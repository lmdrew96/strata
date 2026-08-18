import { asc, eq } from "drizzle-orm";
import { db } from "../db";
import { flagshipEras, flagshipWords } from "../db/schema";
import { ERA_LABELS } from "../lib/eras";
import { pickWeekly, sampleWeekly, shuffleWeekly, weeklySeed } from "../lib/weekly-rotation";
import { MatchingGame, type GameCard } from "./MatchingGame";
import { WordOfTheWeek } from "./WordOfTheWeek";

// Weekly rotation depends on reading the real current date on every visit --
// without this, a production build could prerender the page once and freeze
// that week's picks until the next deploy.
export const dynamic = "force-dynamic";

const GAME_PAIR_COUNT = 6;

export default async function Home() {
  // Same gate as /word/[headword]: Word of the Week links straight into that
  // page, and the matching game is meant to showcase reviewed content, so
  // draft/pending/rejected words can't be picked for either.
  const words = await db
    .select()
    .from(flagshipWords)
    .where(eq(flagshipWords.status, "approved"))
    .orderBy(asc(flagshipWords.id));

  if (words.length === 0) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-strata-teal px-6 text-center">
        <p className="font-display text-2xl text-strata-parchment">Strata</p>
        <p className="font-data mt-3 max-w-md text-sm text-strata-parchment/60">
          No flagship words have been published yet. Check back once the first batch clears
          review.
        </p>
      </main>
    );
  }

  const eras = await db.select().from(flagshipEras).orderBy(asc(flagshipEras.orderIndex));
  const erasByWord = new Map<number, typeof eras>();
  for (const era of eras) {
    const list = erasByWord.get(era.flagshipWordId) ?? [];
    list.push(era);
    erasByWord.set(era.flagshipWordId, list);
  }

  const seed = weeklySeed();

  const wordOfWeek = pickWeekly(words, seed);
  const wordOfWeekEras = erasByWord.get(wordOfWeek.id) ?? [];

  // A word only makes a fair matching-game pairing when it has an oldest
  // attested form that actually differs from the modern spelling -- same
  // spelling on both cards makes for a trivial, uninteresting match.
  const gamePool = words
    .map((word) => {
      const wordEras = erasByWord.get(word.id) ?? [];
      if (wordEras.length < 2) return null;
      const oldest = wordEras[0];
      const modern = wordEras[wordEras.length - 1];
      if (modern.era !== "modern") return null;
      if (oldest.form.toLowerCase() === modern.form.toLowerCase()) return null;
      return {
        pairId: word.id,
        oldForm: oldest.form,
        oldEraLabel: ERA_LABELS[oldest.era],
        modernForm: modern.form,
      };
    })
    .filter((w): w is NonNullable<typeof w> => w !== null);

  const gameWords = sampleWeekly(gamePool, seed + 1, Math.min(GAME_PAIR_COUNT, gamePool.length));

  const gameCards: GameCard[] = shuffleWeekly(
    gameWords.flatMap((w) => [
      { cardId: `${w.pairId}-old`, pairId: w.pairId, label: w.oldForm, sublabel: w.oldEraLabel },
      { cardId: `${w.pairId}-modern`, pairId: w.pairId, label: w.modernForm, sublabel: "Modern" },
    ]),
    seed + 2,
  );

  return (
    <main className="flex min-h-screen flex-col items-center gap-16 bg-strata-teal px-6 py-16">
      <div className="text-center">
        <p className="font-data text-xs tracking-[0.3em] text-strata-parchment/50 uppercase">
          Strata
        </p>
        <p className="font-body-serif mt-3 max-w-md text-lg text-strata-parchment/80">
          In-depth English etymology, in historical context.
        </p>
      </div>

      <WordOfTheWeek
        headword={wordOfWeek.headword}
        driftType={wordOfWeek.driftType}
        eras={wordOfWeekEras}
      />

      {gameCards.length > 0 && <MatchingGame initialCards={gameCards} />}
    </main>
  );
}
