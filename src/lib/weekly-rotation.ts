// Deterministic weekly content rotation for the landing page -- Word of the
// Week and the matching-game pool both derive from the same seed, so every
// visitor sees the same picks all week (no per-request randomness, no DB
// writes to track "current" content).

function isoWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

export function weeklySeed(date: Date = new Date()): number {
  return date.getUTCFullYear() * 100 + isoWeekNumber(date);
}

// mulberry32 -- small deterministic PRNG, good enough for shuffling a
// content pool. Not for anything security-sensitive.
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seededShuffle<T>(items: T[], seed: number): T[] {
  const rand = mulberry32(seed);
  const shuffled = [...items];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export function pickWeekly<T>(items: T[], seed: number): T {
  return items[seed % items.length];
}

export function sampleWeekly<T>(items: T[], seed: number, count: number): T[] {
  return seededShuffle(items, seed).slice(0, count);
}

export function shuffleWeekly<T>(items: T[], seed: number): T[] {
  return seededShuffle(items, seed);
}
