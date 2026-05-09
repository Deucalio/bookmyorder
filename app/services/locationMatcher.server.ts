import prisma from "../db.server";

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

  const city = cityName
    ? await prisma.city.findFirst({
        where: {
          name: { equals: addr.city ?? "", mode: "insensitive" },
          ...(province && { provinceId: province.id }),
        },
      })
    : null;

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
