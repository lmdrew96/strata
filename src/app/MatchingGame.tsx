"use client";

import { useCallback, useState } from "react";

export type GameCard = {
  cardId: string;
  pairId: number;
  label: string;
  sublabel: string;
};

type Props = {
  initialCards: GameCard[];
};

function shuffleClient<T>(items: T[]): T[] {
  const shuffled = [...items];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export function MatchingGame({ initialCards }: Props) {
  const [cards, setCards] = useState(initialCards);
  // Cards currently face-up but not yet confirmed as a match.
  const [flipped, setFlipped] = useState<string[]>([]);
  const [matchedPairIds, setMatchedPairIds] = useState<Set<number>>(new Set());
  const [announcement, setAnnouncement] = useState("");

  const totalPairs = cards.length / 2;
  const allMatched = matchedPairIds.size === totalPairs;

  const handleFlip = useCallback(
    (card: GameCard) => {
      if (matchedPairIds.has(card.pairId) || flipped.includes(card.cardId)) return;

      // Two mismatched cards are already showing -- picking a third card
      // resolves them immediately instead of forcing a wait.
      const base = flipped.length === 2 ? [] : flipped;
      const next = [...base, card.cardId];
      setFlipped(next);

      if (next.length === 2) {
        const first = cards.find((c) => c.cardId === next[0]);
        const second = cards.find((c) => c.cardId === next[1]);
        if (first && second && first.pairId === second.pairId) {
          setMatchedPairIds((prev) => new Set(prev).add(first.pairId));
          setAnnouncement(`Matched: ${first.label} and ${second.label}`);
          setFlipped([]);
        } else {
          setAnnouncement("Not a match. Pick another card whenever you're ready.");
        }
      }
    },
    [cards, flipped, matchedPairIds],
  );

  function handleReshuffle() {
    setCards((prev) => shuffleClient(prev));
    setFlipped([]);
    setMatchedPairIds(new Set());
    setAnnouncement("");
  }

  return (
    <section className="w-full max-w-3xl">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="font-display text-2xl text-strata-parchment">Match the words</h2>
        <p className="font-data shrink-0 text-xs text-strata-parchment/60">
          {matchedPairIds.size} of {totalPairs} matched
        </p>
      </div>
      <p className="font-data mt-1 text-xs text-strata-parchment/50">
        Flip a card, then find its modern-day match. No timer, no penalty for a wrong guess.
      </p>

      <div className="mt-6 grid grid-cols-3 lg:grid-cols-4 md:grid-cols-3 gap-2">
        {cards.map((card) => (
          <MatchCard
            key={card.cardId}
            card={card}
            faceUp={flipped.includes(card.cardId) || matchedPairIds.has(card.pairId)}
            settled={matchedPairIds.has(card.pairId)}
            onFlip={() => handleFlip(card)}
          />
        ))}
      </div>

      <div aria-live="polite" className="sr-only">
        {announcement}
      </div>

      {allMatched && (
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-strata-rosewood/30 px-5 py-4">
          <p className="font-data text-sm text-strata-parchment">
            All {totalPairs} matched.
          </p>
          <button
            type="button"
            onClick={handleReshuffle}
            className="font-data rounded-md border border-strata-parchment/30 px-3 py-1.5 text-xs font-medium tracking-wide text-strata-parchment uppercase transition-colors hover:bg-strata-parchment/10"
          >
            Play again
          </button>
        </div>
      )}
    </section>
  );
}

function MatchCard({
  card,
  faceUp,
  settled,
  onFlip,
}: {
  card: GameCard;
  faceUp: boolean;
  settled: boolean;
  onFlip: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onFlip}
      disabled={settled}
      aria-pressed={faceUp}
      aria-label={faceUp ? `${card.label}, ${card.sublabel}` : "Face-down card"}
      className={`aspect-square w-full rounded-md border p-1 text-center transition-colors disabled:cursor-default ${
        settled
          ? "border-strata-coral/50 bg-strata-coral/10"
          : faceUp
            ? "border-strata-parchment/40 bg-strata-rosewood/40"
            : "border-strata-parchment/15 bg-strata-rosewood/20 hover:border-strata-parchment/30"
      }`}
    >
      {faceUp ? (
        <>
          <span className="font-display block text-lg text-strata-parchment">{card.label}</span>
          <span className="font-data mt-1 block text-[8px] md:text-[10px] tracking-tighter text-strata-parchment/50 uppercase">
            {card.sublabel}
          </span>
          {settled && (
            <span aria-hidden className="font-data mt-1 block text-xs text-strata-coral">
              ✓ matched
            </span>
          )}
        </>
      ) : (
        <span aria-hidden className="font-data block text-center text-lg text-strata-parchment/30">
          ?
        </span>
      )}
    </button>
  );
}
