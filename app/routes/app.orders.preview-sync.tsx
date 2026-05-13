import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { previewOrderSync } from "../services/sync.server";

/**
 * GET /app/orders/preview-sync?days=10
 *
 * Read-only "what would sync do?" endpoint. Hits the same Shopify GraphQL
 * query as syncRecentOrders but writes nothing — returns counts of new vs.
 * existing orders plus a breakdown by financial/fulfillment status.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);

  const url = new URL(request.url);
  const daysParam = url.searchParams.get("days");
  const days = Math.max(1, Math.min(365, daysParam ? parseInt(daysParam, 10) : 10));

  try {
    const stats = await previewOrderSync(session, admin, days);
    return Response.json(stats);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`preview-sync failed for ${session.shop}:`, err);
    return Response.json({ error: message }, { status: 500 });
  }
};
