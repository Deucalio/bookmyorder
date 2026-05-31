import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useLocation, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { AppProvider as PolarisAppProvider } from "@shopify/polaris";
import enTranslations from "@shopify/polaris/locales/en.json";

import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { OnboardingPicker } from "../components/onboarding/OnboardingPicker";
import {
  getOnboardingCourierCities,
  pricingPlansUrlFor,
  refreshVerifiedPlan,
} from "../services/onboarding.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);

  const shop = await prisma.shop.findUnique({
    where: { shopDomain: session.shop },
    select: { id: true, plan: true, isOnboarded: true, logoUrl: true },
  });

  let isOnboarded = false;
  let currentPlan: string | null = null;
  let hasConfiguredCourier = false;
  let configuredCourierCodes: string[] = [];

  if (shop) {
    const verifiedPlan = await refreshVerifiedPlan(admin, shop);
    const hasPlan =
      verifiedPlan.verified ||
      (shop.isOnboarded && !verifiedPlan.lookupOk && verifiedPlan.plan !== "none");
    currentPlan = hasPlan ? verifiedPlan.plan : null;
    isOnboarded = shop.isOnboarded && hasPlan;

    const enabledCouriers = await prisma.shopCourier.findMany({
      where: { shopId: shop.id, isEnabled: true },
      select: { courierCode: true },
    });
    configuredCourierCodes = enabledCouriers.map((courier) => courier.courierCode);
    hasConfiguredCourier = configuredCourierCodes.length > 0;
  }

  const pathname = new URL(request.url).pathname;
  const shouldRenderPicker = !isOnboarded && pathname !== "/app/onboarding";
  const { tcsCities, lcsCities } = shouldRenderPicker
    ? await getOnboardingCourierCities()
    : { tcsCities: [], lcsCities: [] };

  return {
    // eslint-disable-next-line no-undef
    apiKey: process.env.SHOPIFY_API_KEY || "",
    isOnboarded,
    shopDomain: session.shop,
    pricingUrl: pricingPlansUrlFor(session.shop),
    currentPlan,
    hasConfiguredCourier,
    configuredCourierCodes,
    tcsCities,
    lcsCities,
    logoUrl: shop?.logoUrl ?? null,
  };
};

export default function App() {
  const {
    apiKey,
    isOnboarded,
    shopDomain,
    pricingUrl,
    currentPlan,
    hasConfiguredCourier,
    configuredCourierCodes,
    tcsCities,
    lcsCities,
    logoUrl,
  } = useLoaderData<typeof loader>();
  const location = useLocation();
  // On /app/onboarding the route itself renders the picker.
  const showPickerHere = !isOnboarded && location.pathname !== "/app/onboarding";

  return (
    <AppProvider embedded apiKey={apiKey}>
      <PolarisAppProvider i18n={enTranslations}>
        <s-app-nav>
          <s-link href="/app">Home</s-link>
          <s-link href="/app/orders">Orders</s-link>
          <s-link href="/app/settings">Settings</s-link>
        </s-app-nav>
        {showPickerHere ? (
          <OnboardingPicker
            shopDomain={shopDomain}
            pricingUrl={pricingUrl}
            currentPlan={currentPlan}
            hasConfiguredCourier={hasConfiguredCourier}
            configuredCourierCodes={configuredCourierCodes}
            tcsCities={tcsCities}
            lcsCities={lcsCities}
            logoUrl={logoUrl}
            formAction="/app/onboarding"
          />
        ) : (
          <Outlet />
        )}
      </PolarisAppProvider>
    </AppProvider>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
