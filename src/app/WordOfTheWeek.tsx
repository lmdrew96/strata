import Link from "next/link";
import type { FlagshipEra } from "../db/schema";
import { ERA_COLORS } from "../lib/eras";

type Props = {
  headword: string;
  driftType: string | null;
  eras: FlagshipEra[];
};

export function WordOfTheWeek({ headword, driftType, eras }: Props) {
  const chain = eras
    .map((e) => e.gloss)
    .filter((g): g is string => Boolean(g))
    .join(" → ");
  const modernEra = eras[eras.length - 1];
  const accent = modernEra ? ERA_COLORS[modernEra.era] : ERA_COLORS.modern;

  return (
    <section className="w-full max-w-2xl rounded-lg bg-strata-rosewood/30 p-8 backdrop-blur-sm">
      <p className="font-data text-xs tracking-[0.3em] text-strata-parchment/50 uppercase">
        Word of the Week
      </p>
      <h2 className="font-display mt-3 text-5xl font-medium text-strata-parchment">{headword}</h2>
      {driftType && (
        <p className="font-data mt-2 text-xs tracking-[0.2em] text-strata-parchment/60 uppercase">
          {driftType}
        </p>
      )}
      {chain && <p className="font-data mt-4 text-sm text-strata-parchment/80">{chain}</p>}
      <Link
        href={`/word/${encodeURIComponent(headword)}`}
        className="font-data mt-6 inline-flex items-center gap-1 text-sm font-medium tracking-wide hover:underline"
        style={{ color: accent }}
      >
        Explore the full history →
      </Link>
    </section>
  );
}
