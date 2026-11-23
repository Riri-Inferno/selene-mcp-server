import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { startHttpServer } from "./http.js";
import { getBaseUrl, warnIfEnvApiKeyInvalid } from "./seleneClient.js";
import { createServer, version } from "./server.js";

/**
 * MCP_TRANSPORT で起動方式を切り替える。
 * - stdio（既定）: クライアントが子プロセスとして起動する。API キーは環境変数 SELENE_API_KEY
 * - http: Streamable HTTP で待ち受ける（k3s の Pod など）。API キーはリクエストの Authorization ヘッダー
 */
async function main() {
  const mode = (process.env.MCP_TRANSPORT ?? "stdio").toLowerCase();

  if (mode === "http") {
    startHttpServer();
    return;
  }
  if (mode !== "stdio") {
    throw new Error(`MCP_TRANSPORT は stdio か http を指定してください（指定値: ${mode}）`);
  }

  warnIfEnvApiKeyInvalid();
  await createServer().connect(new StdioServerTransport());
  console.error(`[selene-mcp] v${version} ready on stdio (base=${getBaseUrl()})`);
}

main().catch((err) => {
  console.error("[selene-mcp] fatal:", err);
  process.exit(1);
});
