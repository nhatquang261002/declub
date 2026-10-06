"use client";

import { useEffect } from "react";
import Link from "next/link";
import { ErrorPanel } from "@/components/ErrorPanel";

// Catches a crash while rendering a page, so one broken screen doesn't blank the whole app.
// The header and wallet stay up because this sits inside the root layout.
export default function RouteError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <ErrorPanel
      title="This page hit a problem"
      message="Something broke while showing this page. Your assets and deals are safe: nothing moves without a transaction or signature from you."
      details={[error.message, error.digest && `Reference: ${error.digest}`].filter(Boolean).join("\n")}
      onRetry={retry}
    >
      <Link href="/deals" className="mt-1 text-sm font-bold underline">
        Back to deals
      </Link>
    </ErrorPanel>
  );
}
