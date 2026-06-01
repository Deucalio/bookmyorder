import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

// Mandatory GDPR webhook: shop/redact (fires ~48h after uninstall).
// authenticate.webhook verifies the HMAC signature (using SHOPIFY_API_SECRET)
// and throws a 401 Response when it's invalid. The full shop wipe already runs
// synchronously in webhooks.app.uninstalled.tsx (which fires first), so by the
// time this arrives the Shop row is normally gone. We defensively clear any
// lingering sessions as a backstop.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);

  console.log(`[gdpr] ${topic} for ${shop}`);

  await db.session.deleteMany({ where: { shop } }).catch((err) => {
    console.error(`[gdpr] shop/redact session cleanup failed for ${shop}:`, err);
  });

  return new Response(null, { status: 200 });
};
