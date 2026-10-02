"use client";

import { usePrivy } from "@privy-io/react-auth";
import { PRIVY_APP_ID } from "@/lib/config";

function usePrivyLogin(): (() => void) | undefined {
  const { ready, authenticated, login } = usePrivy();
  return ready && !authenticated ? () => login() : undefined;
}

const useNoLogin = (): (() => void) | undefined => undefined;

/**
 * Opens Privy's sign-in, or `undefined` when someone is already signed in, Privy is still loading,
 * or the app runs without it. Same shape as `useAccessToken`, and for the same reason: PRIVY_APP_ID
 * is fixed at build time, so Privy's hooks are only called under its provider.
 */
export const useSignIn: () => (() => void) | undefined = PRIVY_APP_ID ? usePrivyLogin : useNoLogin;
