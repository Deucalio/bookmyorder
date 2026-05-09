import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { processWebhook, upsertFulfillmentFromWebhook } from "../services/webhookHandlers.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, webhookId, payload } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop} (id=${webhookId})`);

  return processWebhook({
    shopDomain: shop,
    webhookId,
    topic,
    payload: payload as never,
    handler: (shopId) => upsertFulfillmentFromWebhook(shopId, payload as never),
  });
};
