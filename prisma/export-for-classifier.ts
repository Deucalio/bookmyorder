/**
 * prisma/export-for-classifier.ts
 *
 * Dumps the DB state needed by the second-pass classifier (Opus web):
 *   1. cities-export.json  — all City rows with province + aliases
 *   2. areas-export.json   — all Area rows with parent city name
 *
 * The classifier uses cities as List A (alias / missing_city matching)
 * and areas as the dedup set for sub_area proposals (so it doesn't
 * propose creating an Area that already exists).
 *
 * Run:
 *   npx tsx prisma/export-for-classifier.ts
 */

import { PrismaClient } from "@prisma/client";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const prisma = new PrismaClient();

async function main() {
  // ── Cities ──────────────────────────────────────────────────────────────
  const cities = await prisma.city.findMany({
    select: {
      id: true,
      name: true,
      aliases: true,
      province: { select: { name: true } },
    },
    orderBy: { name: "asc" },
  });

  const citiesOut = cities.map((c) => ({
    id: c.id,
    name: c.name,
    province: c.province?.name ?? null,
    aliases: c.aliases,
  }));

  const citiesPath = path.join(__dirname, "data", "cities-export.json");
  fs.writeFileSync(citiesPath, JSON.stringify(citiesOut, null, 2), "utf-8");
  console.log(`📦  Cities  : ${citiesOut.length}`);
  console.log(`📄  ${citiesPath}`);

  // Province coverage check — surfaces NULLs so you know if some rows
  // can't be classified by province at all
  const missingProvince = citiesOut.filter((c) => !c.province).length;
  if (missingProvince > 0) {
    console.log(`   ⚠️  ${missingProvince} cities have no province`);
  }

  // ── Areas ───────────────────────────────────────────────────────────────
  const areas = await prisma.area.findMany({
    select: {
      id: true,
      cityId: true,
      name: true,
      zone: true,
      aliases: true,
      city: { select: { name: true } },
    },
    orderBy: [{ city: { name: "asc" } }, { name: "asc" }],
  });

  const areasOut = areas.map((a) => ({
    id: a.id,
    cityId: a.cityId,
    cityName: a.city.name,
    name: a.name,
    zone: a.zone,
    aliases: a.aliases,
  }));

  const areasPath = path.join(__dirname, "data", "areas-export.json");
  fs.writeFileSync(areasPath, JSON.stringify(areasOut, null, 2), "utf-8");
  console.log(`\n📦  Areas   : ${areasOut.length}`);
  console.log(`📄  ${areasPath}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
