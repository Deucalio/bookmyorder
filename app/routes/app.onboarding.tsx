import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useActionData, useLoaderData } from "react-router";

import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { OnboardingPicker } from "../components/onboarding/OnboardingPicker";
import {
  getOnboardingCourierCities,
  pricingPlansUrlFor,
  refreshVerifiedPlan,
} from "../services/onboarding.server";
import { verifyCourier } from "../services/verifyCourier.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);

  const shop = await prisma.shop.findUnique({
    where: { shopDomain: session.shop },
    select: { id: true, plan: true, isOnboarded: true },
  });

  let currentPlan: string | null = null;

  if (shop) {
    const verifiedPlan = await refreshVerifiedPlan(admin, shop);
    currentPlan = verifiedPlan.verified ? verifiedPlan.plan : null;
  }

  const couriers = shop
    ? await prisma.shopCourier.findMany({
        where: { shopId: shop.id, isEnabled: true },
        select: { courierCode: true },
      })
    : [];

  const { tcsCities, lcsCities } = await getOnboardingCourierCities();

  return {
    shopDomain: session.shop,
    pricingUrl: pricingPlansUrlFor(session.shop),
    currentPlan,
    hasConfiguredCourier: couriers.length > 0,
    configuredCourierCodes: couriers.map((courier) => courier.courierCode),
    tcsCities,
    lcsCities,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);

  const shopRecord = await prisma.shop.findUnique({
    where: { shopDomain: session.shop },
    select: { id: true, plan: true, isOnboarded: true },
  });

  if (!shopRecord) {
    throw new Response("Shop not found", { status: 404 });
  }

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "complete-onboarding") {
    const verifiedPlan = await refreshVerifiedPlan(admin, shopRecord);
    if (!verifiedPlan.verified) {
      return {
        success: false,
        intent: "complete-onboarding",
        error: "Please select a Shopify plan before completing onboarding.",
      };
    }

    await prisma.shop.update({
      where: { id: shopRecord.id },
      data: { isOnboarded: true, plan: verifiedPlan.plan },
    });
    throw redirect("/app");
  }

  if (intent === "select-plan") {
    const verifiedPlan = await refreshVerifiedPlan(admin, shopRecord);
    if (!verifiedPlan.verified) {
      return {
        success: false,
        intent: "select-plan",
        error: "No active Shopify plan was detected yet.",
      };
    }

    return { success: true, intent: "select-plan", plan: verifiedPlan.plan };
  }

  if (intent === "configure-courier") {
    const courierCode = formData.get("courierCode") as string;
    const isEnabled = formData.get("isEnabled") === "true";

    if (courierCode === "leopards") {
      const apiKey = (formData.get("apiKey") as string) || "";
      const apiPassword = (formData.get("apiPassword") as string) || "";
      const defaultShipmentType = (formData.get("defaultShipmentType") as string) || "OVERNIGHT";

      const rawShipmentId = (formData.get("shipment_id") as string).trim();
      const shipment_id =
        rawShipmentId || `SHIP${Math.random().toString(36).substring(2, 10).toUpperCase()}`;
      const shipment_name_eng = (formData.get("shipment_name_eng") as string) || "";
      const shipment_email = (formData.get("shipment_email") as string) || "";
      const shipment_phone = (formData.get("shipment_phone") as string) || "";
      const shipment_address = (formData.get("shipment_address") as string) || "";

      const credentials = { apiKey, apiPassword, defaultShipmentType };
      const shipment_city = (formData.get("shipment_city") as string) || "";
      const default_remarks = (formData.get("default_remarks") as string) || "";
      const default_special_instructions =
        (formData.get("default_special_instructions") as string) || "";
      const rawOriginCityId = (formData.get("lcs_origin_city_id") as string) || "";
      const shipment_origin_city_id = rawOriginCityId ? parseInt(rawOriginCityId) : null;
      const meta_data = {
        shipment_id,
        shipment_name_eng,
        shipment_email,
        shipment_phone,
        shipment_address,
        shipment_city,
        default_remarks,
        default_special_instructions,
        shipment_origin_city_id,
      };

      const verify = await verifyCourier("leopards", credentials);
      if (!verify.success) {
        return { success: false, intent: "configure-courier", courierCode: "leopards", error: verify.error };
      }

      await prisma.shopCourier.upsert({
        where: {
          shopId_courierCode: {
            shopId: shopRecord.id,
            courierCode: "leopards",
          },
        },
        update: { isEnabled, credentials, meta_data, courierName: "Leopards Courier" },
        create: {
          shopId: shopRecord.id,
          courierCode: "leopards",
          courierName: "Leopards Courier",
          isEnabled,
          credentials,
          meta_data,
        },
      });

      return { success: true, intent: "configure-courier", courierCode: "leopards" };
    }

    if (courierCode === "tcs") {
      const username = (formData.get("username") as string) || "";
      const password = (formData.get("password") as string) || "";
      const bearerToken = (formData.get("bearerToken") as string) || "";
      const accountNumber = (formData.get("accountNumber") as string) || "";
      const costCenterCode = (formData.get("costCenterCode") as string) || "";
      const tcsDefaultShipmentType = (formData.get("defaultShipmentType") as string) || "O";

      const tcsShipmentName = (formData.get("tcs_shipment_name_eng") as string) || "";
      const tcsShipmentPhone = (formData.get("tcs_shipment_phone") as string) || "";
      const tcsShipmentAddress = (formData.get("tcs_shipment_address") as string) || "";
      const tcsShipmentEmail = (formData.get("tcs_shipment_email") as string) || "";
      const tcsOriginCityName = (formData.get("tcs_origin_city_name") as string) || "";
      const tcsOriginCityCode = (formData.get("tcs_origin_city_code") as string) || "";
      const tcsOriginCityId = (formData.get("tcs_origin_city_id") as string) || "";

      const credentials = {
        username,
        password,
        bearerToken,
        accountNumber,
        costCenterCode,
        defaultShipmentType: tcsDefaultShipmentType,
      };
      const meta_data = {
        shipment_name_eng: tcsShipmentName,
        shipment_phone: tcsShipmentPhone,
        shipment_address: tcsShipmentAddress,
        shipment_email: tcsShipmentEmail,
        origin_city_name: tcsOriginCityName,
        origin_city_code: tcsOriginCityCode,
        origin_city_id: tcsOriginCityId ? parseInt(tcsOriginCityId) : null,
      };

      const verify = await verifyCourier("tcs", credentials, meta_data);
      if (!verify.success) {
        return { success: false, intent: "configure-courier", courierCode: "tcs", error: verify.error };
      }

      await prisma.shopCourier.upsert({
        where: {
          shopId_courierCode: {
            shopId: shopRecord.id,
            courierCode: "tcs",
          },
        },
        update: { isEnabled, credentials, meta_data, courierName: "TCS Courier" },
        create: {
          shopId: shopRecord.id,
          courierCode: "tcs",
          courierName: "TCS Courier",
          isEnabled,
          credentials,
          meta_data,
        },
      });

      return { success: true, intent: "configure-courier", courierCode: "tcs" };
    }
  }

  return { error: "Unknown intent" };
};

export default function OnboardingPage() {
  const {
    shopDomain,
    pricingUrl,
    currentPlan,
    hasConfiguredCourier,
    configuredCourierCodes,
    tcsCities,
    lcsCities,
  } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  return (
    <OnboardingPicker
      shopDomain={shopDomain}
      pricingUrl={pricingUrl}
      currentPlan={currentPlan}
      hasConfiguredCourier={hasConfiguredCourier}
      configuredCourierCodes={configuredCourierCodes}
      tcsCities={tcsCities}
      lcsCities={lcsCities}
      actionData={actionData}
    />
  );
}
