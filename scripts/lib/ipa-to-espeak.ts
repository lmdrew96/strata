/**
 * Translates IPA (as stored in flagshipEras.ipa — bare phonemes, no slashes)
 * into eSpeak-NG's own phoneme mnemonic alphabet, for use as bracket-mode
 * phoneme input (`[[...]]`). eSpeak-NG's phoneme INPUT mode does not accept
 * raw IPA — confirmed by testing against the installed 1.52.0 binary:
 * unicode IPA symbols like "ç" and "θ" either get silently dropped or parsed
 * as unrecognized text. Its mnemonic alphabet was cross-checked by comparing
 * `espeak-ng --ipa` and `espeak-ng -x` output for the same words (e.g.
 * "think" -> ipa "θˈɪŋk", mnemonic "T'INk").
 *
 * Multi-character IPA sequences are matched longest-first so digraphs
 * (affricates, diphthongs, length marks) aren't split into their single-char
 * parts first.
 *
 * IMPORTANT — a mapping target that isn't itself a real eSpeak phoneme token
 * doesn't error, it silently truncates: eSpeak stops parsing at the first
 * unrecognized token and drops everything after it, so e.g. mapping bare ɑ
 * to a nonexistent standalone "A" made "kniçtɑs" synthesize as if it were
 * just "kniçt" — no warning, no error, just short/wrong audio (caught only
 * because "knight" OE and ME happened to collide byte-for-byte on playback).
 * Every entry here must be a token confirmed valid on its own via
 * `espeak-ng -x "[[...]]"`, not assumed by analogy to a related symbol. As
 * a second line of defense, generate-pronunciation-audio.ts re-verifies each
 * constructed phoneme string against eSpeak's own trace output before
 * treating it as safe to synthesize.
 */
const MULTI_CHAR_MAP: [string, string][] = [
  // Affricates
  ["tʃ", "tS"], // tʃ
  ["dʒ", "dZ"], // dʒ
  // Long vowels / centering diphthongs
  ["iː", "i:"], // iː
  ["uː", "u:"], // uː
  ["ɑː", "A:"], // ɑː
  ["ɔː", "O:"], // ɔː
  ["ɜː", "3:"], // ɜː
  // Closing diphthongs
  ["eɪ", "eI"], // eɪ
  ["aɪ", "aI"], // aɪ
  ["ɔɪ", "OI"], // ɔɪ
  ["aʊ", "aU"], // aʊ
  ["əʊ", "oU"], // əʊ
  ["oʊ", "oU"], // oʊ
  // Centering diphthongs
  ["ɪə", "I@"], // ɪə
  ["eə", "E@"], // eə
  ["ʊə", "U@"], // ʊə
  // Aspirated w (OE/ME hw-)
  ["ʍ", "hw"], // ʍ
];

const SINGLE_CHAR_MAP: Record<string, string> = {
  // Vowels
  "ɪ": "I", // ɪ
  "ɛ": "E", // ɛ
  "æ": "a", // æ (espeak's own IPA output uses plain 'a' for TRAP)
  // Bare/unmarked ɑ has no standalone eSpeak token of its own — only the
  // long "A:" is real; a bare "A" is silently unrecognized (see the
  // eSpeak-NG truncation note on ipaToEspeakPhonemes below). Approximated
  // with the open-front vowel instead of pairing it with the rounded ɒ,
  // since ɑ and 'a' share unroundedness while ɒ differs on that feature too.
  "ɑ": "a", // ɑ
  "ɒ": "0", // ɒ
  "ɔ": "O", // ɔ
  "ʊ": "U", // ʊ
  "ʌ": "V", // ʌ
  "ə": "@", // ə
  "ɐ": "a#", // ɐ
  a: "a",
  e: "e",
  i: "i",
  o: "o",
  u: "u",
  // Fricatives / other consonants without a direct ASCII IPA form
  "θ": "T", // θ
  "ð": "D", // ð
  "ʃ": "S", // ʃ
  "ʒ": "Z", // ʒ
  "ŋ": "N", // ŋ
  "ɹ": "r", // ɹ
  "ç": "C", // ç
  x: "x",
  // Voiced velar fricative (OE <g> between vowels) has no eSpeak English
  // equivalent — approximated with the plosive, same "honest approximation"
  // tradeoff as the front-rounded vowels below.
  "ɣ": "g", // ɣ
  // Front rounded vowels (OE y, ø) don't exist in eSpeak's English voice.
  // Approximated with the nearest unrounded vowel rather than skipped
  // outright, consistent with the spec's "synthetic sound as honest signal"
  // framing — these were always going to be approximations, not recordings.
  y: "u", // OE <y>, nearest available rounded vowel
  "ø": "3:", // ø
  // Passthrough consonants: identical in IPA and eSpeak mnemonic notation.
  p: "p",
  b: "b",
  t: "t",
  d: "d",
  k: "k",
  g: "g",
  f: "f",
  v: "v",
  s: "s",
  z: "z",
  m: "m",
  n: "n",
  l: "l",
  h: "h",
  w: "w",
  j: "j",
  r: "r",
  // IPA's proper voiced-velar-plosive letter (U+0261 LATIN SMALL LETTER
  // SCRIPT G) is a different codepoint from ASCII "g" (U+0067) — visually
  // near-identical in most fonts but distinct, and Claude's IPA generation
  // uses the proper IPA one. Map both.
  "ɡ": "g", // U+0261
  // Optional/variable segment markers — drop the parens, keep the sound
  // inside as part of the pronunciation rather than treating it as absent.
  "(": "",
  ")": "",
  // Suprasegmentals
  "ˈ": "'", // ˈ primary stress
  "ˌ": ",", // ˌ secondary stress (best-effort; eSpeak's own secondary-stress mnemonic)
  "ː": ":", // ː length (only reached if not already consumed by a MULTI_CHAR_MAP entry)
  ".": "", // syllable boundary — eSpeak infers this itself
  " ": " ",
};

// First character of every vowel mnemonic this module ever emits (both
// MULTI_CHAR_MAP targets like "eI"/"oU" and SINGLE_CHAR_MAP ones like "@"/
// "0"/"V"). Used only to detect a schwa-into-vowel hiatus — see the note on
// SCHWA_HIATUS_BREAK below.
const VOWEL_START = /^[aeiouAEIOUV03]/;

/**
 * eSpeak-NG's en-gb voice applies real RP "linking/intrusive r" liaison:
 * when it sees a schwa ("@") immediately followed by another vowel, it
 * inserts an audible "r" between them that isn't in the phoneme string we
 * gave it — a real feature for connected natural speech, but wrong for a
 * discrete reconstructed pronunciation (confirmed by feeding "n@Is" ->
 * traced back as "n@r-Is"). Known diphthongs (eɪ, əʊ, etc.) never hit this,
 * since MULTI_CHAR_MAP consumes them as one token before this matters — this
 * only fires for a schwa genuinely followed by a *separate* vowel nucleus,
 * as in "nəɪs"'s EME reconstruction. A silent pause between them ("_", also
 * confirmed against the binary) blocks the liaison rule without being
 * audible in a single isolated word.
 */
const SCHWA_HIATUS_BREAK = "_";

/**
 * Converts a bare-IPA string to eSpeak-NG bracket-mode phoneme input.
 * Returns null if the IPA contains a symbol with no known eSpeak equivalent
 * — callers should skip audio generation for that era rather than guess.
 */
export function ipaToEspeakPhonemes(ipa: string): string | null {
  let remaining = ipa.trim();
  const tokens: string[] = [];

  outer: while (remaining.length > 0) {
    for (const [ipaSeq, mnemonic] of MULTI_CHAR_MAP) {
      if (remaining.startsWith(ipaSeq)) {
        tokens.push(mnemonic);
        remaining = remaining.slice(ipaSeq.length);
        continue outer;
      }
    }
    const ch = remaining[0];
    if (ch in SINGLE_CHAR_MAP) {
      tokens.push(SINGLE_CHAR_MAP[ch]);
      remaining = remaining.slice(1);
      continue;
    }
    return null;
  }

  let out = "";
  for (let i = 0; i < tokens.length; i++) {
    if (i > 0 && tokens[i - 1] === "@" && VOWEL_START.test(tokens[i])) {
      out += SCHWA_HIATUS_BREAK;
    }
    out += tokens[i];
  }

  return out.length > 0 ? out : null;
}
