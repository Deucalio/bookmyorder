import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { forwardWebhook } from "../services/forwardWebhook.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, webhookId, payload } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop} (id=${webhookId})`);
  return forwardWebhook(shop, webhookId, topic, payload);
};
