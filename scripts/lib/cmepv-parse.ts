// Parsing helpers for the CMEPV TEI/DLPS-DTD XML files -- shared between
// scripts/ingest-cmepv.ts and any one-off checks against the parser itself.
// See ingest-cmepv.ts's header comment for why this is a hand-rolled
// tokenizer rather than a strict XML parser.

export type RawPassage = { locator: string | null; text: string };
export type HeaderMeta = { title: string; author: string | null; date: string | null };

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function cleanText(raw: string): string {
  return decodeEntities(raw).replace(/\s+/g, " ").trim();
}

function stripTags(s: string): string {
  return cleanText(s.replace(/<[^>]+>/g, ""));
}

// The header is always near the start of the document -- slicing keeps the
// regexes fast and avoids ever scanning a 20MB body for it.
export function extractHeader(xml: string): HeaderMeta {
  const head = xml.slice(0, 20000);
  const headerMatch = head.match(/<HEADER>[\s\S]*?<\/HEADER>/);
  const header = headerMatch ? headerMatch[0] : head;

  const titleMatch = header.match(/<TITLESTMT>[\s\S]*?<TITLE[^>]*>([\s\S]*?)<\/TITLE>/);
  const authorMatch = header.match(/<TITLESTMT>[\s\S]*?<AUTHOR>([\s\S]*?)<\/AUTHOR>/);
  // Prefer SOURCEDESC's own DATE (the original/print edition date) over
  // PUBLICATIONSTMT's HTI digitization-year DATE, which is elsewhere in the
  // same header and not useful for a historical citation.
  const sourceDateMatch = header.match(/<SOURCEDESC>[\s\S]*?<DATE>([\s\S]*?)<\/DATE>/);
  const anyDateMatch = header.match(/<DATE>([\s\S]*?)<\/DATE>/);

  return {
    title: titleMatch ? stripTags(titleMatch[1]) : "Untitled",
    author: authorMatch ? stripTags(authorMatch[1]) : null,
    date: sourceDateMatch ? stripTags(sourceDateMatch[1]) : anyDateMatch ? stripTags(anyDateMatch[1]) : null,
  };
}

// Corpus-wide (not per-file) editorial-apparatus signals -- ChaosPatch
// 08ae757a's follow-on to the EGilds.xml fix. An audit of all ~127 files'
// DIV1/DIV2/DIV3 TYPE vocabulary (215 distinct values) plus a content-
// language spot-check (does the passage carry any ME orthography -- þ ȝ ð,
// hem/heo/hit/quod/ich -- as one sign it's not modern editorial prose) found
// these two classes generalize safely everywhere they were checked, unlike
// generic vocabulary such as "introduction"/"preface"/"appendix" (also seen
// labeling a medieval author's own genuine prologue, e.g. CharlesG.xml's
// "CAXTON'S INTRODUCTION." and afw5744.xml's Ormulum dedication -- real
// primary text, must stay searchable):
//   - a DIV1/2/3 TYPE naming itself as editorial apparatus ("note", "notes",
//     "editor's introduction", "front matter", "back matter", "version
//     notes", "text notes", "endnotes", anything containing "editorial", or
//     anything containing "omitted" -- the DTD's own marker for content the
//     editors chose not to transcribe, confirmed empty on inspection).
//   - a HEAD whose own text contains "editor"/"editorial" -- catches cases
//     where the enclosing division's TYPE doesn't self-label (EGilds.xml's
//     "Editorial Interjection" sits under DIV3 TYPE="gild records").
// Deliberately NOT included: TYPE values seen carrying genuine primary
// content under editorial-sounding labels ("appendix", "various readings",
// "comment" -- aeh6713.xml's DIV TYPE="comment" is a medieval "[Comment.]"
// gloss written in Middle English, not a modern editor's aside). Those stay
// per-file (see PER_FILE_DIV1_EXCLUSIONS / PER_FILE_HEADING_EXCLUSIONS in
// ingest-cmepv.ts) rather than risk hiding real evidence corpus-wide.
const AUTO_EXCLUDE_DIV_TYPES = new Set([
  "note",
  "notes",
  "editor's introduction",
  "front matter",
  "back matter",
  "version notes",
  "text notes",
  "endnotes",
]);

function isAutoExcludedDivType(type: string | null): boolean {
  if (!type) return false;
  const lower = type.toLowerCase();
  return AUTO_EXCLUDE_DIV_TYPES.has(lower) || lower.includes("omitted") || lower.includes("editorial");
}

// "editor"/"editorial" anywhere catches self-labeled asides regardless of
// position; "note" is anchored to the START of the heading only -- verified
// against every "note"-led heading in the corpus (19 occurrences, 3 files):
// EGilds.xml's "NOTE.—"/"NOTES."/"GENERAL NOTE." sit under DIV3
// TYPE="gild records" (a genuine-content type, so the DIV check alone
// doesn't catch them) but are confirmed editorial commentary on inspection;
// the only other two files' "NOTES" headings are already excluded via a
// nested TYPE="version notes" DIV2 or an enclosing "back matter" DIV1.
// Anchored (not a bare substring) so a primary-text heading that merely
// mentions "note" mid-title isn't caught.
const EDITOR_HEADING_RE = /\beditor(ial)?\b|^\s*(general\s+)?notes?\b/i;

// Hand-rolled tokenizer rather than an XML parser: several files have
// irregular/unclosed markup that a strict parser would choke on, and all we
// actually need is "is this token a tag or text, and which tag."
//
// excludeDiv1Types: skip passages inside a top-level <DIV1 TYPE="..."> whose
// type is in this list -- per-file opt-in for vocabulary too generic to
// exclude corpus-wide (see ingest-cmepv.ts's EGilds.xml call site).
//
// excludeHeadings: skip passages under a <HEAD> whose exact (case-
// insensitive) text is in this list -- per-file opt-in for a one-off
// editorial headnote that shares a DIV1 with genuine primary content under
// other headings (e.g. LinDDoc.xml's "APPENDIX: ADDITIONAL DOCUMENTS"
// headnote, followed by real transcribed documents under different heads).
//
// DIV1/2/3 tags in this DTD don't nest reliably enough to close-tag-track
// (confirmed on EGilds.xml: 8 DIV1 opens, 6 closes), so exclusion is tracked
// per level (see divExcluded below): each DIVn open re-evaluates its own
// level from its TYPE and resets any deeper levels, but leaves shallower
// levels alone -- so a DIV2/DIV3 that isn't itself an excluded type still
// inherits exclusion from an excluded ancestor DIV1, rather than a generic
// nested type value ("introduction", "section") silently un-excluding it.
//
// bodyTag: the wrapper tag this file's real content lives inside (default
// "BODY"). EGilds.xml has NO top-level <BODY> at all -- it quotes an entire
// external essay verbatim, complete with that essay's own nested
// <Q1><TEXT><BODY>...</BODY></TEXT></Q1>, so the naive greedy
// <BODY>...</BODY> match locks onto THAT nested body (which starts
// mid-Introduction) instead of the real document, silently starting the
// DIV1 exclusion tracking already inside "Introduction" without ever having
// seen its opening tag. Anchoring on <TEXT> instead for this one file
// captures the true document bounds and lets DIV1 tracking see every
// boundary (confirmed directly against the raw XML, 2026-08-21).
export function extractPassages(
  xml: string,
  excludeDiv1Types: string[] = [],
  bodyTag: string = "BODY",
  excludeHeadings: string[] = [],
): RawPassage[] {
  const bodyMatch = xml.match(new RegExp(`<${bodyTag}>([\\s\\S]*)<\\/${bodyTag}>`));
  if (!bodyMatch) return [];
  const body = bodyMatch[1];

  const excludeSet = new Set(excludeDiv1Types.map((t) => t.toLowerCase()));
  const excludeHeadingSet = new Set(excludeHeadings.map((h) => h.toLowerCase()));
  const passages: RawPassage[] = [];
  let mode: "none" | "head" | "p" = "none";
  let apparatusDepth = 0;
  let headBuf = "";
  let pBuf = "";
  let currentHeading: string | null = null;
  let currentVerse: string | null = null;
  let currentHeadingExcluded = false;
  // Per-level exclusion state, index 0/1/2 = DIV1/DIV2/DIV3. A DIVn open
  // sets its own level from its TYPE and clears any deeper levels (they
  // belonged to whatever was nested in the PREVIOUS DIVn, now superseded) --
  // but does NOT touch shallower levels, so a non-excluded DIV2/DIV3 nested
  // inside an excluded DIV1 correctly stays excluded (confirmed real shape:
  // aha2749.xml's excluded DIV1 TYPE="front matter" contains a DIV2
  // TYPE="introduction" and DIV3 TYPE="section" that aren't excluded types
  // on their own, but everything under them is still the same editorial
  // essay). Effective exclusion is OR across all three levels.
  const divExcluded: [boolean, boolean, boolean] = [false, false, false];
  const setDivLevel = (levelIdx: number, excluded: boolean) => {
    divExcluded[levelIdx] = excluded;
    for (let i = levelIdx + 1; i < divExcluded.length; i++) divExcluded[i] = false;
  };

  const flushP = () => {
    const text = cleanText(pBuf);
    pBuf = "";
    const excluded = divExcluded[0] || divExcluded[1] || divExcluded[2] || currentHeadingExcluded;
    if (text.length === 0 || excluded) return;
    const locatorParts = [currentHeading, currentVerse ? `v.${currentVerse}` : null].filter(
      (p): p is string => Boolean(p),
    );
    passages.push({ locator: locatorParts.length > 0 ? locatorParts.join(" ") : null, text });
  };

  const tokenRe = /<[^>]+>|[^<]+/g;
  let m: RegExpExecArray | null = tokenRe.exec(body);
  while (m !== null) {
    const tok = m[0];
    if (tok[0] === "<") {
      const isClose = tok[1] === "/";
      const nameMatch = tok.match(/^<\/?([A-Za-z0-9]+)/);
      const name = nameMatch ? nameMatch[1].toUpperCase() : "";

      if (name === "NOTE1" || name === "NOTE2" || name === "ARGUMENT") {
        apparatusDepth += isClose ? -1 : 1;
        m = tokenRe.exec(body);
        continue;
      }
      if (apparatusDepth > 0) {
        m = tokenRe.exec(body);
        continue;
      }

      if ((name === "DIV1" || name === "DIV2" || name === "DIV3") && !isClose) {
        const typeMatch = tok.match(/TYPE="([^"]*)"/i);
        const type = typeMatch ? typeMatch[1] : null;
        const levelIdx = name === "DIV1" ? 0 : name === "DIV2" ? 1 : 2;
        const perFileExcluded = name === "DIV1" && type ? excludeSet.has(type.toLowerCase()) : false;
        setDivLevel(levelIdx, perFileExcluded || isAutoExcludedDivType(type));
        // A new division of ANY level starts a fresh heading context --
        // confirmed necessary by EGilds.xml's nested <Q1><TEXT><BODY>
        // mini-document inside a DIV3 headed "NOTE.—": a later <HEAD>
        // ("MR. HABINDON'S ACCOUNT...") inside that same nested block, with
        // no DIV1/2/3 boundary in between, must still inherit the "NOTE.—"
        // exclusion rather than clear it just because its own text doesn't
        // match. Conversely a real DIV boundary (e.g. ahb1378.xml's
        // one-paragraph "APPENDIX." headnote followed by a sibling DIV2 of
        // genuine content) must clear it -- see excludeHeadings' doc comment.
        currentHeadingExcluded = false;
      }

      if (name === "HEAD") {
        if (isClose) {
          currentHeading = cleanText(headBuf) || currentHeading;
          // Only ever turns TRUE here -- a heading that doesn't itself match
          // must not clear an exclusion inherited from an earlier heading in
          // the same division (see the DIV-open comment above for why).
          if (currentHeading && (EDITOR_HEADING_RE.test(currentHeading) || excludeHeadingSet.has(currentHeading.toLowerCase()))) {
            currentHeadingExcluded = true;
          }
          currentVerse = null;
          headBuf = "";
        } else {
          headBuf = "";
        }
        mode = isClose ? "none" : "head";
      } else if (name === "P" || name === "L") {
        // Verse texts use <L> (line) instead of <P> for their structural
        // unit -- treated the same way here, one passage per line/paragraph.
        if (mode === "p") flushP(); // guard against an unclosed prior <P>/<L>
        if (isClose) {
          flushP();
          mode = "none";
        } else {
          mode = "p";
        }
      } else if (name === "MILESTONE" && /UNIT="verse"/.test(tok)) {
        if (mode === "p") flushP();
        const nMatch = tok.match(/N="([^"]*)"/);
        currentVerse = nMatch ? nMatch[1] : currentVerse;
      }
      // Any other tag (PB, EPB, HI1, CELL, ...) is ignored -- its own
      // markup is dropped but its enclosed text still flows through via the
      // text-run branch below.
      m = tokenRe.exec(body);
      continue;
    }

    if (apparatusDepth === 0) {
      if (mode === "head") headBuf += tok;
      else if (mode === "p") pBuf += tok;
    }
    m = tokenRe.exec(body);
  }
  if (mode === "p") flushP();

  return passages;
}
