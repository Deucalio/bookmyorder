// app/services/onboarding.server.ts
//
// Plan-selection helpers. The gate itself lives in app.tsx — it renders the
// picker inline when Shop.isOnboarded is false instead of doing a server
// redirect (302s from a loader can drop the embedded session token).

import prisma from "../db.server";

type VerifiedPlan = "free" | "pro";
type StoredPlan = VerifiedPlan | "none";

type ActivePlanLookup =
  | { ok: true; plan: VerifiedPlan | null }
  | { ok: false; plan: null };

type ShopPlanRecord = {
  id: string;
  plan: string | null;
  isOnboarded?: boolean;
};

export type CityOption = {
  value: string;
  label: string;
  cityName: string;
  cityCode?: string;
  cityId?: number;
};

/**
 * Returns the plan the merchant has picked on Shopify's managed-pricing page,
 * or null if no ACTIVE subscription exists yet. A subscription whose name
 * contains "pro" maps to "pro"; any other active subscription maps to "free".
 */
export async function lookupActivePlan(admin: any): Promise<ActivePlanLookup> {
  try {
    const res = await admin.graphql(
      `#graphql
      query {
        currentAppInstallation {
          activeSubscriptions {
            id
            name
            status
            currentPeriodEnd
          }
        }
      }`,
    );
    const json = await res.json();
    if (json?.errors) {
      console.warn("[onboarding] activeSubscriptions GraphQL errors:", json.errors);
      return { ok: false, plan: null };
    }

    const subs = json?.data?.currentAppInstallation?.activeSubscriptions ?? [];
    const active = subs.filter((s: any) => (s.status ?? "").toUpperCase() === "ACTIVE");
    if (active.length === 0) return { ok: true, plan: null };

    const hasPro = active.some((s: any) => (s.name ?? "").toLowerCase().includes("pro"));
    return { ok: true, plan: hasPro ? "pro" : "free" };
  } catch (err) {
    console.warn("[onboarding] activeSubscriptions query failed:", (err as any)?.message);
    return { ok: false, plan: null };
  }
}

export async function detectActivePlan(admin: any): Promise<VerifiedPlan | null> {
  const lookup = await lookupActivePlan(admin);
  return lookup.plan;
}

/**
 * Refreshes Shop.plan from Shopify's managed-pricing subscription state.
 * During onboarding we require a fresh Shopify confirmation, so stale DB plans
 * are reset to "none" unless Shopify returns an ACTIVE subscription.
 */
export async function refreshVerifiedPlan(
  admin: any,
  shop: ShopPlanRecord,
): Promise<{
  plan: StoredPlan;
  verified: boolean;
  lookupOk: boolean;
}> {
  const lookup = await lookupActivePlan(admin);

  if (!lookup.ok) {
    const plan = shop.isOnboarded ? normalizeStoredPlan(shop.plan) : "none";
    return { plan, verified: false, lookupOk: false };
  }

  const targetPlan: StoredPlan = lookup.plan ?? "none";

  if (normalizeStoredPlan(shop.plan) !== targetPlan) {
    await prisma.shop.update({
      where: { id: shop.id },
      data: { plan: targetPlan },
    });
  }

  return {
    plan: targetPlan,
    verified: lookup.plan !== null,
    lookupOk: true,
  };
}

function normalizeStoredPlan(plan: string | null | undefined): StoredPlan {
  return plan === "pro" || plan === "free" ? plan : "none";
}

/** Back-compat alias. */
export async function hasActiveProSubscription(admin: any): Promise<boolean> {
  return (await detectActivePlan(admin)) === "pro";
}

/**
 * Shopify managed-pricing URL — merchant lands here to pick / upgrade plans.
 *
 *   https://admin.shopify.com/store/<shop>/charges/<APP_HANDLE>/pricing_plans
 *
 * Requires:
 *   1. SHOPIFY_APP_NAME env var set to the app's URL handle (e.g. "book-my-order").
 *   2. Plans defined + PUBLISHED in the Shopify Partner dashboard under Pricing.
 *
 * We use this rather than `appSubscriptionCreate` because the merchant already
 * configured managed pricing — calling the mutation alongside would create
 * duplicate Pro subscriptions.
 */
export function pricingPlansUrlFor(shop: string): string | null {
  const appHandle = process.env.SHOPIFY_APP_NAME;
  if (!appHandle) return null;
  const shopName = shop.replace(".myshopify.com", "");
  return `https://admin.shopify.com/store/${shopName}/charges/${appHandle}/pricing_plans`;
}

export async function getOnboardingCourierCities(): Promise<{
  tcsCities: CityOption[];
  lcsCities: CityOption[];
}> {
  const [rawTcsCities, rawLcsCities] = await Promise.all([
    prisma.$queryRaw<Array<{ id: string; name: string; courierMappings: any }>>`
      SELECT id, name, "courierMappings"
      FROM "City"
      WHERE "courierMappings" -> 'tcs' IS NOT NULL
      ORDER BY name ASC
    `,
    prisma.$queryRaw<Array<{ id: string; name: string; courierMappings: any }>>`
      SELECT id, name, "courierMappings"
      FROM "City"
      WHERE "courierMappings" -> 'leopards' IS NOT NULL
      ORDER BY name ASC
    `,
  ]);

  const tcsCities = rawTcsCities
    .flatMap((c): CityOption[] => {
      const mappings = typeof c.courierMappings === "string"
        ? JSON.parse(c.courierMappings)
        : c.courierMappings;
      const tcs = mappings?.tcs;
      if (!tcs?.cityCode) return [];
      return [{
        value: tcs.cityCode as string,
        label: `${tcs.cityName ?? c.name} (${tcs.cityCode})`,
        cityName: (tcs.cityName ?? c.name) as string,
        cityCode: tcs.cityCode as string,
        cityId: tcs.cityID == null ? undefined : Number(tcs.cityID),
      }];
    });

  const lcsCities = rawLcsCities
    .flatMap((c): CityOption[] => {
      const mappings = typeof c.courierMappings === "string"
        ? JSON.parse(c.courierMappings)
        : c.courierMappings;
      const lcs = mappings?.leopards;
      if (lcs?.id == null) return [];
      return [{
        value: String(lcs.id),
        label: `${c.name} (${lcs.id})`,
        cityName: c.name as string,
        cityId: lcs.id as number,
      }];
    });

  return { tcsCities, lcsCities };
}
