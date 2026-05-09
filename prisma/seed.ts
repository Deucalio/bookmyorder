import { PrismaClient } from "@prisma/client";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const prisma = new PrismaClient();

type AreaJson = { id: string; name: string };
type CityJson = { id: string; name: string; areas: AreaJson[] };
type ProvinceJson = { id: string; name: string; cities: CityJson[] };

async function main() {
  const dir = path.join(__dirname, "data", "cities");
  if (!fs.existsSync(dir)) {
    console.log(`Skipping location seed — ${dir} does not exist.`);
    return;
  }
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  if (files.length === 0) {
    console.log("Skipping location seed — no JSON files in prisma/data/cities/.");
    return;
  }

  // Aggregate all files into one set, deduping by id.
  const provinceMap = new Map<string, ProvinceJson>();
  const cityMap = new Map<string, CityJson & { provinceId: string }>();
  const areaMap = new Map<string, AreaJson & { cityId: string }>();

  for (const file of files) {
    console.log(`Reading ${file}...`);
    const raw = fs.readFileSync(path.join(dir, file), "utf-8");
    const json = JSON.parse(raw) as ProvinceJson[];

    for (const p of json) {
      if (!provinceMap.has(p.id)) provinceMap.set(p.id, p);

      for (const c of p.cities) {
        if (!cityMap.has(c.id)) cityMap.set(c.id, { ...c, provinceId: p.id });

        for (const a of c.areas) {
          if (!areaMap.has(a.id)) areaMap.set(a.id, { ...a, cityId: c.id });
        }
      }
    }
  }

  console.log(`Provinces: ${provinceMap.size}`);
  console.log(`Cities:    ${cityMap.size}`);
  console.log(`Areas:     ${areaMap.size}`);

  for (const p of provinceMap.values()) {
    await prisma.province.upsert({
      where: { id: p.id },
      update: { name: p.name },
      create: { id: p.id, name: p.name },
    });
  }

  for (const c of cityMap.values()) {
    await prisma.city.upsert({
      where: { id: c.id },
      update: { name: c.name, provinceId: c.provinceId },
      create: { id: c.id, name: c.name, provinceId: c.provinceId },
    });
  }

  const areas = Array.from(areaMap.values());
  const batchSize = 500;
  for (let i = 0; i < areas.length; i += batchSize) {
    const batch = areas.slice(i, i + batchSize);
    await prisma.area.createMany({
      data: batch.map((a) => ({ id: a.id, name: a.name, cityId: a.cityId })),
      skipDuplicates: true,
    });
  }

  console.log("Locations seeded successfully.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
