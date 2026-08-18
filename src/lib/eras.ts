import type { Era } from "../db/schema";

export const ERA_LABELS: Record<Era, string> = {
  old_english: "Old English",
  middle_english: "Middle English",
  early_modern_english: "Early Modern English",
  modern: "Modern",
};

export const ERA_DATES: Record<Era, string> = {
  old_english: "c. 900",
  middle_english: "c. 1400",
  early_modern_english: "c. 1600",
  modern: "Today",
};

// One accent per era, matching the spec's sediment gradient: oldest reads
// deep and dark, modern resolves into the brightest coral.
export const ERA_COLORS: Record<Era, string> = {
  old_english: "#26121b",
  middle_english: "#6b1a34",
  early_modern_english: "#ce3737",
  modern: "#fb6734",
};
