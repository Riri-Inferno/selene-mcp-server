# selene-mcp-server

[SELENE (ServerlessKakeibo)](https://kakeibo.riri-inferno.com/) の GET 系エンドポイントを LLM から扱えるようにする MCP (Model Context Protocol) サーバ。

TypeScript 製、stdio トランスポート、Docker で配布可能。Claude Desktop / Claude Code / MCP Inspector などの MCP クライアントから利用できる。

## なぜ作ったか

SELENE は家計簿アプリで、Web UI で取引・統計・カテゴリを閲覧できる。この MCP サーバを Claude に繋ぐと、LLM が「先月の支出は？」「カテゴリ何ある？」のような質問を、API を自律的に叩いて答えられるようになる。

## ステータス: API キー認証対応版

SELENE 本体側に **ユーザー単位の長寿命 API キー** 発行・認証の仕組みが入ったので、当リポジトリも JWT 直貼り運用から API キー (`SELENE_API_KEY`) 運用へ切り替えた。読み取り 12 種と書き込み 7 種の Tool を提供している。

API キーの設計仕様は SELENE 本体リポジトリの [`Document/Architecture/api-key-auth.md`](https://github.com/Riri-Inferno/ServerlessKakeibo/blob/main/Document/Architecture/api-key-auth.md) 参照。要点:

- API キーは SELENE の Web UI から発行する（`slk_` で始まる長寿命トークン）
- 送信は **JWT と同じ `Authorization: Bearer <key>`** ヘッダ。スキーム判別は接頭辞 (`slk_` / `eyJ`) で行われる
- 発行できるのは `read`（読み取りのみ）か `read write`（書き込みも許可）の 2 種類。書き込み系 Tool を使うには `read write` のキーが必要

### 今できていること
- TypeScript で MCP サーバを実装、stdio で MCP プロトコルを話せる
- SELENE の **読み取り 12 種**（取引・カテゴリ・統計・ユーザー設定）と **書き込み 7 種**（取引とカテゴリの作成・更新・削除）を Tool として提供（一覧は「提供している Tool」参照）
- 書き込み系 Tool には MCP の annotations（`destructiveHint` など）を付けている
- API エラー時は、ステータスごとの対処方法を添えて `isError` の結果としてモデルに返す
- Zod による入力スキーマ → JSON Schema 自動変換、LLM への引数仕様提示
- Docker イメージ化、`docker run -i --rm -e ... selene-mcp:latest` で MCP クライアントから繋がる
- `SELENE_API_KEY` 経由の認証（`slk_` プレフィックス未一致時は起動時に警告）

### 現状の制約
- レシート画像の読み取りは提供しない。クライアント側の LLM が画像を読み、`create_transaction` で登録する
- 取引の更新は全体の置き換え。`get_transaction_detail` で取得してから、全体を `update_transaction` に渡す
- カテゴリのリセット・並べ替え、ユーザー設定の更新、エクスポート、全データ削除は API キーでは使えない（SELENE の画面から操作する）
- リモート（HTTP）では、API キーを `Authorization` ヘッダーで渡せるクライアント（Claude Code など）だけが使える。claude.ai やスマホのコネクタ向けの OAuth 対応は [ServerlessKakeibo#100](https://github.com/Riri-Inferno/ServerlessKakeibo/issues/100) で対応する予定

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

## リモートで使う（Streamable HTTP）

`MCP_TRANSPORT=http` で起動すると、`POST /mcp` で MCP を待ち受ける（ステートレス）。SELENE の k3s では `https://mcp-kakeibo.riri-inferno.com/mcp` で公開している。

- 認証は SELENE 本体に任せる。リクエストの `Authorization: Bearer slk_...` を、そのまま SELENE API に転送する（サーバーは API キーを保存しない）
- ヘッダーがない、または `slk_` で始まらない場合は 401
- `MCP_ALLOWED_HOSTS` 以外の Host ヘッダーは 403（DNS rebinding 対策）
- `GET /healthz` は死活監視用（認証なし）

Claude Code への登録（端末に Node やビルド済みのコードは不要）:

```bash
claude mcp add --transport http selene https://mcp-kakeibo.riri-inferno.com/mcp \
  --header "Authorization: Bearer slk_..."
```

## MCP クライアントへの登録（ローカル・stdio）

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
| `SELENE_API_KEY` | stdio のみ | — | SELENE で発行された API キー。`slk_` で始まる文字列。`Bearer ` プレフィックスは付いていてもなくても良い（内部で剥がす） |
| `SELENE_API_BASE_URL` | — | `https://api-kakeibo.riri-inferno.com` | API ホスト。ローカル開発時は `http://localhost:8080`、k3s ではクラスタ内の Service の URL |
| `MCP_TRANSPORT` | — | `stdio` | `stdio` または `http` |
| `PORT` | — | `3000` | HTTP モードの待ち受けポート |
| `MCP_ALLOWED_HOSTS` | — | （検証しない） | HTTP モードで許可する Host ヘッダー（カンマ区切り）。公開時は必ず指定する |

`SELENE_API_KEY` が必須なのは stdio モードだけ。HTTP モードではリクエストのヘッダーのキーを使う。

> ⚠️ API キーは発行時の 1 回のみ平文で表示され、以降は再表示できない（SELENE 側で PBKDF2 ハッシュ保存）。漏洩した場合は SELENE の UI から個別失効してから再発行する。

## 提供している Tool

### 読み取り（`read` スコープ）

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
| `get_user_settings` | ユーザー設定（締め日・タイムゾーン・通貨など）。API キーではメールアドレスとアイコン URL は返らない | `GET /api/user/settings` |

### 書き込み（`read write` スコープ）

| Tool 名 | 概要 | エンドポイント |
|---|---|---|
| `create_transaction` | 取引を登録（支出は品目が1件以上必要） | `POST /Transaction` |
| `update_transaction` | 取引を全体置き換えで更新。合計はサーバーが品目から再計算 | `PUT /Transaction/{id}` |
| `delete_transaction` | 取引を削除 | `DELETE /Transaction/{id}` |
| `create_category` | カテゴリを作成（`kind`: transaction / item / income-item） | `POST /api/categories/{kind}` |
| `update_category` | カテゴリの名前・色・表示順を更新 | `PUT /api/categories/{kind}/{id}` |
| `delete_category` | カテゴリを非表示にする（restore で戻せる） | `DELETE /api/categories/{kind}/{id}` |
| `restore_category` | 非表示にしたカテゴリを戻す | `POST /api/categories/{kind}/{id}/restore` |

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

### バージョンの上げ方

バージョンは `package.json` だけで管理し、サーバーは起動時にそこから読む。上げるときは `npm version` を使う（`package-lock.json` も一緒に更新される）。

```bash
npm version minor --no-git-tag-version   # 0.5.0 → 0.6.0
```

### リリース

develop を main にマージしてから、**Target を main にして** GitHub Release（例: `v0.6.0`）を公開する。公開すると `.github/workflows/release.yml` が arm64 のイメージを build して、`ghcr.io/riri-inferno/selene-mcp-server` に `:latest` と `:<タグ>` で push する。k3s 上の keel が `:latest` の更新を検知して、Pod を入れ替える。

Target が main 以外の Release では build しない。

### プロジェクト構成

```
src/
├── index.ts             # 起動（MCP_TRANSPORT で stdio / http を切り替え）
├── server.ts            # McpServer の生成と各 Tool の register 呼び出し
├── http.ts              # Streamable HTTP（ステートレス、API キーの転送）
├── seleneClient.ts      # 共通 HTTP ヘルパ（GET/POST/PUT/DELETE、Bearer、エラー時の対処ヒント）
└── tools/
    ├── categories.ts
    ├── transactions.ts
    ├── transactionDetail.ts
    ├── monthlySummary.ts
    ├── monthlyComparison.ts
    ├── statistics.ts
    ├── itemCategories.ts
    ├── userSettings.ts
    ├── transactionWrite.ts  # 取引の登録・更新・削除
    └── categoryWrite.ts     # カテゴリの作成・更新・削除・復元
```

各 Tool ファイルは `export function register(server: McpServer): void` を export する。新しい Tool を追加する場合：

1. `src/tools/<新Tool>.ts` を作成し、`register(server)` を実装
2. `src/server.ts` で import → `register(server)` を呼ぶ
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
- k3s に常駐させる MCP サーバーのアーキテクチャ: [`docs/architecture.md`](docs/architecture.md)
- API キー認証 設計ドキュメント: [`Document/Architecture/api-key-auth.md`](https://github.com/Riri-Inferno/ServerlessKakeibo/blob/main/Document/Architecture/api-key-auth.md)
