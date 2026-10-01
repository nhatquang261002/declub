import type { GetAccessToken } from "@/hooks/useAccessToken";

/**
 * The browser side of /api/state (ADR 0012). Both calls are best-effort: saved state is a
 * convenience, so a server that is off, slow or failing means the app keeps using what the
 * browser has, and nothing here throws.
 */
export type RemoteState = { enabled: false } | { enabled: true; seen: string[]; initialized: boolean; recents: string[] };

async function call(getToken: GetAccessToken, method: "GET" | "POST", path: string, body?: unknown): Promise<Response | undefined> {
  try {
    const token = await getToken();
    if (!token) return undefined;
    return await fetch(path, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    return undefined;
  }
}

/** What the server has saved for this user, and for `account` (read markers) if one is given. */
export async function loadState(getToken: GetAccessToken, account?: string): Promise<RemoteState> {
  const response = await call(getToken, "GET", `/api/state${account ? `?account=${account}` : ""}`);
  if (!response?.ok) return { enabled: false };
  return (await response.json()) as RemoteState;
}

export type StatePatch = { account?: string; seen?: string[]; initialized?: true; recents?: string[] };

// The server takes this many read markers per request (lib/state.ts).
const SEEN_PER_REQUEST = 500;

/** Adds to the saved state. Read markers go in batches the server will accept. */
export async function saveState(getToken: GetAccessToken, patch: StatePatch): Promise<void> {
  const { seen = [], ...rest } = patch;
  if (seen.length === 0) {
    if (rest.initialized || rest.recents?.length) await call(getToken, "POST", "/api/state", rest);
    return;
  }
  for (let i = 0; i < seen.length; i += SEEN_PER_REQUEST) {
    const first = i === 0;
    await call(getToken, "POST", "/api/state", {
      account: rest.account,
      seen: seen.slice(i, i + SEEN_PER_REQUEST),
      ...(first ? { initialized: rest.initialized, recents: rest.recents } : {}),
    });
  }
}
