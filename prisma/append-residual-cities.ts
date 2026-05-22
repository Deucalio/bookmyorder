/**
 * prisma/append-residual-cities.ts
 *
 * Bulk-inserts the 632 residual source entries from
 * missing-cities-residual.json as new City rows. Each entry's
 * courierMappings is populated from its tcs / leopards / daewoo data.
 *
 * Province assignment:
 *   - When tcs_city.area is present → TCS_AREA_TO_PROVINCE map.
 *   - When absent (Leopards-only or Daewoo-only entries) →
 *     FALLBACK_PROVINCE_NAME (Punjab) since both Leopards and the
 *     remaining Daewoo coverage are concentrated there.
 *   - DXB-area entries (Ajman, Sharjah, Al Ain, etc.) need a "UAE"
 *     province row; created automatically if missing.
 *
 * IDs are deterministic: SCS-<slug-of-name>. Stable across re-runs,
 * so re-running upserts instead of duplicating.
 *
 * NOTE: This inserts every residual entry verbatim — including obvious
 * sub-localities ("chak abdullah"), courier facilities ("vespa
 * factory", "head office"), and aliases of existing cities
 * ("barnala (a.k)" duplicates the canonical "Barnala A.K"). Cleanup
 * is a separate pass; this script's job is just "put them in".
 *
 * Run:
 *   npx tsx prisma/append-residual-cities.ts                # apply
 *   $env:DRY_RUN="1"; npx tsx prisma/append-residual-cities.ts  # preview (PowerShell)
 *   DRY_RUN=1 npx tsx prisma/append-residual-cities.ts      # preview (bash)
 */

import { PrismaClient } from "@prisma/client";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const DRY_RUN = process.env.DRY_RUN === "1";

// ─── Province mapping ─────────────────────────────────────────────────────────
// TCS area codes → Province.name as it exists in DB. Verified against the
// Province table on 2026-05-21: Azad Kashmir, Balochistan, FATA,
// Gilgit-Baltistan, Islamabad, Khyber Pakhtunkhwa, Punjab, Sindh.

const TCS_AREA_TO_PROVINCE: Record<string, string> = {
  LHE: "Punjab",                // Lahore region
  RWP: "Punjab",                // Rawalpindi (TCS lumps surrounding districts here)
  ISB: "Islamabad",             // Islamabad capital territory
  MUX: "Punjab",                // Multan
  FSD: "Punjab",                // Faisalabad
  GUJ: "Punjab",                // Gujranwala / Gujrat
  KHI: "Sindh",                 // Karachi
  HDD: "Sindh",                 // Hyderabad
  SKZ: "Sindh",                 // Sukkur
  PEW: "Khyber Pakhtunkhwa",    // Peshawar
  SWT: "Khyber Pakhtunkhwa",    // Swat (also under PEW sometimes)
  UET: "Balochistan",           // Quetta
  DXB: "UAE",                   // Dubai (created automatically if missing)
  // Junk facility codes seen in source — fall back to default
  HOF: null as unknown as string, // "Head Office" — sentinel; uses default
  KHW: "Sindh",                 // "Khi Warehouse" — Karachi-adjacent
};
const FALLBACK_PROVINCE_NAME = "Punjab";

// ─── Source types (mirror missing-cities-residual.json shape) ─────────────────

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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildMappings(entry: ShippingCityEntry): CourierMappings | null {
  const mappings: CourierMappings = {};
  if (entry.tcs_city) mappings.tcs = { ...entry.tcs_city };
  if (entry.leopards_city) mappings.leopards = { ...entry.leopards_city };
  if (entry.daewoo_city) {
    mappings.daewoo = {
      terminal_id: entry.daewoo_city.terminal_id,
      terminal_name: entry.daewoo_city.terminal_name,
    };
  }
  return Object.keys(mappings).length > 0 ? mappings : null;
}

/** Strip \r\n, lowercase, non-alphanumeric runs → hyphen, trim hyphens. */
function slug(s: string): string {
  return s
    .replace(/[\r\n]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Title-case for display name: "abbaspur (a.k)" → "Abbaspur (A.K)". */
function titleCase(s: string): string {
  const cleaned = s.replace(/[\r\n]/g, "").trim();
  return cleaned.replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const prisma = new PrismaClient();

async function main() {
  // 1. Load source
  const srcPath = path.join(__dirname, "data", "missing-cities-residual.json");
  if (!fs.existsSync(srcPath)) {
    console.error(`❌  Not found: ${srcPath}`);
    process.exit(1);
  }
  const entries: ShippingCityEntry[] = JSON.parse(
    fs.readFileSync(srcPath, "utf-8"),
  );
  console.log(`📦  Loaded ${entries.length} residual source entries`);

  // 2. Load existing provinces
  const dbProvinces = await prisma.province.findMany({
    select: { id: true, name: true },
  });
  const provinceIdByName = new Map<string, string>(
    dbProvinces.map((p) => [p.name, p.id]),
  );
  console.log(`🌍  Loaded ${dbProvinces.length} provinces from DB`);

  // 3. Determine if we need a UAE province for DXB entries
  const hasDxbEntry = entries.some((e) => e.tcs_city?.area === "DXB");
  if (hasDxbEntry && !provinceIdByName.has("UAE")) {
    const uaeId = "PRV-UAE";
    if (DRY_RUN) {
      console.log(`   would create province: UAE (${uaeId})`);
    } else {
      await prisma.province.upsert({
        where: { name: "UAE" },
        create: { id: uaeId, name: "UAE" },
        update: {},
      });
      console.log(`   ✅  created province: UAE (${uaeId})`);
    }
    provinceIdByName.set("UAE", uaeId);
  }

  // 4. Plan inserts
  type PlanRow = {
    sourceName: string;
    cityId: string;
    cityName: string;
    provinceName: string;
    provinceId: string | null;
    couriers: string[];
    mappings: CourierMappings;
    slugCollisionIndex?: number;
  };

  const usedSlugs = new Map<string, number>(); // slug → occurrence count
  const plan: PlanRow[] = [];
  const skipped: { sourceName: string; reason: string }[] = [];

  for (const entry of entries) {
    const cleanName = entry.name.replace(/[\r\n]/g, "").trim();
    if (!cleanName) {
      skipped.push({ sourceName: entry.name, reason: "empty name" });
      continue;
    }

    const mappings = buildMappings(entry);
    if (!mappings) {
      skipped.push({ sourceName: cleanName, reason: "no courier data" });
      continue;
    }

    // Province
    const tcsArea = entry.tcs_city?.area ?? null;
    const mappedName = tcsArea ? TCS_AREA_TO_PROVINCE[tcsArea] : null;
    const provinceName = mappedName || FALLBACK_PROVINCE_NAME;
    const provinceId = provinceIdByName.get(provinceName) ?? null;
    if (!provinceId) {
      skipped.push({
        sourceName: cleanName,
        reason: `unknown province "${provinceName}" (area=${tcsArea})`,
      });
      continue;
    }

    // ID — slug + collision suffix
    const baseSlug = slug(cleanName);
    if (!baseSlug) {
      skipped.push({ sourceName: cleanName, reason: "slug empty" });
      continue;
    }
    const collisionCount = (usedSlugs.get(baseSlug) ?? 0) + 1;
    usedSlugs.set(baseSlug, collisionCount);
    const cityId = collisionCount === 1
      ? `SCS-${baseSlug}`
      : `SCS-${baseSlug}-${collisionCount}`;

    plan.push({
      sourceName: cleanName,
      cityId,
      cityName: titleCase(cleanName),
      provinceName,
      provinceId,
      couriers: Object.keys(mappings),
      mappings,
      slugCollisionIndex: collisionCount > 1 ? collisionCount : undefined,
    });
  }

  // 5. Pre-flight summary
  console.log(`\n📋  Plan: ${plan.length} to insert, ${skipped.length} skipped\n`);

  const byProvince = new Map<string, number>();
  for (const p of plan) {
    byProvince.set(p.provinceName, (byProvince.get(p.provinceName) ?? 0) + 1);
  }
  console.log("By province:");
  for (const [name, count] of [...byProvince.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`   ${name.padEnd(28)} ${count}`);
  }

  const courierStats = { tcs: 0, leopards: 0, daewoo: 0 };
  for (const p of plan) {
    for (const c of p.couriers) {
      courierStats[c as keyof typeof courierStats]++;
    }
  }
  console.log("\nCourier coverage per inserted row:");
  console.log(`   tcs only          ${plan.filter((p) => p.couriers.length === 1 && p.couriers[0] === "tcs").length}`);
  console.log(`   leopards only     ${plan.filter((p) => p.couriers.length === 1 && p.couriers[0] === "leopards").length}`);
  console.log(`   daewoo only       ${plan.filter((p) => p.couriers.length === 1 && p.couriers[0] === "daewoo").length}`);
  console.log(`   ≥2 couriers       ${plan.filter((p) => p.couriers.length >= 2).length}`);
  console.log(`   total tcs entries ${courierStats.tcs}`);
  console.log(`   total leopards    ${courierStats.leopards}`);
  console.log(`   total daewoo      ${courierStats.daewoo}`);

  const collisions = plan.filter((p) => p.slugCollisionIndex);
  if (collisions.length) {
    console.log(`\n⚠️   ${collisions.length} slug collision(s) — disambiguated with -N suffix:`);
    for (const p of collisions.slice(0, 10)) {
      console.log(`   ${p.cityId} ← "${p.sourceName}"`);
    }
  }

  if (skipped.length) {
    console.log(`\n⏭️   ${skipped.length} skipped:`);
    for (const s of skipped.slice(0, 20)) {
      console.log(`   "${s.sourceName}" — ${s.reason}`);
    }
    if (skipped.length > 20) console.log(`   ... and ${skipped.length - 20} more`);
  }

  // 6. Apply
  if (DRY_RUN) {
    console.log("\n⚠️   DRY RUN — no rows written");
    return;
  }

  console.log(`\n📝  Writing ${plan.length} rows...`);
  let inserted = 0;
  let updated = 0;
  for (const row of plan) {
    const existing = await prisma.city.findUnique({
      where: { id: row.cityId },
      select: { id: true, courierMappings: true },
    });
    if (existing) {
      // Re-run: merge mappings (same semantics as the other seeders)
      const merged = { ...(existing.courierMappings as object || {}), ...row.mappings };
      await prisma.city.update({
        where: { id: row.cityId },
        data: { courierMappings: merged as never },
      });
      updated++;
    } else {
      await prisma.city.create({
        data: {
          id: row.cityId,
          name: row.cityName,
          provinceId: row.provinceId!,
          courierMappings: row.mappings as never,
        },
      });
      inserted++;
    }
  }

  // 7. Final report
  console.log("\n─── Summary ────────────────────────────────────────");
  console.log(`✅  Inserted : ${inserted}`);
  console.log(`🔁  Updated  : ${updated} (existed from a previous run)`);
  console.log(`⏭️   Skipped  : ${skipped.length}`);

  const finalCount = await prisma.city.count();
  const finalMapped = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*)::bigint AS count FROM "City" WHERE "courierMappings" IS NOT NULL
  `;
  console.log(`\n🗺️   City total now            : ${finalCount}`);
  console.log(`🗺️   City with courierMappings : ${finalMapped[0].count}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
