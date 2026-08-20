import { extractHeader, extractPassages } from "./lib/cmepv-parse";

const REPO = "cltk/middle_english_text_cmepv";
const RAW_BASE = `https://raw.githubusercontent.com/${REPO}/master`;

// The full current flagship batch (queried live from flagshipWords).
const HEADWORDS = [
  "video","evident","inspect","provide","spectacle","respect","suspect","spectator","survey",
  "import","species","bully","clue","cute","deer","dizzy","egregious","fantastic","fantasy",
  "girl","hound","portable","meat","naughty","nice","pretty","silly","support","terrific",
  "transport","wench","export","report","contain","lord","deport","knight","vixen","retain",
  "maintain","villain","manufacture","manifest","manuscript","manage","manual","command",
  "manner","captain","mandate","cattle","demand","decapitate","achieve","chapter","chief",
  "capitulate","cadet","spirit","inspire","cape","conspire","perspire","respire","transpire",
  "conduct","aspire","produce","induce","duke","educate","duct","seduce","reduce","vision",
  "continue","tenacious","tenure","capital","lady","manipulate","constable","marshal","knave",
  "sheriff","marquis","churl","awful","duchess","starve","baron","boor","steward","neighbor",
];

// A handful of common ME spelling variants worth trying alongside the plain
// modern form -- rough and not exhaustive, just enough to avoid undercounting
// obvious cases (y/i, u/v, final -e, -tion/-cioun, gh/ȝ).
function variants(word: string): string[] {
  const out = new Set([word]);
  out.add(word.replace(/tion$/, "cioun"));
  out.add(word.replace(/tion$/, "cion"));
  out.add(word.replace(/y/g, "i"));
  out.add(word.replace(/qu/g, "qu")); // no-op, kept for symmetry
  out.add(word + "e");
  return [...out];
}

async function main() {
  const res = await fetch(`https://api.github.com/repos/${REPO}/contents/xml`);
  const entries = (await res.json()) as { name: string; type: string }[];
  const files = entries.filter((e) => e.type === "file" && e.name.endsWith(".xml")).map((e) => e.name);

  const hitCounts = new Map<string, number>();
  const examples = new Map<string, { text: string; citation: string }>();
  for (const w of HEADWORDS) hitCounts.set(w, 0);

  let filesDone = 0;
  for (const file of files) {
    const r = await fetch(`${RAW_BASE}/xml/${file}`);
    if (!r.ok) continue;
    const xml = await r.text();
    const meta = extractHeader(xml);
    const passages = extractPassages(xml);
    filesDone++;

    for (const p of passages) {
      const lower = p.text.toLowerCase();
      for (const w of HEADWORDS) {
        if (variants(w).some((v) => lower.includes(v))) {
          hitCounts.set(w, (hitCounts.get(w) ?? 0) + 1);
          if (!examples.has(w)) {
            const citation = `${meta.title}${p.locator ? `, ${p.locator}` : ""}`;
            examples.set(w, { text: p.text.slice(0, 150), citation });
          }
        }
      }
    }
    if (filesDone % 20 === 0) console.error(`...${filesDone}/${files.length} files`);
  }

  const resolved = [...hitCounts.entries()].filter(([, c]) => c > 0);
  const missed = [...hitCounts.entries()].filter(([, c]) => c === 0);

  console.log(`\n${resolved.length}/${HEADWORDS.length} headwords have at least one substring hit in CMEPV.\n`);
  console.log("MISSED:", missed.map(([w]) => w).join(", "));
  console.log("\nSample hits (first match per word):");
  for (const [w] of resolved.slice(0, 90)) {
    const ex = examples.get(w);
    console.log(`  ${w.padEnd(12)} (${hitCounts.get(w)}x) -- ${ex?.citation} -- "${ex?.text}"`);
  }
}

main();
