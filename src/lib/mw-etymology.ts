// Merriam-Webster Collegiate Dictionary etymology as a lineage-plausibility
// REFERENCE, not a source (ChaosPatch 24160af2). A professionally-edited
// etymology summary is a cheap cross-check against the class of error
// "baron" represents -- the model claiming an OE/ME ancestor for a word
// that's actually a later loan. Fetched once per headword and surfaced
// read-only next to the OE/ME era cards in the admin UI where Nae is
// already doing her sense-check reading -- never a quote source, an
// automated pass/fail gate, or a model input.

const MW_API_KEY = process.env.MW_COLLEGIATE_API_KEY;

type MwTextPair = [string, string];

type MwDictionaryEntry = {
  et?: MwTextPair[];
};

// M-W's markup tokens (see dictionaryapi.com's formatting guide): {it}..{/it}
// for italics around foreign terms, {a_link|text|target} for a
// cross-reference, {mat|entry|} for a "more at" supplemental pointer, plus
// plain {b}/{sc}/{sup}/{inf} formatting tags. This is a plain-text reading
// aid, not a rendered dictionary entry, so a lossy strip is enough: keep the
// display text out of a *_link token, drop everything else bracketed
// (including {mat|...} -- it's a "see also" note, not etymology content, and
// the term it names is normally already in the surrounding sentence).
function stripMwMarkup(text: string): string {
  return text
    .replace(/\{[a-z_]+_link\|([^|}]*)\|[^}]*\}/gi, "$1")
    .replace(/\{[^}]*\}/g, "")
    .replace(/\s+([,.])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim()
    // A stripped {mat|...} note (a "see also" pointer, not etymology
    // content) is often the last thing in the sentence -- once it's gone,
    // the comma that used to introduce it is left dangling at the end.
    .replace(/,\s*$/, "");
}

function extractEtymologyText(entry: MwDictionaryEntry): string | null {
  if (!entry.et || entry.et.length === 0) return null;
  const parts = entry.et
    .filter(([type]) => type === "text")
    .map(([, text]) => stripMwMarkup(text))
    .filter((text) => text.length > 0);
  const joined = parts.join(" ").trim();
  return joined.length > 0 ? joined : null;
}

// null = transient failure (no key configured, request/parse error, non-OK
// response) -- don't cache, safe to retry later. { text } = a completed
// lookup, worth caching even when text is null (a genuine "M-W has no
// etymology for this word" or "word not found" result), so a confirmed-empty
// headword doesn't get re-fetched forever.
export type MwEtymologyResult = { text: string | null } | null;

/**
 * Best-effort fetch of M-W's etymology summary for a headword. Never
 * throws -- a failure here must not block or slow down core flagship
 * generation, same "search is best-effort, not mandatory" philosophy as the
 * rest of this pipeline.
 */
export async function fetchMwEtymology(headword: string): Promise<MwEtymologyResult> {
  if (!MW_API_KEY) return null;

  try {
    const res = await fetch(
      `https://www.dictionaryapi.com/api/v3/references/collegiate/json/${encodeURIComponent(headword)}?key=${MW_API_KEY}`,
    );
    if (!res.ok) {
      console.error(`[mw-etymology] "${headword}" fetch failed: HTTP ${res.status}`);
      return null;
    }

    const body = await res.json();
    if (!Array.isArray(body)) {
      console.error(`[mw-etymology] "${headword}" unexpected response shape (not an array)`);
      return null;
    }

    // A "word not found" response is an array of plain suggestion strings,
    // not dictionary entry objects -- entries like that carry no `et` field
    // to extract, same as a real entry with no etymology on file.
    for (const entry of body) {
      if (typeof entry !== "object" || entry === null) continue;
      const text = extractEtymologyText(entry as MwDictionaryEntry);
      if (text) return { text };
    }
    return { text: null };
  } catch (err) {
    console.error(`[mw-etymology] "${headword}" fetch threw:`, err);
    return null;
  }
}
