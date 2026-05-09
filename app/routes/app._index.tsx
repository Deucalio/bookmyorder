import { useState } from "react";
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
  Box,
} from "@shopify/polaris";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const shopRecord = await prisma.shop.findUnique({
    where: { shopDomain: session.shop },
    select: { id: true },
  });

  if (!shopRecord) {
    return { kpis: { pending: 0, bookedToday: 0, fulfilledToday: 0, failed: 0 } };
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [pending, bookedToday, fulfilledToday, failed] = await Promise.all([
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
  ]);

  return { kpis: { pending, bookedToday, fulfilledToday, failed } };
};

type KpiTone = "warning" | "info" | "success" | "critical";
type Kpi = { label: string; value: number; tone: KpiTone };

export default function Index() {
  const { kpis } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const [bannerDismissed, setBannerDismissed] = useState(false);

  const KPIS: Kpi[] = [
    { label: "Pending Booking", value: kpis.pending, tone: "warning" },
    { label: "Booked Today", value: kpis.bookedToday, tone: "info" },
    { label: "Fulfilled Today", value: kpis.fulfilledToday, tone: "success" },
    { label: "Failed", value: kpis.failed, tone: "critical" },
  ];

  return (
    <Page
      title="Book My Order"
      subtitle="Manage your courier bookings"
    >
      <Layout>
        {!bannerDismissed && (
          <Layout.Section>
            <Banner
              title="Welcome to Book My Order"
              tone="info"
              onDismiss={() => setBannerDismissed(true)}
            >
              <p>
                Select orders, assign couriers, and fulfill in one place.
              </p>
            </Banner>
          </Layout.Section>
        )}

        <Layout.Section>
          <InlineGrid columns={{ xs: 1, sm: 2, md: 4 }} gap="400">
            {KPIS.map((kpi) => (
              <div key={kpi.label} className="bmo-kpi-card">
                <Card>
                  <BlockStack gap="200">
                    <Text as="h3" variant="headingSm" tone="subdued">
                      {kpi.label}
                    </Text>
                    <InlineStack align="space-between" blockAlign="center">
                      <Text as="p" variant="heading2xl">
                        {kpi.value}
                      </Text>
                      <Badge tone={kpi.tone}>{String(kpi.value)}</Badge>
                    </InlineStack>
                  </BlockStack>
                </Card>
              </div>
            ))}
          </InlineGrid>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                Quick Actions
              </Text>
              <InlineStack gap="300">
                <button
                  type="button"
                  className="bmo-primary-btn"
                  onClick={() => navigate("/app/orders")}
                >
                  Go to Orders
                </button>
                <Button onClick={() => navigate("/app/settings")}>
                  Settings
                </Button>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Box paddingBlockStart="200">
            <Text as="p" tone="subdued" variant="bodySm">
              Tip: connect your courier credentials in Settings before booking.
            </Text>
          </Box>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
