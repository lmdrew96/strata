// Pure string helpers for citation formatting -- no server-only imports, so
// they're safe to call from both server code (sourcing-tier.ts, when a new
// citation is built) and "use client" display components (reformatting an
// already-stored citation, including ones generated before this file
// existed).

// Builds a citation from Strata's own structured corpus_passages metadata:
// "Attribution, Specific, Date". Attribution is the individual author when
// one is recorded, otherwise the work's own title stands in for it -- an
// anonymous OE gospel or an unattributed Bible translation IS its own
// attribution (e.g. "King James Bible"). The middle slot is the work's
// title when there's a named author, otherwise the passage's own locator,
// so an anonymous/scriptural citation still points at a specific passage
// instead of repeating the title twice.
export function formatCorpusCitation(source: {
  textTitle: string;
  textAuthor: string | null;
  textDate: string | null;
  locator: string | null;
}): string {
  const attribution = source.textAuthor || source.textTitle;
  const specific = source.textAuthor ? source.textTitle : source.locator;
  const parts = [
    attribution,
    specific && specific !== attribution ? specific : null,
    source.textDate,
  ].filter((p): p is string => Boolean(p));
  return parts.join(", ");
}

// Wiktionary/kaikki citations are raw {{quote-book}} template output -- a
// full bibliographic record (publisher, place, page, OCLC...) that reads as
// abnormally long next to Strata's own corpus citations. They reliably
// start with a bare year, though, so this reorders "YEAR, rest..." down to
// the first two comma-separated segments after the year (almost always
// author + title) with the year moved to the end -- "Author, Title, Year".
// Best-effort: a citation that doesn't start with a bare year (Strata's own
// corpus citations, or an already author-first Claude-generated one) is
// returned unchanged rather than risking a bad parse.
export function shortenCitation(raw: string): string {
  const trimmed = raw.trim();
  const match = trimmed.match(/^(\d{4})\b[^,]*,\s*(.+)$/);
  if (!match) return trimmed;

  const [, year, rest] = match;
  const segments = rest.split(/,\s*/).filter(Boolean);
  const kept = segments.slice(0, 2).join(", ");
  return kept ? `${kept}, ${year}` : year;
}
