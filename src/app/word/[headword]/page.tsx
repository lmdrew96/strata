import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "../../../db";
import { flagshipEras, flagshipWords } from "../../../db/schema";
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

  return (
    <main className="min-h-screen bg-strata-teal">
      <TimelineScrubber headword={word.headword} driftType={word.driftType} eras={eras} />
    </main>
  );
}
