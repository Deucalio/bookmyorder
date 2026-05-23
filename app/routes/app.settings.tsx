import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useLoaderData, useNavigation } from "react-router";
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
  ActionList,
  FormLayout,
  TextField,
  Select,
  Divider,
  Box,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

/* ─── loader ──────────────────────────────────────────────────────── */

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const shopRecord = await prisma.shop.findUnique({
    where: { shopDomain: session.shop },
    select: { id: true },
  });

  if (!shopRecord) {
    throw new Response("Shop not found", { status: 404 });
  }

  const couriers = await prisma.shopCourier.findMany({
    where: { shopId: shopRecord.id },
  });

  const leopards = couriers.find((c) => c.courierCode === "leopards") || null;
  const tcs = couriers.find((c) => c.courierCode === "tcs") || null;

  return {
    leopards: leopards
      ? {
          isEnabled: leopards.isEnabled,
          credentials: (leopards.credentials as Record<string, any>) || {},
          meta_data: (leopards.meta_data as Record<string, any>) || {},
        }
      : {
          isEnabled: false,
          credentials: { apiKey: "", apiPassword: "", defaultShipmentType: "OVERNIGHT" },
          meta_data: { shipment_id: "", shipment_name_eng: "", shipment_email: "", shipment_phone: "", shipment_address: "" },
        },
    tcs: tcs
      ? {
          isEnabled: tcs.isEnabled,
          credentials: (tcs.credentials as Record<string, any>) || {},
          meta_data: (tcs.meta_data as Record<string, any>) || {},
        }
      : {
          isEnabled: false,
          credentials: { username: "", password: "", bearerToken: "", accountNumber: "", costCenterCode: "" },
          meta_data: {},
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
  const courierCode = formData.get("courierCode") as string;
  const isEnabled = formData.get("isEnabled") === "true";

  if (courierCode === "leopards") {
    const apiKey = (formData.get("apiKey") as string) || "";
    const apiPassword = (formData.get("apiPassword") as string) || "";
    const defaultShipmentType = (formData.get("defaultShipmentType") as string) || "OVERNIGHT";

    const shipment_id = (formData.get("shipment_id") as string) || "";
    const shipment_name_eng = (formData.get("shipment_name_eng") as string) || "";
    const shipment_email = (formData.get("shipment_email") as string) || "";
    const shipment_phone = (formData.get("shipment_phone") as string) || "";
    const shipment_address = (formData.get("shipment_address") as string) || "";

    const credentials = { apiKey, apiPassword, defaultShipmentType };
    const meta_data = { shipment_id, shipment_name_eng, shipment_email, shipment_phone, shipment_address };

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

    const credentials = { username, password, bearerToken, accountNumber, costCenterCode };
    const meta_data = {};

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

  return { success: false, error: "Invalid courier code" };
};

/* ─── Component ───────────────────────────────────────────────────── */

export default function SettingsPage() {
  const { leopards, tcs } = useLoaderData<typeof loader>();
  const navigation = useNavigation();

  const isSaving = navigation.state === "submitting" || navigation.state === "loading";

  /* sidebar tab */
  const [selectedTab, setSelectedTab] = useState("general");

  /* Leopards controlled state */
  const [leopardsEnabled, setLeopardsEnabled] = useState(leopards.isEnabled);
  const [leopardsApiKey, setLeopardsApiKey] = useState(leopards.credentials.apiKey || "");
  const [leopardsApiPassword, setLeopardsApiPassword] = useState(leopards.credentials.apiPassword || "");
  const [leopardsShipmentType, setLeopardsShipmentType] = useState(leopards.credentials.defaultShipmentType || "OVERNIGHT");
  const [leopardsShipmentId, setLeopardsShipmentId] = useState(leopards.meta_data.shipment_id || "");
  const [leopardsShipperName, setLeopardsShipperName] = useState(leopards.meta_data.shipment_name_eng || "");
  const [leopardsShipperEmail, setLeopardsShipperEmail] = useState(leopards.meta_data.shipment_email || "");
  const [leopardsShipperPhone, setLeopardsShipperPhone] = useState(leopards.meta_data.shipment_phone || "");
  const [leopardsShipperAddress, setLeopardsShipperAddress] = useState(leopards.meta_data.shipment_address || "");

  /* TCS controlled state */
  const [tcsEnabled, setTcsEnabled] = useState(tcs.isEnabled);
  const [tcsUsername, setTcsUsername] = useState(tcs.credentials.username || "");
  const [tcsPassword, setTcsPassword] = useState(tcs.credentials.password || "");
  const [tcsBearerToken, setTcsBearerToken] = useState(tcs.credentials.bearerToken || "");
  const [tcsAccountNumber, setTcsAccountNumber] = useState(tcs.credentials.accountNumber || "");
  const [tcsCostCenterCode, setTcsCostCenterCode] = useState(tcs.credentials.costCenterCode || "");

  return (
    <Page
      title="Settings"
      subtitle="Configure courier integrations and app preferences"
    >
      <Layout>

        {/* ── Left Sidebar Navigation ────────────────────────── */}
        <Layout.Section variant="oneThird">
          <Card>
            <ActionList
              actionRole="menuitem"
              sections={[
                {
                  items: [
                    {
                      content: "General",
                      active: selectedTab === "general",
                      onAction: () => setSelectedTab("general"),
                    },
                  ],
                },
                {
                  title: "Courier Section",
                  items: [
                    {
                      content: "Leopards Courier",
                      active: selectedTab === "leopards",
                      onAction: () => setSelectedTab("leopards"),
                      suffix: leopardsEnabled ? <Badge tone="success">Active</Badge> : null,
                    },
                    {
                      content: "TCS Courier",
                      active: selectedTab === "tcs",
                      onAction: () => setSelectedTab("tcs"),
                      suffix: tcsEnabled ? <Badge tone="success">Active</Badge> : null,
                    },
                  ],
                },
              ]}
            />
          </Card>
        </Layout.Section>

        {/* ── Right Content Area ─────────────────────────────── */}
        <Layout.Section>
          <Card>
            <Box paddingBlockStart="400" paddingBlockEnd="400" paddingInlineStart="400" paddingInlineEnd="400">
              {selectedTab === "general" && (
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
                  enabled={leopardsEnabled}
                  setEnabled={setLeopardsEnabled}
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
                  isSaving={isSaving}
                />
              )}

              {selectedTab === "tcs" && (
                <TcsForm
                  enabled={tcsEnabled}
                  setEnabled={setTcsEnabled}
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
                  isSaving={isSaving}
                />
              )}
            </Box>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

/* ─── Leopards Form ───────────────────────────────────────────────── */

function LeopardsForm({
  enabled, setEnabled,
  apiKey, setApiKey,
  apiPassword, setApiPassword,
  shipmentType, setShipmentType,
  shipmentId, setShipmentId,
  shipperName, setShipperName,
  shipperEmail, setShipperEmail,
  shipperPhone, setShipperPhone,
  shipperAddress, setShipperAddress,
  isSaving,
}: {
  enabled: boolean; setEnabled: (v: boolean) => void;
  apiKey: string; setApiKey: (v: string) => void;
  apiPassword: string; setApiPassword: (v: string) => void;
  shipmentType: string; setShipmentType: (v: string) => void;
  shipmentId: string; setShipmentId: (v: string) => void;
  shipperName: string; setShipperName: (v: string) => void;
  shipperEmail: string; setShipperEmail: (v: string) => void;
  shipperPhone: string; setShipperPhone: (v: string) => void;
  shipperAddress: string; setShipperAddress: (v: string) => void;
  isSaving: boolean;
}) {
  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    const newErrors: Record<string, string> = {};
    if (!apiKey.trim()) newErrors.apiKey = "API Key is required";
    if (!apiPassword.trim()) newErrors.apiPassword = "API Password is required";

    if (Object.keys(newErrors).length > 0) {
      e.preventDefault();
      setErrors(newErrors);
      return;
    }
    setErrors({});
  };

  return (
    <Form method="post" onSubmit={handleSubmit}>
      <input type="hidden" name="courierCode" value="leopards" />
      <input type="hidden" name="isEnabled" value="true" />

      <BlockStack gap="500">
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
                onChange={(v) => { setApiKey(v); if (errors.apiKey) setErrors((prev) => { const { apiKey: _, ...rest } = prev; return rest; }); }}
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
                onChange={(v) => { setApiPassword(v); if (errors.apiPassword) setErrors((prev) => { const { apiPassword: _, ...rest } = prev; return rest; }); }}
                type="password"
                autoComplete="off"
                placeholder="Enter your API password"
                requiredIndicator
                error={errors.apiPassword}
              />
            </FormLayout.Group>
            <Select
              label="Default Shipment Type"
              name="defaultShipmentType"
              options={[
                { label: "Overnight (Default)", value: "OVERNIGHT" },
                { label: "Detain", value: "DETAIN" },
                { label: "Overland", value: "OVERLAND" },
              ]}
              value={shipmentType}
              onChange={setShipmentType}
              helpText="This will be pre-selected when booking orders through Leopards."
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
          <Banner tone="info">
            These fields are optional. You can fill them in later or leave them blank.
          </Banner>
          <FormLayout>
            <FormLayout.Group>
              <TextField
                label="Shipper ID"
                name="shipment_id"
                value={shipmentId}
                onChange={setShipmentId}
                autoComplete="off"
                placeholder="e.g. 12345"
              />
              <TextField
                label="Shipper Name"
                name="shipment_name_eng"
                value={shipperName}
                onChange={setShipperName}
                autoComplete="off"
                placeholder="e.g. My Store"
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
                onChange={setShipperPhone}
                type="tel"
                autoComplete="off"
                placeholder="e.g. 0300-1234567"
              />
            </FormLayout.Group>
            <TextField
              label="Pickup Address"
              name="shipment_address"
              value={shipperAddress}
              onChange={setShipperAddress}
              multiline={3}
              autoComplete="off"
              placeholder="Full pickup address for Leopards rider"
            />
          </FormLayout>
        </BlockStack>

        <Divider />

        {/* ── Save ────────────────────────── */}
        <InlineStack align="end">
          <Button variant="primary" submit loading={isSaving}>
            Save Leopards Settings
          </Button>
        </InlineStack>
      </BlockStack>
    </Form>
  );
}

/* ─── TCS Form ────────────────────────────────────────────────────── */

function TcsForm({
  enabled, setEnabled,
  username, setUsername,
  password, setPassword,
  bearerToken, setBearerToken,
  accountNumber, setAccountNumber,
  costCenterCode, setCostCenterCode,
  isSaving,
}: {
  enabled: boolean; setEnabled: (v: boolean) => void;
  username: string; setUsername: (v: string) => void;
  password: string; setPassword: (v: string) => void;
  bearerToken: string; setBearerToken: (v: string) => void;
  accountNumber: string; setAccountNumber: (v: string) => void;
  costCenterCode: string; setCostCenterCode: (v: string) => void;
  isSaving: boolean;
}) {
  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    const newErrors: Record<string, string> = {};
    if (!username.trim()) newErrors.username = "Username is required";
    if (!password.trim()) newErrors.password = "Password is required";
    if (!bearerToken.trim()) newErrors.bearerToken = "Bearer Token is required";
    if (!accountNumber.trim()) newErrors.accountNumber = "Account Number is required";
    if (!costCenterCode.trim()) newErrors.costCenterCode = "CostCenter Code is required";

    if (Object.keys(newErrors).length > 0) {
      e.preventDefault();
      setErrors(newErrors);
      return;
    }
    setErrors({});
  };

  const clearError = (field: string) => {
    if (errors[field]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
  };

  return (
    <Form method="post" onSubmit={handleSubmit}>
      <input type="hidden" name="courierCode" value="tcs" />
      <input type="hidden" name="isEnabled" value="true" />

      <BlockStack gap="500">
        {/* ── Status toggle ───────────────── */}
        <InlineStack align="space-between" blockAlign="center" wrap={false}>
          <BlockStack gap="050">
            <InlineStack gap="200" blockAlign="center">
              <Text as="h3" variant="headingSm">
                TCS Courier
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

        {/* ── Login Credentials ───────────── */}
        <BlockStack gap="300">
          <Text as="h3" variant="headingSm">
            Login Credentials
          </Text>
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
          <Text as="h3" variant="headingSm">
            Account Details
          </Text>
          <FormLayout>
            <FormLayout.Group>
              <TextField
                label="TCS Account Number"
                name="accountNumber"
                value={accountNumber}
                onChange={(v) => { setAccountNumber(v); clearError("accountNumber"); }}
                autoComplete="off"
                placeholder="e.g. 123456789"
                requiredIndicator
                error={errors.accountNumber}
              />
              <TextField
                label="CostCenter Code"
                name="costCenterCode"
                value={costCenterCode}
                onChange={(v) => { setCostCenterCode(v); clearError("costCenterCode"); }}
                autoComplete="off"
                placeholder="e.g. CC001"
                requiredIndicator
                error={errors.costCenterCode}
                helpText={
                  <>
                    Find your CostCenter Code at{" "}
                    <a
                      href="https://envio.tcscourier.com/Costcenter/Setup"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      envio.tcscourier.com/Costcenter/Setup
                    </a>
                  </>
                }
              />
            </FormLayout.Group>
          </FormLayout>
        </BlockStack>

        <Divider />

        {/* ── Save ────────────────────────── */}
        <InlineStack align="end">
          <Button variant="primary" submit loading={isSaving}>
            Save TCS Settings
          </Button>
        </InlineStack>
      </BlockStack>
    </Form>
  );
}
