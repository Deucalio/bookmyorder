import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useLoaderData, useNavigation, useActionData } from "react-router";
import {
  Page,
  Banner,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Button,
  Badge,
  FormLayout,
  TextField,
  Select,
  Divider,
  Box,
  Combobox,
  Listbox,
  AutoSelection,
  DropZone,
  Thumbnail,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { verifyCourier } from "../services/verifyCourier.server";
import { courier_companies } from "../../utils/courierCompanies";

type CourierId = "leopards" | "tcs";

const COURIER_VISUALS: Record<CourierId, { logoBackground: string; logoBorder: string }> = {
  leopards: { logoBackground: "#fff7e8", logoBorder: "#f6b642" },
  tcs: { logoBackground: "#e30613", logoBorder: "#b8000b" },
};

function getCourierMeta(courierId: CourierId) {
  const courier = (courier_companies as any[]).find((c) => c.id === courierId);
  return {
    name: courier?.name ?? courierId,
    logo: courier?.logo ?? "",
    color: courier?.color ?? "#64748b",
  };
}

function CourierLogoMark({ courierId, small = false }: { courierId: CourierId; small?: boolean }) {
  const courier = getCourierMeta(courierId);
  const visual = COURIER_VISUALS[courierId];

  return (
    <div
      className={small ? "bmo-settings-courier-logo small" : "bmo-settings-courier-logo"}
      style={{
        backgroundColor: visual.logoBackground,
        borderColor: visual.logoBorder,
      }}
    >
      <img src={courier.logo} alt={`${courier.name} logo`} />
    </div>
  );
}

function CourierSettingsHeader({
  courierId,
  enabled,
  description,
}: {
  courierId: CourierId;
  enabled: boolean;
  description: string;
}) {
  const courier = getCourierMeta(courierId);

  return (
    <div className="bmo-settings-courier-header" style={{ ["--courier-accent" as any]: courier.color }}>
      <CourierLogoMark courierId={courierId} />
      <div className="bmo-settings-courier-header-copy">
        <Text as="h2" variant="headingLg">{courier.name}</Text>
        <Text as="p" tone="subdued">{description}</Text>
      </div>
      <Badge tone={enabled ? "success" : undefined}>{enabled ? "Active" : "Inactive"}</Badge>
    </div>
  );
}

/* ─── loader ──────────────────────────────────────────────────────── */

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const shopRecord = await prisma.shop.findUnique({
    where: { shopDomain: session.shop },
    select: { id: true, logoUrl: true },
  });

  if (!shopRecord) {
    throw new Response("Shop not found", { status: 404 });
  }

  const couriers = await prisma.shopCourier.findMany({
    where: { shopId: shopRecord.id },
  });

  const leopards = couriers.find((c) => c.courierCode === "leopards") || null;
  const tcs = couriers.find((c) => c.courierCode === "tcs") || null;

  // Fetch cities that have TCS or Leopards courier mappings
  const [rawTcsCities, rawLcsCities] = await Promise.all([
    prisma.$queryRaw<Array<{ id: string; name: string; courierMappings: any }>>`
      SELECT id, name, "courierMappings"
      FROM "City"
      WHERE "courierMappings" -> 'tcs' IS NOT NULL
      ORDER BY name ASC
    `,
    prisma.$queryRaw<Array<{ id: string; name: string; courierMappings: any }>>`
      SELECT id, name, "courierMappings"
      FROM "City"
      WHERE "courierMappings" -> 'leopards' IS NOT NULL
      ORDER BY name ASC
    `,
  ]);

  const tcsCities = rawTcsCities
    .map((c) => {
      const mappings = typeof c.courierMappings === "string"
        ? JSON.parse(c.courierMappings)
        : c.courierMappings;
      const tcs = mappings?.tcs;
      if (!tcs?.cityCode) return null;
      return {
        value: tcs.cityCode as string,
        label: `${tcs.cityName ?? c.name} (${tcs.cityCode})`,
        cityName: (tcs.cityName ?? c.name) as string,
        cityCode: tcs.cityCode as string,
        cityID: (tcs.cityID ?? null) as number | null,
      };
    })
    .filter((c): c is NonNullable<typeof c> => c !== null);

  const lcsCities = rawLcsCities
    .map((c) => {
      const mappings = typeof c.courierMappings === "string"
        ? JSON.parse(c.courierMappings)
        : c.courierMappings;
      const lcs = mappings?.leopards;
      if (lcs?.id == null) return null;
      return {
        value: String(lcs.id),
        label: `${c.name} (${lcs.id})`,
        cityName: c.name as string,
        cityId: lcs.id as number,
      };
    })
    .filter((c): c is NonNullable<typeof c> => c !== null);

  return {
    tcsCities,
    lcsCities,
    logoUrl: shopRecord.logoUrl ?? null,
    leopards: leopards
      ? {
          isEnabled: leopards.isEnabled,
          credentials: (leopards.credentials as Record<string, any>) || {},
          meta_data: (leopards.meta_data as Record<string, any>) || {},
        }
      : {
          isEnabled: false,
          credentials: { apiKey: "", apiPassword: "", defaultShipmentType: "OVERNIGHT" },
          meta_data: { shipment_id: "", shipment_name_eng: "", shipment_email: "", shipment_phone: "", shipment_address: "", shipment_city: "", default_remarks: "", default_special_instructions: "" },
        },
    tcs: tcs
      ? {
          isEnabled: tcs.isEnabled,
          credentials: (tcs.credentials as Record<string, any>) || {},
          meta_data: (tcs.meta_data as Record<string, any>) || {},
        }
      : {
          isEnabled: false,
          credentials: { username: "", password: "", bearerToken: "", accountNumber: "", costCenterCode: "", defaultShipmentType: "O" },
          meta_data: { shipment_name_eng: "", shipment_phone: "", shipment_address: "", shipment_email: "", origin_city_name: "", origin_city_code: "", origin_city_id: "" },
        },
  };
};

/* ─── action ──────────────────────────────────────────────────────── */

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const shopRecord = await prisma.shop.findUnique({
    where: { shopDomain: session.shop },
    select: { id: true },
  });

  if (!shopRecord) {
    throw new Response("Shop not found", { status: 404 });
  }

  const formData = await request.formData();

  // Store logo (General tab) — saved as a base64 data URL in Shop.logoUrl.
  if (formData.get("intent") === "updateLogo") {
    const logoUrl = (formData.get("logoUrl") as string) || "";
    if (logoUrl && !logoUrl.startsWith("data:image/")) {
      return { success: false, section: "general", error: "Please upload a valid image file." };
    }
    if (logoUrl.length > 1_500_000) {
      return { success: false, section: "general", error: "Logo is too large — please use an image under 1 MB." };
    }
    await prisma.shop.update({
      where: { id: shopRecord.id },
      data: { logoUrl: logoUrl || null },
    });
    return { success: true, section: "general" };
  }

  const courierCode = formData.get("courierCode") as string;
  const isEnabled = formData.get("isEnabled") === "true";

  if (courierCode === "leopards") {
    const apiKey = (formData.get("apiKey") as string) || "";
    const apiPassword = (formData.get("apiPassword") as string) || "";
    const defaultShipmentType = (formData.get("defaultShipmentType") as string) || "OVERNIGHT";

    // If the user left shipment_id blank, generate a stable random one for them
    const rawShipmentId = (formData.get("shipment_id") as string).trim();
    const shipment_id = rawShipmentId || `SHIP${Math.random().toString(36).substring(2, 10).toUpperCase()}`;
    const shipment_name_eng = (formData.get("shipment_name_eng") as string) || "";
    const shipment_email = (formData.get("shipment_email") as string) || "";
    const shipment_phone = (formData.get("shipment_phone") as string) || "";
    const shipment_address = (formData.get("shipment_address") as string) || "";

    const credentials = { apiKey, apiPassword, defaultShipmentType };
    const shipment_city          = (formData.get("shipment_city") as string) || "";
    const default_remarks        = (formData.get("default_remarks") as string) || "";
    const default_special_instructions = (formData.get("default_special_instructions") as string) || "";
    const rawOriginCityId        = (formData.get("lcs_origin_city_id") as string) || "";
    const shipment_origin_city_id = rawOriginCityId ? parseInt(rawOriginCityId) : null;
    const meta_data = { shipment_id, shipment_name_eng, shipment_email, shipment_phone, shipment_address, shipment_city, default_remarks, default_special_instructions, shipment_origin_city_id };

    const verify = await verifyCourier("leopards", credentials);
    if (!verify.success) {
      return { success: false, courierCode: "leopards", error: verify.error };
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

    return { success: true, courierCode: "leopards" };
  } else if (courierCode === "tcs") {
    const username = (formData.get("username") as string) || "";
    const password = (formData.get("password") as string) || "";
    const bearerToken = (formData.get("bearerToken") as string) || "";
    const accountNumber = (formData.get("accountNumber") as string) || "";
    const costCenterCode = (formData.get("costCenterCode") as string) || "";
    const tcsDefaultShipmentType = (formData.get("defaultShipmentType") as string) || "O";

    const tcsShipmentName    = (formData.get("tcs_shipment_name_eng") as string) || "";
    const tcsShipmentPhone   = (formData.get("tcs_shipment_phone") as string) || "";
    const tcsShipmentAddress = (formData.get("tcs_shipment_address") as string) || "";
    const tcsShipmentEmail   = (formData.get("tcs_shipment_email") as string) || "";
    const tcsOriginCityName  = (formData.get("tcs_origin_city_name") as string) || "";
    const tcsOriginCityCode  = (formData.get("tcs_origin_city_code") as string) || "";
    const tcsOriginCityId    = (formData.get("tcs_origin_city_id") as string) || "";

    const credentials = { username, password, bearerToken, accountNumber, costCenterCode, defaultShipmentType: tcsDefaultShipmentType };
    const meta_data = {
      shipment_name_eng: tcsShipmentName,
      shipment_phone:    tcsShipmentPhone,
      shipment_address:  tcsShipmentAddress,
      shipment_email:    tcsShipmentEmail,
      origin_city_name:  tcsOriginCityName,
      origin_city_code:  tcsOriginCityCode,
      origin_city_id:    tcsOriginCityId ? parseInt(tcsOriginCityId) : null,
    };

    const verify = await verifyCourier("tcs", credentials, meta_data);
    if (!verify.success) {
      return { success: false, courierCode: "tcs", error: verify.error };
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

    return { success: true, courierCode: "tcs" };
  }

  return { success: false, courierCode: null, error: "Invalid courier code" };
};

/* ─── Component ───────────────────────────────────────────────────── */

export default function SettingsPage() {
  const { leopards, tcs, logoUrl } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  // Action returns a union (courier saves vs. logo save); read loosely.
  const actionData = useActionData<typeof action>() as any;

  const isSaving = navigation.state === "submitting" || navigation.state === "loading";

  /* sidebar tab */
  const [selectedTab, setSelectedTab] = useState("general");

  /* Store logo (General tab) — stored as a base64 data URL in Shop.logoUrl */
  const [logoData, setLogoData] = useState<string | null>(logoUrl);
  const [logoError, setLogoError] = useState<string | null>(null);

  const handleLogoDrop = (_files: File[], accepted: File[]) => {
    const file = accepted[0];
    if (!file) {
      setLogoError("That file type isn't supported. Please upload a PNG or JPG image.");
      return;
    }
    if (file.size > 1024 * 1024) {
      setLogoError("Image is too large — please use a file under 1 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setLogoData(reader.result as string);
      setLogoError(null);
    };
    reader.onerror = () => setLogoError("Failed to read the image. Please try again.");
    reader.readAsDataURL(file);
  };

  /* Leopards controlled state */
  const [leopardsEnabled] = useState(leopards.isEnabled);
  const [leopardsApiKey, setLeopardsApiKey] = useState(leopards.credentials.apiKey || "");
  const [leopardsApiPassword, setLeopardsApiPassword] = useState(leopards.credentials.apiPassword || "");
  const [leopardsShipmentType, setLeopardsShipmentType] = useState(leopards.credentials.defaultShipmentType || "OVERNIGHT");
  const [leopardsShipmentId, setLeopardsShipmentId] = useState(leopards.meta_data.shipment_id || "");
  const [leopardsShipperName, setLeopardsShipperName] = useState(leopards.meta_data.shipment_name_eng || "");
  const [leopardsShipperEmail, setLeopardsShipperEmail] = useState(leopards.meta_data.shipment_email || "");
  const [leopardsShipperPhone, setLeopardsShipperPhone] = useState(leopards.meta_data.shipment_phone || "");
  const [leopardsShipperAddress, setLeopardsShipperAddress] = useState(leopards.meta_data.shipment_address || "");
  const [leopardsShipperCity, setLeopardsShipperCity] = useState((leopards.meta_data as any).shipment_city || "");
  const [leopardsDefaultRemarks, setLeopardsDefaultRemarks] = useState((leopards.meta_data as any).default_remarks || "");
  const [leopardsSpecialInstructions, setLeopardsSpecialInstructions] = useState((leopards.meta_data as any).default_special_instructions || "");

  /* TCS controlled state */
  const [tcsEnabled] = useState(tcs.isEnabled);
  const [tcsUsername, setTcsUsername] = useState(tcs.credentials.username || "");
  const [tcsPassword, setTcsPassword] = useState(tcs.credentials.password || "");
  const [tcsBearerToken, setTcsBearerToken] = useState(tcs.credentials.bearerToken || "");
  const [tcsAccountNumber, setTcsAccountNumber] = useState(tcs.credentials.accountNumber || "");
  const [tcsCostCenterCode, setTcsCostCenterCode] = useState(tcs.credentials.costCenterCode || "");
  const [tcsShipmentType, setTcsShipmentType] = useState(tcs.credentials.defaultShipmentType || "O");
  const [tcsShipperName, setTcsShipperName] = useState((tcs.meta_data as any).shipment_name_eng || "");
  const [tcsShipperPhone, setTcsShipperPhone] = useState((tcs.meta_data as any).shipment_phone || "");
  const [tcsShipperAddress, setTcsShipperAddress] = useState((tcs.meta_data as any).shipment_address || "");
  const [tcsShipperEmail, setTcsShipperEmail] = useState((tcs.meta_data as any).shipment_email || "");

  // TCS city picker state
  const savedOriginCode = (tcs.meta_data as any).origin_city_code || "";
  const { tcsCities, lcsCities } = useLoaderData<typeof loader>();
  const savedTcsCity = tcsCities.find((c) => c.cityCode === savedOriginCode) ?? null;
  const [tcsOriginCity, setTcsOriginCity] = useState<typeof savedTcsCity>(savedTcsCity);
  const [tcsCitySearch, setTcsCitySearch] = useState(savedTcsCity?.label ?? "");

  // LCS city picker state
  const savedLcsOriginCityId = String((leopards.meta_data as any).shipment_origin_city_id ?? "");
  const savedLcsCity = lcsCities.find((c) => c.value === savedLcsOriginCityId) ?? null;
  const [lcsOriginCity, setLcsOriginCity] = useState<typeof savedLcsCity>(savedLcsCity);
  const [lcsCitySearch, setLcsCitySearch] = useState(savedLcsCity?.label ?? "");
  const leopardsConnected = leopardsEnabled || (actionData?.courierCode === "leopards" && actionData.success);
  const tcsConnected = tcsEnabled || (actionData?.courierCode === "tcs" && actionData.success);

  return (
    <Page
      fullWidth
      title="Settings"
      subtitle="Configure courier integrations and app preferences"
    >
      <div className="bmo-settings-shell">
      <Layout>

        {/* ── Left Sidebar Navigation ────────────────────────── */}
        <Layout.Section variant="oneThird">
          <Card>
            <div className="bmo-settings-nav-stack">
              <button
                type="button"
                className={`bmo-settings-nav-card general ${selectedTab === "general" ? "is-active" : ""}`}
                onClick={() => setSelectedTab("general")}
              >
                <span className="bmo-settings-nav-icon">BM</span>
                <span className="bmo-settings-nav-copy">
                  <strong>General</strong>
                  <small>Store logo and app overview</small>
                </span>
                <span className="bmo-settings-nav-arrow">&gt;</span>
              </button>

              {(["leopards", "tcs"] as CourierId[]).map((courierId) => {
                const courier = getCourierMeta(courierId);
                const enabled = courierId === "leopards" ? leopardsConnected : tcsConnected;

                return (
                  <button
                    key={courierId}
                    type="button"
                    className={`bmo-settings-nav-card ${selectedTab === courierId ? "is-active" : ""}`}
                    onClick={() => setSelectedTab(courierId)}
                    style={{ ["--courier-accent" as any]: courier.color }}
                  >
                    <CourierLogoMark courierId={courierId} small />
                    <span className="bmo-settings-nav-copy">
                      <strong>{courier.name}</strong>
                    <small>{enabled ? "Connected and ready" : "Needs credentials"}</small>
                    </span>
                    <Badge tone={enabled ? "success" : undefined}>
                      {enabled ? "Active" : "Off"}
                    </Badge>
                  </button>
                );
              })}
            </div>
          </Card>
        </Layout.Section>

        {/* ── Right Content Area ─────────────────────────────── */}
        <Layout.Section>
          <Card>
            <Box paddingBlockStart="400" paddingBlockEnd="400" paddingInlineStart="400" paddingInlineEnd="400">
              {selectedTab === "general" && (
                <BlockStack gap="500">
                  <div className="bmo-settings-hero">
                    <div className="bmo-settings-hero-logo">
                      {logoData ? (
                        <img src={logoData} alt="Store logo preview" />
                      ) : (
                        <span>BM</span>
                      )}
                    </div>
                    <div className="bmo-settings-hero-copy">
                      <Text as="h2" variant="headingLg">General settings</Text>
                      <Text as="p" tone="subdued">
                        Keep the brand mark for slips in one place and monitor courier readiness before booking orders.
                      </Text>
                    </div>
                    <Badge tone={leopardsConnected || tcsConnected ? "success" : "attention"}>
                      {leopardsConnected || tcsConnected ? "Couriers connected" : "Setup needed"}
                    </Badge>
                  </div>

                  <div className="bmo-settings-status-grid">
                    {(["leopards", "tcs"] as CourierId[]).map((courierId) => {
                      const courier = getCourierMeta(courierId);
                      const enabled = courierId === "leopards" ? leopardsConnected : tcsConnected;
                      return (
                        <div key={courierId} className="bmo-settings-status-card">
                          <CourierLogoMark courierId={courierId} />
                          <div className="bmo-settings-status-copy">
                            <Text as="h3" variant="headingSm">{courier.name}</Text>
                            <Text as="p" tone="subdued" variant="bodySm">
                              {enabled ? "Credentials verified and available for booking." : "Add credentials to enable booking from Orders."}
                            </Text>
                          </div>
                          <div className="bmo-settings-status-action">
                            <Badge tone={enabled ? "success" : undefined}>{enabled ? "Active" : "Inactive"}</Badge>
                            <Button onClick={() => setSelectedTab(courierId)}>
                              {enabled ? "Manage" : "Connect"}
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <Divider />

                  <div className="bmo-settings-logo-panel">
                    <div>
                      <Text as="h3" variant="headingMd">Store logo</Text>
                      <Text as="p" tone="subdued" variant="bodySm">
                        Printed on the top-left of every shipping slip. Use a PNG or JPG under 1 MB. A transparent PNG works best.
                      </Text>
                    </div>

                    {actionData?.section === "general" && actionData.success && (
                      <Banner tone="success" title="Store logo saved" />
                    )}
                    {actionData?.section === "general" && !actionData.success && (
                      <Banner tone="critical" title="Could not save logo">
                        <p>{actionData.error}</p>
                      </Banner>
                    )}
                    {logoError && (
                      <Banner tone="critical">
                        <p>{logoError}</p>
                      </Banner>
                    )}

                    <div className="bmo-settings-logo-grid">
                      <div className="bmo-settings-logo-preview">
                        {logoData ? (
                          <Thumbnail source={logoData} alt="Store logo" size="large" />
                        ) : (
                          <span>No logo uploaded</span>
                        )}
                      </div>
                      <div className="bmo-settings-logo-drop">
                        <DropZone accept="image/*" type="image" allowMultiple={false} onDrop={handleLogoDrop}>
                          <DropZone.FileUpload actionTitle="Add logo" actionHint="or drop an image here" />
                        </DropZone>
                      </div>
                    </div>

                    <Form method="post">
                      <input type="hidden" name="intent" value="updateLogo" />
                      <input type="hidden" name="logoUrl" value={logoData ?? ""} />
                      <InlineStack gap="200">
                        <Button variant="primary" submit loading={isSaving} disabled={logoData === logoUrl}>
                          Save logo
                        </Button>
                        {logoData && (
                          <Button tone="critical" variant="tertiary" onClick={() => setLogoData(null)}>
                            Remove
                          </Button>
                        )}
                      </InlineStack>
                    </Form>
                  </div>
                </BlockStack>
              )}

              {false && selectedTab === "general" && (
                <BlockStack gap="400">
                  <BlockStack gap="200">
                    <Text as="h2" variant="headingMd">General Dashboard</Text>
                    <Text as="p" tone="subdued">
                      Overview of your configured couriers and app settings.
                    </Text>
                  </BlockStack>
                  
                  <Divider />
                  
                  <BlockStack gap="300">
                    <Text as="h3" variant="headingSm">Courier Integrations Status</Text>
                    
                    <InlineStack align="space-between" blockAlign="center">
                      <Text as="p" fontWeight="bold">Leopards Courier</Text>
                      <Badge tone={leopardsEnabled ? "success" : undefined}>
                        {leopardsEnabled ? "Active" : "Inactive"}
                      </Badge>
                    </InlineStack>

                    <InlineStack align="space-between" blockAlign="center">
                      <Text as="p" fontWeight="bold">TCS Courier</Text>
                      <Badge tone={tcsEnabled ? "success" : undefined}>
                        {tcsEnabled ? "Active" : "Inactive"}
                      </Badge>
                    </InlineStack>
                  </BlockStack>

                  <Divider />

                  {/* ── Store Logo ─────────────────── */}
                  <BlockStack gap="300">
                    <BlockStack gap="050">
                      <Text as="h3" variant="headingSm">Store Logo</Text>
                      <Text as="p" tone="subdued" variant="bodySm">
                        Printed on the top-left of every shipping slip. Use a PNG or JPG under 1 MB — a transparent PNG works best.
                      </Text>
                    </BlockStack>

                    {actionData?.section === "general" && actionData.success && (
                      <Banner tone="success" title="Store logo saved" />
                    )}
                    {actionData?.section === "general" && !actionData.success && (
                      <Banner tone="critical" title="Could not save logo">
                        <p>{actionData.error}</p>
                      </Banner>
                    )}
                    {logoError && (
                      <Banner tone="critical">
                        <p>{logoError}</p>
                      </Banner>
                    )}

                    <InlineStack gap="400" blockAlign="center">
                      {logoData ? (
                        <Thumbnail source={logoData ?? ""} alt="Store logo" size="large" />
                      ) : (
                        <Text as="p" tone="subdued" variant="bodySm">No logo uploaded yet.</Text>
                      )}
                      <Box width="280px">
                        <DropZone accept="image/*" type="image" allowMultiple={false} onDrop={handleLogoDrop}>
                          <DropZone.FileUpload actionTitle="Add logo" actionHint="or drop an image here" />
                        </DropZone>
                      </Box>
                    </InlineStack>

                    <Form method="post">
                      <input type="hidden" name="intent" value="updateLogo" />
                      <input type="hidden" name="logoUrl" value={logoData ?? ""} />
                      <InlineStack gap="200">
                        <Button variant="primary" submit loading={isSaving} disabled={logoData === logoUrl}>
                          Save logo
                        </Button>
                        {logoData && (
                          <Button tone="critical" variant="tertiary" onClick={() => setLogoData(null)}>
                            Remove
                          </Button>
                        )}
                      </InlineStack>
                    </Form>
                  </BlockStack>

                  <Divider />

                  <BlockStack gap="300">
                    <InlineStack align="space-between" blockAlign="center">
                      <BlockStack gap="050">
                        <Text as="h3" variant="headingSm">
                          App Version
                        </Text>
                        <Text as="p" tone="subdued" variant="bodySm">
                          Current release information
                        </Text>
                      </BlockStack>
                      <Badge>v1.0.0</Badge>
                    </InlineStack>
                  </BlockStack>
                </BlockStack>
              )}

              {selectedTab === "leopards" && (
                <LeopardsForm
                  enabled={leopardsConnected}
                  apiKey={leopardsApiKey}
                  setApiKey={setLeopardsApiKey}
                  apiPassword={leopardsApiPassword}
                  setApiPassword={setLeopardsApiPassword}
                  shipmentType={leopardsShipmentType}
                  setShipmentType={setLeopardsShipmentType}
                  shipmentId={leopardsShipmentId}
                  setShipmentId={setLeopardsShipmentId}
                  shipperName={leopardsShipperName}
                  setShipperName={setLeopardsShipperName}
                  shipperEmail={leopardsShipperEmail}
                  setShipperEmail={setLeopardsShipperEmail}
                  shipperPhone={leopardsShipperPhone}
                  setShipperPhone={setLeopardsShipperPhone}
                  shipperAddress={leopardsShipperAddress}
                  setShipperAddress={setLeopardsShipperAddress}
                  shipperCity={leopardsShipperCity}
                  setShipperCity={setLeopardsShipperCity}
                  defaultRemarks={leopardsDefaultRemarks}
                  setDefaultRemarks={setLeopardsDefaultRemarks}
                  specialInstructions={leopardsSpecialInstructions}
                  setSpecialInstructions={setLeopardsSpecialInstructions}
                  originCity={lcsOriginCity}
                  setOriginCity={setLcsOriginCity}
                  citySearch={lcsCitySearch}
                  setCitySearch={setLcsCitySearch}
                  cityOptions={lcsCities}
                  isSaving={isSaving}
                  serverError={actionData?.courierCode === "leopards" && !actionData.success ? actionData.error : undefined}
                  serverSuccess={actionData?.courierCode === "leopards" && actionData.success ? true : undefined}
                />
              )}

              {selectedTab === "tcs" && (
                <TcsForm
                  enabled={tcsConnected}
                  username={tcsUsername}
                  setUsername={setTcsUsername}
                  password={tcsPassword}
                  setPassword={setTcsPassword}
                  bearerToken={tcsBearerToken}
                  setBearerToken={setTcsBearerToken}
                  accountNumber={tcsAccountNumber}
                  setAccountNumber={setTcsAccountNumber}
                  costCenterCode={tcsCostCenterCode}
                  setCostCenterCode={setTcsCostCenterCode}
                  shipmentType={tcsShipmentType}
                  setShipmentType={setTcsShipmentType}
                  shipperName={tcsShipperName}
                  setShipperName={setTcsShipperName}
                  shipperPhone={tcsShipperPhone}
                  setShipperPhone={setTcsShipperPhone}
                  shipperAddress={tcsShipperAddress}
                  setShipperAddress={setTcsShipperAddress}
                  shipperEmail={tcsShipperEmail}
                  setShipperEmail={setTcsShipperEmail}
                  originCity={tcsOriginCity}
                  setOriginCity={setTcsOriginCity}
                  citySearch={tcsCitySearch}
                  setCitySearch={setTcsCitySearch}
                  cityOptions={tcsCities}
                  isSaving={isSaving}
                  serverError={actionData?.courierCode === "tcs" && !actionData.success ? actionData.error : undefined}
                  serverSuccess={actionData?.courierCode === "tcs" && actionData.success ? true : undefined}
                />
              )}
            </Box>
          </Card>
        </Layout.Section>
      </Layout>
      </div>
    </Page>
  );
}

/* ─── Leopards Form ───────────────────────────────────────────────── */

type LcsCityOption = {
  value: string;
  label: string;
  cityName: string;
  cityId: number;
};

function LeopardsForm({
  enabled,
  apiKey, setApiKey,
  apiPassword, setApiPassword,
  shipmentType, setShipmentType,
  shipmentId, setShipmentId,
  shipperName, setShipperName,
  shipperEmail, setShipperEmail,
  shipperPhone, setShipperPhone,
  shipperAddress, setShipperAddress,
  shipperCity, setShipperCity,
  defaultRemarks, setDefaultRemarks,
  specialInstructions, setSpecialInstructions,
  originCity, setOriginCity,
  citySearch, setCitySearch,
  cityOptions,
  isSaving,
  serverError,
  serverSuccess,
}: {
  enabled: boolean;
  apiKey: string; setApiKey: (v: string) => void;
  apiPassword: string; setApiPassword: (v: string) => void;
  shipmentType: string; setShipmentType: (v: string) => void;
  shipmentId: string; setShipmentId: (v: string) => void;
  shipperName: string; setShipperName: (v: string) => void;
  shipperEmail: string; setShipperEmail: (v: string) => void;
  shipperPhone: string; setShipperPhone: (v: string) => void;
  shipperAddress: string; setShipperAddress: (v: string) => void;
  shipperCity: string; setShipperCity: (v: string) => void;
  defaultRemarks: string; setDefaultRemarks: (v: string) => void;
  specialInstructions: string; setSpecialInstructions: (v: string) => void;
  originCity: LcsCityOption | null;
  setOriginCity: (v: LcsCityOption | null) => void;
  citySearch: string;
  setCitySearch: (v: string) => void;
  cityOptions: LcsCityOption[];
  isSaving: boolean;
  serverError?: string;
  serverSuccess?: boolean;
}) {
  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    const newErrors: Record<string, string> = {};
    if (!apiKey.trim())       newErrors.apiKey = "API Key is required";
    if (!apiPassword.trim())  newErrors.apiPassword = "API Password is required";
    if (!shipperName.trim())  newErrors.shipperName = "Shipper name is required";
    if (!shipperPhone.trim()) newErrors.shipperPhone = "Shipper phone is required";
    if (!shipperAddress.trim()) newErrors.shipperAddress = "Pickup address is required";
    if (!specialInstructions.trim()) newErrors.specialInstructions = "Special instructions are required";
    if (!originCity)            newErrors.originCity = "Origin city is required";

    if (Object.keys(newErrors).length > 0) {
      e.preventDefault();
      setErrors(newErrors);
      return;
    }
    setErrors({});
  };

  const clearError = (field: string) => {
    if (errors[field]) setErrors((prev) => { const next = { ...prev }; delete next[field]; return next; });
  };

  const filteredLcsCities = citySearch.trim()
    ? cityOptions.filter((c) => c.label.toLowerCase().includes(citySearch.toLowerCase()))
    : cityOptions;

  const handleCitySelect = (value: string) => {
    const city = cityOptions.find((c) => c.value === value) ?? null;
    setOriginCity(city);
    setCitySearch(city?.label ?? "");
    if (city && errors.originCity) clearError("originCity");
  };

  const handleCitySearchChange = (value: string) => {
    setCitySearch(value);
    if (originCity && value !== originCity.label) setOriginCity(null);
  };

  return (
    <Form method="post" onSubmit={handleSubmit} className="bmo-settings-form">
      <input type="hidden" name="courierCode" value="leopards" />
      <input type="hidden" name="isEnabled" value="true" />
      <input type="hidden" name="lcs_origin_city_id" value={originCity?.cityId ?? ""} />

      <BlockStack gap="500">
        <CourierSettingsHeader
          courierId="leopards"
          enabled={enabled}
          description="Verify API credentials, pickup origin, and default shipment preferences for Leopards bookings."
        />

        {serverError && (
          <Banner tone="critical" title="Credentials verification failed">
            <p>{serverError}</p>
          </Banner>
        )}
        {/* ── Status toggle ───────────────── */}
        <InlineStack align="space-between" blockAlign="center" wrap={false}>
          <BlockStack gap="050">
            <InlineStack gap="200" blockAlign="center">
              <Text as="h3" variant="headingSm">
                Leopards Courier
              </Text>
              {enabled && (
                <Badge tone="success">Active</Badge>
              )}
            </InlineStack>
            <Text as="p" tone="subdued" variant="bodySm">
              Courier for order booking and fulfillment.
            </Text>
          </BlockStack>
        </InlineStack>

        <Divider />

        {/* ── API Credentials ─────────────── */}
        <BlockStack gap="300">
          <Text as="h3" variant="headingSm">
            API Credentials
          </Text>
          <FormLayout>
            <FormLayout.Group>
              <TextField
                label="API Key"
                name="apiKey"
                value={apiKey}
                onChange={(v) => { setApiKey(v); clearError("apiKey"); }}
                type="password"
                autoComplete="off"
                placeholder="Enter your Leopards API key"
                requiredIndicator
                error={errors.apiKey}
              />
              <TextField
                label="API Password"
                name="apiPassword"
                value={apiPassword}
                onChange={(v) => { setApiPassword(v); clearError("apiPassword"); }}
                type="password"
                autoComplete="off"
                placeholder="Enter your API password"
                requiredIndicator
                error={errors.apiPassword}
              />
            </FormLayout.Group>
            {/* Hidden input guarantees the value submits via FormData even if
                Polaris Select's `name` prop doesn't propagate to a serialisable
                element. The Select below stays the UI control. */}
            <input type="hidden" name="defaultShipmentType" value={shipmentType} />
            <Select
              label="Default Shipment Type"
              options={[
                { label: "Overnight (Default)", value: "OVERNIGHT" },
                { label: "Detain", value: "DETAIN" },
                { label: "Overland", value: "OVERLAND" },
              ]}
              value={shipmentType}
              onChange={setShipmentType}
              helpText="Used on the booking page whenever you haven't picked a per-order service. The order's city must allow this service — if not, we pick the city's first available."
            />
          </FormLayout>
        </BlockStack>

        <Divider />

        {/* ── Shipper Details (meta_data) ─── */}
        <BlockStack gap="300">
          <BlockStack gap="050">
            <Text as="h3" variant="headingSm">
              Shipper / Pickup Details
            </Text>
            <Text as="p" tone="subdued" variant="bodySm">
              These details are sent to Leopards as the pickup origin for every shipment.
            </Text>
          </BlockStack>
          <FormLayout>
            <FormLayout.Group>
              <TextField
                label="Shipper ID"
                name="shipment_id"
                value={shipmentId}
                onChange={setShipmentId}
                autoComplete="off"
                placeholder="e.g. 12345"
                helpText="Optional — a unique ID will be auto-generated if left blank."
              />
              <TextField
                label="Shipper Name"
                name="shipment_name_eng"
                value={shipperName}
                onChange={(v) => { setShipperName(v); clearError("shipperName"); }}
                autoComplete="off"
                placeholder="e.g. My Store"
                requiredIndicator
                error={errors.shipperName}
              />
            </FormLayout.Group>
            <FormLayout.Group>
              <TextField
                label="Email"
                name="shipment_email"
                value={shipperEmail}
                onChange={setShipperEmail}
                type="email"
                autoComplete="off"
                placeholder="e.g. shipping@mystore.com"
              />
              <TextField
                label="Phone"
                name="shipment_phone"
                value={shipperPhone}
                onChange={(v) => { setShipperPhone(v); clearError("shipperPhone"); }}
                type="tel"
                autoComplete="off"
                placeholder="e.g. 0300-1234567"
                requiredIndicator
                error={errors.shipperPhone}
              />
            </FormLayout.Group>
            <TextField
              label="Pickup Address"
              name="shipment_address"
              value={shipperAddress}
              onChange={(v) => { setShipperAddress(v); clearError("shipperAddress"); }}
              multiline={3}
              autoComplete="off"
              placeholder="Full pickup address for Leopards rider"
              requiredIndicator
              error={errors.shipperAddress}
            />
            <FormLayout.Group>
              <TextField
                label="Shipper City"
                name="shipment_city"
                value={shipperCity}
                onChange={setShipperCity}
                autoComplete="off"
                placeholder="e.g. Karachi"
                helpText="Displayed on shipping slips as the origin city."
              />
              <TextField
                label="Default Remarks"
                name="default_remarks"
                value={defaultRemarks}
                onChange={setDefaultRemarks}
                autoComplete="off"
                placeholder="e.g. Handle with care"
                helpText="Printed in the Remarks field on every shipping slip."
              />
            </FormLayout.Group>
            <TextField
              label="Default Special Instructions"
              name="default_special_instructions"
              value={specialInstructions}
              onChange={(v) => { setSpecialInstructions(v); clearError("specialInstructions"); }}
              multiline={2}
              autoComplete="off"
              placeholder="e.g. Call customer before delivery"
              requiredIndicator
              error={errors.specialInstructions}
              helpText="Sent to Leopards with every booking (required by their API). Per-order instructions, when provided, take priority."
            />
          </FormLayout>
        </BlockStack>

        <Divider />

        {/* ── Origin City ─────────────────── */}
        <BlockStack gap="300">
          <BlockStack gap="050">
            <Text as="h3" variant="headingSm">Origin City</Text>
            <Text as="p" tone="subdued" variant="bodySm">
              Your pickup / dispatch city. Used in Leopards QR codes and booking payloads.
            </Text>
          </BlockStack>
          <Combobox
            activator={
              <Combobox.TextField
                label="Select origin city"
                value={citySearch}
                onChange={handleCitySearchChange}
                autoComplete="off"
                placeholder="Search by city name or ID…"
                requiredIndicator
                error={errors.originCity}
              />
            }
          >
            {filteredLcsCities.length > 0 ? (
              <Listbox onSelect={handleCitySelect} autoSelection={AutoSelection.None}>
                {filteredLcsCities.map((city) => (
                  <Listbox.Option
                    key={city.value}
                    value={city.value}
                    selected={originCity?.value === city.value}
                    accessibilityLabel={city.label}
                  >
                    {city.label}
                  </Listbox.Option>
                ))}
              </Listbox>
            ) : (
              <Listbox onSelect={() => {}} autoSelection={AutoSelection.None}>
                <Listbox.Option value="" disabled accessibilityLabel="No cities found">
                  No cities found
                </Listbox.Option>
              </Listbox>
            )}
          </Combobox>
          {originCity && (
            <Text as="p" tone="subdued" variant="bodySm">
              Selected: {originCity.cityName} · ID: {originCity.cityId}
            </Text>
          )}
        </BlockStack>

        <Divider />

        {/* ── Save ────────────────────────── */}
        <InlineStack align="end">
          <Button variant="primary" submit loading={isSaving}>
            Save &amp; Verify Leopards Settings
          </Button>
        </InlineStack>
        {serverSuccess && (
          <div className="bmo-settings-save-success">
            <Badge tone="success">Connected</Badge>
            <div>
              <strong>Leopards Courier is active.</strong>
              <span>Credentials were verified and saved successfully.</span>
            </div>
          </div>
        )}
      </BlockStack>
    </Form>
  );
}

/* ─── TCS Form ────────────────────────────────────────────────────── */

type TcsCityOption = {
  value: string;
  label: string;
  cityName: string;
  cityCode: string;
  cityID: number | null;
};

function TcsForm({
  enabled,
  username, setUsername,
  password, setPassword,
  bearerToken, setBearerToken,
  accountNumber, setAccountNumber,
  costCenterCode, setCostCenterCode,
  shipmentType, setShipmentType,
  shipperName, setShipperName,
  shipperPhone, setShipperPhone,
  shipperAddress, setShipperAddress,
  shipperEmail, setShipperEmail,
  originCity, setOriginCity,
  citySearch, setCitySearch,
  cityOptions,
  isSaving,
  serverError,
  serverSuccess,
}: {
  enabled: boolean;
  username: string; setUsername: (v: string) => void;
  password: string; setPassword: (v: string) => void;
  bearerToken: string; setBearerToken: (v: string) => void;
  accountNumber: string; setAccountNumber: (v: string) => void;
  costCenterCode: string; setCostCenterCode: (v: string) => void;
  shipmentType: string; setShipmentType: (v: string) => void;
  shipperName: string; setShipperName: (v: string) => void;
  shipperPhone: string; setShipperPhone: (v: string) => void;
  shipperAddress: string; setShipperAddress: (v: string) => void;
  shipperEmail: string; setShipperEmail: (v: string) => void;
  originCity: TcsCityOption | null;
  setOriginCity: (v: TcsCityOption | null) => void;
  citySearch: string;
  setCitySearch: (v: string) => void;
  cityOptions: TcsCityOption[];
  isSaving: boolean;
  serverError?: string;
  serverSuccess?: boolean;
}) {
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Filtered city list based on the search text
  const filteredCities = citySearch.trim()
    ? cityOptions.filter((c) =>
        c.label.toLowerCase().includes(citySearch.toLowerCase())
      )
    : cityOptions;

  const handleCitySelect = (value: string) => {
    const city = cityOptions.find((c) => c.value === value) ?? null;
    setOriginCity(city);
    setCitySearch(city?.label ?? "");
    if (city && errors.originCity) {
      setErrors((prev) => { const next = { ...prev }; delete next.originCity; return next; });
    }
  };

  const handleCitySearchChange = (value: string) => {
    setCitySearch(value);
    // Clear selection if user is typing something different
    if (originCity && value !== originCity.label) setOriginCity(null);
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    const newErrors: Record<string, string> = {};
    if (!username.trim())        newErrors.username = "Username is required";
    if (!password.trim())        newErrors.password = "Password is required";
    if (!bearerToken.trim())     newErrors.bearerToken = "Bearer Token is required";
    if (!accountNumber.trim())   newErrors.accountNumber = "Account Number is required";
    if (!costCenterCode.trim())  newErrors.costCenterCode = "Cost Center Code is required";
    if (!shipperName.trim())     newErrors.shipperName = "Shipper name is required";
    if (!shipperPhone.trim())    newErrors.shipperPhone = "Shipper phone is required";
    if (!shipperAddress.trim())  newErrors.shipperAddress = "Pickup address is required";
    if (!originCity)             newErrors.originCity = "Origin city is required";

    if (Object.keys(newErrors).length > 0) {
      e.preventDefault();
      setErrors(newErrors);
      return;
    }
    setErrors({});
  };

  const clearError = (field: string) => {
    if (errors[field]) setErrors((prev) => { const next = { ...prev }; delete next[field]; return next; });
  };

  return (
    <Form method="post" onSubmit={handleSubmit} className="bmo-settings-form">
      <input type="hidden" name="courierCode" value="tcs" />
      <input type="hidden" name="isEnabled" value="true" />
      {/* Hidden inputs carry the selected city values to the action */}
      <input type="hidden" name="tcs_origin_city_name" value={originCity?.cityName ?? ""} />
      <input type="hidden" name="tcs_origin_city_code" value={originCity?.cityCode ?? ""} />
      <input type="hidden" name="tcs_origin_city_id"   value={String(originCity?.cityID ?? "")} />

      <BlockStack gap="500">
        <CourierSettingsHeader
          courierId="tcs"
          enabled={enabled}
          description="Manage TCS portal credentials, account details, and origin city data used on slips and bookings."
        />

        {serverError && (
          <Banner tone="critical" title="Credentials verification failed">
            <p>{serverError}</p>
          </Banner>
        )}
        {/* ── Status ─────────────────────── */}
        <InlineStack align="space-between" blockAlign="center" wrap={false}>
          <BlockStack gap="050">
            <InlineStack gap="200" blockAlign="center">
              <Text as="h3" variant="headingSm">TCS Courier</Text>
              {enabled && <Badge tone="success">Active</Badge>}
            </InlineStack>
            <Text as="p" tone="subdued" variant="bodySm">
              Courier for order booking and fulfillment.
            </Text>
          </BlockStack>
        </InlineStack>

        <Divider />

        {/* ── Login Credentials ───────────── */}
        <BlockStack gap="300">
          <Text as="h3" variant="headingSm">Login Credentials</Text>
          <FormLayout>
            <FormLayout.Group>
              <TextField
                label="Username"
                name="username"
                value={username}
                onChange={(v) => { setUsername(v); clearError("username"); }}
                autoComplete="off"
                placeholder="Enter your TCS username"
                requiredIndicator
                error={errors.username}
              />
              <TextField
                label="Password"
                name="password"
                value={password}
                onChange={(v) => { setPassword(v); clearError("password"); }}
                type="password"
                autoComplete="off"
                requiredIndicator
                error={errors.password}
              />
            </FormLayout.Group>
            <TextField
              label="Bearer Token"
              name="bearerToken"
              value={bearerToken}
              onChange={(v) => { setBearerToken(v); clearError("bearerToken"); }}
              autoComplete="off"
              helpText={'Log in to the envio.tcscourier portal → click your profile icon (top-right) → select "Get Bearer Token".'}
              placeholder="Paste your bearer token here"
              requiredIndicator
              error={errors.bearerToken}
            />
          </FormLayout>
        </BlockStack>

        <Divider />

        {/* ── Account Details ─────────────── */}
        <BlockStack gap="300">
          <Text as="h3" variant="headingSm">Account Details</Text>
          <FormLayout>
            <FormLayout.Group>
              <TextField
                label="TCS Account Number"
                name="accountNumber"
                value={accountNumber}
                onChange={(v) => { setAccountNumber(v); clearError("accountNumber"); }}
                autoComplete="off"
                placeholder="e.g. 704576"
                requiredIndicator
                error={errors.accountNumber}
              />
              <TextField
                label="Cost Center Code"
                name="costCenterCode"
                value={costCenterCode}
                onChange={(v) => { setCostCenterCode(v); clearError("costCenterCode"); }}
                autoComplete="off"
                placeholder="e.g. 034"
                requiredIndicator
                error={errors.costCenterCode}
                helpText={
                  <>
                    Find your Cost Center Code at{" "}
                    <a href="https://envio.tcscourier.com/Costcenter/Setup" target="_blank" rel="noopener noreferrer">
                      envio.tcscourier.com/Costcenter/Setup
                    </a>
                  </>
                }
              />
            </FormLayout.Group>
            {/* Hidden input guarantees the value submits via FormData even if
                Polaris Select's `name` prop doesn't propagate. */}
            <input type="hidden" name="defaultShipmentType" value={shipmentType} />
            <Select
              label="Default Shipment Type"
              options={[
                { label: "Overnight (Default)", value: "O" },
                { label: "Express", value: "X" },
              ]}
              value={shipmentType}
              onChange={setShipmentType}
              helpText="Used on the booking page whenever you haven't picked a per-order service."
            />
          </FormLayout>
        </BlockStack>

        <Divider />

        {/* ── Shipper / Pickup Details ─────── */}
        <BlockStack gap="300">
          <BlockStack gap="050">
            <Text as="h3" variant="headingSm">Shipper / Pickup Details</Text>
            <Text as="p" tone="subdued" variant="bodySm">
              Appears on TCS shipping slips as the sender. Required for slip generation and barcode accuracy.
            </Text>
          </BlockStack>
          <FormLayout>
            <FormLayout.Group>
              <TextField
                label="Shipper Name"
                name="tcs_shipment_name_eng"
                value={shipperName}
                onChange={(v) => { setShipperName(v); clearError("shipperName"); }}
                autoComplete="off"
                placeholder="e.g. My Store"
                requiredIndicator
                error={errors.shipperName}
              />
              <TextField
                label="Shipper Email"
                name="tcs_shipment_email"
                value={shipperEmail}
                onChange={setShipperEmail}
                type="email"
                autoComplete="off"
                placeholder="e.g. shipping@mystore.com"
              />
            </FormLayout.Group>
            <FormLayout.Group>
              <TextField
                label="Shipper Phone"
                name="tcs_shipment_phone"
                value={shipperPhone}
                onChange={(v) => { setShipperPhone(v); clearError("shipperPhone"); }}
                type="tel"
                autoComplete="off"
                placeholder="e.g. 0300-1234567"
                requiredIndicator
                error={errors.shipperPhone}
              />
            </FormLayout.Group>
            <TextField
              label="Pickup Address"
              name="tcs_shipment_address"
              value={shipperAddress}
              onChange={(v) => { setShipperAddress(v); clearError("shipperAddress"); }}
              multiline={3}
              autoComplete="off"
              placeholder="Full pickup / warehouse address"
              requiredIndicator
              error={errors.shipperAddress}
            />
          </FormLayout>
        </BlockStack>

        <Divider />

        {/* ── Origin City ─────────────────── */}
        <BlockStack gap="300">
          <BlockStack gap="050">
            <Text as="h3" variant="headingSm">Origin City</Text>
            <Text as="p" tone="subdued" variant="bodySm">
              Your pickup city. Used in TCS slip barcodes (ORGN/DSTN) and QR codes.
            </Text>
          </BlockStack>
          <Combobox
            activator={
              <Combobox.TextField
                label="Select origin city"
                value={citySearch}
                onChange={handleCitySearchChange}
                autoComplete="off"
                placeholder="Search by city name or code…"
                requiredIndicator
                error={errors.originCity}
              />
            }
          >
            {filteredCities.length > 0 ? (
              <Listbox onSelect={handleCitySelect} autoSelection={AutoSelection.None}>
                {filteredCities.map((city) => (
                  <Listbox.Option
                    key={city.value}
                    value={city.value}
                    selected={originCity?.value === city.value}
                    accessibilityLabel={city.label}
                  >
                    {city.label}
                  </Listbox.Option>
                ))}
              </Listbox>
            ) : (
              <Listbox onSelect={() => {}} autoSelection={AutoSelection.None}>
                <Listbox.Option value="" disabled accessibilityLabel="No cities found">
                  No cities found
                </Listbox.Option>
              </Listbox>
            )}
          </Combobox>
          {originCity && (
            <Text as="p" tone="subdued" variant="bodySm">
              Selected: {originCity.cityName} · Code: {originCity.cityCode}
              {originCity.cityID ? ` · ID: ${originCity.cityID}` : ""}
            </Text>
          )}
        </BlockStack>

        <Divider />

        {/* ── Save ────────────────────────── */}
        <InlineStack align="end">
          <Button variant="primary" submit loading={isSaving}>
            Save &amp; Verify TCS Settings
          </Button>
        </InlineStack>
        {serverSuccess && (
          <div className="bmo-settings-save-success">
            <Badge tone="success">Connected</Badge>
            <div>
              <strong>TCS Express is active.</strong>
              <span>Credentials were verified and saved successfully.</span>
            </div>
          </div>
        )}
      </BlockStack>
    </Form>
  );
}
