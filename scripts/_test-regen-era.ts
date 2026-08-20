import { regenerateFlagshipEra } from "../src/lib/flagship";

async function main() {
  const [headword, era] = process.argv.slice(2) as [string, "old_english" | "middle_english" | "early_modern_english" | "modern"];
  const draft = await regenerateFlagshipEra(headword, era);
  console.log(JSON.stringify(draft, null, 2));
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
