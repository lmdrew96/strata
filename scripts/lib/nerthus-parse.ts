// Parser for the Nerthus UD Old English treebank's CSV export (ChaosPatch
// b576e7de). Despite the .csv extension the delimiter is ";", with RFC4180-
// style double-quote escaping wherever a field's own text contains one (OE
// prose commonly punctuates with a literal semicolon, e.g. "...to Rome;",
// which is why those comment lines come back quoted). CRLF line endings.
//
// Layout per sentence (see the dataset's README for the full field list):
//   # sent_id = ASCA.YEAR0721.001.001;;;;;;;;;
//   "# text = 721. Her Daniel ferde to Rome;";;;;;;;;;
//   # text_en = 721. Here Daniel travelled to Rome.;;;;;;;;;
//   1;721;721;NUM;numeral (cardinal);...
//   2;.;.;PUNCT;punctuation;...
//   ...
//   ;;;;;;;;;                                    <- blank row ends the sentence

export type NerthusToken = { form: string; lemma: string; upos: string };
export type NerthusSentence = {
  sentId: string;
  text: string;
  textEn: string;
  tokens: NerthusToken[];
};

// Minimal RFC4180 field splitter for a single delimiter/quote pair -- good
// enough for this one corpus's export, not a general CSV library.
function splitCsvLine(line: string, delim: string): string[] {
  const fields: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"' && field === "") {
      inQuotes = true;
    } else if (c === delim) {
      fields.push(field);
      field = "";
    } else {
      field += c;
    }
  }
  fields.push(field);
  return fields;
}

// The LEMMA field sometimes carries an inline gloss/POS annotation appended
// to the actual lemma, e.g. "tō 'to, into' (PREP)" or "gif (CONJ)" -- the
// lemma itself is always the leading run before the first quote/paren.
export function cleanLemma(raw: string): string {
  const cut = raw.search(/['‘(]/);
  return (cut === -1 ? raw : raw.slice(0, cut)).trim();
}

export function parseNerthusCsv(content: string): NerthusSentence[] {
  const lines = content.split(/\r?\n/);
  const sentences: NerthusSentence[] = [];

  let sentId = "";
  let text = "";
  let textEn = "";
  let tokens: NerthusToken[] = [];

  const flush = () => {
    if (sentId && text) {
      sentences.push({ sentId, text, textEn, tokens });
    }
    sentId = "";
    text = "";
    textEn = "";
    tokens = [];
  };

  for (const line of lines) {
    if (line.trim().length === 0) continue;
    const fields = splitCsvLine(line, ";");
    const first = fields[0] ?? "";

    if (first.startsWith("# sent_id =")) {
      flush();
      sentId = first.slice("# sent_id =".length).trim();
    } else if (first.startsWith("# text =")) {
      text = first.slice("# text =".length).trim();
    } else if (first.startsWith("# text_en =")) {
      textEn = first.slice("# text_en =".length).trim();
    } else if (fields.every((f) => f.trim().length === 0)) {
      flush();
    } else if (fields.length >= 4 && fields[0].trim().length > 0) {
      // Token row: ID;FORM;LEMMA;UPOSTAG;...
      tokens.push({ form: fields[1], lemma: cleanLemma(fields[2]), upos: fields[3] });
    }
  }
  flush();

  return sentences;
}
