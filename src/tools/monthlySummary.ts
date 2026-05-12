import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { seleneGet } from "../seleneClient.js";

export function register(server: McpServer): void {
  server.registerTool(
    "get_monthly_summary",
    {
      title: "月次サマリーを取得",
      description:
        "指定月の収入合計・支出合計・差引（収入-支出）・支出トップ3カテゴリを返す。差引が正なら黒字、負なら赤字、0なら収支ゼロ。",
      inputSchema: {
        year: z
          .number()
          .int()
          .min(2000)
          .max(2100)
          .describe("対象年（必須、2000-2100）"),
        month: z
          .number()
          .int()
          .min(1)
          .max(12)
          .describe("対象月（必須、1-12）"),
      },
    },
    async ({ year, month }) => {
      const body = await seleneGet("/TransactionSummary/monthly", { year, month });
      return { content: [{ type: "text", text: body }] };
    }
  );
}
