/**
 * prisma/seed-courier-mappings.ts
 *
 * One-time import: reads shippingCities.js and writes courierMappings JSON
 * onto every matching City row in Postgres.
 *
 * Matching strategy (cascade, stop at first hit):
 *   1. Exact normalize() match against City.name
 *   2. Exact normalize() match against any alias in City.aliases
 *   3. Levenshtein fuzzy match (fastest-levenshtein) on normalize(City.name)
 *      — only accepted when similarity ≥ FUZZY_THRESHOLD
 *
 * Outputs:
 *   prisma/data/import-report.json   — per-entry result
 *   prisma/data/missing-cities.json  — entries with matched: false
 *
 * Run:
 *   npx tsx prisma/seed-courier-mappings.ts
 *   # or dry-run (no DB writes):
 *   DRY_RUN=1 npx tsx prisma/seed-courier-mappings.ts
 */

import { PrismaClient } from "@prisma/client";
import { distance } from "fastest-levenshtein";
import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

// ─── Config ───────────────────────────────────────────────────────────────────

const FUZZY_THRESHOLD = 0.82; // similarity floor (0–1). 0.82 ≈ 1-2 char typos on short names
const DRY_RUN = process.env.DRY_RUN === "1";

// ─── Types mirroring shippingCities.js ────────────────────────────────────────

type TcsCity = {
  cityID: number;
  cityName: string;
  cityCode: string;
  area: string;
};

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
  normalizedTerminalName?: string; // internal field — we strip this
};

type ShippingCityEntry = {
  name: string;
  tcs_city: TcsCity | null;
  leopards_city: LeopardsCity | null;
  daewoo_city: DaewooCity | null;
  similarityScore?: number;
};

// ─── CourierMappings shape written to the DB ──────────────────────────────────

type TcsMapped = { cityID: number; cityName: string; cityCode: string; area: string };
type LeopardsMapped = {
  id: number;
  name: string;
  allow_as_origin: boolean;
  allow_as_destination: boolean;
  shipment_type: string[];
};
type DaewooMapped = { terminal_id: number; terminal_name: string };

type CourierMappings = {
  tcs?: TcsMapped;
  leopards?: LeopardsMapped;
  daewoo?: DaewooMapped;
};

// ─── Report shapes ────────────────────────────────────────────────────────────

type ReportEntry = {
  sourceName: string;
  matched: boolean;
  matchMethod?: "exact-name" | "exact-alias" | "fuzzy";
  matchedName?: string;
  matchSimilarity?: number;
  cityId?: string;
  action: "updated" | "skipped" | "no-op";
  couriersWritten?: string[];
};

// ─── normalize() — identical to area-matcher-server.ts ────────────────────────

const SECTOR_RX = /\b([a-z])(?:-|\/|\s)?(\d{1,2})(?:[-/](\d{1,2}))?\b/gi;
function normalizeSectors(s: string): string {
  return s.replace(SECTOR_RX, (match, letter: string, num: string, sub?: string) => {
    const isJoined = /^[a-z]\d/i.test(match);
    const isPunctuated = /^[a-z][-/]/i.test(match);
    if (!isJoined && !isPunctuated) return match;
    const base = `${letter.toLowerCase()}${num}`;
    return sub ? `${base}_${sub}` : base;
  });
}

const NOISE_RX = /[^\p{L}\p{N}\s_]/gu;
const CONNECTORS_RX = /\b(e|ul|al|i|wal|wala)\b/g;

function normalize(s: string | null | undefined): string {
  if (!s) return "";
  let out = s.toLowerCase();
  // Collapse single-letter dot sequences before stripping dots (F.B → fb)
  out = out.replace(
    /\b([a-z])\.([a-z])\.?([a-z])?\.?([a-z])?\.?([a-z])?\b/g,
    (_, a, b, c, d, e) => [a, b, c, d, e].filter(Boolean).join(""),
  );
  out = normalizeSectors(out);
  out = out.replace(NOISE_RX, " ");
  out = out.replace(/\s+/g, " ").trim();
  out = out.replace(CONNECTORS_RX, "").replace(/\s+/g, " ").trim();
  return out;
}

// ─── Levenshtein similarity (0–1) ─────────────────────────────────────────────

function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - distance(a, b) / maxLen;
}

// ─── Build courier mappings object, omitting null couriers ────────────────────

function buildMappings(entry: ShippingCityEntry): CourierMappings | null {
  const mappings: CourierMappings = {};

  if (entry.tcs_city) {
    mappings.tcs = {
      cityID: entry.tcs_city.cityID,
      cityName: entry.tcs_city.cityName,
      cityCode: entry.tcs_city.cityCode,
      area: entry.tcs_city.area,
    };
  }

  if (entry.leopards_city) {
    mappings.leopards = {
      id: entry.leopards_city.id,
      name: entry.leopards_city.name,
      allow_as_origin: entry.leopards_city.allow_as_origin,
      allow_as_destination: entry.leopards_city.allow_as_destination,
      shipment_type: entry.leopards_city.shipment_type,
    };
  }

  if (entry.daewoo_city) {
    // Strip internal normalizedTerminalName — it's a build artifact, not payload
    mappings.daewoo = {
      terminal_id: entry.daewoo_city.terminal_id,
      terminal_name: entry.daewoo_city.terminal_name,
    };
  }

  return Object.keys(mappings).length > 0 ? mappings : null;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const prisma = new PrismaClient();

async function main() {
  // 1. Load source data
  const dataPath = path.join(__dirname, "data", "shippingCities.js");
  if (!fs.existsSync(dataPath)) {
    console.error(`❌  Not found: ${dataPath}`);
    process.exit(1);
  }

  // Dynamic import works for ESM .js with named exports. Node's ESM loader
  // rejects raw Windows paths ("d:\\..." has protocol 'd:'); convert to a
  // file:// URL so the same code runs on Windows, macOS, and Linux.
  const mod = await import(/* @vite-ignore */ pathToFileURL(dataPath).href);
  const entries: ShippingCityEntry[] = mod.shippingCities;
  console.log(`📦  Loaded ${entries.length} shippingCities entries`);

  // 2. Load all cities from DB (one query — avoids N+1)
  const dbCities = await prisma.city.findMany({
    select: { id: true, name: true, aliases: true, courierMappings: true },
  });
  console.log(`🗄️   Loaded ${dbCities.length} City rows from DB`);

  // Build two lookup structures for O(1) matching:
  //   normName → city  (primary name)
  //   normAlias → city  (all aliases)
  type DbCity = (typeof dbCities)[number];

  const byNormName = new Map<string, DbCity>();
  const byNormAlias = new Map<string, DbCity>();

  for (const city of dbCities) {
    const n = normalize(city.name);
    if (n) byNormName.set(n, city);

    for (const alias of city.aliases ?? []) {
      const an = normalize(alias);
      if (an && !byNormName.has(an)) byNormAlias.set(an, city);
    }
  }

  // Pre-build an array of [normName, city] for fuzzy scan
  const normNameEntries: [string, DbCity][] = [...byNormName.entries()];

  // 3. Process each source entry
  const report: ReportEntry[] = [];
  const missing: ShippingCityEntry[] = [];

  let updated = 0;
  let skipped = 0;
  let noOp = 0;

  for (const entry of entries) {
    // Sanitize: strip stray \r\n from names baked into the source file
    const rawName = entry.name.replace(/[\r\n]/g, "").trim();
    const normEntry = normalize(rawName);

    // --- Stage 1: exact name match ---
    let matched: DbCity | undefined = byNormName.get(normEntry);
    let matchMethod: ReportEntry["matchMethod"] = matched ? "exact-name" : undefined;
    let matchSim: number | undefined = matched ? 1 : undefined;

    // --- Stage 2: alias match ---
    if (!matched) {
      matched = byNormAlias.get(normEntry);
      if (matched) {
        matchMethod = "exact-alias";
        matchSim = 1;
      }
    }

    // --- Stage 3: fuzzy match ---
    if (!matched) {
      let bestSim = 0;
      let bestCity: DbCity | undefined;

      for (const [normName, city] of normNameEntries) {
        // Skip comparisons where length difference makes a match impossible
        // at our threshold (saves ~40% of distance() calls on large datasets)
        const lenDiff = Math.abs(normName.length - normEntry.length);
        const maxLen = Math.max(normName.length, normEntry.length);
        if (maxLen > 0 && 1 - lenDiff / maxLen < FUZZY_THRESHOLD) continue;

        const sim = similarity(normEntry, normName);
        if (sim > bestSim) {
          bestSim = sim;
          bestCity = city;
        }
      }

      if (bestCity && bestSim >= FUZZY_THRESHOLD) {
        matched = bestCity;
        matchMethod = "fuzzy";
        matchSim = bestSim;
      }
    }

    // --- No match ---
    if (!matched) {
      report.push({
        sourceName: rawName,
        matched: false,
        action: "skipped",
      });
      missing.push(entry);
      skipped++;
      continue;
    }

    // --- Build payload ---
    const newMappings = buildMappings(entry);

    if (!newMappings) {
      // All couriers are null — nothing to write for this entry
      report.push({
        sourceName: rawName,
        matched: true,
        matchMethod,
        matchedName: matched.name,
        matchSimilarity: matchSim,
        cityId: matched.id,
        action: "no-op",
        couriersWritten: [],
      });
      noOp++;
      continue;
    }

    // Merge with existing mappings (don't clobber keys added by a previous run
    // or by another source file). Existing keys are overwritten only by this entry.
    const existing = (matched.courierMappings ?? {}) as CourierMappings;
    const merged: CourierMappings = { ...existing, ...newMappings };

    const couriersWritten = Object.keys(newMappings);

    if (!DRY_RUN) {
      await prisma.city.update({
        where: { id: matched.id },
        data: { courierMappings: merged },
      });
    }

    report.push({
      sourceName: rawName,
      matched: true,
      matchMethod,
      matchedName: matched.name,
      matchSimilarity: matchSim,
      cityId: matched.id,
      action: "updated",
      couriersWritten,
    });
    updated++;
  }

  // 4. Write output files
  const outDir = path.join(__dirname, "data");
  fs.mkdirSync(outDir, { recursive: true });

  const reportPath = path.join(outDir, "import-report.json");
  const missingPath = path.join(outDir, "missing-cities.json");

  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf-8");
  fs.writeFileSync(missingPath, JSON.stringify(missing, null, 2), "utf-8");

  // 5. Summary
  console.log("\n─── Summary ────────────────────────────────────────");
  if (DRY_RUN) console.log("⚠️   DRY RUN — no DB writes performed");
  console.log(`✅  Updated : ${updated}`);
  console.log(`⏭️   No-op   : ${noOp}  (all couriers null)`);
  console.log(`❌  Skipped : ${skipped}  (no DB match)`);
  console.log(`\n📄  ${reportPath}`);
  console.log(`📄  ${missingPath}`);

  // Quick breakdown by match method
  const byMethod = report.reduce<Record<string, number>>((acc, r) => {
    const k = r.matchMethod ?? "unmatched";
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {});
  console.log("\n── Match methods ──");
  for (const [k, v] of Object.entries(byMethod)) {
    console.log(`   ${k.padEnd(14)}: ${v}`);
  }

  // Log a sample of fuzzy matches for human review
  const fuzzyMatches = report.filter((r) => r.matchMethod === "fuzzy");
  if (fuzzyMatches.length > 0) {
    console.log("\n── Fuzzy matches (review recommended) ──");
    for (const r of fuzzyMatches.slice(0, 30)) {
      console.log(
        `   "${r.sourceName}" → "${r.matchedName}"  (sim=${r.matchSimilarity?.toFixed(3)})`,
      );
    }
    if (fuzzyMatches.length > 30) {
      console.log(`   … and ${fuzzyMatches.length - 30} more (see import-report.json)`);
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
