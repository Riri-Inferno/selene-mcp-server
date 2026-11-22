import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { seleneGet } from "../seleneClient.js";

const includeHidden = z
  .boolean()
  .optional()
  .describe("true にすると非表示カテゴリも含める（既定: false）");

export function register(server: McpServer): void {
  server.registerTool(
    "get_item_categories",
    {
      title: "商品カテゴリ一覧を取得（支出用）",
      description:
        "取引の明細（品目）を分類する、支出用の商品カテゴリ一覧を返す。取引自体のカテゴリは get_transaction_categories で取得する。",
      inputSchema: { includeHidden },
    },
    async ({ includeHidden }) => {
      const body = await seleneGet("/api/categories/item", { includeHidden });
      return { content: [{ type: "text", text: body }] };
    }
  );

  server.registerTool(
    "get_income_item_categories",
    {
      title: "給与項目カテゴリ一覧を取得（収入用）",
      description: "収入の明細（基本給、手当、控除など）を分類する、給与項目カテゴリの一覧を返す。",
      inputSchema: { includeHidden },
    },
    async ({ includeHidden }) => {
      const body = await seleneGet("/api/categories/income-item", { includeHidden });
      return { content: [{ type: "text", text: body }] };
    }
  );
}
