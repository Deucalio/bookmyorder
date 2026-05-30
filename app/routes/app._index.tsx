import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate } from "react-router";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineGrid,
  InlineStack,
  Badge,
  Button,
  Banner,
  ProgressBar,
  List,
  Divider,
} from "@shopify/polaris";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { ensureCreditRefresh } from "../services/credits.server";

// Mirror of backend-bookmyorder/utils/credits.js PLANS — keep in sync.
const PLANS: Record<string, { label: string; creditsPerCycle: number }> = {
  free: { label: "Free", creditsPerCycle: 300 },
  pro:  { label: "Pro",  creditsPerCycle: Infinity },
};

function addMonths(date: Date, n: number): Date {
  const d = new Date(date);
  const day = d.getDate();
  d.setMonth(d.getMonth() + n);
  if (d.getDate() !== day) d.setDate(0);
  return d;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const shopRecord = await prisma.shop.findUnique({
    where: { shopDomain: session.shop },
    select: {
      id: true,
      plan: true,
      credits: true,
      creditsRenewedAt: true,
      installedAt: true,
      initialSyncCompletedAt: true,
    },
  });

  if (!shopRecord) {
    return {
      shop: null,
      shopCouriers: [] as { courierCode: string; courierName: string; isEnabled: boolean }[],
      stoppedOrdersCount: 0,
      kpis: { pending: 0, bookedToday: 0, fulfilledToday: 0, failed: 0 },
    };
  }

  // Backend only refreshes credits when an orders/create webhook fires. If the
  // merchant lands here after their anniversary with no new orders since, the
  // card would still show last cycle's balance — so refresh here too.
  const refreshedShop = await ensureCreditRefresh(shopRecord);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [pending, bookedToday, fulfilledToday, failed, shopCouriers, stoppedOrdersCount] = await Promise.all([
    prisma.order.count({
      where: {
        shopId: shopRecord.id,
        fulfillments: { none: {} },
        fulfillmentStatus: { not: "FULFILLED" },
      },
    }),
    prisma.fulfillment.count({
      where: {
        order: { shopId: shopRecord.id },
        status: "booked",
        bookedAt: { gte: today },
      },
    }),
    prisma.order.count({
      where: {
        shopId: shopRecord.id,
        fulfillmentStatus: "FULFILLED",
        updatedAt: { gte: today },
      },
    }),
    prisma.fulfillment.count({
      where: {
        order: { shopId: shopRecord.id },
        deliveryOutcome: { in: ["returned", "failed"] },
      },
    }),
    prisma.shopCourier.findMany({
      where: { shopId: shopRecord.id },
      select: { courierCode: true, courierName: true, isEnabled: true },
      orderBy: { courierCode: "asc" },
    }),
    prisma.stoppedOrder.count({ where: { shopId: shopRecord.id } }),
  ]);

  return {
    shop: {
      plan: refreshedShop.plan,
      credits: refreshedShop.credits,
      creditsRenewedAt: refreshedShop.creditsRenewedAt?.toISOString() ?? null,
      installedAt: refreshedShop.installedAt.toISOString(),
      initialSyncCompletedAt: shopRecord.initialSyncCompletedAt?.toISOString() ?? null,
    },
    shopCouriers,
    stoppedOrdersCount,
    kpis: { pending, bookedToday, fulfilledToday, failed },
  };
};

type KpiTone = "warning" | "info" | "success" | "critical";

export default function Index() {
  const { shop, shopCouriers, stoppedOrdersCount, kpis } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  const planKey = (shop?.plan ?? "free").toLowerCase();
  const plan = PLANS[planKey] ?? PLANS.free;
  const isPro = plan.creditsPerCycle === Infinity;
  const total = isPro ? 0 : plan.creditsPerCycle;
  const remaining = shop?.credits ?? plan.creditsPerCycle;
  const used = isPro ? 0 : Math.max(0, total - remaining);
  const usedPercent = isPro ? 0 : Math.min(100, Math.round((used / total) * 100));

  const anchorISO = shop?.creditsRenewedAt ?? shop?.installedAt ?? null;
  const nextRefresh = anchorISO ? addMonths(new Date(anchorISO), 1) : null;
  const nextRefreshLabel = nextRefresh
    ? nextRefresh.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })
    : "—";

  const activeCouriers = shopCouriers.filter((c) => c.isEnabled);
  const noCouriers = activeCouriers.length === 0;

  const KPIS: { label: string; value: number; tone: KpiTone }[] = [
    { label: "Pending Booking", value: kpis.pending, tone: "warning" },
    { label: "Booked Today", value: kpis.bookedToday, tone: "info" },
    { label: "Fulfilled Today", value: kpis.fulfilledToday, tone: "success" },
    { label: "Failed", value: kpis.failed, tone: "critical" },
  ];

  const syncing = shop && !shop.initialSyncCompletedAt;

  return (
    <Page title="Book My Order" subtitle="Manage your courier bookings">
      <Layout>
        {syncing && (
          <Layout.Section>
            <Banner tone="info" title="Importing your Shopify orders…">
              <p>
                We're fetching your existing orders in the background. They'll start showing
                up on the <strong>Orders</strong> page in a minute or two — refresh that page
                to see them appear. Webhooks for any new orders are already live.
              </p>
            </Banner>
          </Layout.Section>
        )}

        {/* ─── Plan + Credits + Couriers ──────────────────────────── */}
        <Layout.Section>
          <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
            {/* Plan & credits */}
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <BlockStack gap="100">
                    <Text as="h3" variant="headingSm" tone="subdued">Your Plan</Text>
                    <InlineStack gap="200" blockAlign="center">
                      <Text as="p" variant="heading2xl">{plan.label}</Text>
                      <Badge tone={isPro ? "success" : "info"}>{isPro ? "Unlimited" : "Active"}</Badge>
                    </InlineStack>
                  </BlockStack>
                  {!isPro && (
                    <Button variant="primary" onClick={() => navigate("/app/settings")}>
                      Upgrade to Pro
                    </Button>
                  )}
                </InlineStack>

                <Divider />

                {isPro ? (
                  <BlockStack gap="100">
                    <Text as="p" variant="bodyMd" fontWeight="semibold">Unlimited orders</Text>
                    <Text as="p" tone="subdued" variant="bodySm">
                      You can sync and book as many orders as you like.
                    </Text>
                  </BlockStack>
                ) : (
                  <BlockStack gap="200">
                    <InlineStack align="space-between" blockAlign="baseline">
                      <Text as="p" variant="bodyMd" fontWeight="semibold">
                        {remaining} of {total} credits left
                      </Text>
                      <Text as="p" tone="subdued" variant="bodySm">
                        {used} used this cycle
                      </Text>
                    </InlineStack>
                    <ProgressBar progress={usedPercent} tone={usedPercent >= 80 ? "critical" : "primary"} size="small" />
                    <Text as="p" tone="subdued" variant="bodySm">
                      1 credit = 1 new order received from Shopify (via webhook). Updates,
                      deletes, and the initial backfill don't use credits.
                    </Text>
                    <Text as="p" tone="subdued" variant="bodySm">
                      Refreshes on <strong>{nextRefreshLabel}</strong> — credits reset to {total}.
                    </Text>
                  </BlockStack>
                )}

                {stoppedOrdersCount > 0 && !isPro && (
                  <Banner tone="warning" title={`${stoppedOrdersCount} new order${stoppedOrdersCount === 1 ? "" : "s"} on hold`}>
                    <p>
                      You've used all your Free credits this cycle. New orders are being kept
                      aside and can be imported once you upgrade to Pro.
                    </p>
                  </Banner>
                )}
              </BlockStack>
            </Card>

            {/* Courier status */}
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <BlockStack gap="100">
                    <Text as="h3" variant="headingSm" tone="subdued">Couriers</Text>
                    <Text as="p" variant="heading2xl">
                      {activeCouriers.length}
                    </Text>
                  </BlockStack>
                  {noCouriers ? (
                    <Badge tone="critical">No courier configured</Badge>
                  ) : (
                    <Badge tone="success">{`${activeCouriers.length} active`}</Badge>
                  )}
                </InlineStack>

                <Divider />

                {noCouriers ? (
                  <BlockStack gap="200">
                    <Banner tone="warning" title="No courier set up">
                      <p>
                        You need to add at least one courier before you can book orders.
                      </p>
                    </Banner>
                    <Button onClick={() => navigate("/app/settings")} variant="primary">
                      Configure couriers
                    </Button>
                  </BlockStack>
                ) : (
                  <BlockStack gap="200">
                    <List type="bullet">
                      {activeCouriers.map((c) => (
                        <List.Item key={c.courierCode}>
                          <InlineStack gap="200" blockAlign="center">
                            <Text as="span" fontWeight="semibold">{c.courierName}</Text>
                            <Badge tone="success">Active</Badge>
                          </InlineStack>
                        </List.Item>
                      ))}
                    </List>
                    <Button onClick={() => navigate("/app/settings")}>Manage couriers</Button>
                  </BlockStack>
                )}
              </BlockStack>
            </Card>
          </InlineGrid>
        </Layout.Section>

        {/* ─── KPI strip ──────────────────────────────────────────── */}
        <Layout.Section>
          <InlineGrid columns={{ xs: 1, sm: 2, md: 4 }} gap="400">
            {KPIS.map((kpi) => (
              <Card key={kpi.label}>
                <BlockStack gap="200">
                  <Text as="h3" variant="headingSm" tone="subdued">{kpi.label}</Text>
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="p" variant="heading2xl">{kpi.value}</Text>
                    <Badge tone={kpi.tone}>{String(kpi.value)}</Badge>
                  </InlineStack>
                </BlockStack>
              </Card>
            ))}
          </InlineGrid>
        </Layout.Section>

        {/* ─── Quick Actions ──────────────────────────────────────── */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">Quick Actions</Text>
              <InlineStack gap="300">
                <Button variant="primary" onClick={() => navigate("/app/orders")}>
                  Go to Orders
                </Button>
                <Button onClick={() => navigate("/app/settings")}>Settings</Button>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
