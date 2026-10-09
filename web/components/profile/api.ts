import { bearerInit } from "@/lib/bearer";

/**
 * One call to a signed-in profile endpoint (`/api/profile`, `/api/avatar`): the Privy access token
 * goes in the header, and a refusal throws the server's `message`, or `fallback` if it sent none.
 */
export async function profileCall<T extends { message?: string }>(
  getAccessToken: () => Promise<string | null>,
  path: string,
  fallback: string,
  method: "GET" | "PUT" | "DELETE",
  body?: unknown,
): Promise<T> {
  const token = await getAccessToken();
  const response = await fetch(path, bearerInit(token, method, body));
  const data = (await response.json()) as T;
  if (!response.ok) throw new Error(data.message ?? fallback);
  return data;
}
