/**
 * prisma/apply-matches.ts
 *
 * Applies human-curated city matches from `prisma/data/matches.csv` to the
 * `City.courierMappings` JSON field. Companion to `seed-courier-mappings.ts`
 * — that script does the automated cascade match (exact + alias + fuzzy);
 * this one applies whatever was left over and reviewed by hand.
 *
 * CSV format (no header):
 *   db_id,db_name,source_match,confidence
 *
 * Rows with `confidence=none` or empty `source_match` are skipped. Every
 * other row looks up the source entry in `shippingCities.js` by name and
 * merges its courier mapping onto the matching City row.
 *
 * Merge semantics match the original seeder: { ...existing, ...new } —
 * keys present in `new` overwrite, other keys survive. Safe to re-run.
 *
 * Run:
 *   npx tsx prisma/apply-matches.ts                  # apply
 *   DRY_RUN=1 npx tsx prisma/apply-matches.ts        # preview, no writes
 */

import { PrismaClient } from "@prisma/client";
import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

const DRY_RUN = process.env.DRY_RUN === "1";

// ─── Types mirroring shippingCities.js ────────────────────────────────────────

type TcsCity = { cityID: number; cityName: string; cityCode: string; area: string };
type LeopardsCity = {
  id: number;
  name: string;
  allow_as_origin: boolean;
  allow_as_destination: boolean;
  shipment_type: string[];
};
type DaewooCity = {
  terminal_id: number;
  terminal_name: string;
  normalizedTerminalName?: string;
};
type ShippingCityEntry = {
  name: string;
  tcs_city: TcsCity | null;
  leopards_city: LeopardsCity | null;
  daewoo_city: DaewooCity | null;
};

type CourierMappings = {
  tcs?: TcsCity;
  leopards?: LeopardsCity;
  daewoo?: { terminal_id: number; terminal_name: string };
};

// Same buildMappings logic as seed-courier-mappings.ts. Inlined rather than
// imported because the seeder runs its main() on import.
function buildMappings(entry: ShippingCityEntry): CourierMappings | null {
  const mappings: CourierMappings = {};
  if (entry.tcs_city) mappings.tcs = { ...entry.tcs_city };
  if (entry.leopards_city) mappings.leopards = { ...entry.leopards_city };
  if (entry.daewoo_city) {
    // Strip internal normalizedTerminalName — build artifact, not payload
    mappings.daewoo = {
      terminal_id: entry.daewoo_city.terminal_id,
      terminal_name: entry.daewoo_city.terminal_name,
    };
  }
  return Object.keys(mappings).length > 0 ? mappings : null;
}

// ─── CSV parser ───────────────────────────────────────────────────────────────

type Row = {
  db_id: string;
  db_name: string;
  source_match: string;
  confidence: string;
  line: number;
};

function parseCsv(text: string): Row[] {
  const out: Row[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed) continue;
    const parts = trimmed.split(",");
    if (parts.length < 4) {
      console.warn(`⚠️  line ${i + 1}: expected 4 columns, got ${parts.length} — skipping: ${trimmed}`);
      continue;
    }
    // If a source name happened to contain a comma, joins everything after col 1
    // back together (last column is always confidence).
    const confidence = parts[parts.length - 1].trim();
    const source_match = parts.slice(2, -1).join(",").trim();
    out.push({
      db_id: parts[0].trim(),
      db_name: parts[1].trim(),
      source_match,
      confidence,
      line: i + 1,
    });
  }
  return out;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const prisma = new PrismaClient();

async function main() {
  // 1. Load source data — Windows-safe dynamic import
  const dataPath = path.join(__dirname, "data", "shippingCities.js");
  if (!fs.existsSync(dataPath)) {
    console.error(`❌  Not found: ${dataPath}`);
    process.exit(1);
  }
  const mod = await import(/* @vite-ignore */ pathToFileURL(dataPath).href);
  const entries: ShippingCityEntry[] = mod.shippingCities;
  console.log(`📦  Loaded ${entries.length} shippingCities entries`);

  // Build lookup keyed by sanitized name (matches the format Claude saw —
  // \r\n stripped, trimmed). First entry wins on duplicate names.
  const sourceByName = new Map<string, ShippingCityEntry>();
  for (const entry of entries) {
    const cleanName = entry.name.replace(/[\r\n]/g, "").trim();
    if (!sourceByName.has(cleanName)) sourceByName.set(cleanName, entry);
  }
  console.log(`   ${sourceByName.size} unique source names`);

  // 2. Load matches.csv
  const csvPath = path.join(__dirname, "data", "matches.csv");
  if (!fs.existsSync(csvPath)) {
    console.error(`❌  Not found: ${csvPath}`);
    process.exit(1);
  }
  const rows = parseCsv(fs.readFileSync(csvPath, "utf-8"));
  console.log(`📄  Parsed ${rows.length} CSV rows`);

  // 3. Filter — skip empty source_match and confidence=none
  const toApply = rows.filter((r) => r.source_match && r.confidence !== "none");
  const skipped = rows.length - toApply.length;
  console.log(`   ${toApply.length} to apply, ${skipped} skipped (none/empty)`);

  // 4. Validate source names
  const sourceMissing: Row[] = toApply.filter((r) => !sourceByName.has(r.source_match));
  if (sourceMissing.length) {
    console.error(`❌  ${sourceMissing.length} rows reference unknown source entries:`);
    for (const r of sourceMissing.slice(0, 10)) {
      console.error(`   line ${r.line}: "${r.db_name}" -> "${r.source_match}"`);
    }
    if (sourceMissing.length > 10) console.error(`   ... and ${sourceMissing.length - 10} more`);
    process.exit(1);
  }

  // 5. Fetch DB cities
  const dbCities = await prisma.city.findMany({
    where: { id: { in: toApply.map((r) => r.db_id) } },
    select: { id: true, name: true, courierMappings: true },
  });
  const cityById = new Map(dbCities.map((c) => [c.id, c]));

  const dbMissing: Row[] = toApply.filter((r) => !cityById.has(r.db_id));
  if (dbMissing.length) {
    console.error(`❌  ${dbMissing.length} rows reference unknown DB cities:`);
    for (const r of dbMissing.slice(0, 10)) {
      console.error(`   line ${r.line}: ${r.db_id} "${r.db_name}"`);
    }
    if (dbMissing.length > 10) console.error(`   ... and ${dbMissing.length - 10} more`);
    process.exit(1);
  }

  // 6. Surface duplicate source assignments — not fatal, just informational
  const sourceUsage = new Map<string, Row[]>();
  for (const r of toApply) {
    const list = sourceUsage.get(r.source_match) ?? [];
    list.push(r);
    sourceUsage.set(r.source_match, list);
  }
  const dupes = [...sourceUsage.entries()].filter(([, rs]) => rs.length > 1);
  if (dupes.length) {
    console.log(`\n⚠️   ${dupes.length} source entries assigned to multiple DB rows:`);
    for (const [src, rs] of dupes) {
      console.log(`   "${src}" -> ${rs.map((r) => `${r.db_name} (${r.db_id})`).join(", ")}`);
    }
    console.log(`   (will write all — merge semantics preserve existing keys)`);
  }

  // 7. Apply
  type ReportEntry = Row & {
    action: "applied" | "would-apply" | "no-op";
    couriersWritten?: string[];
    reason?: string;
  };
  const report: ReportEntry[] = [];
  let applied = 0;
  let noop = 0;

  for (const row of toApply) {
    const city = cityById.get(row.db_id)!;
    const sourceEntry = sourceByName.get(row.source_match)!;
    const newMappings = buildMappings(sourceEntry);
    if (!newMappings) {
      report.push({ ...row, action: "no-op", reason: "source has no courier data" });
      noop++;
      continue;
    }
    const existing = (city.courierMappings ?? {}) as CourierMappings;
    const merged: CourierMappings = { ...existing, ...newMappings };
    const couriersWritten = Object.keys(newMappings);

    if (!DRY_RUN) {
      await prisma.city.update({
        where: { id: city.id },
        data: { courierMappings: merged },
      });
    }
    report.push({
      ...row,
      action: DRY_RUN ? "would-apply" : "applied",
      couriersWritten,
    });
    applied++;
  }

  // 8. Write report
  const reportPath = path.join(__dirname, "data", "apply-report.json");
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf-8");

  // 9. Summary + post-run count
  console.log("\n─── Summary ────────────────────────────────────────");
  if (DRY_RUN) console.log("⚠️   DRY RUN — no DB writes performed");
  console.log(`✅  Applied : ${applied}`);
  console.log(`⏭️   No-op   : ${noop}`);
  console.log(`📄  ${reportPath}`);

  if (!DRY_RUN) {
    // Postgres treats Json null vs SQL null distinctly; use raw to be precise
    const result = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count
      FROM "City"
      WHERE "courierMappings" IS NOT NULL
    `;
    console.log(`\n🗺️   City rows with courierMappings: ${result[0].count}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
