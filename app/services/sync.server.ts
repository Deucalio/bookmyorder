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

  const query = `#graphql
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

  let cursor = null;
  let hasNextPage = true;
  let processedCount = 0;

  while (hasNextPage) {
    const response = await admin.graphql(query, {
      variables: {
        cursor,
        query: `created_at:>=${fromDateStr}`,
      },
    });

    const data = await response.json();
    console.log(`Fetched orders batch for ${shop}, cursor: ${cursor}, hasNextPage: ${data.data.orders.pageInfo.hasNextPage}`, "\n\n", "Data: ",  JSON.stringify(data, null, 2));

    if (data.errors) {
      console.error("GraphQL errors during order sync:", data.errors);
      break;
    }

    const ordersData = data.data?.orders;
    if (!ordersData) break;

    const orders = ordersData.edges.map((edge: any) => edge.node);

    if (orders.length === 0) break;

    // Map orders and save to DB
    const orderRecords = await Promise.all(orders.map(async (o: any) => {
      const orderId = BigInt(o.id.split('/').pop());
      const shipping = o.shippingAddress || {};
      const customer = o.customer || {};

      const customerName = shipping.name || `${customer.firstName || ''} ${customer.lastName || ''}`.trim() || 'No Name';
      const customerPhone = shipping.phone || customer.phone || null;

      const location = await matchLocation({
        province: shipping.province,
        city: shipping.city,
        address1: shipping.address1,
        address2: shipping.address2,
      }).catch(() => ({ provinceId: null, cityId: null, areaId: null }));

      return {
        shopId: shopRecord.id,
        shopifyOrderId: orderId,
        shopifyOrderGid: o.id,
        orderName: o.name,
        customerName: customerName,
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
        currency: o.currencyCode || 'PKR',
        financialStatus: o.displayFinancialStatus || 'PENDING',
        fulfillmentStatus: o.displayFulfillmentStatus || 'UNFULFILLED',
        lineItems: o.lineItems?.edges?.map((e: any) => e.node) || [],
        shopifyCreatedAt: new Date(o.createdAt),
        shopifyUpdatedAt: new Date(o.updatedAt),
      };
    }));

    for (const record of orderRecords) {
      await prisma.order.upsert({
        where: { shopId_shopifyOrderId: { shopId: record.shopId, shopifyOrderId: record.shopifyOrderId } },
        update: record,
        create: record,
      });
    }

    processedCount += orders.length;
    hasNextPage = ordersData.pageInfo.hasNextPage;
    cursor = ordersData.pageInfo.endCursor;
  }

  console.log(`Synced ${processedCount} orders for shop ${shop}`);
}
