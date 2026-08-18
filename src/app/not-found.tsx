import { Footer } from "./Footer";
import { Header } from "./Header";

// Renders whenever /word/[headword]/page.tsx calls notFound() for a
// headword that isn't approved (draft/pending/rejected/nonexistent), and
// also covers genuinely unmatched routes -- a single root layout means this
// file doubles as the app's global 404 without needing global-not-found.js.
export default function NotFound() {
  return (
    <>
      <Header />
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-strata-teal px-6 text-center">
        <p className="font-display text-2xl text-strata-parchment">Not found</p>
        <p className="font-data max-w-md text-sm text-strata-parchment/60">
          That word hasn&rsquo;t been published, or the page doesn&rsquo;t exist. Try the search
          above, or head back home.
        </p>
      </main>
      <Footer />
    </>
  );
}
