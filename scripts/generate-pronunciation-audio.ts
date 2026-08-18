import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { and, eq, isNotNull, isNull, ne } from "drizzle-orm";
import { db } from "../src/db";
import { type Era, flagshipEras, flagshipWords } from "../src/db/schema";
import { ipaToEspeakPhonemes } from "./lib/ipa-to-espeak";

// Reconstructed pronunciation is flagship-only and pre-era, per the spec:
// Modern gets a normal TTS voice (spoken client-side — see TimelineScrubber)
// rather than a synthetic eSpeak clip, so the quality gap itself signals
// "reconstruction" vs. "recording."
const RECONSTRUCTED_ERAS: Era[] = ["old_english", "middle_english", "early_modern_english"];

const OUTPUT_DIR = path.join(process.cwd(), "public", "audio", "pronunciation");
const PUBLIC_PREFIX = "/audio/pronunciation";

function assertEspeakAvailable(): void {
  try {
    execFileSync("espeak-ng", ["--version"], { stdio: "ignore" });
  } catch {
    throw new Error(
      "espeak-ng not found on PATH. Install it first: `brew install espeak-ng` (macOS) " +
        "or your platform's equivalent. This script runs offline/locally — the generated " +
        "audio files are committed as static assets, so espeak-ng is a dev-tool dependency, " +
        "not a production runtime one.",
    );
  }
}

function synthesize(espeakPhonemes: string, outFile: string): void {
  // -s 150: slightly slower than eSpeak's ~175wpm default, for clarity on
  // single reconstructed words rather than running speech.
  execFileSync("espeak-ng", ["-v", "en-gb", "-s", "150", `[[${espeakPhonemes}]]`, "-w", outFile], {
    stdio: "ignore",
  });
}

const onlyLetters = (s: string) => s.replace(/[^a-zA-Z]/g, "");

/**
 * eSpeak-NG doesn't error on an unrecognized phoneme token in bracket-mode
 * input — it silently stops parsing at that point and drops everything
 * after it (see the truncation note on ipaToEspeakPhonemes). A mapping bug
 * or an unanticipated symbol combination can therefore produce short/wrong
 * audio with no error, no skip, nothing in the logs — the first version of
 * this script shipped exactly that for one word before it was caught by
 * accident. This re-derives eSpeak's own trace of what it's about to
 * synthesize and confirms it accounts for the whole phoneme string we sent,
 * so a truncation gets treated as a skip instead of shipping silently.
 */
function verifyNoTruncation(espeakPhonemes: string): boolean {
  const trace = execFileSync("espeak-ng", ["-v", "en-gb", "-q", "-x", `[[${espeakPhonemes}]]`], {
    encoding: "utf8",
  }).trim();
  return onlyLetters(trace) === onlyLetters(espeakPhonemes);
}

async function main() {
  assertEspeakAvailable();

  if (!existsSync(OUTPUT_DIR)) {
    mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const rows = await db
    .select({
      eraId: flagshipEras.id,
      era: flagshipEras.era,
      ipa: flagshipEras.ipa,
      headword: flagshipWords.headword,
    })
    .from(flagshipEras)
    .innerJoin(flagshipWords, eq(flagshipEras.flagshipWordId, flagshipWords.id))
    .where(
      and(
        ne(flagshipEras.era, "modern"),
        isNotNull(flagshipEras.ipa),
        isNull(flagshipEras.audioUrl),
      ),
    );

  const pending = rows.filter((r) => RECONSTRUCTED_ERAS.includes(r.era));

  if (pending.length === 0) {
    console.log("No eras need pronunciation audio.");
    return;
  }

  console.log(`Generating audio for ${pending.length} era(s)...`);

  let generated = 0;
  const skipped: { headword: string; era: string; ipa: string; reason: string }[] = [];

  for (const row of pending) {
    const ipa = row.ipa as string;
    const phonemes = ipaToEspeakPhonemes(ipa);
    if (!phonemes) {
      skipped.push({ headword: row.headword, era: row.era, ipa, reason: "unmappable IPA symbol" });
      continue;
    }
    if (!verifyNoTruncation(phonemes)) {
      skipped.push({
        headword: row.headword,
        era: row.era,
        ipa,
        reason: `eSpeak truncated "${phonemes}" — a mapped token isn't a real phoneme on its own`,
      });
      continue;
    }

    const filename = `${row.headword}-${row.era}.wav`;
    const outFile = path.join(OUTPUT_DIR, filename);

    try {
      synthesize(phonemes, outFile);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`  FAILED [${row.headword}/${row.era}]: ${message}`);
      continue;
    }

    await db
      .update(flagshipEras)
      .set({ audioUrl: `${PUBLIC_PREFIX}/${filename}` })
      .where(eq(flagshipEras.id, row.eraId));

    console.log(`  [${row.era}] ${row.headword}: "${ipa}" -> ${filename}`);
    generated++;
  }

  console.log(`\n=== Generated ${generated}/${pending.length} clip(s) ===`);
  if (skipped.length > 0) {
    console.log(`Skipped ${skipped.length} era(s):`);
    for (const s of skipped) console.log(`  - [${s.era}] ${s.headword}: "${s.ipa}" (${s.reason})`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
