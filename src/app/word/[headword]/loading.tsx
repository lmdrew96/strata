import { Header } from "../../Header";

// page.tsx does several sequential DB queries (word lookup, eras, own +
// reverse siblings, sibling existence check) before rendering anything --
// without this, that shows as a blank flash against the app's dark
// background between navigations. Shape loosely mirrors TimelineScrubber
// (driftType label, word, scrubber, quote panel) so the swap-in doesn't jump.
export default function Loading() {
  return (
    <>
      <Header />
      <main className="min-h-screen bg-strata-teal">
        <div className="mx-auto flex min-h-screen max-w-3xl flex-col items-center px-6 py-16">
          <div className="h-3 w-20 animate-pulse rounded-full bg-strata-parchment/10" />
          <div className="mt-8 h-16 w-64 animate-pulse rounded-lg bg-strata-parchment/10" />
          <div className="mt-12 h-px w-full animate-pulse bg-strata-parchment/10" />
          <div className="mt-12 h-32 w-full animate-pulse rounded-lg bg-strata-rosewood/20" />
        </div>
      </main>
    </>
  );
}
