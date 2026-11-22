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

const server = new McpServer({
  name: "selene-mcp-server",
  version: "0.4.0",
});

categories.register(server);
transactions.register(server);
monthlySummary.register(server);
monthlyComparison.register(server);
transactionDetail.register(server);
statistics.register(server);
itemCategories.register(server);
userSettings.register(server);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[selene-mcp] ready on stdio (base=${getBaseUrl()})`);
}

main().catch((err) => {
  console.error("[selene-mcp] fatal:", err);
  process.exit(1);
});
