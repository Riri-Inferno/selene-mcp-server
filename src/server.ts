import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
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
export const { version } = createRequire(import.meta.url)("../package.json") as { version: string };

/**
 * 全 Tool を登録した McpServer を作る。
 * stdio では起動時に 1 回、HTTP ではリクエストごとに呼ばれる。
 */
export function createServer(): McpServer {
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

  return server;
}
