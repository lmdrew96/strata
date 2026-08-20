// Parser for the "the-old-english-dataset" CSV (ChaosPatch 42f1890d).
// Standard RFC4180 comma-delimited CSV, doubled-quote escaping, and
// (unlike Nerthus's export) fields can contain embedded literal newlines --
// this parses the whole buffer character-by-character rather than
// line-by-line for that reason.
//
// Columns: start,end,text_name,new_match,original_match,translation,
//   original,len_translation,len_original,len_diff
// Per the patch's licensing decision, only start/end/text_name/original are
// read here -- translation is Dr. Ophelia Hostetter's scholarly work and is
// never touched, new_match/original_match/len_* aren't needed.

export type OEPoetryRow = {
  start: string;
  end: string;
  textName: string;
  original: string;
};

function parseCsv(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const n = content.length;

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  while (i < n) {
    const c = content[i];
    if (inQuotes) {
      if (c === '"') {
        if (content[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"' && field === "") {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ",") {
      endField();
      i++;
      continue;
    }
    if (c === "\r") {
      i++;
      continue;
    }
    if (c === "\n") {
      endRow();
      i++;
      continue;
    }
    field += c;
    i++;
  }
  // Trailing field/row if the file doesn't end on a newline.
  if (field.length > 0 || row.length > 0) endRow();

  return rows;
}

// text_name arrives as e.g. "riddle_30a.txt" -- strip the extension and
// title-case each underscore-separated word for a browsable label. This is
// a display convenience only, not an assertion about manuscript or date:
// the source corpus spans multiple manuscripts (Vercelli Book, Exeter
// Book, Beowulf MS, Junius MS...) and attributing each of the ~170 texts
// correctly isn't something to guess at, so textDate/textAuthor are left
// null in the ingest script rather than invented.
export function titleFromTextName(textName: string): string {
  const base = textName.replace(/\.txt$/i, "");
  return base
    .split("_")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function parseOEPoetryCsv(content: string): OEPoetryRow[] {
  const rows = parseCsv(content);
  if (rows.length === 0) return [];

  const header = rows[0];
  const idx = {
    start: header.indexOf("start"),
    end: header.indexOf("end"),
    textName: header.indexOf("text_name"),
    original: header.indexOf("original"),
  };
  if (Object.values(idx).some((v) => v === -1)) {
    throw new Error(`Unexpected header: ${header.join(",")}`);
  }

  const out: OEPoetryRow[] = [];
  for (const r of rows.slice(1)) {
    if (r.every((f) => f.trim().length === 0)) continue;
    const original = (r[idx.original] ?? "").trim();
    const textName = (r[idx.textName] ?? "").trim();
    if (!original || !textName) continue;
    out.push({
      start: (r[idx.start] ?? "").trim(),
      end: (r[idx.end] ?? "").trim(),
      textName,
      original,
    });
  }
  return out;
}
