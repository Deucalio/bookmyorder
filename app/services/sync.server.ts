import prisma from "../db.server";
import { matchLocation } from "./locationMatcher.server";

export async function syncShopData(session: any, admin: any) {
  const { shop } = session;

  // Get shop details via GraphQL
  const response = await admin.graphql(
    `#graphql
    query {
      shop {
        id
        name
        email
        plan {
          displayName
        }
      }
    }`
  );
  const data = await response.json();
  const shopData = data.data.shop;

  // Upsert the Shop record
  const shopRecord = await prisma.shop.upsert({
    where: { shopDomain: shop },
    update: {
      shopName: shopData.name,
      email: shopData.email,
      isActive: true,
      uninstalledAt: null,
      // We don't overwrite plan or credits if they already exist and are active
    },
    create: {
      shopDomain: shop,
      shopName: shopData.name,
      email: shopData.email,
      isActive: true,
      plan: shopData.plan?.displayName || "free",
      credits: 50, // Default credits
    },
  });

  return shopRecord;
}

const ORDERS_QUERY = `#graphql
  query($cursor: String, $query: String) {
    orders(first: 50, after: $cursor, query: $query, sortKey: CREATED_AT, reverse: true) {
      edges {
        cursor
        node {
          id
          name
          createdAt
          updatedAt
          displayFinancialStatus
          displayFulfillmentStatus
          subtotalPriceSet { shopMoney { amount currencyCode } }
          totalPriceSet { shopMoney { amount currencyCode } }
          currencyCode
          customer { email phone firstName lastName }
          shippingAddress {
            address1
            address2
            city
            province
            zip
            phone
            firstName
            lastName
            name
          }
          lineItems(first: 50) {
            edges {
              node {
                id
                title
                quantity
                variant { id title price }
              }
            }
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

/**
 * Pages through every order matching `created_at:>=fromDateStr`, returning the
 * raw GraphQL nodes. Shared between writeable sync and read-only preview so
 * both see the same Shopify-side view.
 */
async function fetchOrdersFromShopify(admin: any, fromDateStr: string): Promise<any[]> {
  const all: any[] = [];
  let cursor: string | null = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const response: any = await admin.graphql(ORDERS_QUERY, {
      variables: { cursor, query: `created_at:>=${fromDateStr}` },
    });
    const data: any = await response.json();
    if (data.errors) {
      console.error("GraphQL errors during order fetch:", data.errors);
      break;
    }
    const ordersData: any = data.data?.orders;
    if (!ordersData) break;

    const orders = ordersData.edges.map((edge: any) => edge.node);
    if (orders.length === 0) break;

    all.push(...orders);
    hasNextPage = ordersData.pageInfo.hasNextPage;
    cursor = ordersData.pageInfo.endCursor;
  }

  return all;
}

async function mapOrderToRecord(shopId: string, o: any) {
  const orderId = BigInt(o.id.split("/").pop());
  const shipping = o.shippingAddress || {};
  const customer = o.customer || {};

  const customerName =
    shipping.name ||
    `${customer.firstName || ""} ${customer.lastName || ""}`.trim() ||
    "No Name";
  const customerPhone = shipping.phone || customer.phone || null;

  const location = await matchLocation({
    province: shipping.province,
    city: shipping.city,
    address1: shipping.address1,
    address2: shipping.address2,
  }).catch(() => ({ provinceId: null, cityId: null, areaId: null }));

  return {
    shopId,
    shopifyOrderId: orderId,
    shopifyOrderGid: o.id,
    orderName: o.name,
    customerName,
    customerEmail: customer.email || null,
    customerPhone: customerPhone ? customerPhone.substring(0, 20) : null,
    provinceId: location.provinceId,
    cityId: location.cityId,
    areaId: location.areaId,
    rawProvince: shipping.province || null,
    rawCity: shipping.city || null,
    addressLine1: shipping.address1 || null,
    addressLine2: shipping.address2 || null,
    postalCode: shipping.zip || null,
    subtotal: parseFloat(o.subtotalPriceSet?.shopMoney?.amount || 0),
    totalAmount: parseFloat(o.totalPriceSet?.shopMoney?.amount || 0),
    codAmount: parseFloat(o.totalPriceSet?.shopMoney?.amount || 0),
    currency: o.currencyCode || "PKR",
    financialStatus: o.displayFinancialStatus || "PENDING",
    fulfillmentStatus: o.displayFulfillmentStatus || "UNFULFILLED",
    lineItems: o.lineItems?.edges?.map((e: any) => e.node) || [],
    shopifyCreatedAt: new Date(o.createdAt),
    shopifyUpdatedAt: new Date(o.updatedAt),
  };
}

export async function syncRecentOrders(session: any, admin: any, daysBack: number = 60) {
  const { shop } = session;

  const shopRecord = await prisma.shop.findUnique({
    where: { shopDomain: shop },
  });
  if (!shopRecord) {
    throw new Error(`Shop record not found for ${shop}`);
  }

  const fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - daysBack);
  const fromDateStr = fromDate.toISOString().split("T")[0];

  try {
    const orders = await fetchOrdersFromShopify(admin, fromDateStr);

    const ids = orders.map((o: any) => BigInt(o.id.split("/").pop()));
    const existing = await prisma.order.findMany({
      where: { shopId: shopRecord.id, shopifyOrderId: { in: ids } },
      select: { shopifyOrderId: true },
    });
    const existingIds = new Set(existing.map((e) => e.shopifyOrderId.toString()));

    const records = await Promise.all(orders.map((o) => mapOrderToRecord(shopRecord.id, o)));

    let newCount = 0;
    for (const record of records) {
      const isNew = !existingIds.has(record.shopifyOrderId.toString());
      if (isNew) newCount += 1;
      await prisma.order.upsert({
        where: { shopId_shopifyOrderId: { shopId: record.shopId, shopifyOrderId: record.shopifyOrderId } },
        update: record,
        create: record,
      });
    }

    await prisma.shop.update({
      where: { id: shopRecord.id },
      data: {
        lastOrderSyncAt: new Date(),
        ordersBackfilledCount: { increment: newCount },
        initialSyncCompletedAt: shopRecord.initialSyncCompletedAt ?? new Date(),
        lastSyncError: null,
      },
    });

    console.log(`Synced ${orders.length} orders for ${shop} (${newCount} new, ${orders.length - newCount} updated)`);
    return { fetched: orders.length, newCount, updatedCount: orders.length - newCount };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.shop.update({
      where: { id: shopRecord.id },
      data: { lastSyncError: message },
    });
    throw err;
  }
}

export type PreviewSyncResult = {
  shopDomain: string;
  shopInstalledAt: Date;
  initialSyncCompletedAt: Date | null;
  lastOrderSyncAt: Date | null;
  ordersBackfilledCount: number;
  windowDays: number;
  windowFromDate: string;
  totalFetched: number;
  wouldCreate: number;
  wouldUpdate: number;
  byFinancialStatus: Record<string, number>;
  byFulfillmentStatus: Record<string, number>;
  ordersInDbForShop: number;
};

/**
 * Read-only counterpart to syncRecentOrders. Hits Shopify the same way but
 * writes nothing — returns counts of what *would* be created vs. updated and
 * a breakdown by financial/fulfillment status.
 */
export async function previewOrderSync(
  session: any,
  admin: any,
  daysBack: number = 10,
): Promise<PreviewSyncResult> {
  const { shop } = session;

  const shopRecord = await prisma.shop.findUnique({ where: { shopDomain: shop } });
  if (!shopRecord) {
    throw new Error(`Shop record not found for ${shop}`);
  }

  const fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - daysBack);
  const fromDateStr = fromDate.toISOString().split("T")[0];

  const orders = await fetchOrdersFromShopify(admin, fromDateStr);

  const ids = orders.map((o: any) => BigInt(o.id.split("/").pop()));
  const existing = ids.length
    ? await prisma.order.findMany({
        where: { shopId: shopRecord.id, shopifyOrderId: { in: ids } },
        select: { shopifyOrderId: true },
      })
    : [];
  const existingIds = new Set(existing.map((e) => e.shopifyOrderId.toString()));

  const byFinancialStatus: Record<string, number> = {};
  const byFulfillmentStatus: Record<string, number> = {};
  let wouldCreate = 0;
  let wouldUpdate = 0;

  for (const o of orders) {
    const orderId = BigInt(o.id.split("/").pop()).toString();
    if (existingIds.has(orderId)) wouldUpdate += 1;
    else wouldCreate += 1;

    const fin = (o.displayFinancialStatus || "PENDING").toUpperCase();
    const ful = (o.displayFulfillmentStatus || "UNFULFILLED").toUpperCase();
    byFinancialStatus[fin] = (byFinancialStatus[fin] ?? 0) + 1;
    byFulfillmentStatus[ful] = (byFulfillmentStatus[ful] ?? 0) + 1;
  }

  const ordersInDbForShop = await prisma.order.count({ where: { shopId: shopRecord.id } });

  return {
    shopDomain: shop,
    shopInstalledAt: shopRecord.installedAt,
    initialSyncCompletedAt: shopRecord.initialSyncCompletedAt,
    lastOrderSyncAt: shopRecord.lastOrderSyncAt,
    ordersBackfilledCount: shopRecord.ordersBackfilledCount,
    windowDays: daysBack,
    windowFromDate: fromDateStr,
    totalFetched: orders.length,
    wouldCreate,
    wouldUpdate,
    byFinancialStatus,
    byFulfillmentStatus,
    ordersInDbForShop,
  };
}
