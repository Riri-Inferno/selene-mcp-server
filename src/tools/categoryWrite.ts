import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { seleneDelete, selenePost, selenePut } from "../seleneClient.js";

/**
 * カテゴリは 3 種類あり、API のパスだけが違う。
 * Tool を 3 倍に増やさず、kind 引数で切り替える。
 */
const kindPaths = {
  transaction: "/api/categories/transaction",
  item: "/api/categories/item",
  "income-item": "/api/categories/income-item",
} as const;

const kind = z
  .enum(["transaction", "item", "income-item"])
  .describe(
    "カテゴリの種類。transaction（取引カテゴリ）、item（支出の品目カテゴリ）、income-item（収入の明細カテゴリ）"
  );

const id = z.string().uuid().describe("カテゴリ ID。一覧系の Tool で取得する");
const name = z.string().min(1).max(100).describe("カテゴリ名");
const colorCode = z
  .string()
  .regex(/^#[0-9A-Fa-f]{6}$/)
  .describe("表示色（#RRGGBB 形式）。例: #4F46E5");

const path = (k: keyof typeof kindPaths, categoryId?: string, suffix = "") =>
  `${kindPaths[k]}${categoryId ? `/${encodeURIComponent(categoryId)}` : ""}${suffix}`;

export function register(server: McpServer): void {
  server.registerTool(
    "create_category",
    {
      title: "カテゴリを作成",
      description:
        "ユーザー独自のカテゴリを作成する。作成前に一覧系の Tool で同じ名前のカテゴリがないか確認すること（非表示のものは includeHidden: true で確認でき、restore_category で戻せる）。",
      inputSchema: {
        kind,
        name,
        colorCode,
        isIncome: z
          .boolean()
          .optional()
          .describe("kind が transaction のときだけ使う。true で収入用、false で支出用（既定: false）"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async ({ kind, name, colorCode, isIncome }) => {
      const reqBody = kind === "transaction" ? { name, colorCode, isIncome: isIncome ?? false } : { name, colorCode };
      const body = await selenePost(path(kind), reqBody);
      return { content: [{ type: "text", text: body }] };
    }
  );

  server.registerTool(
    "update_category",
    {
      title: "カテゴリを更新",
      description:
        "カテゴリの名前、表示色、表示順を更新する。3 つとも必須なので、変えない項目は一覧系の Tool で取得した現在の値を渡す。",
      inputSchema: {
        kind,
        id,
        name,
        colorCode,
        displayOrder: z.number().int().min(1).describe("表示順（1 以上）"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async ({ kind, id, ...rest }) => {
      const body = await selenePut(path(kind, id), rest);
      return { content: [{ type: "text", text: body }] };
    }
  );

  server.registerTool(
    "delete_category",
    {
      title: "カテゴリを削除（非表示にする）",
      description:
        "カテゴリを非表示にする。データは消えず、restore_category で元に戻せる。そのカテゴリが付いた既存の取引はそのまま残る。",
      inputSchema: { kind, id },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    async ({ kind, id }) => {
      const body = await seleneDelete(path(kind, id));
      return { content: [{ type: "text", text: body }] };
    }
  );

  server.registerTool(
    "restore_category",
    {
      title: "カテゴリを元に戻す",
      description:
        "delete_category で非表示にしたカテゴリを、再び表示する。対象の ID は、一覧系の Tool に includeHidden: true を付けて取得する。",
      inputSchema: { kind, id },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async ({ kind, id }) => {
      const body = await selenePost(path(kind, id, "/restore"));
      return { content: [{ type: "text", text: body }] };
    }
  );
}
