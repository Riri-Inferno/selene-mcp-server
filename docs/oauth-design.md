# OAuth で接続する設計

Claude アプリ（Web・スマホ・デスクトップ）のカスタムコネクタから、ユーザーごとに自分の SELENE アカウントで接続できるようにするための設計。全体の構成は [architecture.md](architecture.md) を参照。

**決定：案 A（SELENE の backend を認可サーバーにする）を採用する。** 決め手は「MCP サーバーは薄いほどよい」こと。MCP サーバーは AI と SELENE の間の通訳に徹し、認証の状態も秘密情報も持たない。

この文書の仕様は、一次ソース（MCP の公式仕様、Claude の公式ドキュメント、MCP TypeScript SDK のソース）に基づく。出典は各節と末尾に記載する。一次ソースで確認できなかったことは「未確認」と書く。

## なぜ OAuth が必要か

- MCP サーバーは公開済みで、`Authorization: Bearer slk_...`（API キー）を付ければ使える。Claude Code はヘッダーを設定できるので、すでに使えている
- Claude アプリのカスタムコネクタでは、個人のアカウントはヘッダーを設定できない
  - ヘッダーで固定の認証情報を送る方式（`static_headers`）は、組織の Owner が設定するもので、ベータ版のため限られた組織しか使えない [C2]
  - その方式でも「組織の認証情報として扱い、個人の認証情報として扱わない。ツールが個々のユーザーとして動く必要があるなら OAuth を使う」とされている [C2]
- OAuth なら、ユーザーはコネクタを追加するときに SELENE にログインして承認するだけでよい。API キーを手で発行して貼る必要がなく、ほかの人もそれぞれ自分のアカウントでつなげる

## 満たす必要がある要件

### Claude のカスタムコネクタ [C1][C2][C3]

| 項目 | 要件 |
|---|---|
| 対応する仕様の版 | 2025-03-26、2025-06-18、2025-11-25 |
| クライアント登録 | DCR（RFC 7591）、CIMD、Anthropic が持つクライアント情報、ユーザーが入力するクライアント情報 のいずれか。DCR と CIMD は「デフォルトでサポート」 |
| CIMD を使う条件 | 認可サーバーのメタデータに `"client_id_metadata_document_supported": true` と、`token_endpoint_auth_methods_supported` に `"none"` があること。なければ DCR にフォールバックする |
| コールバック URL | `https://claude.ai/api/mcp/auth_callback`（Web・デスクトップ・スマホ）。Claude Code はループバック（`http://localhost:<任意のポート>/callback` など） |
| 401 の応答 | `WWW-Authenticate` に `resource_metadata` を付けた 401 を返す。`authorization_servers` は先頭の 1 件だけを使う |
| PKCE | S256 が必須 |
| トークンの更新 | 401 を受けたとき、または有効期限の 5 分前から更新する。リフレッシュトークンのローテーションと、`invalid_grant` などの RFC 6749 のエラーコードが必要 |
| トークンエンドポイント | `application/x-www-form-urlencoded` を受け付ける |
| タイムアウト | メタデータ、登録、トークンのエンドポイントは 10 秒、更新は 30 秒、Tool の呼び出しは 240 秒 |
| 接続元 | 端末ではなく Anthropic のクラウド（スマホも同じ）。IP は `160.79.104.0/21` |
| ポート | 443 のみ |
| 利用できるプラン | Free 以上（Free はカスタムコネクタ 1 つまで） |

### MCP の仕様（最新版 2026-07-28）[S1]

Claude が対応しているのは 2025-11-25 版までだが、最新版にも合わせておく。

- MCP サーバーは Protected Resource Metadata（RFC 9728）を提供しなければならない（MUST）。`authorization_servers` を含める
- 認可サーバーは RFC 8414 か OpenID Connect Discovery のメタデータを提供する（MUST）。`issuer` はメタデータの URL と完全に一致させる。`code_challenge_methods_supported` に `S256` を含める
- **MCP サーバーは、トークンが自分宛て（audience）に発行されたことを検証しなければならない（MUST）**
- **MCP サーバーは、受け取ったトークンを上流の API にそのまま転送してはならない（MUST NOT）**
- 無効・期限切れのトークンは 401。スコープ不足は 403 と `error="insufficient_scope"`
- クライアント登録は、CIMD が推奨（SHOULD）。DCR は非推奨になり、互換のために残されている（MAY）
- 公開クライアントのリフレッシュトークンはローテーションする（MUST）。アクセストークンは短命にする（SHOULD）
- 認可レスポンスに `iss` を含める（SHOULD、RFC 9207）

### MCP TypeScript SDK [K1][K2]

- v1 系（`@modelcontextprotocol/sdk`、npm の最新は 1.32.2）には、認可サーバーの部品（`mcpAuthRouter`、`OAuthServerProvider`）がある。クライアントやコード、トークンの保存は自分で実装する
- v2 系では、認可サーバーの部品は `@modelcontextprotocol/server-legacy/auth` に移されて凍結された。新しく作るなら専用の認可サーバーを使うよう案内されている
- リソースサーバー側の部品（`requireBearerAuth`、Protected Resource Metadata のルーター）は v2 でも現役

## 前に考えていた案の問題

最初は「MCP サーバーを SDK の部品で認可サーバーにし、承認されたら API キーを発行して、それをアクセストークンとして返す」案を考えていた。この案には次の問題がある。

- トークンの実体が API キーで、MCP サーバーはそれを backend にそのまま転送する。**トークンの転送禁止（MUST NOT）に当たる**
- トークンの宛先が MCP サーバーではなく backend なので、**audience の検証（MUST）もできない**
- 頼りにする SDK の認可サーバー部品は、v2 で凍結されている

## 選択肢

### 案 A：SELENE の backend を認可サーバーにする（採用）

backend が OAuth の認可サーバーになり、MCP サーバー宛て（`aud` = `https://mcp-kakeibo.riri-inferno.com`）のトークンを発行する。MCP サーバーはそのトークンを backend に送って検証してもらい、backend 宛ての短命なトークンと交換して（RFC 8693 のトークン交換）、それで API を呼ぶ。

- 良い点
  - ユーザー、ログイン（Google / GitHub）、DB、リフレッシュトークンのローテーションは backend にすでにある
  - MCP サーバーはステートレスのまま。署名の鍵も持たない
  - 転送禁止と audience の検証を、仕様どおりに満たせる
  - 承認した連携を backend の DB に記録すれば、SELENE の画面で「Claude（claude.ai）と連携中」と一覧にして、失効もできる
- 気になる点
  - backend に追加する機能が多い（メタデータ、`/authorize`、`/token`、CIMD の取得、承認画面、トークン交換）
  - トークン交換のエンドポイントは、MCP サーバー以外から使われないようにする必要がある。クラスタ内からしか届かない経路にするか、MCP サーバーにクライアント用の秘密情報（k8s の Secret）を持たせる
  - リクエストごとに交換すると、backend への呼び出しが 1 回増える

### 案 B：MCP サーバーを認可サーバーにし、独自のトークンを発行する

MCP サーバーが SDK v1 の `mcpAuthRouter` で認可サーバーになる。ログインと承認は SELENE の画面に任せる。承認されたら backend に API キーを発行してもらい、MCP サーバーはそれを自分で保存する。クライアントには、それとは別の独自のトークンを渡す。

- 良い点
  - backend の変更は少ない（承認画面と、MCP サーバー向けのキー発行だけ）
  - 上流に渡すのは MCP サーバー自身が持つ API キーなので、転送禁止には当たらない
- 気になる点
  - MCP サーバーが状態（クライアント、コード、トークン）と秘密情報（API キー）を持つことになる。DB か Redis が要る
  - 認証の仕組みが 2 か所に分かれる
  - SDK の部品は v2 で凍結されている

### 案 C：外部の認証基盤を使う（Keycloak、Auth0 など）

SDK v2 が案内している方式。認証基盤が MCP サーバー宛てのトークンを発行する。

- 良い点
  - OAuth の実装を自分で持たなくてよい
- 既存の Google 認証を使い回す形（Google をそのまま認可サーバーにする）も考えられるが、次の理由で採らない
  - GitHub でログインしているユーザーが使えない
  - Google が発行するトークンは Google の API 宛てで、MCP サーバー宛てにならない。MCP サーバーは Google に問い合わせてトークンを確かめ、SELENE のユーザーと対応付けたうえで、backend を呼ぶための交換もする必要がある（案 A と同じ仕組みが結局要る）
  - Claude に Google の OAuth クライアント ID と secret を手で入力してもらう方式になる
  - `resource` パラメータやリフレッシュトークンのローテーションなど、Claude の要件に Google が合うかは未確認
  - 案 A でも、承認画面のログインには Google / GitHub をそのまま使う。違うのは、MCP 用のトークンを誰が発行するかだけ
- 気になる点
  - 認証基盤のユーザーと SELENE のユーザーを対応付ける必要がある
  - raspi5 で Keycloak を動かすのは重い。SaaS にすると外部への依存が増える
  - backend を呼ぶための交換は、結局どこかで必要になる

### 比較

| | 案 A：backend が認可サーバー | 案 B：MCP サーバーが認可サーバー | 案 C：外部の認証基盤 |
|---|---|---|---|
| 仕様への適合 | ◎ | ○ | ◎ |
| MCP サーバーのステートレス | ◎ | ×（DB が要る） | ◎ |
| MCP サーバーの秘密情報 | △（交換用に持つ可能性） | ×（API キーを保存） | △ |
| 実装量 | 大（backend） | 中 | 中〜大（連携と運用） |
| 既存資産の活用 | ◎ | ○ | △ |
| 連携の一覧と失効 | ◎（backend の DB） | ○ | △ |

**案 A を採用する。** 認証に必要なものがすでに backend に揃っていて、MCP サーバーの「状態も秘密情報も持たない」設計を崩さずに、仕様を満たせる。MCP サーバーに足すのは、Protected Resource Metadata の提供と、トークンの交換だけになる。

## 案 A の流れ

```mermaid
sequenceDiagram
  autonumber
  actor U as ユーザー
  participant C as Claude<br/>（Anthropic のクラウド）
  participant M as kakeibo-mcp<br/>（リソースサーバー）
  participant F as SELENE 画面
  participant B as kakeibo-backend<br/>（認可サーバー）

  C->>M: POST /mcp（トークンなし）
  M-->>C: 401<br/>WWW-Authenticate: Bearer resource_metadata=...
  C->>M: GET /.well-known/oauth-protected-resource
  M-->>C: authorization_servers = [backend]
  C->>B: GET /.well-known/oauth-authorization-server
  B-->>C: メタデータ（S256、CIMD 対応 など）
  C->>U: ブラウザで認可画面を開く
  U->>B: GET /authorize<br/>（client_id = CIMD の URL、PKCE、resource = MCP の URL）
  B->>B: CIMD を取得し、redirect_uri を検証
  B->>F: ログインと承認の画面へ
  U->>F: Google / GitHub でログインし、承認する
  F->>B: 承認（連携を DB に記録）
  B-->>C: redirect_uri に認可コード（と iss）
  C->>B: POST /token（code + code_verifier + resource）
  B-->>C: アクセストークン（aud = MCP、短命）<br/>リフレッシュトークン（ローテーション）

  C->>M: POST /mcp<br/>Authorization: Bearer <アクセストークン>
  M->>B: トークン交換（RFC 8693）<br/>MCP 宛てのトークン → backend 宛ての短命トークン
  B->>B: 署名、期限、aud、連携が失効していないかを検証
  B-->>M: backend 宛ての短命トークン
  M->>B: API を呼ぶ（backend 宛てのトークン）
  B-->>M: 結果
  M-->>C: Tool の結果
```

### トークンの種類

| トークン | 誰が持つ | 宛先（aud） | 期限 |
|---|---|---|---|
| セッションの JWT（既存） | SELENE の画面 | SELENE | 15 分（リフレッシュは 7 日） |
| OAuth のアクセストークン（新規） | Claude | MCP サーバー | 短命。リフレッシュトークンで更新し、更新のたびにリフレッシュトークンも入れ替える |
| 交換したトークン（新規） | MCP サーバー（使い捨て） | SELENE の API | 数分 |

- セッションの JWT を Claude に渡すことはない
- OAuth のアクセストークンは、セッションの JWT と同じく backend が発行する。宛先が MCP サーバーで、どの連携の承認によるものかとスコープを含む
- 宛先の違うトークンを使い分けるのは、「受け取ったトークンを上流に転送しない」（MUST NOT）を守るため

### API キーで接続する方式との共存

API キーで接続する方式（Claude Code など）は、今の仕組みのまま残す。MCP サーバーは、受け取ったトークンが `slk_` で始まれば今までどおり backend に転送し、それ以外は OAuth のトークンとして交換に回す。

### CIMD（Client ID Metadata Document）

- クライアント（Claude なら Anthropic）が、自分の情報（名前、コールバック URL など）を書いた JSON を HTTPS の URL で公開し、その URL をクライアント ID として使う
- 認可サーバーはその URL から JSON を取得し、`client_id` が URL と一致するか、認可リクエストのコールバック URL が JSON の中のものと一致するかを確かめる
- secret はない。信頼の根拠は、ドメインの所有者だけが JSON を置けることと、認可コードは JSON に書かれたコールバック URL にしか返らないこと、PKCE で横取りしたコードが使えないこと
- 事前の登録（DCR）が要らないので、認可サーバーはクライアントを保存しなくてよい

## 認可サーバーの実装：OpenIddict

backend（ASP.NET Core）の認可サーバーには [OpenIddict](https://github.com/openiddict/openiddict-core) を使う。

- 採用の理由
  - Apache 2.0 で無料
  - トークン交換（RFC 8693）が 7.0 から標準で入っている
  - PKCE の必須化と、リフレッシュトークンのローテーションがある
- Duende IdentityServer は採らない
  - 本番の利用は有料
  - `resource` パラメータ（RFC 8707）は上位プランにしかない
- 前提：OpenIddict の EF Core 連携は EF Core 8 以上が必要。backend を .NET 10 と EF Core 10 に上げて満たした（ServerlessKakeibo#103）

### 必要な機能が実現できるか（OpenIddict 7.9.0 のソースで確認）

| 必要なこと | 結果 | 根拠（`src/` からのパス） |
|---|---|---|
| `/.well-known/oauth-authorization-server` でメタデータを返す | 標準で対応 | `OpenIddict.Server/OpenIddictServerOptions.cs`：設定エンドポイントの既定に `.well-known/openid-configuration` と `.well-known/oauth-authorization-server` の両方がある |
| メタデータに項目を追加する（`client_id_metadata_document_supported` など） | 拡張で対応 | `OpenIddictServerHandlers.Discovery.cs`：メタデータは `context.Metadata` の辞書で組み立てられる。`AddEventHandler` で独自のハンドラを足せる |
| `resource` の値をトークンの `aud` に入れる | 対応 | `OpenIddictServerHandlers.Authentication.cs`：`resource` は登録済み（`RegisterResources`）の値以外を `invalid_target` で拒否する。`OpenIddictServerHandlers.cs`：アクセストークンの `aud` は、承認時に設定した resources から作られる |
| 認可レスポンスに `iss` を含める（RFC 9207） | 標準で対応 | `OpenIddictServerHandlers.Discovery.cs`：`authorization_response_iss_parameter_supported` を true で返す |
| URL 形式の client_id（CIMD）を受け付ける | 拡張で対応 | `OpenIddict.Core/Managers/OpenIddictApplicationManager.cs`：`FindByClientIdAsync` が virtual。`ReplaceApplicationManager` で差し替えて、URL の client_id なら CIMD を取得・検証して返すようにする |
| 認可エンドポイントで SELENE のログインにつなぐ | 対応 | `OpenIddict.Server.AspNetCore/OpenIddictServerAspNetCoreBuilder.cs`：`EnableAuthorizationEndpointPassthrough` で、認可リクエストを自分のコントローラーで処理できる |
| リフレッシュトークンのローテーション | 既定で有効 | `OpenIddictServerBuilder.cs`：`DisableRollingRefreshTokens` のコメントに、無効にすることは推奨しないとある |
| PKCE の必須化、トークン交換 | 対応 | `OpenIddictServerBuilder.cs`：`RequireProofKeyForCodeExchange`、`AllowTokenExchangeFlow` |

## よくある疑問

- **個人のアカウントで作れるか**：作れる。カスタムコネクタは Free 以上のプランで使え [C3]、OAuth（DCR と CIMD）は「デフォルトでサポート」されている [C2]
- **業務システムで、組織で 1 つのキーを使う場合**：`static_headers` を使い、組織の Owner がコネクタを追加するときにキーを入力する。ベータ版で、限られた組織しか使えない [C2]。Team / Enterprise では、Owner がコネクタを組織に追加し、メンバーはそれぞれ接続する [C3]
- **同じ Claude アカウントで、端末ごとに接続が必要か**：接続は端末からではなく Anthropic のクラウドから行われる [C3] ので、アカウント単位で 1 回になると考えられる。ただし「Web で追加したコネクタがスマホにも出る」ことは明記されていない（**未確認**。追加したら実際に確かめる）。Claude Code は別で、端末ごとに設定する
- **別々の Claude アカウントが、同時に同じ MCP サーバーを使えるか**：使える。MCP サーバーはリクエストごとにトークンを受け取って処理し、セッションを持たない。異なるキーを並行で送っても混ざらないことは確認済み
  - OAuth の場合：Claude アカウントごとに SELENE にログインして承認し、別々のトークンを受け取る。2 人が同じ SELENE アカウントで承認すれば、トークンは別々でも同じ家計簿を共有する。片方の連携だけを失効させられる
  - API キーの場合：同じキーを両方に設定しても使える。ただし、どちらからの呼び出しかは区別できず、失効させると両方が止まる

## 未決事項

- トークン交換のエンドポイントを、MCP サーバー以外から使わせない方法（クラスタ内の経路だけにする、またはクライアントの秘密情報を持たせる）
- アクセストークンを JWT にするか、不透明なトークンにするか。backend の今の JWT は HS256（共通鍵）なので、MCP サーバー側では検証せず、交換のときに backend が検証する前提にしている
- CIMD だけにするか、DCR にも対応するか。Claude は CIMD に対応していれば CIMD を使う。Claude Code など、ほかのクライアントが CIMD に対応しているかは**未確認**
- 承認画面の文言、スコープ（`read` / `read write`）を選べるようにするか、連携の一覧と失効の画面
- Cloudflare の Bot Fight Mode が Claude からの接続を止める場合は、`160.79.104.0/21` を WAF で除外する。最新の IP 範囲は [C4] で確認する
- Web で追加したコネクタが、スマホのアプリにも出るか（**未確認**）

## 出典

- [S1] MCP 仕様 Authorization（2026-07-28）: https://modelcontextprotocol.io/specification/latest/basic/authorization
- [C1] Claude: Building connectors: https://claude.com/docs/connectors/building
- [C2] Claude: Authentication: https://claude.com/docs/connectors/building/authentication
- [C3] Claude ヘルプ: Getting started with custom connectors using remote MCP: https://support.claude.com/en/articles/11175166-getting-started-with-custom-connectors-using-remote-mcp
- [C4] Claude API の IP アドレス: https://platform.claude.com/docs/en/api/ip-addresses
- [K1] MCP TypeScript SDK v1 の認可サーバー部品: https://github.com/modelcontextprotocol/typescript-sdk/tree/v1.x/src/server/auth
- [K2] MCP TypeScript SDK v2 の Authorization: https://ts.sdk.modelcontextprotocol.io/v2/serving/authorization.html
- [O1] OpenIddict（ソース。7.9.0 のタグで確認）: https://github.com/openiddict/openiddict-core/tree/7.9.0
- [O2] OpenIddict 7.0 リリース記事（トークン交換）: https://kevinchalet.com/2025/07/07/openiddict-7-0-is-out/
- [O3] Duende IdentityServer のライセンス: https://docs.duendesoftware.com/general/licensing/
