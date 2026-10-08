/** A `fetch` init that carries the Privy access token and, when there is a body, sends it as JSON. */
export const bearerInit = (token: string | null, method: string, body?: unknown): RequestInit => ({
  method,
  headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
  body: body === undefined ? undefined : JSON.stringify(body),
});
