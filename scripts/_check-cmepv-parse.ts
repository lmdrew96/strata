import { extractPassages } from "./lib/cmepv-parse";

async function main() {
  const file = process.argv[2] ?? "afz9170.xml";
  const term = process.argv[3] ?? "stiward";
  const res = await fetch(
    `https://raw.githubusercontent.com/cltk/middle_english_text_cmepv/master/xml/${file}`,
  );
  const xml = await res.text();
  const passages = extractPassages(xml);
  console.log(`total passages: ${passages.length}`);
  const hits = passages.filter((p) => p.text.toLowerCase().includes(term.toLowerCase()));
  console.log(`matches for "${term}": ${hits.length}`);
  for (const h of hits.slice(0, 10)) {
    console.log(`--- locator: ${h.locator} ---`);
    console.log(h.text.slice(0, 300));
    console.log();
  }
}

main();
