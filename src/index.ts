import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { getBaseUrl } from "./seleneClient.js";
import * as categories from "./tools/categories.js";
import * as transactions from "./tools/transactions.js";
import * as monthlySummary from "./tools/monthlySummary.js";
import * as monthlyComparison from "./tools/monthlyComparison.js";
import * as transactionDetail from "./tools/transactionDetail.js";
import * as statistics from "./tools/statistics.js";
import * as itemCategories from "./tools/itemCategories.js";
import * as userSettings from "./tools/userSettings.js";
import * as transactionWrite from "./tools/transactionWrite.js";
import * as categoryWrite from "./tools/categoryWrite.js";

// バージョンは package.json を唯一の正とする（npm version で上げる）。
// src/ と dist/ のどちらから実行しても ../package.json を指す。
const { version } = createRequire(import.meta.url)("../package.json") as { version: string };

const server = new McpServer({
  name: "selene-mcp-server",
  version,
});

categories.register(server);
transactions.register(server);
monthlySummary.register(server);
monthlyComparison.register(server);
transactionDetail.register(server);
statistics.register(server);
itemCategories.register(server);
userSettings.register(server);

// 書き込み系（read write スコープのキーが必要）
transactionWrite.register(server);
categoryWrite.register(server);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[selene-mcp] v${version} ready on stdio (base=${getBaseUrl()})`);
}

main().catch((err) => {
  console.error("[selene-mcp] fatal:", err);
  process.exit(1);
});
