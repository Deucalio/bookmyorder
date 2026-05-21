/**
 * prisma/extract-residual-missing.ts
 *
 * Subtracts the source entries consumed by apply-matches.ts from
 * missing-cities.json. Output: missing-cities-residual.json — the source
 * entries that are STILL unmatched to any DB City row after both the
 * automated cascade (seed-courier-mappings.ts) AND the curated apply pass
 * (apply-matches.ts).
 *
 * Pairing model:
 *   missing-cities.json     = output of seed-courier-mappings.ts (source
 *                             entries that didn't match any DB city)
 *   matches.csv             = human-reviewed pairings between unmapped DB
 *                             cities and entries from the above
 *   missing-cities.json
 *     - source_matches that were applied
 *     = missing-cities-residual.json
 *
 * Original missing-cities.json is left untouched. Re-running this script
 * just regenerates the residual file.
 *
 * Run:
 *   npx tsx prisma/extract-residual-missing.ts
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

type ShippingCityEntry = {
  name: string;
  tcs_city: unknown;
  leopards_city: unknown;
  daewoo_city: unknown;
  [k: string]: unknown;
};

/** Same sanitization apply-matches.ts uses when keying source entries. */
function cleanName(s: string): string {
  return s.replace(/[\r\n]/g, "").trim();
}

/** Parse one CSV row; comma-aware enough for source names with commas. */
function parseRow(line: string): { source_match: string; confidence: string } | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(",");
  if (parts.length < 4) return null;
  const confidence = parts[parts.length - 1].trim();
  const source_match = parts.slice(2, -1).join(",").trim();
  return { source_match, confidence };
}

function main() {
  // 1. Load matches.csv → set of source_match values that were applied
  const csvPath = path.join(__dirname, "data", "matches.csv");
  if (!fs.existsSync(csvPath)) {
    console.error(`❌  Not found: ${csvPath}`);
    process.exit(1);
  }
  const csvText = fs.readFileSync(csvPath, "utf-8");
  const usedSources = new Set<string>();
  let csvRows = 0;
  let csvSkipped = 0;
  for (const line of csvText.split(/\r?\n/)) {
    const row = parseRow(line);
    if (!row) continue;
    csvRows++;
    if (row.source_match && row.confidence !== "none") {
      usedSources.add(row.source_match);
    } else {
      csvSkipped++;
    }
  }
  console.log(`📄  matches.csv: ${csvRows} rows (${usedSources.size} applied, ${csvSkipped} skipped)`);

  // 2. Load missing-cities.json
  const missingPath = path.join(__dirname, "data", "missing-cities.json");
  if (!fs.existsSync(missingPath)) {
    console.error(`❌  Not found: ${missingPath}`);
    process.exit(1);
  }
  const missing: ShippingCityEntry[] = JSON.parse(fs.readFileSync(missingPath, "utf-8"));
  console.log(`📦  missing-cities.json: ${missing.length} entries`);

  // 3. Partition into removed (consumed by apply) and residual (still unmatched)
  const unmatched = new Set(usedSources); // tracks CSV refs we couldn't find in missing
  const removed: ShippingCityEntry[] = [];
  const residual: ShippingCityEntry[] = [];
  for (const entry of missing) {
    const key = cleanName(entry.name);
    if (usedSources.has(key)) {
      removed.push(entry);
      unmatched.delete(key);
    } else {
      residual.push(entry);
    }
  }

  // 4. Warn if matches.csv references a source not present in missing-cities
  // (would indicate the CSV was generated against a different dataset, or
  // someone hand-edited a source_match that no longer exists)
  if (unmatched.size > 0) {
    console.warn(`\n⚠️  ${unmatched.size} source_match value(s) from matches.csv not found in missing-cities.json:`);
    for (const s of unmatched) console.warn(`   "${s}"`);
  }

  // 5. Write residual
  const outPath = path.join(__dirname, "data", "missing-cities-residual.json");
  fs.writeFileSync(outPath, JSON.stringify(residual, null, 2), "utf-8");

  // 6. Summary
  console.log("\n─── Summary ────────────────────────────────────────");
  console.log(`✅  Removed (consumed by apply-matches): ${removed.length}`);
  console.log(`📋  Residual (still unmatched in source): ${residual.length}`);
  console.log(`📄  ${outPath}`);
}

main();
