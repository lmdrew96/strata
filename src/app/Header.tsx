"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

// The only way back to `/` from a word page, and the only way to reach a
// word that isn't currently Word of the Week or a sibling link on another
// word's page. Rendered as a sibling of each page's <main> (not nested
// inside it) so it isn't squashed by main's `items-center` flex alignment.
export function Header() {
  const router = useRouter();
  const [query, setQuery] = useState("");

  // No pre-flight lookup here -- submitting just navigates to the word
  // page, and a nonexistent headword surfaces through the same notFound()
  // gate /word/[headword] already uses for draft/pending/rejected words.
  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) return;
    router.push(`/word/${encodeURIComponent(trimmed)}`);
    setQuery("");
  }

  return (
    <header className="flex w-full flex-wrap items-center justify-between gap-4 bg-strata-teal px-6 py-4">
      <Link
        href="/"
        className="font-data text-xs tracking-[0.3em] text-strata-parchment/70 uppercase transition-colors hover:text-strata-parchment"
      >
        Strata
      </Link>
      <nav className="flex items-center gap-4">
        <Link
          href="/browse"
          className="font-data text-xs tracking-[0.2em] text-strata-parchment/60 uppercase transition-colors hover:text-strata-parchment"
        >
          Browse
        </Link>
      </nav>
      <form onSubmit={handleSubmit} className="flex items-center gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search a word…"
          aria-label="Search for a word"
          className="font-data w-32 rounded-full border border-strata-parchment/20 bg-strata-rosewood/20 px-3 py-1.5 text-xs text-strata-parchment placeholder:text-strata-parchment/40 focus:border-strata-coral/50 focus:outline-none sm:w-56"
        />
      </form>
    </header>
  );
}
