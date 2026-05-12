import prisma from '../app/db.server';

/**
 * Seed common Pakistani address aliases.
 * Run once: `npx tsx prisma/seed-aliases.ts`
 * Safe to re-run: matches by area name and merges aliases.
 */

const KARACHI_AREA_ALIASES: Record<string, string[]> = {
  'DHA': ['Defense', 'Defence', 'D.H.A', 'Defense Housing Authority'],
  'FB Area': ['Federal B Area', 'Federal B. Area', 'F.B Area', 'Fed B Area'],
  'Gulistan-e-Johar': ['Gulistan e Jauhar', 'Johar', 'Jauhar'],
  'Gulshan-e-Iqbal': ['Gulshan Iqbal', 'G.E.I'],
  'Gulshan-e-Hadeed': ['Gulshan Hadeed'],
  'Gulshan-e-Maymar': ['Gulshan Maymar'],
  'Bahria Town': ['Behria Town', 'Bahira Town'],
  'PECHS': ['P.E.C.H.S', 'Pakistan Employees Cooperative Housing Society'],
  'North Nazimabad': ['N. Nazimabad', 'North Nazimbad'],
  'Mehmoodabad': ['Mehmodabad', 'Mahmoodabad'],
  'Soldier Bazar': ['Soilder Bazar', 'Soldier Bazaar', 'Solder Bazar'],
  'Kemari': ['Keamari', 'Kemari Karachi'],
  'BufferZone': ['Buffer Zone'],
  'II Chundrigarh': ['I.I Chundrigar', 'II Chundrigar', 'Chundrigar Road'],
  'MA Jinnah Road': ['M.A Jinnah Road', 'M. A. Jinnah Road'],
};

async function main() {
  const karachi = await prisma.city.findFirst({
    where: { name: 'Karachi' },
    select: { id: true },
  });
  if (!karachi) {
    throw new Error('Karachi city not found — seed cities first.');
  }

  let updated = 0;
  let missing: string[] = [];

  for (const [areaName, aliases] of Object.entries(KARACHI_AREA_ALIASES)) {
    const area = await prisma.area.findFirst({
      where: { cityId: karachi.id, name: areaName },
      select: { id: true, aliases: true },
    });
    if (!area) {
      missing.push(areaName);
      continue;
    }
    // Merge with existing aliases, dedupe
    const merged = Array.from(new Set([...(area.aliases ?? []), ...aliases]));
    await prisma.area.update({
      where: { id: area.id },
      data: { aliases: merged },
    });
    updated++;
  }

  console.log(`✓ Updated ${updated} areas with aliases.`);
  if (missing.length) {
    console.log(`⚠ Could not find these areas in DB:`, missing);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());