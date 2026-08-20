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

// Hand-rolled tokenizer rather than an XML parser: several files have
// irregular/unclosed markup that a strict parser would choke on, and all we
// actually need is "is this token a tag or text, and which tag."
export function extractPassages(xml: string): RawPassage[] {
  const bodyMatch = xml.match(/<BODY>([\s\S]*)<\/BODY>/);
  if (!bodyMatch) return [];
  const body = bodyMatch[1];

  const passages: RawPassage[] = [];
  let mode: "none" | "head" | "p" = "none";
  let noteDepth = 0;
  let headBuf = "";
  let pBuf = "";
  let currentHeading: string | null = null;
  let currentVerse: string | null = null;

  const flushP = () => {
    const text = cleanText(pBuf);
    pBuf = "";
    if (text.length === 0) return;
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

      if (name === "NOTE1" || name === "NOTE2") {
        noteDepth += isClose ? -1 : 1;
        m = tokenRe.exec(body);
        continue;
      }
      if (noteDepth > 0) {
        m = tokenRe.exec(body);
        continue;
      }

      if (name === "HEAD") {
        if (isClose) {
          currentHeading = cleanText(headBuf) || currentHeading;
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
      // Any other tag (PB, EPB, HI1, DIV1, DIV2, CELL, ...) is ignored --
      // its own markup is dropped but its enclosed text still flows through
      // via the text-run branch below.
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
