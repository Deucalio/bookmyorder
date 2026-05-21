// import { PrismaClient } from "@prisma/client";
import { shippingCities } from "./shippingCities-all.js";

// const prisma = new PrismaClient();

import prisma from '../app/db.server';


function normalize(str) {
  return str
    .toLowerCase()
    .trim()
    .replace(/\(a\.k\.?\)/gi, "ak")
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ");
}

async function main() {
  // Fetch DB cities
  const dbCities = await prisma.city.findMany({
    select: {
      id: true,
      name: true,
      aliases: true,
    },
  });

  // Build lookup set
  const dbNameSet = new Set();

  for (const city of dbCities) {
    dbNameSet.add(normalize(city.name));

    for (const alias of city.aliases || []) {
      dbNameSet.add(normalize(alias));
    }
  }

  // Filter shipping cities
  const unmatchedShippingCities = shippingCities.filter((city) => {
    const normalized = normalize(city.name);

    return !dbNameSet.has(normalized);
  });

  console.log("Original:", shippingCities.length);
  console.log("Remaining:", unmatchedShippingCities.length);

  // optional
  console.log(unmatchedShippingCities);

  // If you want JSON output:
  // fs.writeFileSync(
  //   "./missingShippingCities.json",
  //   JSON.stringify(unmatchedShippingCities, null, 2)
  // );
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());