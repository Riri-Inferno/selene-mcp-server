import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const server = new McpServer({
  name: "selene-mcp-server",
  version: "0.1.0",
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[selene-mcp] ready on stdio");
}

main().catch((err) => {
  console.error("[selene-mcp] fatal:", err);
  process.exit(1);
});
