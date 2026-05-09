import type { Prisma } from "@prisma/client";
import prisma from "../db.server";
import { matchLocation } from "./locationMatcher.server";

type ShopifyOrderPayload = {
  id: number;
  admin_graphql_api_id?: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  currency?: string | null;
  subtotal_price?: string | number | null;
  total_price?: string | number | null;
  financial_status?: string | null;
  fulfillment_status?: string | null;
  created_at: string;
  updated_at: string;
  customer?: {
    email?: string | null;
    phone?: string | null;
    first_name?: string | null;
    last_name?: string | null;
  } | null;
  shipping_address?: {
    name?: string | null;
    first_name?: string | null;
    last_name?: string | null;
    phone?: string | null;
    address1?: string | null;
    address2?: string | null;
    city?: string | null;
    province?: string | null;
    zip?: string | null;
  } | null;
  line_items?: unknown[] | null;
};

type ShopifyFulfillmentPayload = {
  id: number;
  admin_graphql_api_id?: string;
  order_id: number;
  status?: string | null;
  shipment_status?: string | null;
  tracking_company?: string | null;
  tracking_number?: string | null;
  tracking_url?: string | null;
  tracking_urls?: string[] | null;
  created_at?: string;
  updated_at?: string;
  line_items?: unknown[] | null;
};

const toFloat = (v: unknown, fallback = 0) => {
  if (v == null) return fallback;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : fallback;
};

const truncate = (v: string | null | undefined, len: number) =>
  v ? v.substring(0, len) : null;

/**
 * Idempotency wrapper.
 *
 * Why: Shopify retries failed deliveries for ~48h. Without an idempotency key
 * a single event could create duplicate rows on retry.
 *
 * How: store one WebhookEvent per (shop, webhookId, topic). If we've already
 * processed it, ack 200 immediately. Otherwise run the handler and mark it
 * processed; on failure, persist the error and 500 so Shopify retries.
 */
export async function processWebhook(args: {
  shopDomain: string;
  webhookId: string;
  topic: string;
  payload: Prisma.InputJsonValue;
  handler: (shopId: string) => Promise<void>;
}) {
  const { shopDomain, webhookId, topic, payload, handler } = args;

  const shopRecord = await prisma.shop.findUnique({
    where: { shopDomain },
    select: { id: true },
  });
  if (!shopRecord) {
    console.warn(`Webhook ${topic} received for unknown shop ${shopDomain} — acking`);
    return new Response();
  }

  const existing = await prisma.webhookEvent.findUnique({
    where: { shopId_shopifyId_topic: { shopId: shopRecord.id, shopifyId: webhookId, topic } },
    select: { id: true, processed: true },
  });
  if (existing?.processed) {
    return new Response();
  }

  const event = await prisma.webhookEvent.upsert({
    where: { shopId_shopifyId_topic: { shopId: shopRecord.id, shopifyId: webhookId, topic } },
    create: {
      shopId: shopRecord.id,
      shopifyId: webhookId,
      topic,
      payload,
      attempts: 1,
    },
    update: {
      attempts: { increment: 1 },
      payload,
    },
  });

  try {
    await handler(shopRecord.id);
    await prisma.webhookEvent.update({
      where: { id: event.id },
      data: { processed: true, processedAt: new Date(), error: null },
    });
    return new Response();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Webhook ${topic} (${webhookId}) failed:`, err);
    await prisma.webhookEvent.update({
      where: { id: event.id },
      data: { error: message },
    });
    return new Response("Webhook processing failed", { status: 500 });
  }
}

export async function upsertOrderFromWebhook(shopId: string, order: ShopifyOrderPayload) {
  const shipping = order.shipping_address || {};
  const customer = order.customer || {};

  const customerName =
    shipping.name ||
    `${shipping.first_name ?? customer.first_name ?? ""} ${shipping.last_name ?? customer.last_name ?? ""}`.trim() ||
    "No Name";

  const customerPhone = shipping.phone || customer.phone || order.phone || null;

  const location = await matchLocation({
    province: shipping.province,
    city: shipping.city,
    address1: shipping.address1,
    address2: shipping.address2,
  }).catch(() => ({ provinceId: null, cityId: null, areaId: null }));

  const shopifyOrderId = BigInt(order.id);
  const total = toFloat(order.total_price);

  const data = {
    shopId,
    shopifyOrderId,
    shopifyOrderGid: order.admin_graphql_api_id ?? `gid://shopify/Order/${order.id}`,
    orderName: order.name,
    customerName,
    customerEmail: customer.email || order.email || null,
    customerPhone: truncate(customerPhone, 20),
    provinceId: location.provinceId,
    cityId: location.cityId,
    areaId: location.areaId,
    rawProvince: shipping.province || null,
    rawCity: shipping.city || null,
    addressLine1: shipping.address1 || null,
    addressLine2: shipping.address2 || null,
    postalCode: shipping.zip || null,
    subtotal: toFloat(order.subtotal_price),
    totalAmount: total,
    codAmount: total,
    currency: order.currency || "PKR",
    financialStatus: (order.financial_status || "PENDING").toUpperCase(),
    fulfillmentStatus: (order.fulfillment_status || "UNFULFILLED").toUpperCase(),
    lineItems: (order.line_items ?? []) as Prisma.InputJsonValue,
    shopifyCreatedAt: new Date(order.created_at),
    shopifyUpdatedAt: new Date(order.updated_at),
  };

  await prisma.order.upsert({
    where: { shopId_shopifyOrderId: { shopId, shopifyOrderId } },
    create: data,
    update: data,
  });
}

const FULFILLMENT_STATUS_MAP: Record<string, string> = {
  pending: "pending",
  open: "booked",
  success: "fulfilled",
  cancelled: "cancelled",
  error: "failed",
  failure: "failed",
};

export async function upsertFulfillmentFromWebhook(
  shopId: string,
  fulfillment: ShopifyFulfillmentPayload,
) {
  const shopifyOrderId = BigInt(fulfillment.order_id);
  const order = await prisma.order.findUnique({
    where: { shopId_shopifyOrderId: { shopId, shopifyOrderId } },
    select: { id: true, fulfillmentStatus: true },
  });
  if (!order) {
    throw new Error(`Order not found for fulfillment ${fulfillment.id} (order_id=${fulfillment.order_id})`);
  }

  const shopifyFulfillmentId = String(fulfillment.id);
  const trackingUrl =
    fulfillment.tracking_url ||
    (Array.isArray(fulfillment.tracking_urls) ? fulfillment.tracking_urls[0] : null) ||
    null;

  const rawStatus = (fulfillment.status || "").toLowerCase();
  const mappedStatus = FULFILLMENT_STATUS_MAP[rawStatus] ?? "pending";
  const fulfilledAt = mappedStatus === "fulfilled" ? new Date(fulfillment.updated_at ?? fulfillment.created_at ?? Date.now()) : null;

  const courierName = fulfillment.tracking_company || "manual";
  const courierCode = courierName.toLowerCase().replace(/\s+/g, "_");

  const existing = await prisma.fulfillment.findFirst({
    where: { orderId: order.id, shopifyFulfillmentId },
    select: { id: true },
  });

  const data = {
    shopifyFulfillmentId,
    shopifyFulfillmentGid: fulfillment.admin_graphql_api_id ?? `gid://shopify/Fulfillment/${fulfillment.id}`,
    courierCode,
    courierName,
    trackingNumber: fulfillment.tracking_number || null,
    trackingUrl,
    status: mappedStatus,
    lastTrackingStatus: fulfillment.shipment_status || null,
    lastTrackingAt: fulfillment.shipment_status ? new Date() : null,
    deliveryOutcome: mappedStatus === "fulfilled" ? "delivered" : mappedStatus === "failed" ? "failed" : "pending",
    fulfilledOnShopifyAt: fulfilledAt,
    items: (fulfillment.line_items ?? []) as Prisma.InputJsonValue,
  };

  if (existing) {
    await prisma.fulfillment.update({
      where: { id: existing.id },
      data,
    });
  } else {
    await prisma.fulfillment.create({
      data: { ...data, orderId: order.id },
    });
  }

  if (mappedStatus === "fulfilled" && order.fulfillmentStatus !== "FULFILLED") {
    await prisma.order.update({
      where: { id: order.id },
      data: { fulfillmentStatus: "FULFILLED" },
    });
  }
}
