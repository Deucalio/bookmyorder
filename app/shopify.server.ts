import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";
import { syncShopData, syncRecentOrders } from "./services/sync.server";

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.October25,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: AppDistribution.AppStore,
  future: {
    expiringOfflineAccessTokens: true,
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
  hooks: {
    afterAuth: async ({ session, admin }) => {
      shopify.registerWebhooks({ session });

      try {
        const shopRecord = await syncShopData(session, admin);

        // Only run the install-time backfill once per shop. Subsequent
        // afterAuth calls (dev tunnel reconnects, token refresh, etc.) skip
        // it — webhooks keep orders/fulfillments fresh after the first sync.
        if (!shopRecord.initialSyncCompletedAt) {
          console.log(`Running initial order backfill for ${session.shop}`);
          syncRecentOrders(session, admin, 10).catch((err) => {
            console.error(`Error syncing recent orders for ${session.shop}:`, err);
          });
        } else {
          console.log(
            `Skipping initial backfill for ${session.shop} — already completed at ${shopRecord.initialSyncCompletedAt.toISOString()}`,
          );
        }
      } catch (error) {
        console.error(`Error during afterAuth sync for ${session.shop}:`, error);
      }
    },
  },
});

export default shopify;
export const apiVersion = ApiVersion.October25;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
