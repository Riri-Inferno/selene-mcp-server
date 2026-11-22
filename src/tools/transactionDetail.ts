import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { seleneGet } from "../seleneClient.js";

export function register(server: McpServer): void {
  server.registerTool(
    "get_transaction_detail",
    {
      title: "取引詳細を取得",
      description:
        "取引 ID を指定して、その取引の詳細（品目、税情報、店舗情報など）を返す。ID は get_transactions の結果から取得する。",
      inputSchema: {
        id: z.string().uuid().describe("取引 ID（UUID）"),
      },
    },
    async ({ id }) => {
      const body = await seleneGet(`/Transaction/${encodeURIComponent(id)}`);
      return { content: [{ type: "text", text: body }] };
    }
  );
}
