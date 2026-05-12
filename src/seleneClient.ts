const SELENE_API_BASE_URL =
  process.env.SELENE_API_BASE_URL ?? "https://api-kakeibo.riri-inferno.com";

const SELENE_JWT_TOKEN = process.env.SELENE_JWT_TOKEN
  ?.replace(/^Bearer\s+/i, "")
  .trim();

if (!SELENE_JWT_TOKEN) {
  console.error(
    "[selene-mcp] WARNING: SELENE_JWT_TOKEN is not set. All tool calls will fail with 401."
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
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${SELENE_JWT_TOKEN ?? ""}`,
      Accept: "application/json",
    },
  });
  const body = await res.text();
  if (!res.ok) {
    throw new Error(
      `SELENE ${res.status} ${res.statusText} on GET ${url.pathname}${url.search}: ${body.slice(0, 500)}`
    );
  }
  return body;
}
