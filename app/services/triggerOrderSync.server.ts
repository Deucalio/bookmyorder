const BACKEND_URL = process.env.BACKEND_URL;
const BACKEND_INTERNAL_SECRET = process.env.BACKEND_INTERNAL_SECRET;

function postToBackend(path: string, body: Record<string, unknown>, label: string): void {
  if (!BACKEND_URL || !BACKEND_INTERNAL_SECRET) {
    console.warn(`[${label}] BACKEND_URL or BACKEND_INTERNAL_SECRET not set — skipping`);
    return;
  }

  fetch(`${BACKEND_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-internal-secret': BACKEND_INTERNAL_SECRET,
    },
    body: JSON.stringify(body),
  }).catch((err) => {
    console.error(`[${label}] Failed to reach backend:`, err);
  });
}

/** Initial/backfill sync: fetches orders by date range from Shopify. */
export function triggerOrderSync(
  shopDomain: string,
  accessToken: string,
  daysBack: number = 60,
): void {
  postToBackend('/api/orders/sync', { shopDomain, accessToken, daysBack }, 'triggerOrderSync');
}

/** Manual sync button: refreshes all orders already in the DB by GID. */
export function triggerOrderRefresh(shopDomain: string, accessToken: string): void {
  postToBackend('/api/orders/refresh', { shopDomain, accessToken }, 'triggerOrderRefresh');
}
