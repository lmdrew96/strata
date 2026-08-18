"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { FlagshipEra } from "../../../db/schema";
import { ERA_COLORS, ERA_DATES, ERA_LABELS } from "../../../lib/eras";

type Sibling = {
  id: number;
  siblingHeadword: string;
  sharedAncestor: string;
  exists: boolean;
};

type Props = {
  headword: string;
  driftType: string | null;
  eras: FlagshipEra[];
  siblings: Sibling[];
};

export function TimelineScrubber({ headword, driftType, eras, siblings }: Props) {
  // Default to the modern stop — the word as the reader already knows it —
  // and let scrubbing backward reveal its history, matching the spec's
  // "chain radiates backward through time" framing.
  const [activeIndex, setActiveIndex] = useState(eras.length - 1);
  const active = eras[activeIndex];
  const accent = active ? ERA_COLORS[active.era] : ERA_COLORS.modern;

  const letters = useMemo(() => (active ? active.form.split("") : []), [active]);

  if (!active) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-24 text-center text-strata-parchment/70">
        <p className="font-data text-sm">No era data yet for &ldquo;{headword}&rdquo;.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col items-center px-6 py-16">
      <p className="font-data text-xs tracking-[0.3em] text-strata-parchment/50 uppercase">
        Strata
      </p>

      {driftType && (
        <p className="font-data mt-8 text-xs tracking-[0.2em] text-strata-parchment/60 uppercase">
          {driftType}
        </p>
      )}

      {/* Ambient glow behind the word, tracking the active era's accent color */}
      <div className="relative mt-4 flex flex-col items-center">
        <div
          className="pointer-events-none absolute inset-0 -z-10 blur-3xl transition-colors duration-500 ease-out"
          style={{
            background: `radial-gradient(circle, ${accent}66 0%, transparent 70%)`,
          }}
          aria-hidden
        />

        <h1
          key={active.era}
          className="font-display text-6xl font-medium text-strata-parchment sm:text-7xl"
        >
          {letters.map((char, i) => (
            <span
              key={i}
              className="strata-letter inline-block"
              style={{ animationDelay: `${i * 28}ms` }}
            >
              {char === " " ? " " : char}
            </span>
          ))}
        </h1>

        {active.ipa && (
          <p className="font-data mt-2 text-sm text-strata-parchment/60">/{active.ipa}/</p>
        )}

        {/* Always-visible era readout — the per-dot labels below hide on
            narrow screens, so this is what keeps era identity from being
            color-only there. */}
        <p className="font-data mt-4 flex items-center gap-2 text-xs tracking-[0.15em] text-strata-parchment/70 uppercase">
          <span
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: accent }}
            aria-hidden
          />
          {ERA_LABELS[active.era]} · {ERA_DATES[active.era]}
        </p>
      </div>

      {/* Timeline scrubber */}
      <div className="mt-12 w-full">
        <div className="relative flex items-center justify-between">
          <div className="absolute top-1/2 right-0 left-0 h-px -translate-y-1/2 bg-strata-parchment/15" />
          {eras.map((era, i) => {
            const isActive = i === activeIndex;
            const isPast = i <= activeIndex;
            return (
              <button
                key={era.id}
                type="button"
                onClick={() => setActiveIndex(i)}
                aria-current={isActive}
                aria-label={`${ERA_LABELS[era.era]} (${ERA_DATES[era.era]})`}
                className="group relative z-10 flex flex-col items-center gap-2 px-1"
              >
                <span
                  className="h-3 w-3 rounded-full border-2 transition-all duration-300"
                  style={{
                    backgroundColor: isPast ? ERA_COLORS[era.era] : "transparent",
                    borderColor: ERA_COLORS[era.era],
                    boxShadow: isActive ? `0 0 0 4px ${ERA_COLORS[era.era]}40` : "none",
                  }}
                />
                <span
                  className={`font-data hidden text-[11px] tracking-wide uppercase sm:block ${
                    isActive ? "text-strata-parchment" : "text-strata-parchment/40"
                  }`}
                >
                  {ERA_LABELS[era.era]}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Quote / gloss panel */}
      <div className="mt-12 w-full rounded-lg bg-strata-rosewood/30 p-6 backdrop-blur-sm">
        {active.gloss && (
          <p className="font-data text-sm tracking-wide text-strata-parchment/80">
            {active.gloss}
          </p>
        )}
        {active.quote && (
          <p className="font-body-serif mt-4 text-lg text-strata-parchment italic">
            &ldquo;{active.quote}&rdquo;
            {active.quoteCitation && (
              <span className="font-data mt-2 block text-xs tracking-wide text-strata-parchment/50 not-italic">
                — {active.quoteCitation}
              </span>
            )}
          </p>
        )}
        {active.quote && active.quoteTranslation && (
          <p className="font-data mt-2 text-sm text-strata-parchment/60">
            &ldquo;{active.quoteTranslation}&rdquo;
          </p>
        )}
        {!active.quote && !active.gloss && (
          <p className="font-data text-sm text-strata-parchment/40">
            No record for this era yet.
          </p>
        )}
      </div>

      {/* Siblings — words that share a root with this one (the spec's
          "radiate" view: branches off a shared ancestor point). Curated by
          Claude during generation rather than mechanically inferred — see
          etymology-graph.ts for why mechanical graph-matching didn't work. */}
      {siblings.length > 0 && (
        <div className="mt-8 w-full">
          <p className="font-data text-xs tracking-[0.2em] text-strata-parchment/50 uppercase">
            Shares a root with
          </p>
          <div className="mt-3 flex flex-wrap gap-3">
            {siblings.map((sibling) =>
              sibling.exists ? (
                <Link
                  key={sibling.id}
                  href={`/word/${encodeURIComponent(sibling.siblingHeadword)}`}
                  className="rounded-md border border-strata-parchment/20 bg-strata-rosewood/20 px-3 py-2 transition-colors hover:border-strata-coral/50 hover:bg-strata-rosewood/30"
                >
                  <span className="font-display text-lg text-strata-parchment">
                    {sibling.siblingHeadword}
                  </span>
                  <span className="font-data mt-0.5 block text-[11px] text-strata-parchment/50">
                    {sibling.sharedAncestor}
                  </span>
                </Link>
              ) : (
                <div
                  key={sibling.id}
                  className="rounded-md border border-dashed border-strata-parchment/15 px-3 py-2"
                >
                  <span className="font-display text-lg text-strata-parchment/50">
                    {sibling.siblingHeadword}
                  </span>
                  <span className="font-data mt-0.5 block text-[11px] text-strata-parchment/40">
                    {sibling.sharedAncestor}
                  </span>
                </div>
              ),
            )}
          </div>
        </div>
      )}
    </div>
  );
}
