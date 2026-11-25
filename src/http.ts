import express, { type Request, type Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { hostHeaderValidation } from "@modelcontextprotocol/sdk/server/middleware/hostHeaderValidation.js";
import {
  exchangeToken,
  loadOAuthConfig,
  type OAuthConfig,
  PROTECTED_RESOURCE_METADATA_PATH,
  protectedResourceMetadata,
  wwwAuthenticate,
} from "./oauth.js";
import { type Credential, getBaseUrl, runWithCredential } from "./seleneClient.js";
import { createServer, version } from "./server.js";

const API_KEY_PREFIX = "slk_";

/**
 * Streamable HTTP で MCP を待ち受ける（ステートレス）。
 *
 * - セッションは持たない。POST /mcp のたびに McpServer と Transport を作り、応答したら捨てる
 *   （Pod を再起動しても、複数台に増やしても、クライアント側で何も起きない）
 * - 認証は SELENE 本体に任せる（この Pod は秘密情報を持たない）
 *   - API キー（slk_...）は、そのまま backend に転送する
 *   - OAuth のアクセストークンは、backend で交換してから使う（MCP_RESOURCE_URL と MCP_AUTHORIZATION_SERVER を設定したとき）
 */
export function startHttpServer(): void {
  const port = Number(process.env.PORT ?? 3000);
  const allowedHosts = process.env.MCP_ALLOWED_HOSTS?.split(",")
    .map((h) => h.trim())
    .filter(Boolean);

  const oauth = loadOAuthConfig();

  const app = express();

  // k8s の probe 用。Host ヘッダーは Pod の IP になるので、Host の検証より前に置く
  app.get("/healthz", (_req, res) => {
    res.json({ status: "ok", version });
  });

  // OAuth の Protected Resource Metadata（RFC 9728）。クライアントはここから認可サーバーを知る。
  // 公開情報なので Host の検証はしない。パス付き（/mcp）とルートの両方で返す
  if (oauth) {
    app.get([PROTECTED_RESOURCE_METADATA_PATH, `${PROTECTED_RESOURCE_METADATA_PATH}/*path`], (_req, res) => {
      res.json(protectedResourceMetadata(oauth));
    });
  }

  const mcp = express.Router();
  // DNS rebinding 対策: 公開しているホスト名以外の Host ヘッダーを拒否する
  if (allowedHosts?.length) {
    mcp.use(hostHeaderValidation(allowedHosts));
  } else {
    console.error("[selene-mcp] WARNING: MCP_ALLOWED_HOSTS が未設定のため、Host ヘッダーを検証しません。");
  }
  mcp.use(express.json({ limit: "1mb" }));

  mcp.post("/", async (req: Request, res: Response) => {
    const credential = await resolveCredential(req, oauth);
    if (!credential) {
      res
        .status(401)
        .set("WWW-Authenticate", wwwAuthenticate(oauth, extractBearer(req) ? "invalid_token" : undefined))
        .json(
          jsonRpcError(
            -32001,
            oauth
              ? "SELENE への接続が必要です（OAuth で接続するか、Authorization: Bearer slk_... で API キーを指定してください）"
              : "Authorization: Bearer slk_... ヘッダーで SELENE の API キーを指定してください"
          )
        );
      return;
    }

    const server = createServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });

    try {
      await server.connect(transport);
      // Tool の処理（seleneClient）まで、このリクエストの認証情報を運ぶ
      await runWithCredential(credential, () => transport.handleRequest(req, res, req.body));
    } catch (err) {
      console.error("[selene-mcp] request failed:", err);
      if (!res.headersSent) {
        res.status(500).json(jsonRpcError(-32603, "Internal server error"));
      }
    }
  });

  // ステートレスなので、サーバーからの通知用の GET（SSE）とセッション終了の DELETE は提供しない
  mcp.all("/", (_req, res) => {
    res.status(405).set("Allow", "POST").json(jsonRpcError(-32000, "Method not allowed"));
  });

  app.use("/mcp", mcp);

  app.listen(port, "0.0.0.0", () => {
    console.error(
      `[selene-mcp] v${version} ready on http://0.0.0.0:${port}/mcp (base=${getBaseUrl()}, allowedHosts=${allowedHosts?.join(",") ?? "*"}, oauth=${oauth ? oauth.resource : "off"})`
    );
  });
}

/** Authorization: Bearer ... からトークンを取り出す */
function extractBearer(req: Request): string | undefined {
  return /^Bearer\s+(\S+)$/i.exec(req.headers.authorization ?? "")?.[1];
}

/**
 * リクエストのトークンから、backend を呼ぶための認証情報を決める。
 * - slk_ で始まる：API キーとしてそのまま使う
 * - それ以外：OAuth が有効なら、backend で交換する
 * 使えなければ undefined（401 を返す）
 */
async function resolveCredential(req: Request, oauth: OAuthConfig | undefined): Promise<Credential | undefined> {
  const token = extractBearer(req);
  if (!token) {
    return undefined;
  }
  if (token.startsWith(API_KEY_PREFIX)) {
    return { kind: "api-key", token };
  }
  if (!oauth) {
    return undefined;
  }
  const exchanged = await exchangeToken(token);
  return exchanged ? { kind: "oauth", token: exchanged } : undefined;
}

function jsonRpcError(code: number, message: string) {
  return { jsonrpc: "2.0", error: { code, message }, id: null };
}
