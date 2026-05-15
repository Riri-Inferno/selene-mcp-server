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
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${SELENE_API_KEY ?? ""}`,
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
