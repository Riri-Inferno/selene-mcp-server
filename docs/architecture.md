# アーキテクチャ（To-Be）

Issue Riri-Inferno/ServerlessKakeibo#100 で目指す構成。スマホやデスクトップの Claude アプリから、ローカルに何も入れずに SELENE の取引を読み書きできるようにする。

- **Phase 3a**：MCP サーバーを k3s の Pod として動かし、Streamable HTTP で公開する。認証は、`Authorization` ヘッダーで渡す API キー
- **Phase 3b**（予定）：OAuth に対応する。ユーザーは SELENE の既存のログイン（Google / GitHub）で承認するだけでよく、API キーを手で発行して貼る必要がなくなる

特定のモデルやクライアントに縛られないように、MCP の標準（Streamable HTTP と MCP Authorization）に沿って作る。

## 全体の構成

```mermaid
flowchart LR
  subgraph Client["クライアント"]
    CA["Claude アプリ<br/>（スマホ / デスクトップ / Web）"]
    CC["Claude Code など<br/>（HTTP の MCP クライアント）"]
    CS["stdio の MCP クライアント<br/>（従来の使い方）"]
  end

  subgraph CF["Cloudflare"]
    DNS["mcp-kakeibo.riri-inferno.com<br/>（DNS: Terraform）"]
    Tunnel["Cloudflare Tunnel"]
  end

  subgraph K3s["raspi5 / k3s（namespace: kakeibo）"]
    CFD["cloudflared"]
    MCP["kakeibo-mcp<br/>MCP_TRANSPORT=http<br/>:3000 /mcp"]
    BE["kakeibo-backend<br/>（ASP.NET Core）:8080"]
    DB[("PostgreSQL")]
  end

  CA -- "HTTPS + OAuth トークン（3b）" --> DNS
  CC -- "HTTPS + Bearer slk_...（3a）" --> DNS
  DNS --> Tunnel --> CFD
  CFD -- "Host: mcp-kakeibo.riri-inferno.com" --> MCP
  MCP -- "クラスタ内の通信<br/>Bearer slk_... をそのまま転送" --> BE
  BE --> DB
  CS -. "子プロセス起動<br/>SELENE_API_KEY" .-> LocalMCP["selene-mcp-server<br/>（ローカル / stdio）"]
  LocalMCP -. "HTTPS" .-> BE
```

ポイント:

- **MCP サーバーは秘密情報を持たない**。受け取った API キー（3b では、OAuth のトークンとして発行された API キー）を backend に転送するだけで、認証と認可（`read` / `read write` スコープ）は SELENE 本体が判断する
- **ステートレス**。セッションを持たず、`POST /mcp` のたびに McpServer を作って捨てる。Pod を再起動しても、台数を増やしても、クライアント側には影響がない
- **stdio も残す**。`MCP_TRANSPORT` の既定は stdio なので、ローカルで子プロセスとして起動する従来の使い方はそのまま動く

## Phase 3a：API キーをヘッダーで渡す

```mermaid
sequenceDiagram
  autonumber
  actor U as ユーザー
  participant C as MCP クライアント<br/>（Claude Code など）
  participant CF as Cloudflare<br/>（Tunnel / cloudflared）
  participant M as kakeibo-mcp
  participant B as kakeibo-backend

  U->>B: SELENE の画面で API キーを発行（read / read write）
  U->>C: claude mcp add --transport http ... --header "Authorization: Bearer slk_..."

  C->>CF: POST /mcp（tools/call）<br/>Authorization: Bearer slk_...
  CF->>M: 転送（Host ヘッダーはそのまま）
  M->>M: Host ヘッダーを検証（違えば 403）
  M->>M: Bearer slk_... を取り出す（なければ 401）
  M->>M: McpServer と Transport を作る<br/>API キーを AsyncLocalStorage に入れる
  M->>B: GET / POST / PUT / DELETE<br/>Authorization: Bearer slk_...
  alt キーが有効で、スコープが足りる
    B-->>M: 200 / 201
    M-->>C: Tool の結果
  else 無効なキー、またはスコープが足りない
    B-->>M: 401 / 403（理由を本文に書く）
    M-->>C: エラーと対処のヒント
  end
  M->>M: 応答後に McpServer と Transport を破棄
```

## Phase 3b：OAuth で接続する（予定）

MCP の TypeScript SDK が提供する認可サーバーの部品を使い、ログインと承認には SELENE の既存の Google / GitHub ログインを使う。ユーザーが承認したら、SELENE が裏で `read write` の API キーを発行し、それを OAuth のアクセストークンとして返す。

トークンの実体が API キーなので、MCP サーバーから backend への転送（3a の仕組み）は変わらない。

```mermaid
sequenceDiagram
  autonumber
  actor U as ユーザー
  participant C as Claude アプリ<br/>（カスタムコネクタ）
  participant M as kakeibo-mcp<br/>（MCP サーバー兼 認可サーバー）
  participant F as SELENE 画面
  participant B as kakeibo-backend
  participant IdP as Google / GitHub

  C->>M: POST /mcp（トークンなし）
  M-->>C: 401<br/>WWW-Authenticate: Bearer resource_metadata=...
  C->>M: GET /.well-known/oauth-protected-resource
  C->>M: GET /.well-known/oauth-authorization-server
  C->>M: POST /register（Dynamic Client Registration）
  C->>U: ブラウザで認可画面を開く
  U->>M: GET /authorize（PKCE の code_challenge 付き）
  M->>F: SELENE のログインと承認画面へリダイレクト
  U->>F: Google / GitHub でログイン
  F->>IdP: OAuth / OIDC
  IdP-->>F: ログイン完了
  U->>F: 「Claude に家計簿の読み書きを許可」を承認
  F->>B: 承認（JWT で認証）
  B->>B: read write の API キーを発行
  B-->>M: 認可コードとキーを対応付ける
  M-->>C: redirect_uri に認可コードを返す
  C->>M: POST /token（code + code_verifier）
  M-->>C: access_token = slk_...

  Note over C,B: 以降は Phase 3a と同じ流れ
  C->>M: POST /mcp<br/>Authorization: Bearer slk_...
  M->>B: Bearer slk_... を転送
  B-->>M: 結果
  M-->>C: Tool の結果
```

未決事項（3b に入る前に調べる）:

- Claude のカスタムコネクタが求める要件。Dynamic Client Registration は必須か、リフレッシュトークンは必要か
- 認可コードと API キーを、MCP サーバーと backend のどちらが、どう対応付けて保持するか（MCP サーバーをステートレスに保てるか）
- 発行したキーを、SELENE の画面から「Claude 用」とわかる形で一覧・失効できるようにする
- Cloudflare の Bot Fight Mode が、claude.ai からの接続を止めないか

## デプロイ

```mermaid
flowchart LR
  subgraph GH["GitHub"]
    Dev["develop"] -- "マージ" --> Main["main"]
    Main -- "Release を公開<br/>（Target: main）" --> WF["release.yml<br/>arm64 で build"]
    IaC["home-raspi-iac<br/>k3s/apps/kakeibo/mcp/"]
  end
  WF -- "push :latest / :vX.Y.Z" --> GHCR[("ghcr.io/riri-inferno/<br/>selene-mcp-server")]
  IaC -- "マニフェストを同期" --> Argo["ArgoCD"]
  Argo --> Pod["kakeibo-mcp Pod"]
  Keel["keel<br/>（5 分ごとに確認）"] -- ":latest の digest が<br/>変わったら入れ替え" --> Pod
  GHCR -. "pull" .-> Pod
  Keel -. "監視" .-> GHCR
```

- マニフェストの変更は ArgoCD が反映する。イメージの更新は keel が反映する（ArgoCD の Sync ではイメージは更新されない）
- DNS レコードは `home-raspi-iac/terraform/cloudflare/dns.tf`、Tunnel の振り分けは `home-raspi-iac/k3s/apps/cloudflared/configmap.yaml` で管理する
