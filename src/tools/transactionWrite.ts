import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { seleneDelete, selenePost, selenePut } from "../seleneClient.js";

const uuid = z.string().uuid();

const itemFields = {
  itemType: z
    .enum(["Product", "Discount"])
    .optional()
    .describe("Product（商品、既定）または Discount（値引き。amount と unitPrice は 0 以下）"),
  name: z.string().min(1).max(200).describe("品目名"),
  quantity: z.number().positive().optional().describe("数量（既定: 1）"),
  unitPrice: z.number().optional().describe("単価"),
  amount: z.number().describe("金額（数量 × 単価。値引きはマイナス値）"),
  userItemCategoryId: uuid
    .optional()
    .describe("支出の品目カテゴリ ID。get_item_categories で取得する"),
  userIncomeItemCategoryId: uuid
    .optional()
    .describe("収入の明細カテゴリ ID（基本給、手当など）。get_income_item_categories で取得する"),
};

const taxFields = {
  taxRate: z.number().int().min(0).max(100).optional().describe("税率（%）。例: 8, 10"),
  taxAmount: z.number().min(0).optional().describe("税額"),
  taxableAmount: z.number().min(0).optional().describe("課税対象額"),
  taxType: z.string().max(50).optional().describe("税の種類（既定: 消費税）"),
};

const shopDetails = z
  .object({
    name: z.string().max(200).optional().describe("店名"),
    branch: z.string().max(200).optional().describe("支店名"),
    postalCode: z.string().max(20).optional(),
    address: z.string().max(500).optional(),
    phoneNumber: z.string().max(20).optional(),
  })
  .optional()
  .describe("店舗情報");

const commonFields = {
  transactionDate: z
    .string()
    .datetime({ offset: true })
    .describe("取引日時（ISO 8601、タイムゾーン付き）。例: 2026-11-23T12:00:00+09:00"),
  currency: z.string().length(3).optional().describe("通貨コード（既定: JPY）"),
  payer: z.string().max(200).optional().describe("支払者（収入の場合は勤務先など）"),
  payee: z.string().max(200).optional().describe("支払先（店名など）"),
  paymentMethod: z.string().max(50).optional().describe("支払方法。例: 現金、クレジットカード"),
  userTransactionCategoryId: uuid
    .optional()
    .describe("取引カテゴリ ID。get_transaction_categories で取得する"),
  notes: z.string().max(1000).optional().describe("メモ"),
  taxInclusionType: z
    .enum(["Unknown", "Exclusive", "Inclusive", "NoTax"])
    .optional()
    .describe("税の扱い。Inclusive（内税）、Exclusive（外税）、NoTax（非課税）、Unknown（不明）"),
  shopDetails,
};

export function register(server: McpServer): void {
  server.registerTool(
    "create_transaction",
    {
      title: "取引を登録",
      description:
        "支出または収入の取引を1件登録する。支出は items（品目）が1件以上必要。収入は amountTotal が必須で、items は任意。" +
        "カテゴリを付ける場合は、先に get_transaction_categories / get_item_categories / get_income_item_categories で ID を取得する。" +
        "レシート画像から登録する場合は、画像を読み取った内容をこの Tool の引数に変換して渡す。",
      inputSchema: {
        type: z.enum(["Expense", "Income"]).describe("Expense（支出）または Income（収入）"),
        amountTotal: z.number().min(0).describe("合計金額"),
        ...commonFields,
        items: z.array(z.object(itemFields)).optional().describe("品目（支出では1件以上必須）"),
        taxes: z.array(z.object(taxFields)).optional().describe("税の内訳"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async (args) => {
      const body = await selenePost("/Transaction", args);
      return { content: [{ type: "text", text: body }] };
    }
  );

  server.registerTool(
    "update_transaction",
    {
      title: "取引を更新（全体を置き換え）",
      description:
        "取引 1 件を、渡した内容で丸ごと置き換える。一部の項目だけを変える操作ではない。" +
        "手順: (1) get_transaction_detail で現在の内容を取得する。(2) 変えたい項目だけ書き換える。(3) 変えない項目も含めて全体を渡す。" +
        "注意: items と taxes に含めなかった既存の明細は削除される。既存の明細を残す場合は、詳細の items[].id を id に入れて渡す。" +
        "合計金額は渡せない。サーバーが items の合計から再計算する（taxInclusionType が Exclusive か Unknown の場合は税額も足す）。" +
        "取引の種別（支出／収入）は変更できない。" +
        "詳細の userTransactionCategory.id は userTransactionCategoryId に、items[].userItemCategory は userItemCategoryId に入れ直す。",
      inputSchema: {
        id: uuid.describe("更新する取引の ID"),
        ...commonFields,
        items: z
          .array(
            z.object({
              id: uuid.optional().describe("既存の明細 ID。新しい明細なら省略"),
              ...itemFields,
            })
          )
          .describe("品目の完全なリスト"),
        taxes: z
          .array(
            z.object({
              id: uuid.optional().describe("既存の税情報 ID。新しい税情報なら省略"),
              ...taxFields,
            })
          )
          .optional()
          .describe("税の内訳の完全なリスト"),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    async ({ id, ...rest }) => {
      const body = await selenePut(`/Transaction/${encodeURIComponent(id)}`, rest);
      return { content: [{ type: "text", text: body }] };
    }
  );

  server.registerTool(
    "delete_transaction",
    {
      title: "取引を削除",
      description:
        "取引を 1 件削除する。この Tool では元に戻せないので、実行前に対象（日付、支払先、金額）をユーザーに示して確認を取ること。",
      inputSchema: {
        id: uuid.describe("削除する取引の ID"),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    async ({ id }) => {
      const body = await seleneDelete(`/Transaction/${encodeURIComponent(id)}`);
      return { content: [{ type: "text", text: body }] };
    }
  );
}
