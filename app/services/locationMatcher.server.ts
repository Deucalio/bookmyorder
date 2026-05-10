import prisma from "../db.server";
import { distance } from "fastest-levenshtein";

const normalize = (s?: string | null) =>
  (s ?? "").toLowerCase().trim().replace(/[^\w\s]/g, "").replace(/\s+/g, " ");

export async function matchLocation(addr: {
  province?: string | null;
  city?: string | null;
  address1?: string | null;
  address2?: string | null;
}) {
  const provinceName = normalize(addr.province);
  const cityName = normalize(addr.city);
  const fullText = normalize(`${addr.address1 ?? ""} ${addr.address2 ?? ""}`);

  const province = provinceName
    ? await prisma.province.findFirst({
        where: { name: { equals: addr.province ?? "", mode: "insensitive" } },
      })
    : null;

  let city = cityName
    ? await prisma.city.findFirst({
        where: {
          name: { equals: addr.city ?? "", mode: "insensitive" },
          ...(province && { provinceId: province.id }),
        },
      })
    : null;

  if (!city && cityName) {
    const allCities = await prisma.city.findMany();
    let bestMatch = null;
    let bestScore = 0;
    
    const calculateScore = (str1: string, str2: string) => {
      const d = distance(str1, str2);
      const maxLen = Math.max(str1.length, str2.length);
      if (maxLen === 0) return 100;
      return Math.round((1 - d / maxLen) * 100);
    };

    for (const c of allCities) {
      const score = calculateScore(cityName, c.name.toLowerCase());
      if (score > bestScore) {
        bestScore = score;
        bestMatch = c;
      }
    }
    
    if (bestScore >= 80) {
      city = bestMatch;
    }
  }

  let area = null;
  if (city) {
    const areas = await prisma.area.findMany({ where: { cityId: city.id } });
    area = areas.find((a) => fullText.includes(normalize(a.name))) ?? null;
  }

  return {
    provinceId: province?.id ?? null,
    cityId: city?.id ?? null,
    areaId: area?.id ?? null,
  };
}
