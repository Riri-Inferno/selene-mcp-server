# k3s に常駐させる MCP サーバーのアーキテクチャ

selene-mcp-server を自宅の k3s（raspi5）に Pod として常駐させ、Streamable HTTP で公開する構成。スマホやデスクトップの Claude アプリから、ローカルに何も入れずに SELENE の取引を読み書きできるようにする（Riri-Inferno/ServerlessKakeibo#100）。

接続の方法は 2 つ。

- **API キーで接続**：SELENE の画面で発行した API キーを、`Authorization` ヘッダーで渡す。Claude Code など、ヘッダーを設定できるクライアント向け
- **OAuth で接続**（未実装）：ユーザーは SELENE の既存のログイン（Google / GitHub）で承認するだけでよく、API キーを手で発行して貼る必要がない。Claude アプリのカスタムコネクタ向け

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

  CA -- "HTTPS + OAuth トークン（未実装）" --> DNS
  CC -- "HTTPS + Bearer slk_..." --> DNS
  DNS --> Tunnel --> CFD
  CFD -- "Host: mcp-kakeibo.riri-inferno.com" --> MCP
  MCP -- "クラスタ内の通信<br/>Bearer slk_... をそのまま転送" --> BE
  BE --> DB
  CS -. "子プロセス起動<br/>SELENE_API_KEY" .-> LocalMCP["selene-mcp-server<br/>（ローカル / stdio）"]
  LocalMCP -. "HTTPS" .-> BE
```

ポイント:

- **MCP サーバーは秘密情報を持たない**。受け取った API キーを backend に転送するだけで、認証と認可（`read` / `read write` スコープ）は SELENE 本体が判断する
- **ステートレス**。セッションを持たず、`POST /mcp` のたびに McpServer を作って捨てる。Pod を再起動しても、台数を増やしても、クライアント側には影響がない
- **stdio も残す**。`MCP_TRANSPORT` の既定は stdio なので、ローカルで子プロセスとして起動する従来の使い方はそのまま動く

## API キーで接続する

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

## OAuth で接続する（未実装）

Claude アプリのカスタムコネクタから、ユーザーごとに自分の SELENE アカウントで接続できるようにする。SELENE の backend を認可サーバーにし、MCP サーバーは受け取ったトークンを backend 宛ての短命なトークンに交換して API を呼ぶ。設計の選択肢、決定の理由、満たす必要がある仕様は [oauth-design.md](oauth-design.md) にまとめた。

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
