import { AsyncLocalStorage } from "node:async_hooks";

const SELENE_API_BASE_URL =
  process.env.SELENE_API_BASE_URL ?? "https://api-kakeibo.riri-inferno.com";

/** stdio モードで使う API キー（環境変数） */
const ENV_API_KEY = process.env.SELENE_API_KEY
  ?.replace(/^Bearer\s+/i, "")
  .trim();

/**
 * backend を呼ぶときの認証情報。
 * - api-key: API キー（slk_...）。クライアントから受け取ったものをそのまま使う
 * - oauth: OAuth の連携。クライアントから受け取ったアクセストークンを backend で交換した、backend 宛ての短命なトークン
 */
export type Credential = { kind: "api-key" | "oauth"; token: string };

/**
 * HTTP モードで、リクエストごとの認証情報を Tool の処理まで運ぶ。
 * 複数ユーザーのリクエストが同時に来ても混ざらないよう、グローバル変数ではなく AsyncLocalStorage を使う。
 */
const requestContext = new AsyncLocalStorage<Credential>();

export function runWithCredential<T>(credential: Credential, fn: () => T): T {
  return requestContext.run(credential, fn);
}

/** HTTP モードならリクエストの認証情報、stdio モードなら環境変数の API キー */
function getCredential(): Credential | undefined {
  return requestContext.getStore() ?? (ENV_API_KEY ? { kind: "api-key", token: ENV_API_KEY } : undefined);
}

export function warnIfEnvApiKeyInvalid(): void {
  if (!ENV_API_KEY) {
    console.error(
      "[selene-mcp] WARNING: SELENE_API_KEY is not set. All tool calls will fail with 401."
    );
  } else if (!ENV_API_KEY.startsWith("slk_")) {
    console.error(
      "[selene-mcp] WARNING: SELENE_API_KEY does not start with 'slk_'. " +
        "SELENE issues API keys with the 'slk_' prefix; you may have pasted a JWT or an invalid value."
    );
  }
}

export function getBaseUrl(): string {
  return SELENE_API_BASE_URL;
}

export type QueryValue = string | number | boolean | Date | undefined | null;

type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";

async function seleneRequest(
  method: HttpMethod,
  path: string,
  options: { query?: Record<string, QueryValue>; body?: unknown } = {}
): Promise<string> {
  const url = new URL(path, SELENE_API_BASE_URL);
  if (options.query) {
    for (const [k, v] of Object.entries(options.query)) {
      if (v === undefined || v === null) continue;
      url.searchParams.set(k, v instanceof Date ? v.toISOString() : String(v));
    }
  }
  const target = `${method} ${url.pathname}${url.search}`;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${getCredential()?.token ?? ""}`,
    Accept: "application/json",
  };
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(
      `SELENE に接続できませんでした (${target}): ${reason}\n` +
        `対処: SELENE_API_BASE_URL (${SELENE_API_BASE_URL}) が正しいか、SELENE が稼働しているかを確認してください。同じ呼び出しを繰り返しても解決しない可能性が高いです。`
    );
  }

  const body = await res.text();
  if (!res.ok) {
    const detail = body.trim() ? body.slice(0, 500) : "(レスポンス本文なし)";
    throw new Error(
      `SELENE ${res.status} ${res.statusText} on ${target}: ${detail}\n` +
        `対処: ${hintForStatus(res.status)}`
    );
  }
  return body;
}

export function seleneGet(path: string, query?: Record<string, QueryValue>): Promise<string> {
  return seleneRequest("GET", path, { query });
}

export function selenePost(path: string, body?: unknown): Promise<string> {
  return seleneRequest("POST", path, { body });
}

export function selenePut(path: string, body: unknown): Promise<string> {
  return seleneRequest("PUT", path, { body });
}

export function seleneDelete(path: string): Promise<string> {
  return seleneRequest("DELETE", path);
}

/**
 * HTTP ステータスごとに、モデルが次に取るべき行動を返す。
 * Tool のエラーは MCP SDK が isError: true の結果としてモデルに渡すので、
 * 「何が起きたか」に加えて「どうすればよいか」を含めておく。
 */
function hintForStatus(status: number): string {
  switch (status) {
    case 400:
      return "リクエストの引数が不正です。本文のエラー内容を見て引数を直してから再実行してください。";
    case 401: {
      const credential = getCredential();
      if (!credential) {
        return "SELENE_API_KEY が設定されていません。ユーザーに API キーの設定を依頼してください。";
      }
      return credential.kind === "oauth"
        ? "SELENE の連携が認証されませんでした。連携が解除された可能性があります。SELENE の画面から操作するか、アプリからもう一度接続するよう、ユーザーに伝えてください。引数を変えて再試行しても解決しません。"
        : "API キーが認証されませんでした。本文の message に理由があります。キーが無効なら SELENE の設定画面でキーの状態を確認するよう、API キーでは利用できない操作なら SELENE の画面から操作するよう、ユーザーに伝えてください。引数を変えて再試行しても解決しません。";
    }
    case 403:
      return getCredential()?.kind === "oauth"
        ? "連携で許可されたスコープが不足しています（読み取りだけを許可した連携で書き込み系の操作を実行した、など）。再試行せず、書き込みも許可して接続し直す必要があることをユーザーに伝えてください。"
        : "API キーのスコープが不足しています（read キーで書き込み系の操作を実行した、など）。再試行せず、書き込みを許可したキー（read write）が必要なことをユーザーに伝えてください。";
    case 404:
      return "対象が見つかりません。ID が正しいか、一覧系の Tool で取り直してから再実行してください。";
    case 429:
      return "リクエストが多すぎます。少し時間をおいてから再実行してください。";
    default:
      return status >= 500
        ? "SELENE 側のエラーです。少し時間をおいて再実行し、続くようならユーザーに伝えてください。"
        : "本文のエラー内容を確認してください。";
  }
}
