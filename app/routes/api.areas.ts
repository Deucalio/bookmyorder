import { type LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const cityId = url.searchParams.get("cityId");

  if (!cityId) return { areas: [] };

  const areas = await prisma.area.findMany({
    where: { cityId },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  return { areas };
};
