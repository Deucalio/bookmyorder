import type { ActionFunctionArgs } from "react-router";

import prisma from "../db.server";
import { authenticate } from "../shopify.server";

// Line items are stored in one of two shapes depending on origin:
//   - sync (GraphQL):   { id, title, quantity, sku, image_url, variant: { id, price } }
//   - webhook (REST):   { id, title, quantity, sku, variant_id, price, grams }
// Normalize a variant id from either shape to its numeric string so order items
// and fulfillment items can be matched reliably.
const variantKey = (value: unknown): string => {
  if (value == null) return "";
  const s = String(value);
  return s.includes("/") ? (s.split("/").pop() ?? "") : s;
};

// Resource route (no default export) so the raw PDF Response is returned
// untouched — a UI route under /app would wrap it in React Router's single-fetch
// stream and corrupt the binary.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const formData = await request.formData();
  const orderIds: string[] = JSON.parse((formData.get("orderIds") as string) ?? "[]");

  const shopRecord = await prisma.shop.findUnique({
    where: { shopDomain: session.shop },
    select: { logoUrl: true },
  });

  const fulfillments = await prisma.fulfillment.findMany({
    where: {
      orderId: { in: orderIds },
      source: "app",
      slipData: { not: null },
      trackingNumber: { not: null },
    },
    include: {
      order: {
        select: {
          id: true,
          orderName: true,
          customerName: true,
          customerPhone: true,
          customerEmail: true,
          addressLine1: true,
          addressLine2: true,
          rawCity: true,
          rawProvince: true,
          postalCode: true,
          codAmount: true,
          lineItems: true,
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  const slipOrders = fulfillments.map((f) => {
    const order = f.order;
    const slipData = f.slipData as any;
    const lineItems = (order.lineItems as any[]) ?? [];
    const fulfillmentItems = (f.items as any[]) ?? [];
    const nameParts = order.customerName.split(" ");

    return {
      id: order.id,
      order_number: order.orderName,
      store_id: "store",
      shipping_address: {
        name: order.customerName,
        first_name: nameParts[0] ?? "",
        last_name: nameParts.slice(1).join(" ") ?? "",
        address1: order.addressLine1 ?? "",
        address2: order.addressLine2 ?? "",
        city: order.rawCity ?? "",
        country: "Pakistan",
        province: order.rawProvince ?? "",
        zip: order.postalCode ?? "",
        phone: order.customerPhone ?? "",
        email: order.customerEmail ?? "",
        company: null,
      },
      order_items: lineItems.map((li: any) => {
        const price = parseFloat(li.variant?.price ?? li.price ?? 0);
        const hasGrams = typeof li.grams === "number";
        return {
          variant_id: variantKey(li.variant?.id ?? li.variant_id),
          sku: li.sku ?? "",
          name: li.title ?? li.name ?? "",
          image_url: li.image_url ?? li.image?.url ?? "",
          unit_price: price,
          total_price: price * (li.quantity ?? 1),
          weight: li.variant?.weight ?? (hasGrams ? li.grams : 0),
          weight_unit: li.variant?.weightUnit === "kilograms" ? "kg" : hasGrams ? "g" : "kg",
          requires_shipping: li.requires_shipping ?? true,
        };
      }),
      fulfillment_orders: [
        {
          fulfillment_order_id: f.id,
          tracking_number: f.trackingNumber ?? "",
          cod_amount: order.codAmount,
          fulfilment_date: f.bookedAt?.toISOString() ?? new Date().toISOString(),
          line_items: fulfillmentItems.map((fi: any) => ({
            fulfillment_order_line_item_id: fi.line_item_id ?? fi.id,
            line_item_id: fi.line_item_id ?? fi.id,
            variant_id: variantKey(fi.variant_id ?? fi.variant?.id),
            fulfillment_order_quantity: fi.fulfillment_order_quantity ?? fi.quantity ?? 1,
          })),
        },
      ],
      selectedCourierCity: slipData?.selectedCourierCity ?? {},
      courierAccount: slipData?.courierAccount ?? {},
      service_level: slipData?.service_level ?? "OVERNIGHT",
    };
  });

  if (slipOrders.length === 0) {
    return Response.json(
      { error: "No slip data found. Orders must be booked through the app (not imported from Shopify)." },
      { status: 404 },
    );
  }

  const BACKEND_URL = process.env.BACKEND_URL;
  const BACKEND_INTERNAL_SECRET = process.env.BACKEND_INTERNAL_SECRET;
  if (!BACKEND_URL || !BACKEND_INTERNAL_SECRET) {
    return Response.json({ error: "Backend not configured" }, { status: 500 });
  }

  const slipRes = await fetch(`${BACKEND_URL}/api/slips/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-internal-secret": BACKEND_INTERNAL_SECRET,
    },
    body: JSON.stringify({
      slipOrders,
      stores: shopRecord?.logoUrl ? [{ id: "store", logo_url: shopRecord.logoUrl }] : [],
    }),
  });

  if (!slipRes.ok) {
    const detail = await slipRes.json().catch(() => ({}));
    return Response.json(
      { error: detail.error ?? `Slip generation failed (${slipRes.status})` },
      { status: 502 },
    );
  }

  const pdf = await slipRes.arrayBuffer();
  return new Response(pdf, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="slips-${new Date().toISOString().split("T")[0]}.pdf"`,
      "Content-Length": String(pdf.byteLength),
    },
  });
};
