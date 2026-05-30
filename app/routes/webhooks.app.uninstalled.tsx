import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { forwardWebhook } from "../services/forwardWebhook.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, webhookId, payload } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  // Wipe synchronously here — we can't rely on the backend forward because it's
  // fire-and-forget and any network blip would leave the shop's data orphaned.
  // Backend's handleAppUninstalled becomes a no-op (no Shop row left to find).
  try {
    // Sessions are keyed by the raw shop string (no FK to Shop). Always clear
    // them — Shopify requires it after uninstall.
    const sessionsResult = await db.session.deleteMany({ where: { shop } });

    const shopRow = await db.shop.findUnique({
      where: { shopDomain: shop },
      select: { id: true },
    });

    if (shopRow) {
      await db.$transaction(
        async (tx) => {
        // BookingAttempt.orderId is a plain String (no FK), and the FK on
        // fulfillmentId is SetNull — so audit rows would linger orphaned.
        const orderIds = (
          await tx.order.findMany({
            where: { shopId: shopRow.id },
            select: { id: true },
          })
        ).map((o) => o.id);
        if (orderIds.length > 0) {
          await tx.bookingAttempt.deleteMany({ where: { orderId: { in: orderIds } } });
        }

        // Break the Order ↔ AddressMatchLog circular FK before the cascade fires.
        await tx.order.updateMany({
          where: { shopId: shopRow.id },
          data: { addressMatchLogId: null },
        });

        // Deleting Shop cascades to:
        //   Order → Fulfillment → TrackingEvent
        //   ShopCourier, CourierCityStats, WebhookEvent
        //   AddressMatchLog, CustomTab, StoppedOrder
          await tx.shop.delete({ where: { id: shopRow.id } });
        },
        // Cascade across Order → Fulfillment → TrackingEvent plus 6+ sibling
        // tables can blow past the 5s default on busy shops.
        { timeout: 60_000, maxWait: 10_000 },
      );
      console.log(
        `[uninstall] Wiped ${shop} — Shop deleted, ${sessionsResult.count} session(s) cleared`,
      );
    } else {
      console.log(
        `[uninstall] No Shop row for ${shop}, ${sessionsResult.count} session(s) cleared`,
      );
    }
  } catch (err) {
    console.error(`[uninstall] Wipe failed for ${shop}:`, err);
    // Keep going — still forward to backend so it can retry/log.
  }

  // Best-effort forward — backend's handler is idempotent (no-ops when no Shop).
  forwardWebhook(shop, webhookId, topic, payload);

  return new Response();
};
