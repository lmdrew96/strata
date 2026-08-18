import Link from "next/link";

// The only way back to `/` from a word page — rendered as a sibling of each
// page's <main> (not nested inside it) so it isn't squashed by main's
// `items-center` flex alignment.
export function Header() {
  return (
    <header className="flex w-full items-center bg-strata-teal px-6 py-4">
      <Link
        href="/"
        className="font-data text-xs tracking-[0.3em] text-strata-parchment/70 uppercase transition-colors hover:text-strata-parchment"
      >
        Strata
      </Link>
    </header>
  );
}
