const SELENE_API_BASE_URL =
  process.env.SELENE_API_BASE_URL ?? "https://api-kakeibo.riri-inferno.com";

const SELENE_API_KEY = process.env.SELENE_API_KEY
  ?.replace(/^Bearer\s+/i, "")
  .trim();

if (!SELENE_API_KEY) {
  console.error(
    "[selene-mcp] WARNING: SELENE_API_KEY is not set. All tool calls will fail with 401."
  );
} else if (!SELENE_API_KEY.startsWith("slk_")) {
  console.error(
    "[selene-mcp] WARNING: SELENE_API_KEY does not start with 'slk_'. " +
      "SELENE issues API keys with the 'slk_' prefix; you may have pasted a JWT or an invalid value."
  );
}

export function getBaseUrl(): string {
  return SELENE_API_BASE_URL;
}

export type QueryValue = string | number | boolean | Date | undefined | null;

export async function seleneGet(
  path: string,
  query?: Record<string, QueryValue>
): Promise<string> {
  const url = new URL(path, SELENE_API_BASE_URL);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null) continue;
      url.searchParams.set(k, v instanceof Date ? v.toISOString() : String(v));
    }
  }
  const target = `GET ${url.pathname}${url.search}`;

  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${SELENE_API_KEY ?? ""}`,
        Accept: "application/json",
      },
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

/**
 * HTTP ステータスごとに、モデルが次に取るべき行動を返す。
 * Tool のエラーは MCP SDK が isError: true の結果としてモデルに渡すので、
 * 「何が起きたか」に加えて「どうすればよいか」を含めておく。
 */
function hintForStatus(status: number): string {
  switch (status) {
    case 400:
      return "リクエストの引数が不正です。本文のエラー内容を見て引数を直してから再実行してください。";
    case 401:
      return SELENE_API_KEY
        ? "API キーが認証されませんでした。考えられる原因: キーの有効期限切れ・失効・誤り、またはこのエンドポイントが API キー認証に未対応。引数を変えても解決しないので、ユーザーに SELENE の設定画面でキーの状態を確認するよう伝えてください。"
        : "SELENE_API_KEY が設定されていません。ユーザーに API キーの設定を依頼してください。";
    case 403:
      return "API キーのスコープが不足しています（例: read キーで書き込み系の操作を実行した）。再試行せず、必要なスコープのキーが要ることをユーザーに伝えてください。";
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
