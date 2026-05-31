import { useEffect, useState } from "react";
import { Form, useNavigation } from "react-router";
import { Banner, Button } from "@shopify/polaris";

type CityOption = {
  value: string;
  label: string;
  cityName: string;
  cityCode?: string;
  cityId?: number;
};

type Props = {
  shopDomain: string;
  pricingUrl?: string | null;
  currentPlan?: string | null;
  hasConfiguredCourier?: boolean;
  configuredCourierCodes?: string[];
  tcsCities?: CityOption[];
  lcsCities?: CityOption[];
  logoUrl?: string | null;
  actionData?: any;
  formAction?: string;
};

const INITIAL_ORDER_BACKFILL_DAYS = 60;

const COURIERS = {
  leopards: {
    name: "Leopards Courier",
    description: "API key, password, pickup city, and shipper details.",
    color: "#FFA500",
    logo: "https://trackmyorder.pk/leopards-logo.png",
    logoBackground: "#FFF7E8",
    logoBorder: "#FDBA4B",
  },
  tcs: {
    name: "TCS Express",
    description: "Username, bearer token, account number, and origin city.",
    color: "#FF0000",
    logo: "https://trackmyorder.pk/TCS.svg",
    logoBackground: "#E30613",
    logoBorder: "#B8000B",
  },
} as const;

export function OnboardingPicker({
  shopDomain: _shopDomain,
  pricingUrl,
  currentPlan,
  hasConfiguredCourier = false,
  configuredCourierCodes = [],
  tcsCities = [],
  lcsCities = [],
  logoUrl = null,
  actionData,
  formAction,
}: Props) {
  const navigation = useNavigation();
  const isSubmitting = navigation.state !== "idle";

  // Determine starting step based on whether a plan is already selected
  const initialStep = !currentPlan ? 1 : hasConfiguredCourier ? 3 : 2;
  const [step, setStep] = useState<number>(initialStep);

  useEffect(() => {
    setStep(!currentPlan ? 1 : hasConfiguredCourier ? 3 : 2);
  }, [currentPlan, hasConfiguredCourier]);

  // Active courier setup state for Step 2
  const [activeCourierSetup, setActiveCourierSetup] = useState<"leopards" | "tcs" | null>(null);

  // Leopards Form States
  const [lcsApiKey, setLcsApiKey] = useState("");
  const [lcsApiPassword, setLcsApiPassword] = useState("");
  const [lcsShipperName, setLcsShipperName] = useState("");
  const [lcsShipperPhone, setLcsShipperPhone] = useState("");
  const [lcsShipperAddress, setLcsShipperAddress] = useState("");
  const [lcsOriginCityId, setLcsOriginCityId] = useState("");

  // TCS Form States
  const [tcsUsername, setTcsUsername] = useState("");
  const [tcsPassword, setTcsPassword] = useState("");
  const [tcsBearerToken, setTcsBearerToken] = useState("");
  const [tcsOriginCityCode, setTcsOriginCityCode] = useState("");
  const [tcsAccountNumber, setTcsAccountNumber] = useState("");
  const [tcsCostCenterCode, setTcsCostCenterCode] = useState("");
  const [tcsShipperName, setTcsShipperName] = useState("");
  const [tcsShipperPhone, setTcsShipperPhone] = useState("");
  const [tcsShipperAddress, setTcsShipperAddress] = useState("");

  // Validation errors
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  // Store logo (Step 2) — held as a base64 data URL, submitted via a hidden input.
  const [logoData, setLogoData] = useState<string | null>(logoUrl);
  const [logoError, setLogoError] = useState<string | null>(null);

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!/^image\/(png|jpe?g)$/.test(file.type)) {
      setLogoError("Please upload a PNG or JPG image.");
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

  // Redirect handling
  const handlePlanSelect = () => {
    if (!pricingUrl || typeof window === "undefined") return;

    // Redirect the top-level parent window to the Shopify Managed Checkout page
    try {
      (window.top ?? window).location.href = pricingUrl;
    } catch {
      window.location.href = pricingUrl;
    }
  };

  const renderCourierCard = (courier: "leopards" | "tcs") => {
    const data = COURIERS[courier];
    const isActive = activeCourierSetup === courier;
    const configured = configuredCourierCodes.includes(courier);
    const settingsId = `${courier}-courier-settings`;

    return (
      <button
        type="button"
        aria-expanded={isActive}
        aria-controls={settingsId}
        onClick={() => {
          setActiveCourierSetup(isActive ? null : courier);
          setFormErrors({});
        }}
        className={`group relative w-full overflow-hidden rounded-xl border bg-white p-5 text-left shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:border-slate-400 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-slate-900/20 ${
          isActive ? "border-slate-900 shadow-md ring-2 ring-slate-900/10" : "border-slate-200"
        }`}
      >
        <span
          className="absolute inset-y-0 left-0 w-1.5"
          style={{ backgroundColor: data.color }}
          aria-hidden="true"
        />
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <div
            className="h-24 w-full shrink-0 rounded-lg border flex items-center justify-center p-4 sm:h-20 sm:w-28"
            style={{
              borderColor: data.logoBorder,
              backgroundColor: data.logoBackground,
            }}
          >
            <img
              src={data.logo}
              alt={`${data.name} logo`}
              className="max-h-14 max-w-full object-contain drop-shadow-sm"
              loading="lazy"
            />
          </div>
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base font-bold text-slate-900">{data.name}</h3>
              {configured && (
                <span className="bg-emerald-100 text-emerald-800 text-[10px] font-bold px-2 py-0.5 rounded-full">
                  Configured
                </span>
              )}
            </div>
            <p className="text-sm text-slate-600 leading-snug">{data.description}</p>
          </div>
          <span
            className={`inline-flex shrink-0 items-center justify-center gap-2 rounded-md border px-3 py-2 text-xs font-bold transition-colors ${
              isActive
                ? "border-slate-900 bg-slate-900 text-white"
                : "border-slate-300 bg-slate-50 text-slate-800 group-hover:border-slate-900 group-hover:bg-white"
            }`}
          >
            {isActive ? "Hide settings" : configured ? "Edit" : "Configure"}
            <svg
              className={`h-3.5 w-3.5 transition-transform ${isActive ? "rotate-180" : ""}`}
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
                clipRule="evenodd"
              />
            </svg>
          </span>
        </div>
      </button>
    );
  };

  const handleCourierSubmit = (e: React.FormEvent<HTMLFormElement>, type: "leopards" | "tcs") => {
    const errors: Record<string, string> = {};
    if (type === "leopards") {
      if (!lcsApiKey) errors.apiKey = "API Key is required";
      if (!lcsApiPassword) errors.apiPassword = "API Password is required";
      if (!lcsShipperName) errors.shipperName = "Shipper Name is required";
      if (!lcsShipperPhone) errors.shipperPhone = "Shipper Phone is required";
      if (!lcsShipperAddress) errors.shipperAddress = "Pickup Address is required";
      if (!lcsOriginCityId) errors.originCity = "Origin City is required";
    } else {
      if (!tcsUsername) errors.username = "Username is required";
      if (!tcsPassword) errors.password = "Password is required";
      if (!tcsBearerToken) errors.bearerToken = "Bearer Token is required";
      if (!tcsAccountNumber) errors.accountNumber = "Account Number is required";
      if (!tcsCostCenterCode) errors.costCenterCode = "Cost Center Code is required";
      if (!tcsShipperName) errors.shipperName = "Shipper Name is required";
      if (!tcsShipperPhone) errors.shipperPhone = "Shipper Phone is required";
      if (!tcsShipperAddress) errors.shipperAddress = "Pickup Address is required";
      if (!tcsOriginCityCode) errors.originCity = "Origin City is required";
    }

    if (Object.keys(errors).length > 0) {
      e.preventDefault();
      setFormErrors(errors);
      return;
    }
    setFormErrors({});
  };

  // Determine progress metrics based on step
  const progressPercent = step === 1 ? 14 : step === 2 ? 50 : 100;
  const progressLabel = `${progressPercent}% Complete`;

  return (
    <div className="min-h-screen bg-slate-50/60 py-12 px-4 sm:px-6 lg:px-8 flex flex-col items-center justify-start space-y-8 relative overflow-hidden font-sans">
      {/* Background decorations */}
      <div className="absolute top-0 left-1/4 w-[500px] h-[500px] bg-indigo-100/40 rounded-full filter blur-3xl -z-10 animate-pulse"></div>
      <div className="absolute bottom-0 right-1/4 w-[500px] h-[500px] bg-fuchsia-100/30 rounded-full filter blur-3xl -z-10 animate-pulse delay-700"></div>

      <div className="max-w-4xl mx-auto w-full space-y-8">
        
        {/* Banner Alert for Env Issues */}
        {!pricingUrl && (
          <Banner tone="warning" title="Setup Required">
            <p>
              Set <code>SHOPIFY_APP_NAME</code> in your environment to your app's handle so plan buttons can deep-link to Shopify's managed checkout.
            </p>
          </Banner>
        )}

        {/* ── TOP SECTION: ONBOARDING TRACKER & PROGRESS ── */}
        <div className="bg-white rounded-2xl border border-slate-200/80 p-8 shadow-sm space-y-6">
          <div className="flex justify-between items-baseline">
            <h2 className="text-xl font-bold text-slate-800">Choose Your Plan</h2>
            <span className="text-sm font-semibold text-slate-500">{progressLabel}</span>
          </div>

          {/* Sleek Custom Progress Bar */}
          <div className="w-full bg-slate-100 h-6 rounded-full overflow-hidden p-0.5 border border-slate-200/50">
            <div
              className="bg-slate-800 h-full rounded-full transition-all duration-500 ease-out"
              style={{ width: `${progressPercent}%` }}
            ></div>
          </div>

          <p className="text-sm text-slate-500 font-medium">Select a plan that fits your business needs.</p>

          {/* Steps Indicator Bar */}
          <div className="flex flex-wrap gap-4 pt-2">
            
            {/* Step 1 */}
            <div className="flex items-center gap-2">
              <span className={`w-7 h-7 flex items-center justify-center rounded-full text-xs font-bold transition-all duration-300 ${
                currentPlan 
                  ? "bg-emerald-500 text-white" 
                  : step === 1 
                  ? "bg-blue-600 text-white shadow-sm" 
                  : "bg-slate-100 text-slate-400"
              }`}>
                {currentPlan ? (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" />
                  </svg>
                ) : "1"}
              </span>
              <span className={`text-sm font-bold transition-all duration-300 ${
                step === 1 ? "text-slate-800" : "text-slate-400"
              }`}>
                Choose Your Plan
              </span>
            </div>

            <div className="w-6 border-t border-slate-200 self-center hidden sm:block"></div>

            {/* Step 2 */}
            <div className="flex items-center gap-2">
              <span className={`w-7 h-7 flex items-center justify-center rounded-full text-xs font-bold transition-all duration-300 ${
                hasConfiguredCourier || step > 2
                  ? "bg-emerald-500 text-white" 
                  : step === 2 
                  ? "bg-blue-600 text-white shadow-sm" 
                  : "bg-slate-100 text-slate-400"
              }`}>
                {hasConfiguredCourier || step > 2 ? (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" />
                  </svg>
                ) : "2"}
              </span>
              <span className={`text-sm font-bold transition-all duration-300 ${
                step === 2 ? "text-slate-800" : "text-slate-400"
              }`}>
                Configure Couriers
              </span>
              <span className="text-[10px] font-medium bg-slate-100 border border-slate-200 text-slate-500 px-1.5 py-0.5 rounded-md">Optional</span>
            </div>

            <div className="w-6 border-t border-slate-200 self-center hidden sm:block"></div>

            {/* Step 3 */}
            <div className="flex items-center gap-2">
              <span className={`w-7 h-7 flex items-center justify-center rounded-full text-xs font-bold transition-all duration-300 ${
                step === 3 
                  ? "bg-blue-600 text-white shadow-sm animate-pulse" 
                  : "bg-slate-100 text-slate-400"
              }`}>
                3
              </span>
              <span className={`text-sm font-bold transition-all duration-300 ${
                step === 3 ? "text-slate-800" : "text-slate-400"
              }`}>
                Setup Complete
              </span>
            </div>

          </div>
        </div>

        {/* ── BOTTOM CONTENT AREA ── */}
        
        {/* STEP 1: CHOOSE PLAN (2 cards side-by-side) */}
        {step === 1 && (
          <div className="space-y-8 animate-fadeIn">
            <div className="space-y-1">
              <h1 className="text-3xl font-black text-slate-900">Choose Your Plan</h1>
              <p className="text-base text-slate-500">Select a plan that fits your business needs to get started with automated delivery tracking.</p>
            </div>

            <div className="grid md:grid-cols-2 gap-8 items-stretch max-w-3xl mx-auto">
              
              {/* Free Plan Card */}
              <div className="bg-white rounded-2xl border border-slate-200/80 p-8 flex flex-col justify-between shadow-sm relative group overflow-hidden">
                <div className="space-y-6">
                  <div>
                    <h3 className="text-xl font-black text-slate-800">Free Plan</h3>
                    <p className="text-3xl font-black text-slate-950 mt-2">$0<span className="text-slate-400 text-sm font-semibold">/month</span></p>
                  </div>

                  <ul className="space-y-3.5 text-sm text-slate-600 font-medium">
                    <li className="flex items-start gap-2.5">
                      <span className="text-slate-800 mt-0.5">•</span>
                      <span>300 new orders per month</span>
                    </li>
                    <li className="flex items-start gap-2.5">
                      <span className="text-slate-800 mt-0.5">•</span>
                      <span>Unlimited updates & cancellations</span>
                    </li>
                    <li className="flex items-start gap-2.5">
                      <span className="text-slate-800 mt-0.5">•</span>
                      <span>All courier integrations (LCS, TCS)</span>
                    </li>
                    <li className="flex items-start gap-2.5">
                      <span className="text-slate-800 mt-0.5">•</span>
                      <span>Custom tabs and filters</span>
                    </li>
                    <li className="flex items-start gap-2.5">
                      <span className="text-slate-800 mt-0.5">•</span>
                      <span>Shipping slips & invoices</span>
                    </li>
                  </ul>
                </div>

                <div className="pt-8">
                  <Button
                    variant="primary"
                    size="large"
                    fullWidth
                    disabled={!pricingUrl || isSubmitting}
                    onClick={handlePlanSelect}
                  >
                    Select Plan
                  </Button>
                </div>
              </div>

              {/* Pro Plan Card */}
              <div className="bg-white rounded-2xl border-2 border-indigo-600 p-8 flex flex-col justify-between shadow-md relative overflow-hidden group">
                <span className="absolute top-4 right-4 bg-emerald-100 text-emerald-800 text-xs font-black px-3 py-1 rounded-full uppercase tracking-wider">
                  Popular
                </span>

                <div className="space-y-6">
                  <div>
                    <h3 className="text-xl font-black text-slate-800">Pro Plan</h3>
                    <p className="text-3xl font-black text-slate-950 mt-2">$10<span className="text-slate-400 text-sm font-semibold">/month</span></p>
                  </div>

                  <ul className="space-y-3.5 text-sm text-slate-600 font-medium">
                    <li className="flex items-start gap-2.5">
                      <span className="text-indigo-600 mt-0.5">•</span>
                      <span><strong>Unlimited</strong> new orders</span>
                    </li>
                    <li className="flex items-start gap-2.5">
                      <span className="text-indigo-600 mt-0.5">•</span>
                      <span>Everything in Free</span>
                    </li>
                    <li className="flex items-start gap-2.5">
                      <span className="text-indigo-600 mt-0.5">•</span>
                      <span>No credit limit sync gates</span>
                    </li>
                    <li className="flex items-start gap-2.5">
                      <span className="text-indigo-600 mt-0.5">•</span>
                      <span>Priority courier sync slots</span>
                    </li>
                    <li className="flex items-start gap-2.5">
                      <span className="text-indigo-600 mt-0.5">•</span>
                      <span>Priority WhatsApp/Email support</span>
                    </li>
                  </ul>
                </div>

                <div className="pt-8">
                  <Button
                    variant="primary"
                    size="large"
                    fullWidth
                    disabled={!pricingUrl || isSubmitting}
                    onClick={handlePlanSelect}
                  >
                    Select Plan
                  </Button>
                </div>
              </div>

            </div>
          </div>
        )}

        {/* STEP 2: CONFIGURE COURIERS */}
        {step === 2 && (
          <div className="space-y-7 animate-fadeIn">
            <div className="flex flex-col gap-4 sm:flex-row sm:justify-between sm:items-start">
              <div className="space-y-1">
                <h1 className="text-2xl font-bold text-slate-950">Configure Courier Integrations</h1>
                <p className="text-sm text-slate-600 max-w-2xl">
                  Link Leopards or TCS credentials now, or skip this step and connect couriers later from Settings.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => setStep(1)}>Back</Button>
                <Button onClick={() => setStep(3)} variant="secondary">
                  Skip for now
                </Button>
              </div>
            </div>

            <div className="rounded-xl border border-blue-200 bg-blue-50 p-5">
              <p className="text-sm font-semibold text-blue-950">Initial order import</p>
              <p className="mt-1 text-sm leading-6 text-blue-900">
                After onboarding, Book My Order will start adding your Shopify orders from the last{" "}
                <strong>{INITIAL_ORDER_BACKFILL_DAYS} days</strong> so your dashboard has recent history ready.
              </p>
            </div>

            {/* Courier Choice Cards */}
            <div className="grid md:grid-cols-2 gap-6">
              {renderCourierCard("leopards")}
              {renderCourierCard("tcs")}
            </div>

            {/* Banner feedback */}
            {actionData && actionData.intent === "configure-courier" && !actionData.success && (
              <Banner tone="critical" title="Verification Failed">
                <p>{actionData.error || "Please check your credentials and shipper details."}</p>
              </Banner>
            )}
            {actionData && actionData.intent === "configure-courier" && actionData.success && (
              <Banner tone="success" title="Courier Configured Successfully!">
                <p>Your credentials were verified. Click Continue below to complete setup.</p>
              </Banner>
            )}

            {/* Leopards Form Panel */}
            {activeCourierSetup === "leopards" && (
              <div id="leopards-courier-settings" className="bg-white rounded-xl border border-slate-200 p-8 shadow-sm animate-fadeIn">
                <div className="mb-6 flex items-center gap-4">
                  <div className="h-16 w-20 rounded-lg border border-orange-200 bg-orange-50 flex items-center justify-center p-2">
                    <img
                      src={COURIERS.leopards.logo}
                      alt="Leopards Courier logo"
                      className="max-h-11 max-w-full object-contain"
                      loading="lazy"
                    />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-slate-900">Leopards Courier Settings</h3>
                    <p className="text-sm text-slate-500">Verify your API credentials before enabling bookings.</p>
                  </div>
                </div>
                
                <Form method="post" action={formAction} onSubmit={(e) => handleCourierSubmit(e, "leopards")} className="space-y-6">
                  <input type="hidden" name="intent" value="configure-courier" />
                  <input type="hidden" name="courierCode" value="leopards" />
                  <input type="hidden" name="isEnabled" value="true" />

                  <div className="grid md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">API Key *</label>
                      <input
                        type="password"
                        name="apiKey"
                        value={lcsApiKey}
                        onChange={(e) => setLcsApiKey(e.target.value)}
                        className="w-full border border-slate-300 rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
                        placeholder="Enter API key"
                      />
                      {formErrors.apiKey && <p className="text-[10px] text-red-500 mt-1 font-semibold">{formErrors.apiKey}</p>}
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">API Password *</label>
                      <input
                        type="password"
                        name="apiPassword"
                        value={lcsApiPassword}
                        onChange={(e) => setLcsApiPassword(e.target.value)}
                        className="w-full border border-slate-300 rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
                        placeholder="Enter API password"
                      />
                      {formErrors.apiPassword && <p className="text-[10px] text-red-500 mt-1 font-semibold">{formErrors.apiPassword}</p>}
                    </div>
                  </div>

                  <div className="grid md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">Origin City *</label>
                      <select
                        name="lcs_origin_city_id"
                        value={lcsOriginCityId}
                        onChange={(e) => setLcsOriginCityId(e.target.value)}
                        className="w-full border border-slate-300 bg-white rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      >
                        <option value="">Select Origin City</option>
                        {lcsCities.map((c) => (
                          <option key={c.value} value={c.value}>{c.label}</option>
                        ))}
                      </select>
                      {formErrors.originCity && <p className="text-[10px] text-red-500 mt-1 font-semibold">{formErrors.originCity}</p>}
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">Shipper Name *</label>
                      <input
                        type="text"
                        name="shipment_name_eng"
                        value={lcsShipperName}
                        onChange={(e) => setLcsShipperName(e.target.value)}
                        className="w-full border border-slate-300 rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
                        placeholder="e.g. My Store Name"
                      />
                      {formErrors.shipperName && <p className="text-[10px] text-red-500 mt-1 font-semibold">{formErrors.shipperName}</p>}
                    </div>
                  </div>

                  <div className="grid md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">Phone Number *</label>
                      <input
                        type="text"
                        name="shipment_phone"
                        value={lcsShipperPhone}
                        onChange={(e) => setLcsShipperPhone(e.target.value)}
                        className="w-full border border-slate-300 rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
                        placeholder="e.g. 0300-1234567"
                      />
                      {formErrors.shipperPhone && <p className="text-[10px] text-red-500 mt-1 font-semibold">{formErrors.shipperPhone}</p>}
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">Backup Email</label>
                      <input
                        type="email"
                        name="shipment_email"
                        className="w-full border border-slate-300 rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
                        placeholder="shipping@store.com"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">Pickup Address *</label>
                    <textarea
                      name="shipment_address"
                      value={lcsShipperAddress}
                      onChange={(e) => setLcsShipperAddress(e.target.value)}
                      className="w-full border border-slate-300 rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500 h-20 resize-none"
                      placeholder="Enter warehouse pickup address..."
                    ></textarea>
                    {formErrors.shipperAddress && <p className="text-[10px] text-red-500 mt-1 font-semibold">{formErrors.shipperAddress}</p>}
                  </div>

                  <Button submit variant="primary" loading={isSubmitting}>
                    Verify and enable Leopards
                  </Button>
                </Form>
              </div>
            )}

            {/* TCS Form Panel */}
            {activeCourierSetup === "tcs" && (
              <div id="tcs-courier-settings" className="bg-white rounded-xl border border-slate-200 p-8 shadow-sm animate-fadeIn">
                <div className="mb-6 flex items-center gap-4">
                  <div className="h-16 w-20 rounded-lg border border-red-200 bg-red-50 flex items-center justify-center p-2">
                    <img
                      src={COURIERS.tcs.logo}
                      alt="TCS Express logo"
                      className="max-h-11 max-w-full object-contain"
                      loading="lazy"
                    />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-slate-900">TCS Courier Settings</h3>
                    <p className="text-sm text-slate-500">Add account details and pickup origin for TCS booking.</p>
                  </div>
                </div>
                
                <Form method="post" action={formAction} onSubmit={(e) => handleCourierSubmit(e, "tcs")} className="space-y-6">
                  <input type="hidden" name="intent" value="configure-courier" />
                  <input type="hidden" name="courierCode" value="tcs" />
                  <input type="hidden" name="isEnabled" value="true" />

                  <div className="grid md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">Username *</label>
                      <input
                        type="text"
                        name="username"
                        value={tcsUsername}
                        onChange={(e) => setTcsUsername(e.target.value)}
                        className="w-full border border-slate-300 rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
                        placeholder="TCS API Username"
                      />
                      {formErrors.username && <p className="text-[10px] text-red-500 mt-1 font-semibold">{formErrors.username}</p>}
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">Password *</label>
                      <input
                        type="password"
                        name="password"
                        value={tcsPassword}
                        onChange={(e) => setTcsPassword(e.target.value)}
                        className="w-full border border-slate-300 rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
                        placeholder="TCS API Password"
                      />
                      {formErrors.password && <p className="text-[10px] text-red-500 mt-1 font-semibold">{formErrors.password}</p>}
                    </div>
                  </div>

                  <div className="grid md:grid-cols-3 gap-4">
                    <div className="md:col-span-2">
                      <label className="block text-xs font-bold text-slate-700 mb-1">Bearer Token *</label>
                      <input
                        type="password"
                        name="bearerToken"
                        value={tcsBearerToken}
                        onChange={(e) => setTcsBearerToken(e.target.value)}
                        className="w-full border border-slate-300 rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
                        placeholder="Bearer token"
                      />
                      {formErrors.bearerToken && <p className="text-[10px] text-red-500 mt-1 font-semibold">{formErrors.bearerToken}</p>}
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">Account Number *</label>
                      <input
                        type="text"
                        name="accountNumber"
                        value={tcsAccountNumber}
                        onChange={(e) => setTcsAccountNumber(e.target.value)}
                        className="w-full border border-slate-300 rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
                        placeholder="e.g. 50920"
                      />
                      {formErrors.accountNumber && <p className="text-[10px] text-red-500 mt-1 font-semibold">{formErrors.accountNumber}</p>}
                    </div>
                  </div>

                  <div className="grid md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">Cost Center Code *</label>
                      <input
                        type="text"
                        name="costCenterCode"
                        value={tcsCostCenterCode}
                        onChange={(e) => setTcsCostCenterCode(e.target.value)}
                        className="w-full border border-slate-300 rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
                        placeholder="e.g. 050"
                      />
                      {formErrors.costCenterCode && <p className="text-[10px] text-red-500 mt-1 font-semibold">{formErrors.costCenterCode}</p>}
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">Origin City *</label>
                      <select
                        name="tcs_origin_city_code"
                        value={tcsOriginCityCode}
                        onChange={(e) => setTcsOriginCityCode(e.target.value)}
                        className="w-full border border-slate-300 bg-white rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      >
                        <option value="">Select Origin City</option>
                        {tcsCities.map((c) => (
                          <option key={c.value} value={c.value}>{c.label}</option>
                        ))}
                      </select>
                      {formErrors.originCity && <p className="text-[10px] text-red-500 mt-1 font-semibold">{formErrors.originCity}</p>}
                    </div>
                  </div>

                  <div className="grid md:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">Shipper Name *</label>
                      <input
                        type="text"
                        name="tcs_shipment_name_eng"
                        value={tcsShipperName}
                        onChange={(e) => setTcsShipperName(e.target.value)}
                        className="w-full border border-slate-300 rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
                        placeholder="Pickup name"
                      />
                      {formErrors.shipperName && <p className="text-[10px] text-red-500 mt-1 font-semibold">{formErrors.shipperName}</p>}
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">Shipper Phone *</label>
                      <input
                        type="text"
                        name="tcs_shipment_phone"
                        value={tcsShipperPhone}
                        onChange={(e) => setTcsShipperPhone(e.target.value)}
                        className="w-full border border-slate-300 rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
                        placeholder="Pickup phone"
                      />
                      {formErrors.shipperPhone && <p className="text-[10px] text-red-500 mt-1 font-semibold">{formErrors.shipperPhone}</p>}
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">Shipper Email</label>
                      <input
                        type="email"
                        name="tcs_shipment_email"
                        className="w-full border border-slate-300 rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
                        placeholder="tcs@mystore.com"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">Pickup Address *</label>
                    <textarea
                      name="tcs_shipment_address"
                      value={tcsShipperAddress}
                      onChange={(e) => setTcsShipperAddress(e.target.value)}
                      className="w-full border border-slate-300 rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500 h-20 resize-none"
                      placeholder="Enter pickup address..."
                    ></textarea>
                    {formErrors.shipperAddress && <p className="text-[10px] text-red-500 mt-1 font-semibold">{formErrors.shipperAddress}</p>}
                  </div>

                  <Button submit variant="primary" loading={isSubmitting}>
                    Verify and enable TCS
                  </Button>
                </Form>
              </div>
            )}

            {/* Store Logo Panel */}
            <div className="bg-white rounded-xl border border-slate-200 p-8 shadow-sm">
              <div className="mb-6 flex items-center gap-4">
                <div className="h-16 w-20 shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-slate-50 flex items-center justify-center p-2 text-sm font-bold text-slate-400">
                  {logoData ? (
                    <img
                      src={logoData}
                      alt="Store logo preview"
                      className="max-h-full max-w-full object-contain"
                    />
                  ) : (
                    <span>BM</span>
                  )}
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-900">Store Logo</h3>
                  <p className="text-sm text-slate-500">
                    Printed on the top-left of every shipping slip. PNG or JPG under 1 MB — a transparent PNG works best.
                  </p>
                </div>
                <span className="ml-auto text-[10px] font-medium bg-slate-100 border border-slate-200 text-slate-500 px-1.5 py-0.5 rounded-md">
                  Optional
                </span>
              </div>

              {logoError && (
                <div className="mb-4">
                  <Banner tone="critical">
                    <p>{logoError}</p>
                  </Banner>
                </div>
              )}
              {actionData && actionData.intent === "update-logo" && actionData.success && (
                <div className="mb-4">
                  <Banner tone="success" title="Store logo saved" />
                </div>
              )}
              {actionData && actionData.intent === "update-logo" && !actionData.success && (
                <div className="mb-4">
                  <Banner tone="critical" title="Could not save logo">
                    <p>{actionData.error}</p>
                  </Banner>
                </div>
              )}

              <Form method="post" action={formAction} className="space-y-4">
                <input type="hidden" name="intent" value="update-logo" />
                <input type="hidden" name="logoUrl" value={logoData ?? ""} />

                <input
                  type="file"
                  accept="image/png,image/jpeg"
                  onChange={handleLogoChange}
                  className="block w-full text-sm text-slate-600 file:mr-4 file:rounded-lg file:border-0 file:bg-slate-900 file:px-4 file:py-2 file:text-sm file:font-bold file:text-white hover:file:bg-slate-800"
                />

                <div className="flex items-center gap-2">
                  <Button submit variant="primary" loading={isSubmitting} disabled={!logoData || logoData === logoUrl}>
                    Save logo
                  </Button>
                  {logoData && (
                    <Button variant="tertiary" tone="critical" onClick={() => setLogoData(null)}>
                      Remove
                    </Button>
                  )}
                </div>
              </Form>
            </div>

            {/* Bottom Continue Button */}
            <div className="flex flex-wrap justify-between gap-3 pt-4 border-t border-slate-200">
              <Button onClick={() => setStep(1)}>Back to plan</Button>
              <Button onClick={() => setStep(3)} variant="primary">
                Continue setup
              </Button>
            </div>
          </div>
        )}

        {/* STEP 3: SETUP COMPLETE */}
        {step === 3 && (
          <div className="bg-white rounded-xl border border-slate-200 p-8 sm:p-10 shadow-sm animate-scaleIn">
            <div className="mb-6">
              <Button onClick={() => setStep(2)}>Back to couriers</Button>
            </div>
            <div className="mx-auto flex max-w-xl flex-col items-center text-center space-y-6">
            <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto text-emerald-600 border-2 border-emerald-200 shadow-inner">
              <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3.5" d="M5 13l4 4L19 7" />
              </svg>
            </div>

            <div className="space-y-2">
              <h1 className="text-2xl font-bold text-slate-950">Setup Complete!</h1>
              <p className="text-sm text-slate-600 leading-6">
                Your Book My Order store is configured and ready. We will import Shopify orders from the last{" "}
                <strong>{INITIAL_ORDER_BACKFILL_DAYS} days</strong> so your dashboard starts with recent order history.
              </p>
            </div>

            <div className="w-full rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-left">
              <p className="text-sm font-semibold text-emerald-950">What happens next</p>
              <p className="mt-1 text-sm leading-6 text-emerald-900">
                The initial sync runs in the background after you enter the dashboard. New orders continue to arrive through webhooks.
              </p>
            </div>

            <div className="pt-2 w-full max-w-sm">
              <Form method="post" action={formAction}>
                <input type="hidden" name="intent" value="complete-onboarding" />
                <Button submit variant="primary" size="large" fullWidth loading={isSubmitting}>
                  Go to dashboard
                </Button>
              </Form>
            </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
