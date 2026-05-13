/**
 * scripts/test-area-matcher.ts
 *
 * Smoke-test the area matcher against real shipping addresses.
 * Produces console output + a JSON report with per-method breakdown and
 * confidence histogram so you can tune thresholds.
 *
 * Run:  npx tsx scripts/test-area-matcher.ts
 *
 * Edit CONFIG below to control:
 *   - which city to test against
 *   - whether to filter samples by raw city name (recommended)
 *   - sample limit
 *   - confidence floor (passed to matchArea)
 */

import { PrismaClient } from "@prisma/client";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  matchArea, // kept for one-shot callers
  matchAreaWithIndex,
  loadAreasForCity,
  __test,
  type AreaMatch,
} from './area-matcher-server';
import { ArrOfSamples } from "./samples";

// =============================================================================
// CONFIG
// =============================================================================
const CONFIG = {
  /** Canonical city name to test against (must exist in DB after merge). */
  CITY_NAME: "Karachi",

  /**
   * If true, only test samples whose raw `city` field roughly matches CITY_NAME.
   * Strongly recommended — testing Lahore addresses against Karachi areas
   * inflates the failure rate and tells you nothing useful.
   */
  FILTER_BY_CITY: true,

  /** Max samples to test. null = all. */
  LIMIT: null as number | null,

  /** Confidence floor passed to matchArea. 0 = accept any match. */
  MIN_CONFIDENCE: 0.9,

  /** If true, deduplicate samples with identical normalized addresses. */
  DEDUP: true,

  /** Where the JSON report is written. */
  LOG_DIR: "./logs/area-matcher-test",

  /** Only log per-sample results to console for failures + low-confidence hits. */
  VERBOSE_CONSOLE: false,
};

// =============================================================================
// Sample source — replace with your data import
// =============================================================================
// Expected shape: array of objects with `shipping_address` as a JSON string.
// Replace this import / declaration with however you load your sample data.
declare const ArrOfSamples: Array<{ shipping_address: string }>;

// =============================================================================
// Types
// =============================================================================
type SampleResult = {
  index: number;
  rawAddress1: string;
  rawAddress2: string;
  rawCity: string;
  combined: string;
  match: AreaMatch | null;
};

type Report = {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  config: typeof CONFIG;
  city: { id: string; name: string };
  totals: {
    samplesLoaded: number;
    samplesAfterFilter: number;
    samplesAfterDedup: number;
    matched: number;
    unmatched: number;
    matchRate: string; // formatted percentage
  };
  byMethod: Record<string, number>;
  confidenceHistogram: Record<string, number>;
  unmatchedSamples: Array<{ address: string; rawCity: string }>;
  lowConfidenceSamples: Array<{
    address: string;
    method: string;
    confidence: number;
    matchedArea: string;
  }>;
  sampleResults: SampleResult[];
};

// =============================================================================
// Helpers
// =============================================================================
function safeParseAddress(raw: string): {
  address1: string;
  address2: string;
  city: string;
} {
  try {
    const parsed = JSON.parse(raw ?? "{}");
    return {
      address1: typeof parsed?.address1 === "string" ? parsed.address1 : "",
      address2: typeof parsed?.address2 === "string" ? parsed.address2 : "",
      city: typeof parsed?.city === "string" ? parsed.city : "",
    };
  } catch {
    return { address1: "", address2: "", city: "" };
  }
}

function bucketConfidence(c: number): string {
  if (c >= 0.95) return "0.95-1.00";
  if (c >= 0.85) return "0.85-0.94";
  if (c >= 0.70) return "0.70-0.84";
  if (c >= 0.60) return "0.60-0.69";
  return "0.00-0.59";
}

function looseCityMatch(rawCity: string, target: string): boolean {
  if (!rawCity) return false;
  const a = rawCity.toLowerCase().replace(/\s+/g, "");
  const b = target.toLowerCase().replace(/\s+/g, "");
  return a.includes(b) || b.includes(a);
}

// =============================================================================
// Main
// =============================================================================
async function main(): Promise<void> {
  const prisma = new PrismaClient();
  const startedAt = Date.now();

  // 1. Resolve city
  const city = await prisma.city.findFirst({
    where: { name: CONFIG.CITY_NAME },
    select: { id: true, name: true },
  });
  if (!city) {
    console.error(`City "${CONFIG.CITY_NAME}" not found in DB. Aborting.`);
    await prisma.$disconnect();
    process.exit(1);
  }
  console.log(`Testing against city: ${city.name} (${city.id})`);

  // 2. Load and parse samples
  const samplesLoaded = ArrOfSamples.length;
  console.log(`Loaded ${samplesLoaded} raw samples`);

  let parsed = ArrOfSamples.map((item, i) => {
    const { address1, address2, city: rawCity } = safeParseAddress(
      item.shipping_address,
    );
    return {
      index: i,
      address1,
      address2,
      rawCity,
      combined: `${address1} ${address2}`.trim(),
    };
  }).filter((s) => s.combined.length > 0);

  // 3. Filter by city if enabled
  if (CONFIG.FILTER_BY_CITY) {
    const before = parsed.length;
    parsed = parsed.filter((s) => looseCityMatch(s.rawCity, CONFIG.CITY_NAME));
    console.log(
      `Filtered by city "${CONFIG.CITY_NAME}": ${parsed.length} of ${before} samples kept`,
    );
  }
  const samplesAfterFilter = parsed.length;

  // 4. Dedup by normalized combined address
  if (CONFIG.DEDUP) {
    const seen = new Set<string>();
    const before = parsed.length;
    parsed = parsed.filter((s) => {
      const key = __test.normalize(s.combined);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    console.log(`Deduped: ${parsed.length} of ${before} samples remain`);
  }
  const samplesAfterDedup = parsed.length;

  // 5. Apply limit
  if (CONFIG.LIMIT !== null) {
    parsed = parsed.slice(0, CONFIG.LIMIT);
    console.log(`LIMIT applied: testing ${parsed.length} samples`);
  }

  // Print first 5 for sanity check
  console.log("\nFirst 5 samples to be tested:");
  parsed.slice(0, 5).forEach((s, i) => console.log(`  [${i}] ${s.combined}`));
  console.log("");

  // 6. Run matcher
  const sampleResults: SampleResult[] = [];
  const byMethod: Record<string, number> = {
    substring: 0,
    token: 0,
    fuzzy: 0,
    "zone-only": 0,
    unmatched: 0,
  };
  const confidenceHistogram: Record<string, number> = {
    "0.95-1.00": 0,
    "0.85-0.94": 0,
    "0.70-0.84": 0,
    "0.60-0.69": 0,
    "0.00-0.59": 0,
  };
  const unmatchedSamples: Report["unmatchedSamples"] = [];
  const lowConfidenceSamples: Report["lowConfidenceSamples"] = [];

// Load all areas for the test city ONCE, before the loop.
  // For multi-city tests (production batches with 50+ cities), use
  // loadAreasForCities(uniqueCityIds) and group samples by cityId.
  console.log(`Loading areas for ${city.name}...`);
  const tStart = Date.now();
  const areas = await loadAreasForCity(city.id);
  console.log(`Loaded ${areas.length} areas in ${Date.now() - tStart}ms\n`);

  let matched = 0;
  for (const s of parsed) {
    const match = matchAreaWithIndex(areas, s.address1, s.address2, {
      minConfidence: CONFIG.MIN_CONFIDENCE,
    });

    sampleResults.push({
      index: s.index,
      rawAddress1: s.address1,
      rawAddress2: s.address2,
      rawCity: s.rawCity,
      combined: s.combined,
      match,
    });

    if (match) {
      matched++;
      byMethod[match.method]++;
      confidenceHistogram[bucketConfidence(match.confidence)]++;

      if (match.confidence < 0.85) {
        lowConfidenceSamples.push({
          address: s.combined,
          method: match.method,
          confidence: Math.round(match.confidence * 100) / 100,
          matchedArea: match.areaName || `(zone-only: ${match.zone})`,
        });
      }
      if (CONFIG.VERBOSE_CONSOLE || match.confidence < 0.85) {
        console.log(
          `[${match.method.padEnd(11)}] ${match.confidence
            .toFixed(2)} → ${match.areaName || `zone:${match.zone}`}  ::  ${
            s.combined
          }`,
        );
      }
    } else {
      byMethod.unmatched++;
      unmatchedSamples.push({ address: s.combined, rawCity: s.rawCity });
      if (CONFIG.VERBOSE_CONSOLE) {
        console.log(`[NO MATCH ]      → ${s.combined}`);
      }
    }
  }

  // 7. Build report
  const matchRate = parsed.length > 0
    ? `${((matched / parsed.length) * 100).toFixed(1)}%`
    : "0.0%";

  const report: Report = {
    startedAt: new Date(startedAt).toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    config: CONFIG,
    city,
    totals: {
      samplesLoaded,
      samplesAfterFilter,
      samplesAfterDedup,
      matched,
      unmatched: parsed.length - matched,
      matchRate,
    },
    byMethod,
    confidenceHistogram,
    unmatchedSamples,
    lowConfidenceSamples,
    sampleResults,
  };

  // 8. Console summary
  console.log("\n========== SUMMARY ==========");
  console.log(`City:            ${city.name} (${city.id})`);
  console.log(`Loaded:          ${samplesLoaded}`);
  console.log(`After filter:    ${samplesAfterFilter}`);
  console.log(`After dedup:     ${samplesAfterDedup}`);
  console.log(`Tested:          ${parsed.length}`);
  console.log(`Matched:         ${matched} (${matchRate})`);
  console.log(`Unmatched:       ${parsed.length - matched}`);
  console.log("\nBy method:");
  Object.entries(byMethod).forEach(([m, c]) =>
    console.log(`  ${m.padEnd(11)} ${c}`),
  );
  console.log("\nConfidence histogram:");
  Object.entries(confidenceHistogram).forEach(([b, c]) =>
    console.log(`  ${b.padEnd(11)} ${c}`),
  );

  // 9. Write report
  if (!fs.existsSync(CONFIG.LOG_DIR))
    fs.mkdirSync(CONFIG.LOG_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const reportPath = path.join(
    CONFIG.LOG_DIR,
    `report-${CONFIG.CITY_NAME.toLowerCase()}-${stamp}.json`,
  );
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\nReport: ${reportPath}`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});