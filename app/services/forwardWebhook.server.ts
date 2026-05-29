const BACKEND_URL = process.env.BACKEND_URL;
const BACKEND_INTERNAL_SECRET = process.env.BACKEND_INTERNAL_SECRET;

/**
 * Forward a verified webhook payload to the backend for processing.
 * Returns a 200 Response immediately so Shopify gets an ack without waiting
 * for the backend to finish.
 */
export async function forwardWebhook(
  shopDomain: string,
  webhookId: string,
  topic: string,
  payload: unknown,
): Promise<Response> {
  if (!BACKEND_URL || !BACKEND_INTERNAL_SECRET) {
    console.warn('[forwardWebhook] BACKEND_URL or BACKEND_INTERNAL_SECRET not set — skipping forward');
    return new Response();
  }

  fetch(`${BACKEND_URL}/api/webhooks/process`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-internal-secret': BACKEND_INTERNAL_SECRET,
    },
    body: JSON.stringify({ shopDomain, webhookId, topic, payload }),
  }).catch((err) => {
    console.error(`[forwardWebhook] Failed to forward ${topic} for ${shopDomain}:`, err);
  });

  return new Response();
}
