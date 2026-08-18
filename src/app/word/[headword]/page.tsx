import { and, eq, inArray } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "../../../db";
import { flagshipEras, flagshipSiblings, flagshipWords } from "../../../db/schema";
import { Header } from "../../Header";
import { TimelineScrubber } from "./TimelineScrubber";

export default async function WordPage({
  params,
}: {
  params: Promise<{ headword: string }>;
}) {
  const { headword } = await params;
  const normalized = decodeURIComponent(headword).toLowerCase();

  // Draft/pending/rejected words are mid-review, not launch content — only
  // 'approved' is safe to serve publicly at this URL.
  const [word] = await db
    .select()
    .from(flagshipWords)
    .where(
      and(eq(flagshipWords.headword, normalized), eq(flagshipWords.status, "approved")),
    );

  if (!word) notFound();

  const eras = await db
    .select()
    .from(flagshipEras)
    .where(eq(flagshipEras.flagshipWordId, word.id))
    .orderBy(flagshipEras.orderIndex);

  // Siblings aren't symmetric in storage -- each word's list is generated
  // independently, so A listing B doesn't guarantee B's own generation
  // happened to list A back. Merge both directions here so the reader sees
  // the relationship regardless of which side "claimed" it.
  const ownSiblings = await db
    .select()
    .from(flagshipSiblings)
    .where(eq(flagshipSiblings.flagshipWordId, word.id));

  const reverseSiblings = await db
    .select({
      id: flagshipSiblings.id,
      siblingHeadword: flagshipWords.headword,
      sharedAncestor: flagshipSiblings.sharedAncestor,
    })
    .from(flagshipSiblings)
    .innerJoin(flagshipWords, eq(flagshipSiblings.flagshipWordId, flagshipWords.id))
    .where(eq(flagshipSiblings.siblingHeadword, word.headword));

  const seen = new Set<string>();
  const siblings = [...ownSiblings, ...reverseSiblings].filter((s) => {
    if (seen.has(s.siblingHeadword)) return false;
    seen.add(s.siblingHeadword);
    return true;
  });

  // Only count a sibling as "exists" if it's approved — otherwise this page
  // would render a clickable link straight into the 404 this same gate now
  // produces for anything still in draft/pending/rejected.
  const existingSiblingWords =
    siblings.length > 0
      ? await db
          .select({ headword: flagshipWords.headword })
          .from(flagshipWords)
          .where(
            and(
              inArray(
                flagshipWords.headword,
                siblings.map((s) => s.siblingHeadword),
              ),
              eq(flagshipWords.status, "approved"),
            ),
          )
      : [];
  const existingHeadwords = new Set(existingSiblingWords.map((w) => w.headword));

  return (
    <>
      <Header />
      <main className="min-h-screen bg-strata-teal">
        <TimelineScrubber
          headword={word.headword}
          driftType={word.driftType}
          eras={eras}
          siblings={siblings.map((s) => ({
            ...s,
            exists: existingHeadwords.has(s.siblingHeadword),
          }))}
        />
      </main>
    </>
  );
}
