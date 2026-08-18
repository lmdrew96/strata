import Link from "next/link";

// Sibling of <main>, same pattern as Header -- the only discoverable path
// to /admin from the public site.
export function Footer() {
  return (
    <footer className="flex w-full items-center justify-center bg-strata-teal px-6 py-4">
      <Link
        href="/admin/flagship"
        className="font-data text-xs tracking-[0.2em] text-strata-parchment/30 uppercase transition-colors hover:text-strata-parchment/60"
      >
        admin
      </Link>
    </footer>
  );
}
