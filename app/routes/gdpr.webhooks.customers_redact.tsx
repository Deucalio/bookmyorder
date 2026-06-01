import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

// Mandatory GDPR webhook: customers/redact.
// authenticate.webhook verifies the HMAC signature (using SHOPIFY_API_SECRET)
// and throws a 401 Response when it's invalid. Best-effort: scrub the PII we
// hold for the orders Shopify asks us to redact.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  console.log(`[gdpr] ${topic} for ${shop}`);

  try {
    const shopRow = await db.shop.findUnique({
      where: { shopDomain: shop },
      select: { id: true },
    });

    const ordersToRedact = (payload as any)?.orders_to_redact;
    if (shopRow && Array.isArray(ordersToRedact) && ordersToRedact.length > 0) {
      const ids = ordersToRedact
        .map((id: unknown) => {
          try {
            return BigInt(String(id));
          } catch {
            return null;
          }
        })
        .filter((id): id is bigint => id !== null);

      if (ids.length > 0) {
        await db.order.updateMany({
          where: { shopId: shopRow.id, shopifyOrderId: { in: ids } },
          data: {
            customerName: "Redacted",
            customerEmail: null,
            customerPhone: null,
            addressLine1: null,
            addressLine2: null,
            rawCity: null,
            rawProvince: null,
            postalCode: null,
          },
        });
      }
    }
  } catch (err) {
    console.error(`[gdpr] customers/redact failed for ${shop}:`, err);
    // Still 200 — the HMAC was valid; don't make Shopify retry on an internal error.
  }

  return new Response(null, { status: 200 });
};
