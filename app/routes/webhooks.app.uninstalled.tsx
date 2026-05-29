import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { forwardWebhook } from "../services/forwardWebhook.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, session, topic, webhookId, payload } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  // Delete local sessions — Shopify requires this on uninstall.
  // Webhook may fire after sessions are already gone, so guard on session existence.
  if (session) {
    await db.session.deleteMany({ where: { shop } });
  }

  // Also notify the backend so it can mark the shop as inactive.
  forwardWebhook(shop, webhookId, topic, payload);

  return new Response();
};
