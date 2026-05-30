import type { ActionFunctionArgs } from "react-router";

import prisma from "../db.server";
import { authenticate } from "../shopify.server";

// Same dual-shape line-item handling we use for slips.
const variantKey = (value: unknown): string => {
  if (value == null) return "";
  const s = String(value);
  return s.includes("/") ? (s.split("/").pop() ?? "") : s;
};

// Resource route (no default export) so the raw PDF Response is returned
// untouched — see api.slips.ts for the same pattern.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const formData = await request.formData();
  const orderIds: string[] = JSON.parse((formData.get("orderIds") as string) ?? "[]");

  const shopRecord = await prisma.shop.findUnique({
    where: { shopDomain: session.shop },
    select: { id: true, shopName: true, email: true, logoUrl: true, shopDomain: true },
  });
  if (!shopRecord) {
    return Response.json({ error: "Shop not found" }, { status: 404 });
  }

  const dbOrders = await prisma.order.findMany({
    where: { id: { in: orderIds }, shopId: shopRecord.id },
    select: {
      id: true,
      orderName: true,
      customerName: true,
      customerEmail: true,
      customerPhone: true,
      addressLine1: true,
      addressLine2: true,
      rawCity: true,
      rawProvince: true,
      postalCode: true,
      financialStatus: true,
      subtotal: true,
      totalAmount: true,
      codAmount: true,
      currency: true,
      lineItems: true,
      shopifyCreatedAt: true,
    },
    orderBy: { shopifyCreatedAt: "asc" },
  });

  if (dbOrders.length === 0) {
    return Response.json(
      { error: "No matching orders found for the selection." },
      { status: 404 },
    );
  }

  // Map DB rows → invoice-kit input shape.
  const invoiceOrders = dbOrders.map((o) => {
    const lineItems = (o.lineItems as any[]) ?? [];
    const address = {
      name: o.customerName,
      address1: o.addressLine1 ?? "",
      address2: o.addressLine2 ?? "",
      city: o.rawCity ?? "",
      country: "Pakistan",
      phone: o.customerPhone ?? "",
    };
    return {
      id: o.id,
      store_id: "store",
      order_number: o.orderName,
      status: o.financialStatus.toLowerCase(),
      order_date: o.shopifyCreatedAt.toISOString(),
      payment_method: o.codAmount > 0 ? "COD" : "Prepaid",
      payment_status: o.financialStatus.toLowerCase(),
      shipping_method: "",
      billing_address: address,
      shipping_address: address,
      order_items: lineItems.map((li: any) => {
        const price = parseFloat(li.variant?.price ?? li.price ?? 0);
        const qty = li.quantity ?? 1;
        return {
          id: variantKey(li.id),
          image_url: li.image_url ?? li.image?.url ?? "",
          name: li.title ?? li.name ?? "Item",
          sku: li.sku ?? "",
          variant_title: li.variant?.title ?? li.variant_title ?? "",
          quantity: qty,
          unit_price: price,
          total_price: price * qty,
        };
      }),
      subtotal: o.subtotal,
      tax_amount: 0,
      shipping_amount: 0,
      discount_amount: 0,
      total_amount: o.totalAmount,
    };
  });

  const store = {
    id: "store",
    name: shopRecord.shopName ?? shopRecord.shopDomain,
    logo_url: shopRecord.logoUrl ?? "",
    address: "",
    phone: "",
    email: shopRecord.email ?? "",
  };

  const BACKEND_URL = process.env.BACKEND_URL;
  const BACKEND_INTERNAL_SECRET = process.env.BACKEND_INTERNAL_SECRET;
  if (!BACKEND_URL || !BACKEND_INTERNAL_SECRET) {
    return Response.json({ error: "Backend not configured" }, { status: 500 });
  }

  const res = await fetch(`${BACKEND_URL}/api/invoices/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-internal-secret": BACKEND_INTERNAL_SECRET,
    },
    body: JSON.stringify({
      orders: invoiceOrders,
      stores: [store],
      currency: invoiceOrders[0]?.payment_method ? (dbOrders[0].currency || "PKR") : "PKR",
    }),
  });

  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    return Response.json(
      { error: detail.error ?? `Invoice generation failed (${res.status})` },
      { status: 502 },
    );
  }

  const pdf = await res.arrayBuffer();
  return new Response(pdf, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="invoices-${new Date().toISOString().split("T")[0]}.pdf"`,
      "Content-Length": String(pdf.byteLength),
    },
  });
};
