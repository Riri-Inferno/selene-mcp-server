import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { seleneGet } from "../seleneClient.js";

export function register(server: McpServer): void {
  server.registerTool(
    "get_statistics_monthly_comparison",
    {
      title: "前月比込みの月次サマリーを取得",
      description:
        "指定月と前月の収支を比較し、前月比（%）を含めて返す。前月データがない場合、Previous は null になる。",
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
      const body = await seleneGet("/api/Statistics/monthly-comparison", { year, month });
      return { content: [{ type: "text", text: body }] };
    }
  );
}
