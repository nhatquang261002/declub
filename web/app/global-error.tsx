"use client";

import { useLogError, type ErrorBoundaryProps } from "@/hooks/useLogError";
import "./globals.css";

// Last resort: the root layout itself failed, so this brings its own <html> and <body>.
export default function GlobalError({ error, retry }: ErrorBoundaryProps) {
  useLogError(error);

  return (
    <html lang="en">
      <body className="flex min-h-screen items-center justify-center px-4">
        <div className="page-section error-panel max-w-md" role="alert">
          <h1 className="text-xl font-extrabold">DeClub couldn&apos;t load</h1>
          <p className="text-sm text-muted">
            Something went wrong starting the app. Your assets are safe: nothing moves without a transaction or signature from you.
          </p>
          <button type="button" className="btn-primary mt-3" onClick={() => retry()}>
            Reload
          </button>
        </div>
      </body>
    </html>
  );
}
