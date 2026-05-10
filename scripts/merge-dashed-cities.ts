/**
 * scripts/merge-dashed-cities.ts
 *
 * Merges cities like "Peshawar - Hayatabad" into:
 *   - Canonical city "Peshawar" (created or reused)
 *   - New Area "Hayatabad" under that canonical city
 *
 * Existing areas under the dashed city are reassigned to the canonical city.
 * Orders and CourierCityStats referencing the dashed city are also reassigned.
 * Cities like "Bara - Khyber Agency" (admin suffix) are renamed to just "Bara".
 *
 * Run with:  npx tsx scripts/merge-dashed-cities.ts
 *
 * Tested against this schema:
 *   model City  { id String @id; provinceId String; name String; ... }
 *   model Area  { id String @id; cityId String;     name String; ... }
 *   model Order            { cityId String?; areaId String?; provinceId String?; ... }
 *   model CourierCityStats { cityId String;  @@unique([shopId, courierCode, cityId]) }
 *
 * BACKUP YOUR DB before running with DRY_RUN=false. There is no undo.
 */

import { PrismaClient, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

// =============================================================================
// CONFIG — edit these to control the run
// =============================================================================
const CONFIG = {
  /** If true: read-only — no DB writes, just produce a preview report. */
  DRY_RUN: false,

  /** Process at most N dashed cities. null = all. */
  // LIMIT: 9 as number | null,
  LIMIT: null,

  /**
   * Optional: only process dashed cities whose base name (left of " - ") matches
   * this string (case-insensitive). Useful to test one group end-to-end.
   * Example: 'peshawar' processes all Peshawar - * cities together.
   */
  // TARGET_BASE_NAME: null as string | null,
  TARGET_BASE_NAME: null,

  /** Where the JSON report and log are written. */
  LOG_DIR: './logs/merge-dashed-cities',

  /**
   * If the suffix (right of " - ") contains any of these substrings, the city
   * is treated as STANDALONE — the suffix is dropped, no area is created.
   * Example: "Bara - Khyber Agency" → renamed to "Bara".
   */
  ADMIN_SUFFIX_KEYWORDS: [
    'agency',
    'district',
    'tehsil',
    'sub-division',
    'subdivision',
  ],

  /**
   * Hard overrides for tricky names. Key is the EXACT original City.name.
   *   action 'standalone' → rename city to `as`, drop suffix, no area created.
   *   action 'zone'       → split into base city `as` + area `area`.
   *   action 'skip'       → leave row untouched (handle manually later).
   */
  NAME_OVERRIDES: {
    // 'Faisalabad Chak - Jhumra': { action: 'standalone', as: 'Chak Jhumra' },
    // 'Some Name': { action: 'zone', as: 'Some', area: 'Name' },
    // 'Hard Case': { action: 'skip' },
  } as Record<
    string,
    | { action: 'standalone'; as: string }
    | { action: 'zone'; as: string; area: string }
    | { action: 'skip' }
  >,

  /**
   * ID generator for newly created City / Area rows.
   * Default: short prefixed UUID so merged rows are easy to spot in DB.
   * Switch to `randomUUID()` if you prefer plain UUIDs.
   */
  newCityId: () => `MRG-CITY-${randomUUID().slice(0, 12)}`,
  newAreaId: () => `MRG-AREA-${randomUUID().slice(0, 12)}`,
};

// =============================================================================
// Helpers
// =============================================================================
function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

function parseDashedName(name: string): { base: string; suffix: string | null } {
  // Prefer " - " (with surrounding spaces) — the canonical pattern in the data
  const withSpaces = name.indexOf(' - ');
  if (withSpaces !== -1) {
    return {
      base: name.substring(0, withSpaces).trim(),
      suffix: name.substring(withSpaces + 3).trim() || null,
    };
  }
  // Fallback: plain dash with no surrounding spaces
  const plain = name.indexOf('-');
  if (plain === -1) return { base: name.trim(), suffix: null };
  return {
    base: name.substring(0, plain).trim(),
    suffix: name.substring(plain + 1).trim() || null,
  };
}

function isAdminSuffix(suffix: string): boolean {
  const norm = normalize(suffix);
  return CONFIG.ADMIN_SUFFIX_KEYWORDS.some((kw) => norm.includes(kw));
}

// =============================================================================
// Logging
// =============================================================================
type LogEntry = {
  timestamp: string;
  level: 'info' | 'warn' | 'error';
  message: string;
  data?: unknown;
};

const logEntries: LogEntry[] = [];

function log(level: LogEntry['level'], message: string, data?: unknown): void {
  const entry: LogEntry = { timestamp: new Date().toISOString(), level, message, data };
  logEntries.push(entry);
  const tag = level === 'error' ? '[ERROR]' : level === 'warn' ? '[WARN] ' : '[INFO] ';
  if (data !== undefined) console.log(`${tag} ${message}`, JSON.stringify(data));
  else console.log(`${tag} ${message}`);
}

// =============================================================================
// Report types
// =============================================================================
type CityOperation = {
  mode: 'standalone-rename' | 'zone-merge' | 'override-skip';
  oldCity: { id: string; name: string; provinceId: string };
  parsed: { base: string; suffix: string | null };
  canonicalCity: {
    id: string;
    name: string;
    wasCreatedNow: boolean;
  } | null;
  newArea: { id: string; name: string } | null;
  reassignedAreas: { id: string; name: string }[];
  ordersReassigned: number;
  statsReassigned: number;
  statsMergedAndDeleted: number;
  oldCityDeleted: boolean;
};

type Report = {
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  config: typeof CONFIG;
  summary: {
    dashedCitiesInDb: number;
    dashedCitiesProcessed: number;
    standaloneRenamed: number;
    zonesMerged: number;
    canonicalCitiesCreated: number;
    canonicalCitiesReused: number;
    areasCreatedFromZones: number;
    existingAreasReassigned: number;
    ordersReassigned: number;
    statsReassigned: number;
    statsMergedAndDeleted: number;
    skipped: number;
    errors: number;
  };
  operations: CityOperation[];
  errors: { cityId: string; cityName: string; error: string; stack?: string }[];
};

function newReport(): Report {
  return {
    startedAt: new Date().toISOString(),
    config: CONFIG,
    summary: {
      dashedCitiesInDb: 0,
      dashedCitiesProcessed: 0,
      standaloneRenamed: 0,
      zonesMerged: 0,
      canonicalCitiesCreated: 0,
      canonicalCitiesReused: 0,
      areasCreatedFromZones: 0,
      existingAreasReassigned: 0,
      ordersReassigned: 0,
      statsReassigned: 0,
      statsMergedAndDeleted: 0,
      skipped: 0,
      errors: 0,
    },
    operations: [],
    errors: [],
  };
}



// =============================================================================
// SIMPLIFIED before/after report
// =============================================================================
type SimpleChange = {
  before: {
    city: string;
    id: string;
    areasCount: number;
    ordersCount: number;
    statsCount: number;
  };
  after:
    |  {
        action: 'zone-merge';
        cityBecame: string;
        newAreaCreated: string;
        zoneAssigned: string;
        areasMovedToCanonical: number;
        ordersMovedToCanonical: number;
        statsMovedToCanonical: number;
        statsMergedAndDeleted: number;
        oldCityDeleted: boolean;
      }
    | {
        action: 'standalone-rename';
        cityBecame: string;
        mergedIntoExistingCity: boolean;
        areasMovedToCanonical: number;
        ordersMovedToCanonical: number;
        statsMovedToCanonical: number;
        statsMergedAndDeleted: number;
        oldCityDeleted: boolean;
      }
    | {
        action: 'override-skip';
        reason: string;
      };
};

type SimpleReport = {
  startedAt: string;
  finishedAt?: string;
  mode: 'DRY_RUN' | 'LIVE';
  summary: {
    before: {
      dashedCitiesInDb: number;
      dashedCitiesProcessed: number;
    };
    after: {
      canonicalCitiesCreated: string[]; // names of new canonical cities
      canonicalCitiesReused: string[];  // names of canonical cities reused
      newAreasCreated: number;
      areasReassigned: number;
      ordersReassigned: number;
      statsReassigned: number;
      statsMergedAndDeleted: number;
      dashedCitiesDeleted: number;
      standaloneRenamed: number;
      skipped: number;
      errors: number;
    };
  };
  changes: SimpleChange[];
};

const simpleChanges: SimpleChange[] = [];
const canonicalCreatedNames = new Set<string>();
const canonicalReusedNames = new Set<string>();

function recordChange(change: SimpleChange): void {
  simpleChanges.push(change);
}



// =============================================================================
// Main
// =============================================================================
type DashedCityRow = {
  id: string;
  name: string;
  provinceId: string;
  areas: { id: string; name: string }[];
};

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  const startedAt = Date.now();
  const report = newReport();

  log('info', 'merge-dashed-cities starting', {
    dryRun: CONFIG.DRY_RUN,
    limit: CONFIG.LIMIT,
    targetBaseName: CONFIG.TARGET_BASE_NAME,
  });

  if (!CONFIG.DRY_RUN) {
    console.log('\n*** LIVE RUN — DB will be modified. Backup first. ***\n');
  }

  try {
    report.summary.dashedCitiesInDb = await prisma.city.count({
      where: { name: { contains: '-' } },
    });
    log('info', `Found ${report.summary.dashedCitiesInDb} dashed cities in DB`);

    let dashedCities: DashedCityRow[] = await prisma.city.findMany({
      where: { name: { contains: '-' } },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        provinceId: true,
        areas: { select: { id: true, name: true } },
      },
    });

    if (CONFIG.TARGET_BASE_NAME) {
      const target = CONFIG.TARGET_BASE_NAME.toLowerCase();
      dashedCities = dashedCities.filter(
        (c) => parseDashedName(c.name).base.toLowerCase() === target,
      );
      log('info', `Filtered to ${dashedCities.length} cities with base "${target}"`);
    }

    if (CONFIG.LIMIT !== null) {
      dashedCities = dashedCities.slice(0, CONFIG.LIMIT);
      log('info', `LIMIT applied → processing ${dashedCities.length} cities`);
    }

    for (const city of dashedCities) {
      try {
        await processCity(prisma, city, report);
      } catch (err) {
        report.summary.errors++;
        const e = err as Error;
        report.errors.push({
          cityId: city.id,
          cityName: city.name,
          error: e.message,
          stack: e.stack,
        });
        log('error', `Failed processing "${city.name}" (${city.id}): ${e.message}`);
      }
    }
  } finally {
    report.finishedAt = new Date().toISOString();
    report.durationMs = Date.now() - startedAt;

    if (!fs.existsSync(CONFIG.LOG_DIR)) fs.mkdirSync(CONFIG.LOG_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const tag = CONFIG.DRY_RUN ? '-DRYRUN' : '-LIVE';
    const reportPath = path.join(CONFIG.LOG_DIR, `report-${stamp}${tag}.json`);
    const logPath = path.join(CONFIG.LOG_DIR, `log-${stamp}${tag}.json`);
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    fs.writeFileSync(logPath, JSON.stringify(logEntries, null, 2));
    const simplePath = path.join(CONFIG.LOG_DIR, `simple-${stamp}${tag}.json`);
    const simpleReport: SimpleReport = {
      startedAt: report.startedAt,
      finishedAt: report.finishedAt,
      mode: CONFIG.DRY_RUN ? 'DRY_RUN' : 'LIVE',
      summary: {
        before: {
          dashedCitiesInDb: report.summary.dashedCitiesInDb,
          dashedCitiesProcessed: report.summary.dashedCitiesProcessed,
        },
        after: {
          canonicalCitiesCreated: [...canonicalCreatedNames].sort(),
          canonicalCitiesReused: [...canonicalReusedNames].sort(),
          newAreasCreated: report.summary.areasCreatedFromZones,
          areasReassigned: report.summary.existingAreasReassigned,
          ordersReassigned: report.summary.ordersReassigned,
          statsReassigned: report.summary.statsReassigned,
          statsMergedAndDeleted: report.summary.statsMergedAndDeleted,
          dashedCitiesDeleted: report.summary.zonesMerged + 
            simpleChanges.filter(
              (c) => c.after.action === 'standalone-rename' && 
                     'oldCityDeleted' in c.after && 
                     c.after.oldCityDeleted
            ).length,
          standaloneRenamed: report.summary.standaloneRenamed,
          skipped: report.summary.skipped,
          errors: report.summary.errors,
        },
      },
      changes: simpleChanges,
    };
    fs.writeFileSync(simplePath, JSON.stringify(simpleReport, null, 2));

    console.log('\n========== SUMMARY ==========');
    console.log(JSON.stringify(report.summary, null, 2));
    console.log(`\nReport: ${reportPath}`);
    console.log(`Log:    ${logPath}`);
        console.log(`Simple:   ${simplePath}`);

    if (CONFIG.DRY_RUN) console.log('\n*** DRY RUN — no DB changes were committed. ***');

    await prisma.$disconnect();
  }
}

// =============================================================================
// Per-city dispatcher
// =============================================================================
async function processCity(
  prisma: PrismaClient,
  city: DashedCityRow,
  report: Report,
): Promise<void> {
  const override = CONFIG.NAME_OVERRIDES[city.name];

  if (override?.action === 'skip') {
    log('warn', `OVERRIDE skip → "${city.name}"`);
    report.summary.skipped++;
    report.operations.push({
      mode: 'override-skip',
      oldCity: { id: city.id, name: city.name, provinceId: city.provinceId },
      parsed: parseDashedName(city.name),
      canonicalCity: null,
      newArea: null,
      reassignedAreas: [],
      ordersReassigned: 0,
      statsReassigned: 0,
      statsMergedAndDeleted: 0,
      oldCityDeleted: false,
    });
    recordChange({
      before: {
        city: city.name,
        id: city.id,
        areasCount: city.areas.length,
        ordersCount: 0,
        statsCount: 0,
      },
      after: {
        action: 'override-skip',
        reason: 'NAME_OVERRIDES marked this row as skip',
      },
    });
    return;
  }

  let parsed: { base: string; suffix: string | null };
  let standalone: boolean;

  if (override?.action === 'standalone') {
    parsed = { base: override.as, suffix: null };
    standalone = true;
    log('info', `OVERRIDE standalone → "${city.name}" → "${override.as}"`);
  } else if (override?.action === 'zone') {
    parsed = { base: override.as, suffix: override.area };
    standalone = false;
    log('info', `OVERRIDE zone → "${city.name}" → city="${override.as}", area="${override.area}"`);
  } else {
    parsed = parseDashedName(city.name);
    if (!parsed.suffix) {
      log('warn', `Skipping "${city.name}" — no parseable suffix`);
      report.summary.skipped++;
      return;
    }
    standalone = isAdminSuffix(parsed.suffix);
  }

  log('info', `Processing "${city.name}"`, {
    base: parsed.base,
    suffix: parsed.suffix,
    mode: standalone ? 'standalone-rename' : 'zone-merge',
    existingAreasCount: city.areas.length,
  });

  if (CONFIG.DRY_RUN) {
    await simulateOperation(prisma, city, parsed, standalone, report);
  } else {
    await prisma.$transaction(
      async (tx) => {
        if (standalone) {
          await applyStandalone(tx, city, parsed.base, report);
        } else {
          await applyZoneMerge(tx, city, parsed.base, parsed.suffix as string, report);
        }
      },
      { timeout: 30_000 },
    );
  }
}

// =============================================================================
// DRY-RUN simulator — same queries, no writes
// =============================================================================
async function simulateOperation(
  prisma: PrismaClient,
  city: DashedCityRow,
  parsed: { base: string; suffix: string | null },
  standalone: boolean,
  report: Report,
): Promise<void> {
  const ordersCount = await prisma.order.count({ where: { cityId: city.id } });
  const statsCount = await prisma.courierCityStats.count({ where: { cityId: city.id } });

  if (standalone) {
    const collision = await prisma.city.findFirst({
      where: { name: parsed.base, provinceId: city.provinceId, NOT: { id: city.id } },
      select: { id: true, name: true },
    });
    log('info', `[DRYRUN] Would rename "${city.name}" → "${parsed.base}"`, {
      collisionWithExistingCity: collision ? collision.id : 'none',
      ordersToReassign: ordersCount,
      statsToReassign: statsCount,
      areasToReassign: city.areas.length,
    });
    report.summary.standaloneRenamed++;
    report.summary.dashedCitiesProcessed++;
    if (collision) {
      report.summary.existingAreasReassigned += city.areas.length;
      report.summary.ordersReassigned += ordersCount;
      report.summary.statsReassigned += statsCount;
    }
    report.operations.push({
      mode: 'standalone-rename',
      oldCity: { id: city.id, name: city.name, provinceId: city.provinceId },
      parsed,
      canonicalCity: collision
        ? { id: collision.id, name: collision.name, wasCreatedNow: false }
        : { id: city.id, name: parsed.base, wasCreatedNow: false },
      newArea: null,
      reassignedAreas: collision ? city.areas : [],
      ordersReassigned: collision ? ordersCount : 0,
      statsReassigned: collision ? statsCount : 0,
      statsMergedAndDeleted: 0,
      oldCityDeleted: !!collision,
    });

    recordChange({
      before: {
        city: city.name,
        id: city.id,
        areasCount: city.areas.length,
        ordersCount: ordersCount,
        statsCount: statsCount,
      },
      after: {
        action: 'standalone-rename',
        cityBecame: collision ? `${collision.name} (existing)` : `${parsed.base} (renamed in place)`,
        mergedIntoExistingCity: !!collision,
        areasMovedToCanonical: collision ? city.areas.length : 0,
        ordersMovedToCanonical: collision ? ordersCount : 0,
        statsMovedToCanonical: collision ? statsCount : 0,
        statsMergedAndDeleted: 0,
        oldCityDeleted: !!collision,
      },
    });


    return;
  }

  // Zone-merge simulation
  const existing = await prisma.city.findFirst({
    where: { name: parsed.base, provinceId: city.provinceId },
    select: { id: true, name: true },
  });
  log('info', `[DRYRUN] Would zone-merge "${city.name}"`, {
    canonicalCity: existing
      ? `REUSE existing ${existing.id} ("${existing.name}")`
      : `CREATE new "${parsed.base}"`,
    newArea: parsed.suffix,
    areasToReassign: city.areas.length,
    ordersToReassign: ordersCount,
    statsToReassign: statsCount,
  });

  if (existing) report.summary.canonicalCitiesReused++;
  else report.summary.canonicalCitiesCreated++;
  report.summary.zonesMerged++;
  report.summary.areasCreatedFromZones++;
  report.summary.existingAreasReassigned += city.areas.length;
  report.summary.ordersReassigned += ordersCount;
  report.summary.statsReassigned += statsCount;
  report.summary.dashedCitiesProcessed++;

  report.operations.push({
    mode: 'zone-merge',
    oldCity: { id: city.id, name: city.name, provinceId: city.provinceId },
    parsed,
    canonicalCity: existing
      ? { id: existing.id, name: existing.name, wasCreatedNow: false }
      : { id: '(would-be-generated)', name: parsed.base, wasCreatedNow: true },
    newArea: { id: '(would-be-generated)', name: parsed.suffix as string },
    reassignedAreas: city.areas,
    ordersReassigned: ordersCount,
    statsReassigned: statsCount,
    statsMergedAndDeleted: 0,
    oldCityDeleted: true,
  });

  if (existing) canonicalReusedNames.add(existing.name);
  else canonicalCreatedNames.add(parsed.base);

  recordChange({
    before: {
      city: city.name,
      id: city.id,
      areasCount: city.areas.length,
      ordersCount: ordersCount,
      statsCount: statsCount,
    },
    after: {
      action: 'zone-merge',
      cityBecame: existing
        ? `${existing.name} (existing canonical, reused)`
        : `${parsed.base} (new canonical, created)`,
      newAreaCreated: parsed.suffix as string,
            zoneAssigned: parsed.suffix as string,
      areasMovedToCanonical: city.areas.length,
      ordersMovedToCanonical: ordersCount,
      statsMovedToCanonical: statsCount,
      statsMergedAndDeleted: 0,
      oldCityDeleted: true,
    },
  });

}

// =============================================================================
// LIVE: standalone (rename in place, OR merge into existing if collision)
// =============================================================================
async function applyStandalone(
  tx: Prisma.TransactionClient,
  city: DashedCityRow,
  newName: string,
  report: Report,
): Promise<void> {
  const existing = await tx.city.findFirst({
    where: { name: newName, provinceId: city.provinceId, NOT: { id: city.id } },
  });

  let canonicalId: string;
  let canonicalName: string;
  const reassigned: { id: string; name: string }[] = [];
  let ordersReassigned = 0;
  let statsReassigned = 0;
  let statsMerged = 0;

  if (existing) {
    log('info', `  Standalone target "${newName}" exists (${existing.id}); merging into it`);
    canonicalId = existing.id;
    canonicalName = existing.name;

    if (city.areas.length > 0) {
      await tx.area.updateMany({
        where: { cityId: city.id },
        data: { cityId: canonicalId },
      });
      reassigned.push(...city.areas);
      report.summary.existingAreasReassigned += city.areas.length;
      log('info', `  Reassigned ${city.areas.length} areas → ${canonicalId}`);
    }

    const orderRes = await tx.order.updateMany({
      where: { cityId: city.id },
      data: { cityId: canonicalId },
    });
    ordersReassigned = orderRes.count;
    report.summary.ordersReassigned += orderRes.count;
    log('info', `  Reassigned ${orderRes.count} orders`);

    const statsRes = await migrateStats(tx, city.id, canonicalId);
    statsReassigned = statsRes.reassigned;
    statsMerged = statsRes.merged;
    report.summary.statsReassigned += statsRes.reassigned;
    report.summary.statsMergedAndDeleted += statsRes.merged;
    log('info', `  Stats: reassigned=${statsRes.reassigned}, merged-and-deleted=${statsRes.merged}`);

    await tx.city.delete({ where: { id: city.id } });
    log('info', `  Deleted old dashed city ${city.id}`);
  } else {
    await tx.city.update({ where: { id: city.id }, data: { name: newName } });
    canonicalId = city.id;
    canonicalName = newName;
    log('info', `  Renamed ${city.id}: "${city.name}" → "${newName}"`);
  }

  report.summary.standaloneRenamed++;
  report.summary.dashedCitiesProcessed++;
  report.operations.push({
    mode: 'standalone-rename',
    oldCity: { id: city.id, name: city.name, provinceId: city.provinceId },
    parsed: { base: newName, suffix: null },
    canonicalCity: { id: canonicalId, name: canonicalName, wasCreatedNow: false },
    newArea: null,
    reassignedAreas: reassigned,
    ordersReassigned,
    statsReassigned,
    statsMergedAndDeleted: statsMerged,
    oldCityDeleted: !!existing,
  });

  if (existing) canonicalReusedNames.add(canonicalName);

  recordChange({
    before: {
      city: city.name,
      id: city.id,
      areasCount: city.areas.length,
      ordersCount: ordersReassigned,
      statsCount: statsReassigned + statsMerged,
    },
    after: {
      action: 'standalone-rename',
      cityBecame: existing
        ? `${canonicalName} (existing, merged into)`
        : `${canonicalName} (renamed in place)`,
      mergedIntoExistingCity: !!existing,
      areasMovedToCanonical: reassigned.length,
      ordersMovedToCanonical: ordersReassigned,
      statsMovedToCanonical: statsReassigned,
      statsMergedAndDeleted: statsMerged,
      oldCityDeleted: !!existing,
    },
  });

}

// =============================================================================
// LIVE: zone-merge (split city into base city + area)
// =============================================================================
async function applyZoneMerge(
  tx: Prisma.TransactionClient,
  city: DashedCityRow,
  baseName: string,
  suffix: string,
  report: Report,
): Promise<void> {
  // 1. Find or create canonical city
  let canonical = await tx.city.findFirst({
    where: { name: baseName, provinceId: city.provinceId },
  });

  let createdNow = false;
  if (!canonical) {
    canonical = await tx.city.create({
      data: {
        id: CONFIG.newCityId(),
        name: baseName,
        provinceId: city.provinceId,
      },
    });
    createdNow = true;
    report.summary.canonicalCitiesCreated++;
    log('info', `  Created canonical city "${baseName}" (${canonical.id})`);
  } else {
    report.summary.canonicalCitiesReused++;
    log('info', `  Reusing canonical city "${baseName}" (${canonical.id})`);
  }

  // 2. Create the new Area for the suffix (or reuse if it already exists)
  let newArea = await tx.area.findFirst({
    where: { name: suffix, cityId: canonical.id },
  });
  if (newArea) {
    log('warn', `  Area "${suffix}" already exists under ${canonical.id} (${newArea.id}); reusing`);
  } else {
 newArea = await tx.area.create({
      data: {
        id: CONFIG.newAreaId(),
        name: suffix,
        cityId: canonical.id,
        zone: suffix,
      },
    });
    report.summary.areasCreatedFromZones++;
    log('info', `  Created area "${suffix}" (${newArea.id}) under canonical city`);
  }

  // 3. Reassign existing areas of dashed city → canonical city
if (city.areas.length > 0) {
    const r = await tx.area.updateMany({
      where: { cityId: city.id },
      data: { cityId: canonical.id, zone: suffix },
    });
    report.summary.existingAreasReassigned += r.count;
    log('info', `  Reassigned ${r.count} existing areas → canonical city (zone: ${suffix})`);
  }

  // 4. Reassign orders pointing to the dashed city
  const orderRes = await tx.order.updateMany({
    where: { cityId: city.id },
    data: { cityId: canonical.id },
  });
  report.summary.ordersReassigned += orderRes.count;
  log('info', `  Reassigned ${orderRes.count} orders → canonical city`);

  // 5. Migrate CourierCityStats (handle unique-constraint collisions by summing)
  const statsRes = await migrateStats(tx, city.id, canonical.id);
  report.summary.statsReassigned += statsRes.reassigned;
  report.summary.statsMergedAndDeleted += statsRes.merged;
  log('info', `  Stats: reassigned=${statsRes.reassigned}, merged-and-deleted=${statsRes.merged}`);

  // 6. Delete the dashed city
  await tx.city.delete({ where: { id: city.id } });
  log('info', `  Deleted old dashed city ${city.id}`);

  report.summary.zonesMerged++;
  report.summary.dashedCitiesProcessed++;
  report.operations.push({
    mode: 'zone-merge',
    oldCity: { id: city.id, name: city.name, provinceId: city.provinceId },
    parsed: { base: baseName, suffix },
    canonicalCity: { id: canonical.id, name: canonical.name, wasCreatedNow: createdNow },
    newArea: { id: newArea.id, name: newArea.name },
    reassignedAreas: city.areas,
    ordersReassigned: orderRes.count,
    statsReassigned: statsRes.reassigned,
    statsMergedAndDeleted: statsRes.merged,
    oldCityDeleted: true,
  });

if (createdNow) canonicalCreatedNames.add(canonical.name);
  else canonicalReusedNames.add(canonical.name);

  recordChange({
    before: {
      city: city.name,
      id: city.id,
      areasCount: city.areas.length,
      ordersCount: orderRes.count,
      statsCount: statsRes.reassigned + statsRes.merged,
    },
    after: {
      action: 'zone-merge',
      cityBecame: createdNow
        ? `${canonical.name} (new canonical, created)`
        : `${canonical.name} (existing canonical, reused)`,
      newAreaCreated: newArea.name,
            zoneAssigned: newArea.name,

      areasMovedToCanonical: city.areas.length,
      ordersMovedToCanonical: orderRes.count,
      statsMovedToCanonical: statsRes.reassigned,
      statsMergedAndDeleted: statsRes.merged,
      oldCityDeleted: true,
    },
  });


}

// =============================================================================
// CourierCityStats migration helper
//
// Constraint: @@unique([shopId, courierCode, cityId])
// If reassigning a stats row would collide with an existing canonical row,
// we sum the counters into the existing row and delete the duplicate.
// =============================================================================
async function migrateStats(
  tx: Prisma.TransactionClient,
  fromCityId: string,
  toCityId: string,
): Promise<{ reassigned: number; merged: number }> {
  const oldStats = await tx.courierCityStats.findMany({
    where: { cityId: fromCityId },
  });

  let reassigned = 0;
  let merged = 0;

  for (const stat of oldStats) {
    const collision = await tx.courierCityStats.findUnique({
      where: {
        shopId_courierCode_cityId: {
          shopId: stat.shopId,
          courierCode: stat.courierCode,
          cityId: toCityId,
        },
      },
    });

    if (collision) {
      const totalBooked = collision.totalBooked + stat.totalBooked;
      const totalDelivered = collision.totalDelivered + stat.totalDelivered;
      const totalReturned = collision.totalReturned + stat.totalReturned;
      const totalFailed = collision.totalFailed + stat.totalFailed;
      const deliveryRatio = totalBooked > 0 ? totalDelivered / totalBooked : 0;

      await tx.courierCityStats.update({
        where: { id: collision.id },
        data: { totalBooked, totalDelivered, totalReturned, totalFailed, deliveryRatio },
      });
      await tx.courierCityStats.delete({ where: { id: stat.id } });
      merged++;
    } else {
      await tx.courierCityStats.update({
        where: { id: stat.id },
        data: { cityId: toCityId },
      });
      reassigned++;
    }
  }

  return { reassigned, merged };
}

// =============================================================================
main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
