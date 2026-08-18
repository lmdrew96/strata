"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

// No Header here -- this is a bare auth gate, not a content page, so it
// skips the site nav the same way Sensible's admin login does.
export default function AdminLoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

// useSearchParams needs a Suspense boundary above it for static builds --
// split out so the wrapper above can provide one without an extra fallback
// flash (this route is tiny and renders instantly either way).
function LoginForm() {
  const router = useRouter();
  const nextPath = useSearchParams().get("next") ?? "/admin/flagship";
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const res = await fetch("/api/admin-login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });

    if (res.ok) {
      router.push(nextPath);
      router.refresh();
    } else {
      setError("Incorrect password.");
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-strata-teal px-6">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-lg border border-strata-parchment/15 bg-strata-rosewood/20 p-6"
      >
        <h1 className="font-display text-xl font-medium text-strata-parchment">Admin Login</h1>
        <input
          type="password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          className="font-data mt-4 w-full rounded border border-strata-parchment/20 bg-strata-rosewood/20 px-3 py-2 text-sm text-strata-parchment placeholder:text-strata-parchment/40 focus:border-strata-coral/50 focus:outline-none"
        />
        {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
        <button
          type="submit"
          disabled={submitting || !password}
          className="mt-3 w-full rounded bg-strata-coral px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-strata-coral/90 disabled:opacity-50"
        >
          {submitting ? "Checking…" : "Log in"}
        </button>
      </form>
    </main>
  );
}
