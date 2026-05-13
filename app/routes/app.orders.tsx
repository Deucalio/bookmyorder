import { useMemo, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import {
  Page,
  Card,
  Tabs,
  IndexTable,
  Badge,
  Button,
  Select,
  Filters,
  EmptyState,
  Pagination,
  InlineStack,
  Text,
  Box,
  Modal,
  BlockStack,
  useIndexResourceState,
  useSetIndexFiltersMode,
} from "@shopify/polaris";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import { getActiveCouriers } from "../config/couriers";
import prisma from "../db.server";
import { syncShopData, syncRecentOrders } from "../services/sync.server";
import { FulfillmentModal } from "../components/FulfillmentModal";

type OrderRow = {
  id: string;
  orderName: string;
  customerName: string;
  phone: string | null;
  city: string | null;
  area: string | null;
  codAmount: number;
  status: "pending" | "assigned" | "booked" | "fulfilled" | "failed";
  courierCode: string | null;
  rawCity: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  cityId: string | null;
  areaId: string | null;
  shopifyOrderGid: string | null;
  /** Persisted confidence from the server-side area matcher (0-1). null if no match. */
  areaMatchConfidence: number | null;
  /** Method used by the cascade matcher: substring | token | fuzzy | zone-only. */
  areaMatchMethod: string | null;
};

function deriveStatus(
  fulfillmentStatus: string,
  fulfillments: { status: string; deliveryOutcome: string }[],
): OrderRow["status"] {
  if (fulfillmentStatus === "FULFILLED") return "fulfilled";
  if (fulfillments.length === 0) return "pending";
  const latest = fulfillments[fulfillments.length - 1];
  if (latest.deliveryOutcome === "delivered") return "fulfilled";
  if (["returned", "failed"].includes(latest.deliveryOutcome)) return "failed";
  if (latest.status === "booked") return "booked";
  return "assigned";
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const shopRecord = await prisma.shop.findUnique({
    where: { shopDomain: session.shop },
    select: { id: true },
  });

  if (!shopRecord) return { orders: [] as OrderRow[], cities: [] as { id: string; name: string }[] };

  const dbOrders = await prisma.order.findMany({
    where: { shopId: shopRecord.id },
    include: {
      fulfillments: { orderBy: { createdAt: "asc" } },
      city: { select: { name: true } },
      area: { select: { name: true } },
      addressMatchLog: { select: { matchConfidence: true, matchMethod: true } },
    },
    orderBy: { shopifyCreatedAt: "desc" },
    take: 250,
  });

  const cities = await prisma.city.findMany({
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  const orders: OrderRow[] = dbOrders.map((o) => ({
    id: o.id,
    orderName: o.orderName,
    customerName: o.customerName,
    phone: o.customerPhone,
    city: o.city?.name ?? o.rawCity,
    area: o.area?.name ?? null,
    codAmount: o.codAmount,
    status: deriveStatus(o.fulfillmentStatus, o.fulfillments),
    courierCode: o.fulfillments[o.fulfillments.length - 1]?.courierCode ?? null,
    rawCity: o.rawCity,
    addressLine1: o.addressLine1,
    addressLine2: o.addressLine2,
    cityId: o.cityId,
    areaId: o.areaId,
    shopifyOrderGid: o.shopifyOrderGid,
    areaMatchConfidence: o.addressMatchLog?.matchConfidence ?? null,
    areaMatchMethod: o.addressMatchLog?.matchMethod ?? null,
  }));

  return { orders, cities };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "updateAddress") {
    const orderId = formData.get("orderId") as string;
    const shopifyOrderGid = formData.get("shopifyOrderGid") as string;
    const cityId = formData.get("cityId") as string;
    const areaId = formData.get("areaId") as string;
    
    const city = await prisma.city.findUnique({ where: { id: cityId } });
    
    // Update DB
    await prisma.order.update({
      where: { id: orderId },
      data: { cityId, areaId },
    });

    // Update Shopify
    if (city) {
      const res = await admin.graphql(
        `#graphql
        mutation orderUpdate($input: OrderInput!) {
          orderUpdate(input: $input) {
            order { id }
            userErrors { field message }
          }
        }`,
        {
          variables: {
            input: {
              id: shopifyOrderGid,
              shippingAddress: {
                city: city.name,
              }
            }
          }
        }
      );
      const data = await res.json();
      if (data.data?.orderUpdate?.userErrors?.length) {
        console.error("Failed to update Shopify order:", data.data.orderUpdate.userErrors);
      }
    }

    return { success: true };
  }

  await syncShopData(session, admin);
  await syncRecentOrders(session, admin, 10);
  return { synced: true };
};

const TABS = [
  { id: "pending", label: "Pending Booking", status: "pending" as const },
  { id: "booked", label: "Booked", status: "booked" as const },
  { id: "fulfilled", label: "Fulfilled", status: "fulfilled" as const },
  { id: "failed", label: "Failed", status: "failed" as const },
];

const STATUS_BADGE: Record<
  OrderRow["status"],
  { tone: "warning" | "info" | "attention" | "success" | "critical"; label: string }
> = {
  pending: { tone: "warning", label: "Unassigned" },
  assigned: { tone: "info", label: "Courier Assigned" },
  booked: { tone: "attention", label: "Booked" },
  fulfilled: { tone: "success", label: "Fulfilled" },
  failed: { tone: "critical", label: "Failed" },
};

export default function OrdersPage() {
  const { orders, cities } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const isSyncing = fetcher.state !== "idle";

  const [tabIndex, setTabIndex] = useState(0);
  const [search, setSearch] = useState("");
  const [courierFilter, setCourierFilter] = useState("all");
  const [cityFilter, setCityFilter] = useState("all");
  const [rowCouriers, setRowCouriers] = useState<Record<string, string>>(() =>
    Object.fromEntries(orders.map((o) => [o.id, o.courierCode ?? ""])),
  );
  const [isBookingModalOpen, setIsBookingModalOpen] = useState(false);

  const { mode, setMode } = useSetIndexFiltersMode();

  const cityFilterOptions = useMemo(
    () => [
      { label: "All Cities", value: "all" },
      ...Array.from(new Set(orders.map((o) => o.city).filter(Boolean))).map(
        (c) => ({ label: c!, value: c! }),
      ),
    ],
    [orders],
  );

  const filteredOrders = useMemo(() => {
    const activeStatus = TABS[tabIndex].status;
    return orders.filter((o) => {
      const matchesTab =
        activeStatus === "pending"
          ? o.status === "pending" || o.status === "assigned"
          : o.status === activeStatus;
      if (!matchesTab) return false;
      if (
        search &&
        !`${o.orderName} ${o.customerName}`
          .toLowerCase()
          .includes(search.toLowerCase())
      ) {
        return false;
      }
      if (courierFilter !== "all" && o.courierCode !== courierFilter) return false;
      if (cityFilter !== "all" && o.city !== cityFilter) return false;
      return true;
    });
  }, [orders, tabIndex, search, courierFilter, cityFilter]);

  const { selectedResources, allResourcesSelected, handleSelectionChange } =
    useIndexResourceState(filteredOrders as unknown as { [key: string]: unknown }[]);

  const courierOptions = useMemo(
    () => [
      { label: "Select courier", value: "" },
      ...getActiveCouriers().map((c) => ({ label: c.name, value: c.code })),
    ],
    [],
  );

  const courierFilterOptions = [
    { label: "All Couriers", value: "all" },
    ...getActiveCouriers().map((c) => ({ label: c.name, value: c.code })),
  ];

  const tabsConfig = TABS.map((t) => ({
    id: t.id,
    content: t.label,
    accessibilityLabel: t.label,
    panelID: `${t.id}-panel`,
  }));

  const rowMarkup = filteredOrders.map((order, index) => {
    const badge = STATUS_BADGE[order.status];
    return (
      <IndexTable.Row
        id={order.id}
        key={order.id}
        position={index}
        selected={selectedResources.includes(order.id)}
      >
        <IndexTable.Cell>
          <Text as="span" variant="bodyMd" fontWeight="semibold">
            {order.orderName}
          </Text>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Text as="span" variant="bodyMd">
            {order.customerName}
          </Text>
          {order.phone && (
            <Box>
              <Text as="span" variant="bodySm" tone="subdued">
                {order.phone}
              </Text>
            </Box>
          )}
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Text as="span" variant="bodyMd">
            {order.city ?? "—"}
          </Text>
          {order.area && (
            <Box>
              <Text as="span" variant="bodySm" tone="subdued">
                {order.area}
              </Text>
            </Box>
          )}
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Text as="span" variant="bodyMd">
            Rs. {order.codAmount.toLocaleString()}
          </Text>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Select
            label=""
            labelHidden
            options={courierOptions}
            value={rowCouriers[order.id] ?? ""}
            onChange={(value) =>
              setRowCouriers((prev) => ({ ...prev, [order.id]: value }))
            }
          />
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Badge tone={badge.tone}>{badge.label}</Badge>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Button size="slim" onClick={() => undefined}>
            View
          </Button>
        </IndexTable.Cell>
      </IndexTable.Row>
    );
  });

  const filters = [
    {
      key: "courier",
      label: "Courier",
      filter: (
        <Select
          label="Courier"
          labelHidden
          options={courierFilterOptions}
          value={courierFilter}
          onChange={setCourierFilter}
        />
      ),
      shortcut: true,
    },
    {
      key: "city",
      label: "City",
      filter: (
        <Select
          label="City"
          labelHidden
          options={cityFilterOptions}
          value={cityFilter}
          onChange={setCityFilter}
        />
      ),
      shortcut: true,
    },
  ];

  const isEmpty = filteredOrders.length === 0;
  const selectedCount = selectedResources.length;

  return (
    <Page
      title="Orders"
      subtitle="Sync, assign couriers, and book shipments"
      primaryAction={{
        content: "Sync Orders",
        loading: isSyncing,
        onAction: () => fetcher.submit({}, { method: "post" }),
      }}
    >
      <Card padding="0">
        <Tabs
          tabs={tabsConfig}
          selected={tabIndex}
          onSelect={setTabIndex}
        />

        <Box padding="400">
          <Filters
            queryValue={search}
            queryPlaceholder="Search by order # or customer"
            onQueryChange={setSearch}
            onQueryClear={() => setSearch("")}
            filters={filters}
            onClearAll={() => {
              setSearch("");
              setCourierFilter("all");
              setCityFilter("all");
            }}
            mode={mode}
            setMode={setMode}
          />
        </Box>

        {selectedCount > 0 && (
          <Box paddingInline="400">
            <div className="bmo-bulk-bar">
              <Text as="span" variant="bodyMd" fontWeight="semibold">
                {selectedCount} {selectedCount === 1 ? "order" : "orders"} selected
              </Text>
              <InlineStack gap="200">
                <Button onClick={() => undefined}>Assign Courier</Button>
                <Button variant="secondary" onClick={() => undefined}>
                  Auto-Select Couriers
                </Button>
                <button
                  type="button"
                  className="bmo-primary-btn"
                  onClick={() => setIsBookingModalOpen(true)}
                >
                  Book Selected
                </button>
              </InlineStack>
            </div>
          </Box>
        )}

        {isEmpty ? (
          <Box padding="400">
            {orders.length === 0 ? (
              <EmptyState
                heading="No orders synced yet"
                action={{
                  content: "Sync Orders",
                  loading: isSyncing,
                  onAction: () => fetcher.submit({}, { method: "post" }),
                }}
                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              >
                <p>Sync your Shopify orders to get started.</p>
              </EmptyState>
            ) : (
              <EmptyState
                heading="No orders in this category"
                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              >
                <p>Try a different tab or adjust your filters.</p>
              </EmptyState>
            )}
          </Box>
        ) : (
          <IndexTable
            resourceName={{ singular: "order", plural: "orders" }}
            itemCount={filteredOrders.length}
            selectedItemsCount={
              allResourcesSelected ? "All" : selectedResources.length
            }
            onSelectionChange={handleSelectionChange}
            headings={[
              { title: "Order #" },
              { title: "Customer" },
              { title: "City" },
              { title: "COD (Rs.)" },
              { title: "Courier" },
              { title: "Status" },
              { title: "Action" },
            ]}
          >
            {rowMarkup}
          </IndexTable>
        )}

        <Box padding="400">
          <InlineStack align="center">
            <Pagination
              hasPrevious={false}
              hasNext={false}
              onPrevious={() => undefined}
              onNext={() => undefined}
            />
          </InlineStack>
        </Box>
      </Card>

      <FulfillmentModal
        open={isBookingModalOpen}
        onClose={() => setIsBookingModalOpen(false)}
        initialSelectedIds={selectedResources as string[]}
        orders={orders}
        cities={cities}
      />
    </Page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
