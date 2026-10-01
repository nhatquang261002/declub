"use client";

import { usePrivy } from "@privy-io/react-auth";
import { PRIVY_APP_ID } from "@/lib/config";

export type GetAccessToken = () => Promise<string | null>;

function usePrivyToken(): GetAccessToken | undefined {
  const { ready, authenticated, getAccessToken } = usePrivy();
  return ready && authenticated ? getAccessToken : undefined;
}

const useNoToken = (): GetAccessToken | undefined => undefined;

/**
 * How to get the signed-in user's Privy access token, or `undefined` when nobody is signed in or
 * Privy is off. Per-user server state (ADR 0012) is only used when this is defined; otherwise the
 * app keeps that state in the browser, as it always has.
 *
 * PRIVY_APP_ID is fixed at build time, so the same hook runs for the life of the app, and Privy's
 * hooks are only ever called under its provider (see components/Providers.tsx).
 */
export const useAccessToken: () => GetAccessToken | undefined = PRIVY_APP_ID ? usePrivyToken : useNoToken;
