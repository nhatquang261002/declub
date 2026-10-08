import { useEffect } from "react";

/** What Next hands an `error.tsx` boundary. */
export type ErrorBoundaryProps = { error: Error & { digest?: string }; retry: () => void };

/** Logs the error a boundary caught, once per error. */
export function useLogError(error: Error) {
  useEffect(() => {
    console.error(error);
  }, [error]);
}
