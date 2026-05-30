// Mirror of backend-bookmyorder/utils/credits.js refresh logic, called from
// the dashboard loader so a merchant who lands on the page after their
// anniversary sees the refreshed balance even if no new-order webhook has
// fired yet to trigger the backend's lazy refresh.

import prisma from "../db.server";

const PLANS: Record<string, { creditsPerCycle: number }> = {
  free: { creditsPerCycle: 300 },
  pro:  { creditsPerCycle: Infinity },
};

function planFor(planCode: string | null | undefined) {
  return PLANS[(planCode || "free").toLowerCase()] || PLANS.free;
}

function addMonths(date: Date, n: number): Date {
  const d = new Date(date);
  const day = d.getDate();
  d.setMonth(d.getMonth() + n);
  // Clamp Jan 31 + 1mo → Feb 28/29 rather than Mar 3.
  if (d.getDate() !== day) d.setDate(0);
  return d;
}

type ShopForRefresh = {
  id: string;
  plan: string;
  credits: number;
  creditsRenewedAt: Date | null;
  installedAt: Date;
};

/**
 * If the shop's billing cycle has elapsed, reset credits to the plan limit
 * and stamp creditsRenewedAt to the calculated anniversary (not `now`) so
 * the cycle doesn't drift forward on each refresh.
 */
export async function ensureCreditRefresh<T extends ShopForRefresh>(shop: T): Promise<T> {
  if (planFor(shop.plan).creditsPerCycle === Infinity) return shop;

  const anchor = shop.creditsRenewedAt ?? shop.installedAt;
  const nextAt = addMonths(anchor, 1);
  if (Date.now() < nextAt.getTime()) return shop;

  const limit = planFor(shop.plan).creditsPerCycle;
  await prisma.shop.update({
    where: { id: shop.id },
    data: { credits: limit, creditsRenewedAt: nextAt },
  });
  return { ...shop, credits: limit, creditsRenewedAt: nextAt };
}
