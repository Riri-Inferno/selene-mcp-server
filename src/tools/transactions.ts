import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { seleneGet } from "../seleneClient.js";

export function register(server: McpServer): void {
  server.registerTool(
    "get_transactions",
    {
      title: "取引一覧を取得",
      description:
        "SELENE の取引一覧をページングして取得する。日付範囲、カテゴリ、支払者(payer)、受取者(payee)、金額、取引種別(income/expense)でフィルタ可能。",
      inputSchema: {
        page: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe("ページ番号（1始まり、既定: 1）"),
        pageSize: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe("1ページあたりの件数（1-100、既定: 50）"),
        startDate: z
          .string()
          .optional()
          .describe("開始日 ISO 8601（例: 2026-05-01T00:00:00Z）。これ以降の取引を取得"),
        endDate: z
          .string()
          .optional()
          .describe("終了日 ISO 8601。これ以前の取引を取得"),
        userTransactionCategoryId: z
          .string()
          .uuid()
          .optional()
          .describe("ユーザー取引カテゴリID（get_transaction_categories の id を使う）"),
        payer: z.string().optional().describe("支払者の部分一致検索"),
        payee: z
          .string()
          .max(200)
          .optional()
          .describe("受取者（店舗名）の部分一致検索"),
        minAmount: z
          .number()
          .nonnegative()
          .optional()
          .describe("最小金額"),
        maxAmount: z
          .number()
          .nonnegative()
          .optional()
          .describe("最大金額"),
        type: z
          .enum(["Income", "Expense"])
          .optional()
          .describe("取引種別フィルタ"),
      },
    },
    async (params) => {
      const body = await seleneGet("/Transaction", {
        page: params.page,
        pageSize: params.pageSize,
        startDate: params.startDate,
        endDate: params.endDate,
        userTransactionCategoryId: params.userTransactionCategoryId,
        payer: params.payer,
        payee: params.payee,
        minAmount: params.minAmount,
        maxAmount: params.maxAmount,
        type: params.type,
      });
      return { content: [{ type: "text", text: body }] };
    }
  );
}
