"use client";

import { useEffect } from "react";
import "./globals.css";

// Last resort: the root layout itself failed, so this brings its own <html> and <body>.
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body className="flex min-h-screen items-center justify-center px-4">
        <div className="page-section error-panel max-w-md" role="alert">
          <h1 className="text-xl font-extrabold">On Deal couldn&apos;t load</h1>
          <p className="text-sm text-muted">
            Something went wrong starting the app. Your assets are safe: nothing moves without your signature.
          </p>
          <button type="button" className="btn-primary mt-3" onClick={() => retry()}>
            Reload
          </button>
        </div>
      </body>
    </html>
  );
}
