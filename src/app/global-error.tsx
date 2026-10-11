"use client";

import "./globals.css";

/**
 * Last resort, when the root layout itself fails. It replaces the whole document, so it brings its own html and
 * body, and keeps to plain markup that cannot fail in turn.
 */
export default function GlobalError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="en">
      <body className="min-h-full bg-bg text-ink">
        <title>Something went wrong · CareerMetro</title>
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-4 py-16">
          <h1 className="text-2xl font-semibold">Something went wrong</h1>
          <p className="text-muted">Your data is safe. Please try again in a minute.</p>
          <button
            type="button"
            onClick={() => retry()}
            className="mt-2 self-start rounded-full bg-accent px-4 py-2.5 text-sm font-medium text-on-accent"
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
