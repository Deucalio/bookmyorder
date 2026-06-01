import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

// Mandatory GDPR webhook: customers/data_request.
// authenticate.webhook verifies the HMAC signature (using SHOPIFY_API_SECRET)
// and throws a 401 Response when it's invalid. Shopify notifies us that a
// customer requested their data — the store owner provides it out-of-band, so
// we just acknowledge here.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  console.log(`[gdpr] ${topic} for ${shop}:`, JSON.stringify(payload));

  return new Response(null, { status: 200 });
};
