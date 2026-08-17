import { eq, inArray } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "../../../db";
import { flagshipEras, flagshipSiblings, flagshipWords } from "../../../db/schema";
import { TimelineScrubber } from "./TimelineScrubber";

export default async function WordPage({
  params,
}: {
  params: Promise<{ headword: string }>;
}) {
  const { headword } = await params;
  const normalized = decodeURIComponent(headword).toLowerCase();

  const [word] = await db
    .select()
    .from(flagshipWords)
    .where(eq(flagshipWords.headword, normalized));

  if (!word) notFound();

  const eras = await db
    .select()
    .from(flagshipEras)
    .where(eq(flagshipEras.flagshipWordId, word.id))
    .orderBy(flagshipEras.orderIndex);

  const siblings = await db
    .select()
    .from(flagshipSiblings)
    .where(eq(flagshipSiblings.flagshipWordId, word.id));

  const existingSiblingWords =
    siblings.length > 0
      ? await db
          .select({ headword: flagshipWords.headword })
          .from(flagshipWords)
          .where(
            inArray(
              flagshipWords.headword,
              siblings.map((s) => s.siblingHeadword),
            ),
          )
      : [];
  const existingHeadwords = new Set(existingSiblingWords.map((w) => w.headword));

  return (
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
  );
}
