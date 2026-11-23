import express, { type Request, type Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { hostHeaderValidation } from "@modelcontextprotocol/sdk/server/middleware/hostHeaderValidation.js";
import { getBaseUrl, runWithApiKey } from "./seleneClient.js";
import { createServer, version } from "./server.js";

const API_KEY_PREFIX = "slk_";

/**
 * Streamable HTTP で MCP を待ち受ける（ステートレス）。
 *
 * - セッションは持たない。POST /mcp のたびに McpServer と Transport を作り、応答したら捨てる
 *   （Pod を再起動しても、複数台に増やしても、クライアント側で何も起きない）
 * - 認証は SELENE 本体に任せる。Authorization ヘッダーの API キーを、そのまま backend に転送する
 *   （この Pod は秘密情報を持たない）
 */
export function startHttpServer(): void {
  const port = Number(process.env.PORT ?? 3000);
  const allowedHosts = process.env.MCP_ALLOWED_HOSTS?.split(",")
    .map((h) => h.trim())
    .filter(Boolean);

  const app = express();

  // k8s の probe 用。Host ヘッダーは Pod の IP になるので、Host の検証より前に置く
  app.get("/healthz", (_req, res) => {
    res.json({ status: "ok", version });
  });

  const mcp = express.Router();
  // DNS rebinding 対策: 公開しているホスト名以外の Host ヘッダーを拒否する
  if (allowedHosts?.length) {
    mcp.use(hostHeaderValidation(allowedHosts));
  } else {
    console.error("[selene-mcp] WARNING: MCP_ALLOWED_HOSTS が未設定のため、Host ヘッダーを検証しません。");
  }
  mcp.use(express.json({ limit: "1mb" }));

  mcp.post("/", async (req: Request, res: Response) => {
    const apiKey = extractApiKey(req);
    if (!apiKey) {
      res
        .status(401)
        .set("WWW-Authenticate", 'Bearer realm="selene-mcp"')
        .json(jsonRpcError(-32001, "Authorization: Bearer slk_... ヘッダーで SELENE の API キーを指定してください"));
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
      // Tool の処理（seleneClient）まで、このリクエストの API キーを運ぶ
      await runWithApiKey(apiKey, () => transport.handleRequest(req, res, req.body));
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
      `[selene-mcp] v${version} ready on http://0.0.0.0:${port}/mcp (base=${getBaseUrl()}, allowedHosts=${allowedHosts?.join(",") ?? "*"})`
    );
  });
}

/** Authorization: Bearer slk_... から API キーを取り出す。形式が違えば undefined */
function extractApiKey(req: Request): string | undefined {
  const match = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization ?? "");
  const token = match?.[1];
  return token?.startsWith(API_KEY_PREFIX) ? token : undefined;
}

function jsonRpcError(code: number, message: string) {
  return { jsonrpc: "2.0", error: { code, message }, id: null };
}
