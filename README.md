# selene-mcp-server

[SELENE (ServerlessKakeibo)](https://kakeibo.riri-inferno.com/) の GET 系エンドポイントを LLM から扱えるようにする MCP (Model Context Protocol) サーバ。

TypeScript 製、stdio トランスポート、Docker で配布可能。Claude Desktop / Claude Code / MCP Inspector などの MCP クライアントから利用できる。

## なぜ作ったか

SELENE は家計簿アプリで、Web UI で取引・統計・カテゴリを閲覧できる。この MCP サーバを Claude に繋ぐと、LLM が「先月の支出は？」「カテゴリ何ある？」のような質問を、API を自律的に叩いて答えられるようになる。

## ステータス: API キー認証対応版

SELENE 本体側に **ユーザー単位の長寿命 API キー** 発行・認証の仕組みが入ったので、当リポジトリも JWT 直貼り運用から API キー (`SELENE_API_KEY`) 運用へ切り替えた。これ以降、残りの GET / POST 系 Tool を順次追加していく予定。

API キーの設計仕様は SELENE 本体リポジトリの [`Document/Architecture/api-key-auth.md`](https://github.com/Riri-Inferno/ServerlessKakeibo/blob/main/Document/Architecture/api-key-auth.md) 参照。要点:

- API キーは SELENE の Web UI から発行する（`slk_` で始まる長寿命トークン）
- 送信は **JWT と同じ `Authorization: Bearer <key>`** ヘッダ。スキーム判別は接頭辞 (`slk_` / `eyJ`) で行われる
- 初期リリースでは `read` スコープのキーのみ発行可能。書き込み系 Tool が必要になった時点で `write` スコープを別途検討

### 今できていること
- TypeScript で MCP サーバを実装、stdio で MCP プロトコルを話せる
- SELENE の **GET 12種**（取引・カテゴリ・統計・ユーザー設定）を Tool として提供（一覧は「提供している Tool」参照）
- API エラー時は、ステータスごとの対処方法を添えて `isError` の結果としてモデルに返す
- Zod による入力スキーマ → JSON Schema 自動変換、LLM への引数仕様提示
- Docker イメージ化、`docker run -i --rm -e ... selene-mcp:latest` で MCP クライアントから繋がる
- `SELENE_API_KEY` 経由の認証（`slk_` プレフィックス未一致時は起動時に警告）

### 現状の制約
- 書き込み系（POST/PUT/DELETE）Tool は未実装。SELENE 側で `write` スコープを発行可能にする UI が整ってから着手予定

## クイックスタート（Docker）

```bash
# ビルド
docker build -t selene-mcp:latest .

# 動作確認（任意の MCP クライアントから）
docker run -i --rm \
  -e SELENE_API_KEY="slk_..." \
  -e SELENE_API_BASE_URL="https://api-kakeibo.riri-inferno.com" \
  selene-mcp:latest
```

## MCP クライアントへの登録

Claude Desktop の `claude_desktop_config.json` または Claude Code の `.mcp.json` / `settings.json` の `mcpServers` に：

```json
{
  "mcpServers": {
    "selene": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "-e", "SELENE_API_KEY",
        "-e", "SELENE_API_BASE_URL",
        "selene-mcp:latest"
      ],
      "env": {
        "SELENE_API_KEY": "slk_...",
        "SELENE_API_BASE_URL": "https://api-kakeibo.riri-inferno.com"
      }
    }
  }
}
```

## 環境変数

| 名前 | 必須 | 既定値 | 説明 |
|---|---|---|---|
| `SELENE_API_KEY` | ✅ | — | SELENE で発行された API キー。`slk_` で始まる文字列。`Bearer ` プレフィックスは付いていてもなくても良い（内部で剥がす） |
| `SELENE_API_BASE_URL` | — | `https://api-kakeibo.riri-inferno.com` | API ホスト。ローカル開発時は `http://localhost:8080` 等 |

> ⚠️ API キーは発行時の 1 回のみ平文で表示され、以降は再表示できない（SELENE 側で PBKDF2 ハッシュ保存）。漏洩した場合は SELENE の UI から個別失効してから再発行する。

## 提供している Tool

| Tool 名 | 概要 | エンドポイント |
|---|---|---|
| `get_transaction_categories` | 取引カテゴリ一覧（マスタ+カスタム） | `GET /api/categories/transaction` |
| `get_transactions` | 取引一覧（page/期間/カテゴリ/金額/種別でフィルタ） | `GET /Transaction` |
| `get_monthly_summary` | 月次サマリ（収入/支出/差引/トップ3カテゴリ） | `GET /TransactionSummary/monthly` |
| `get_statistics_monthly_comparison` | 前月比込み月次サマリ | `GET /api/Statistics/monthly-comparison` |
| `get_transaction_detail` | 取引詳細（品目・税・店舗情報） | `GET /Transaction/{id}` |
| `get_statistics_category_breakdown` | カテゴリ別支出内訳（金額・構成比） | `GET /api/Statistics/category-breakdown` |
| `get_statistics_trend` | 月次の収支推移（最大24か月） | `GET /api/Statistics/trend` |
| `get_statistics_highlights` | 月次ハイライト（最大支出・最多カテゴリなど） | `GET /api/Statistics/highlights` |
| `get_statistics_date_range` | 取引データの日付範囲 | `GET /api/Statistics/date-range` |
| `get_item_categories` | 商品カテゴリ一覧（支出の品目用） | `GET /api/categories/item` |
| `get_income_item_categories` | 給与項目カテゴリ一覧（収入の明細用） | `GET /api/categories/income-item` |
| `get_user_settings` | ユーザー設定（締め日・タイムゾーン・通貨など） | `GET /api/user/settings` |

各 Tool の引数仕様は `src/tools/*.ts` の Zod スキーマ（`.describe()` 付き）を参照。

## 開発

```bash
# 依存インストール
npm install

# 開発実行（tsx で TS を直接実行）
npm run dev

# MCP Inspector で動作確認
export SELENE_API_KEY="slk_..."
export SELENE_API_BASE_URL="https://api-kakeibo.riri-inferno.com"
npm run inspect
# → http://localhost:6274/ をブラウザで開く

# 型チェック
npx tsc --noEmit

# ビルド
npm run build
```

### プロジェクト構成

```
src/
├── index.ts             # 起動 + 各 Tool の register 呼び出し
├── seleneClient.ts      # 共通 HTTP ヘルパ（base URL + Bearer + クエリ整形）
└── tools/
    ├── categories.ts
    ├── transactions.ts
    ├── transactionDetail.ts
    ├── monthlySummary.ts
    ├── monthlyComparison.ts
    ├── statistics.ts
    ├── itemCategories.ts
    └── userSettings.ts
```

各 Tool ファイルは `export function register(server: McpServer): void` を export する。新しい GET を追加する場合：

1. `src/tools/<新Tool>.ts` を作成し、`register(server)` を実装
2. `src/index.ts` で import → `register(server)` を呼ぶ
3. `npm run dev` → Inspector で `tools/list` に出ること、`tools/call` でデータが返ることを確認

## 技術スタック

- TypeScript on Node.js 22
- [`@modelcontextprotocol/sdk`](https://github.com/modelcontextprotocol/typescript-sdk)
- [Zod](https://zod.dev/) — Tool 入力スキーマ → JSON Schema 自動変換
- Docker (multi-stage, alpine)

## 参考

- [Model Context Protocol 公式](https://modelcontextprotocol.io/)
- 配布パターンの参考実装: [nulab/backlog-mcp-server](https://github.com/nulab/backlog-mcp-server)
- SELENE 本体: [Riri-Inferno/ServerlessKakeibo](https://github.com/Riri-Inferno/ServerlessKakeibo)
- API キー認証 設計ドキュメント: [`Document/Architecture/api-key-auth.md`](https://github.com/Riri-Inferno/ServerlessKakeibo/blob/main/Document/Architecture/api-key-auth.md)
