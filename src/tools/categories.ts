import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { seleneGet } from "../seleneClient.js";

export function register(server: McpServer): void {
  server.registerTool(
    "get_transaction_categories",
    {
      title: "取引カテゴリ一覧を取得",
      description:
        "SELENE のログインユーザの取引カテゴリ一覧（マスタ由来 + カスタム）を返す。家計簿の支出・収入を分類するカテゴリ。",
      inputSchema: {
        includeHidden: z
          .boolean()
          .optional()
          .describe("true にすると非表示カテゴリも含める（既定: false）"),
      },
    },
    async ({ includeHidden }) => {
      const body = await seleneGet("/api/categories/transaction", { includeHidden });
      return { content: [{ type: "text", text: body }] };
    }
  );
}
