import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { seleneGet } from "../seleneClient.js";

const year = z.number().int().min(2000).max(2100).describe("対象年（必須、2000-2100）");
const month = z.number().int().min(1).max(12).describe("対象月（必須、1-12）");

export function register(server: McpServer): void {
  server.registerTool(
    "get_statistics_category_breakdown",
    {
      title: "カテゴリ別支出内訳を取得",
      description:
        "指定月の支出をカテゴリごとに集計し、金額と構成比（%）を返す。全カテゴリを返す（上位N件に絞らない）。",
      inputSchema: { year, month },
    },
    async ({ year, month }) => {
      const body = await seleneGet("/api/Statistics/category-breakdown", { year, month });
      return { content: [{ type: "text", text: body }] };
    }
  );

  server.registerTool(
    "get_statistics_trend",
    {
      title: "月次推移を取得",
      description:
        "基準月から遡って、指定した月数分の月ごとの収支推移を返す。基準年月を省略すると現在の月が基準になる。",
      inputSchema: {
        months: z
          .number()
          .int()
          .min(1)
          .max(24)
          .optional()
          .describe("取得する月数（1-24、既定: 12）"),
        year: z.number().int().min(2000).max(2100).optional().describe("基準年（省略時は現在）"),
        month: z.number().int().min(1).max(12).optional().describe("基準月（省略時は現在）"),
      },
    },
    async ({ months, year, month }) => {
      const body = await seleneGet("/api/Statistics/trend", { months, year, month });
      return { content: [{ type: "text", text: body }] };
    }
  );

  server.registerTool(
    "get_statistics_highlights",
    {
      title: "月次ハイライトを取得",
      description: "指定月の支出について、目立った点（ハイライト）を返す。",
      inputSchema: { year, month },
    },
    async ({ year, month }) => {
      const body = await seleneGet("/api/Statistics/highlights", { year, month });
      return { content: [{ type: "text", text: body }] };
    }
  );

  server.registerTool(
    "get_statistics_date_range",
    {
      title: "取引データの日付範囲を取得",
      description:
        "登録されている取引の最も古い日付と最も新しい日付を返す。集計する期間を決める前に呼ぶとよい。",
      inputSchema: {},
    },
    async () => {
      const body = await seleneGet("/api/Statistics/date-range");
      return { content: [{ type: "text", text: body }] };
    }
  );
}
