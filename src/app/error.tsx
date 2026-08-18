"use client";

import { useEffect } from "react";
import { Footer } from "./Footer";
import { Header } from "./Header";

// Wraps page.js/loading.js/not-found.js and nested layouts below the root
// layout in a React error boundary (does not cover layout.tsx itself -- see
// Next's global-error.js for that, not needed here). `retry` (not `reset`)
// is the current API as of Next 16.3 -- see error.md's version history.
export default function Error({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <>
      <Header />
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-strata-teal px-6 text-center">
        <p className="font-display text-2xl text-strata-parchment">Something went wrong</p>
        <p className="font-data max-w-md text-sm text-strata-parchment/60">
          {error.message || "An unexpected error occurred."}
        </p>
        <button
          type="button"
          onClick={() => retry()}
          className="font-data mt-2 rounded-full border border-strata-parchment/30 px-4 py-2 text-xs tracking-wide text-strata-parchment uppercase transition-colors hover:border-strata-coral/50 hover:text-strata-coral"
        >
          Try again
        </button>
      </main>
      <Footer />
    </>
  );
}
