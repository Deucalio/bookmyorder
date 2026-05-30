// Lazy-loaded tracking timeline for a single Fulfillment. Called from the
// Orders page when a row is expanded — avoids shipping every event for
// every order on the initial loader.
//
// Returns:
//   { fulfillmentId, lastStatus, lastSyncedAt, events: [...] }
// or 404 if the fulfillment is not owned by the calling shop.

import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const fulfillmentId = params.fulfillmentId;
  if (!fulfillmentId) {
    return Response.json({ error: "fulfillmentId required" }, { status: 400 });
  }

  // Scope check: confirm the fulfillment belongs to the calling shop.
  const fulfillment = await prisma.fulfillment.findFirst({
    where: { id: fulfillmentId, order: { shop: { shopDomain: session.shop } } },
    select: {
      id: true,
      lastTrackingStatus: true,
      lastTrackingAt: true,
      trackingEvents: {
        orderBy: { eventAt: "asc" },
        select: {
          id: true,
          normalizedStatus: true,
          description: true,
          location: true,
          receiver: true,
          reason: true,
          eventAt: true,
        },
      },
    },
  });

  if (!fulfillment) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  return Response.json({
    fulfillmentId: fulfillment.id,
    lastStatus: fulfillment.lastTrackingStatus,
    lastSyncedAt: fulfillment.lastTrackingAt?.toISOString() ?? null,
    events: fulfillment.trackingEvents.map((e) => ({
      id: e.id,
      status: e.normalizedStatus,
      description: e.description,
      location: e.location,
      receiver: e.receiver,
      reason: e.reason,
      at: e.eventAt.toISOString(),
    })),
  });
};
