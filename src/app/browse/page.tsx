import { asc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { db } from "../../db";
import { flagshipEras, flagshipWords } from "../../db/schema";
import { Footer } from "../Footer";
import { Header } from "../Header";

export const metadata: Metadata = {
  title: "Browse — Strata",
  description: "Every published word, browsable by headword.",
};

// Without this, Next prerenders the list once at build time and a word
// approved afterward (no redeploy) wouldn't show up here -- same reasoning
// as the homepage's force-dynamic for weekly rotation.
export const dynamic = "force-dynamic";

// Approved-only, same publish gate as /word/[headword] and the homepage --
// draft/pending/rejected words aren't launch content.
export default async function BrowsePage() {
  const words = await db
    .select({ id: flagshipWords.id, headword: flagshipWords.headword })
    .from(flagshipWords)
    .where(eq(flagshipWords.status, "approved"))
    .orderBy(asc(flagshipWords.headword));

  const eras = await db
    .select({
      flagshipWordId: flagshipEras.flagshipWordId,
      gloss: flagshipEras.gloss,
      orderIndex: flagshipEras.orderIndex,
    })
    .from(flagshipEras)
    .orderBy(asc(flagshipEras.orderIndex));

  const chainByWord = new Map<number, string>();
  for (const era of eras) {
    if (!era.gloss) continue;
    const existing = chainByWord.get(era.flagshipWordId);
    chainByWord.set(era.flagshipWordId, existing ? `${existing} → ${era.gloss}` : era.gloss);
  }

  return (
    <>
      <Header />
      <main className="min-h-screen bg-strata-teal">
        <div className="mx-auto max-w-4xl p-8">
          <h1 className="font-display text-2xl font-medium text-strata-parchment">Browse</h1>
          <p className="font-data mt-1 text-sm text-strata-parchment/50">
            {words.length} published word{words.length === 1 ? "" : "s"}.
          </p>

          {words.length === 0 ? (
            <p className="font-data mt-8 text-sm text-strata-parchment/40">
              No published words yet.
            </p>
          ) : (
            <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {words.map((word) => (
                <Link
                  key={word.id}
                  href={`/word/${encodeURIComponent(word.headword)}`}
                  className="rounded-lg border border-strata-parchment/15 bg-strata-rosewood/20 p-4 transition-colors hover:border-strata-coral/50"
                >
                  <p className="font-display text-lg font-medium text-strata-parchment">
                    {word.headword}
                  </p>
                  {chainByWord.get(word.id) && (
                    <p className="font-data mt-1 text-xs text-strata-parchment/60">
                      {chainByWord.get(word.id)}
                    </p>
                  )}
                </Link>
              ))}
            </div>
          )}
        </div>
      </main>
      <Footer />
    </>
  );
}
