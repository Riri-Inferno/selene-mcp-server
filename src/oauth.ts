import { getBaseUrl } from "./seleneClient.js";

/**
 * OAuth のリソースサーバーとしての設定（HTTP モードのみ）。
 * MCP_RESOURCE_URL と MCP_AUTHORIZATION_SERVER の両方があるときだけ有効になる。
 * 設計: SELENE 本体の Document/Architecture/mcp-oauth-design.md
 */
export interface OAuthConfig {
  /** この MCP サーバーの URL。backend の OAuth:McpResource と文字列として完全に一致させる */
  resource: string;
  /** 認可サーバー（backend）の issuer */
  authorizationServer: string;
  /** Protected Resource Metadata の URL（401 の WWW-Authenticate で案内する） */
  resourceMetadataUrl: string;
  scopes: string[];
}

export const PROTECTED_RESOURCE_METADATA_PATH = "/.well-known/oauth-protected-resource";

export function loadOAuthConfig(): OAuthConfig | undefined {
  const resource = process.env.MCP_RESOURCE_URL?.trim();
  const authorizationServer = process.env.MCP_AUTHORIZATION_SERVER?.trim();
  if (!resource || !authorizationServer) {
    return undefined;
  }

  // パス付きの resource（例: https://mcp.example.com/mcp）なら、メタデータもパス付きの場所を案内する（RFC 9728）
  const url = new URL(resource);
  const path = url.pathname === "/" ? "" : url.pathname;
  return {
    resource,
    authorizationServer,
    resourceMetadataUrl: `${url.origin}${PROTECTED_RESOURCE_METADATA_PATH}${path}`,
    scopes: ["read", "write"],
  };
}

/** Protected Resource Metadata（RFC 9728） */
export function protectedResourceMetadata(config: OAuthConfig) {
  return {
    resource: config.resource,
    authorization_servers: [config.authorizationServer],
    scopes_supported: config.scopes,
    bearer_methods_supported: ["header"],
    resource_name: "SELENE（家計簿）",
  };
}

/** 401 で返す WWW-Authenticate。クライアントはここから OAuth の接続を始める */
export function wwwAuthenticate(config: OAuthConfig | undefined, error?: "invalid_token"): string {
  if (!config) {
    return 'Bearer realm="selene-mcp"';
  }
  const params = [
    ...(error ? [`error="${error}"`] : []),
    `resource_metadata="${config.resourceMetadataUrl}"`,
    `scope="${config.scopes.join(" ")}"`,
  ];
  return `Bearer ${params.join(", ")}`;
}

const TOKEN_EXCHANGE_PATH = "/internal/oauth/token-exchange";

/**
 * クライアントから受け取った OAuth のアクセストークン（宛先 = この MCP サーバー）を、
 * backend 宛ての短命なトークンに交換する（RFC 8693）。
 * 受け取ったトークンを backend にそのまま渡すことは、MCP の仕様で禁止されている（MUST NOT）。
 * 検証（署名、期限、宛先、連携が失効していないか）は backend が行う。
 *
 * 交換できなければ undefined（クライアントには 401 を返し、リフレッシュしてもらう）
 */
export async function exchangeToken(subjectToken: string): Promise<string | undefined> {
  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
    subject_token: subjectToken,
    subject_token_type: "urn:ietf:params:oauth:token-type:access_token",
  });

  let res: Response;
  try {
    res = await fetch(new URL(TOKEN_EXCHANGE_PATH, getBaseUrl()), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body,
      signal: AbortSignal.timeout(5000),
    });
  } catch (err) {
    console.error("[selene-mcp] token exchange failed:", err instanceof Error ? err.message : err);
    return undefined;
  }

  if (!res.ok) {
    // 期限切れや連携の解除は通常の出来事なので、理由だけ残す（トークンは出さない）
    const detail = await res.text().catch(() => "");
    console.error(`[selene-mcp] token exchange rejected: ${res.status} ${detail.slice(0, 200)}`);
    return undefined;
  }

  const json = (await res.json()) as { access_token?: unknown };
  return typeof json.access_token === "string" ? json.access_token : undefined;
}
