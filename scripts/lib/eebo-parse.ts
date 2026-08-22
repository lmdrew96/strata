// Parsing helpers for EEBO-TCP Phase I TEI P5 XML files (ChaosPatch 92909bfa)
// -- shared between scripts/ingest-eebo.ts and any one-off checks against the
// parser itself.
//
// Unlike CMEPV's older DLPS DTD (all-caps tags, irregular/unclosed markup),
// EEBO-TCP's TEI P5 conversion (tcp2tei.xsl) is well-formed, lowercase-tagged
// XML. It's also a *diplomatic* transcription -- TCP's own stated policy is
// to transcribe exactly what's on the page, nothing added -- so there's no
// CMEPV-style risk of a modern editor's essay being bundled into the same
// <body> as the primary text. That means this parser doesn't need CMEPV's
// per-file/corpus-wide editorial-exclusion machinery at all.
//
// Title/author/date come from scripts/lib/eebo-select.ts's TCP.json-derived
// candidate list, not from parsing each file's teiHeader -- the index
// already carries clean metadata for every text, so re-deriving it from XML
// (which requires picking between editionStmt's digitization-adjacent date
// and sourceDesc's print-edition date, same ambiguity CMEPV's header parser
// exists to resolve) is unnecessary duplicate work here.

export type RawPassage = { locator: string | null; text: string };

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

// A TCP volume can bundle several distinct works under one outer <text>
// (e.g. A00002: five separately-titled meditations sharing one file, each
// with its own <front>/<body>) -- a global non-greedy scan across every
// <body>...</body> block handles both the single-work and bundled cases
// without needing to understand the surrounding <text>/<group> nesting.
const BODY_RE = /<body>([\s\S]*?)<\/body>/g;

// Hand-rolled tokenizer, same approach as cmepv-parse.ts: all that's needed
// is "is this token a tag or text, and which tag." <note> (marginal glosses,
// cross-references, printer's errata) is treated as apparatus and skipped
// entirely -- it's genuine period content, but it's not the flow of the
// primary text and risks pulling in an unrelated word next to a real match.
function extractPassagesFromBody(body: string): RawPassage[] {
  const passages: RawPassage[] = [];
  let mode: "none" | "head" | "p" = "none";
  let noteDepth = 0;
  let headBuf = "";
  let pBuf = "";
  let currentHeading: string | null = null;
  let currentPage: string | null = null;

  const flushP = () => {
    const text = cleanText(pBuf);
    pBuf = "";
    if (text.length === 0) return;
    const locatorParts = [currentHeading, currentPage ? `p. ${currentPage}` : null].filter(
      (p): p is string => Boolean(p),
    );
    passages.push({ locator: locatorParts.length > 0 ? locatorParts.join(", ") : null, text });
  };

  const tokenRe = /<[^>]+>|[^<]+/g;
  let m: RegExpExecArray | null = tokenRe.exec(body);
  while (m !== null) {
    const tok = m[0];
    if (tok[0] === "<") {
      const isClose = tok[1] === "/";
      const isSelfClosing = tok.endsWith("/>");
      const nameMatch = tok.match(/^<\/?([A-Za-z0-9]+)/);
      const name = nameMatch ? nameMatch[1].toLowerCase() : "";

      if (name === "note") {
        if (!isSelfClosing) noteDepth += isClose ? -1 : 1;
        m = tokenRe.exec(body);
        continue;
      }
      if (noteDepth > 0) {
        m = tokenRe.exec(body);
        continue;
      }

      if (name === "pb") {
        const nMatch = tok.match(/\bn="([^"]*)"/);
        if (nMatch) currentPage = nMatch[1];
        m = tokenRe.exec(body);
        continue;
      }

      if (name === "head") {
        if (isClose) {
          currentHeading = cleanText(headBuf) || currentHeading;
          headBuf = "";
        } else {
          headBuf = "";
        }
        mode = isClose ? "none" : "head";
      } else if (name === "p" || name === "l") {
        // Verse lines (<l>) are flushed individually, same as prose <p> --
        // matches cmepv-parse.ts's convention rather than introducing a
        // separate per-stanza (<lg>) grouping.
        if (mode === "p") flushP(); // guard against an unclosed prior <p>/<l>
        if (isClose) {
          flushP();
          mode = "none";
        } else {
          mode = "p";
        }
      }
      // Any other tag (div, hi, lg, gap, seg, ...) is ignored -- its own
      // markup is dropped but enclosed text still flows through below.
      m = tokenRe.exec(body);
      continue;
    }

    if (noteDepth === 0) {
      if (mode === "head") headBuf += tok;
      else if (mode === "p") pBuf += tok;
    }
    m = tokenRe.exec(body);
  }
  if (mode === "p") flushP();

  return passages;
}

export function extractPassages(xml: string): RawPassage[] {
  const passages: RawPassage[] = [];
  let bodyMatch: RegExpExecArray | null;
  BODY_RE.lastIndex = 0;
  while ((bodyMatch = BODY_RE.exec(xml)) !== null) {
    passages.push(...extractPassagesFromBody(bodyMatch[1]));
  }
  return passages;
}
