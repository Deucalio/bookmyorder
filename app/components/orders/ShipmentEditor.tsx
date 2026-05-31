import { useEffect, useMemo, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { distance } from "fastest-levenshtein";

import type {
  BookingDraft,
  CityOption,
  CourierSelectOption,
  OrderRow,
} from "./types";
import { getCourierLabel, courierServesCity } from "./orderUi";
import { CityCombobox } from "./CityCombobox";
// Source-of-truth courier list (logos, colors). Plain JS module.
import { courier_companies } from "../../../utils/courierCompanies";


type ShipmentEditorProps = {
  order: OrderRow;
  draft: BookingDraft;
  courierCode: string;
  cities: CityOption[];
  cityId: string;
  areaId: string;
  courierOptions: CourierSelectOption[];
  /** Shop-saved default service per courier code (e.g. { leopards: "OVERNIGHT" }) */
  shopCourierDefaults: Record<string, string>;
  /** Shop-saved default special instructions per courier code (from courier settings). */
  shopCourierInstructions: Record<string, string>;
  validationErrors: string[];
  issues: string[];
  onCourierChange: (orderId: string, courierCode: string) => void;
  onDraftChange: (orderId: string, patch: Partial<BookingDraft>) => void;
  onLocationChange: (orderId: string, cityId: string, areaId: string) => void;
};

const calculateScore = (str1: string, str2: string) => {
  if (!str1 || !str2) return 0;
  const s1 = str1.toLowerCase().trim();
  const s2 = str2.toLowerCase().trim();
  const d = distance(s1, s2);
  const maxLen = Math.max(s1.length, s2.length);
  if (maxLen === 0) return 100;
  return Math.round((1 - d / maxLen) * 100);
};

export function ShipmentEditor({
  order,
  draft,
  courierCode,
  cities,
  cityId,
  areaId,
  courierOptions,
  shopCourierDefaults,
  shopCourierInstructions,
  validationErrors,
  issues = [],
  onCourierChange,
  onDraftChange,
  onLocationChange,
}: ShipmentEditorProps) {
  const areaFetcher = useFetcher<{ areas: CityOption[] }>();
  const saveFetcher = useFetcher<Record<string, unknown>>();
  const weightFetcher = useFetcher<{ success?: boolean; error?: string }>();
  const [areas, setAreas] = useState<CityOption[]>([]);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [weightStatus, setWeightStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const initialCityId = useRef(order.cityId || "");
  const initialAreaId = useRef(order.areaId || "");

  // Once an order is booked or fulfilled, its destination is committed with the
  // courier — there's no value in editing the mapped city / area anymore.
  const locked = order.status === "booked" || order.status === "fulfilled";

  useEffect(() => {
    if (cityId) {
      areaFetcher.load(`/api/areas?cityId=${cityId}`);
    } else {
      setAreas([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cityId]);

  useEffect(() => {
    if (areaFetcher.data?.areas) {
      setAreas(areaFetcher.data.areas);
    }
  }, [areaFetcher.data]);

  useEffect(() => {
    if (locked) return;
    if (cityId === initialCityId.current && areaId === initialAreaId.current) {
      return;
    }

    const timer = setTimeout(() => {
      const formData = new FormData();
      formData.append("intent", "updateAddress");
      formData.append("orderId", order.id);
      formData.append("cityId", cityId);
      formData.append("areaId", areaId);
      saveFetcher.submit(formData, { method: "POST", action: "/app/orders" });
      initialCityId.current = cityId;
      initialAreaId.current = areaId;
    }, 400);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cityId, areaId, order.id, locked]);

  useEffect(() => {
    if (saveFetcher.state === "submitting" || saveFetcher.state === "loading") {
      setSaveStatus("saving");
      return;
    }

    if (saveStatus === "saving") {
      setSaveStatus("saved");
      const timer = setTimeout(() => setSaveStatus("idle"), 1400);
      return () => clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveFetcher.state]);

  const selectedCity = useMemo(
    () => cities.find((city) => city.id === cityId),
    [cities, cityId],
  );

  const cityScore =
    selectedCity && order.rawCity ? calculateScore(order.rawCity, selectedCity.name) : null;
  const isAreaUnchanged = order.areaId && areaId === order.areaId;
  const areaScore =
    isAreaUnchanged && order.areaMatchConfidence != null
      ? Math.round(order.areaMatchConfidence * 100)
      : null;
  const rawAddress = `${order.addressLine1 || ""} ${order.addressLine2 || ""}`.trim();
  const courierLabel = getCourierLabel(courierCode, courierOptions);

  // Courier branding (logo + accent) sourced from the shared courier list.
  const courierMeta = useMemo(
    () => (courier_companies as any[]).find((c) => c.id === courierCode),
    [courierCode],
  );
  const courierLogo = courierMeta?.logo as string | undefined;
  const courierColor = (courierMeta?.color as string | undefined) || "var(--bmo-blue-border)";
  // Some courier marks are light (e.g. the TCS logo is white) and need a tinted
  // backdrop to be visible — mirror the Settings page courier visuals.
  const courierChipBg =
    courierCode === "tcs" ? "#e30613" : courierCode === "leopards" ? "#fff7e8" : "#ffffff";

  const servesCity = courierServesCity(courierCode, selectedCity?.courierMappings ?? null);
  const matchedAreaName =
    areas.find((a) => a.id === areaId)?.name ?? order.area ?? "";

  const updateDraft = (patch: Partial<BookingDraft>) => onDraftChange(order.id, patch);

  // Parcel weight persistence. Saved to our DB (Order.parcelWeight) and the row
  // is revalidated automatically when the fetcher resolves.
  const weightNum = Number(draft.weight);
  const weightValid = draft.weight.trim() !== "" && !Number.isNaN(weightNum) && weightNum > 0;
  const weightDirty = weightValid && weightNum !== (order.parcelWeight ?? NaN);

  const saveWeight = () => {
    if (!weightValid) return;
    const formData = new FormData();
    formData.append("intent", "updateWeight");
    formData.append("orderId", order.id);
    formData.append("weight", draft.weight);
    weightFetcher.submit(formData, { method: "POST", action: "/app/orders" });
  };

  useEffect(() => {
    if (weightFetcher.state === "submitting" || weightFetcher.state === "loading") {
      setWeightStatus("saving");
      return;
    }
    if (weightStatus === "saving") {
      setWeightStatus(weightFetcher.data?.success ? "saved" : "error");
      const timer = setTimeout(() => setWeightStatus("idle"), 1600);
      return () => clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weightFetcher.state]);

  // Special instructions default to whatever the merchant configured for this
  // courier in Settings (the same value the booking flow falls back to), so the
  // field isn't blank and reflects what will actually be sent.
  const courierDefaultInstructions = shopCourierInstructions[courierCode] ?? "";
  useEffect(() => {
    if (!draft.instructions.trim() && courierDefaultInstructions.trim()) {
      updateDraft({ instructions: courierDefaultInstructions });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courierCode, courierDefaultInstructions]);

  // Service level options — courier-specific, sourced from city courierMappings.
  // TCS: hardcoded O/X (no city-level service data).
  // LCS: from courierMappings.leopards.shipment_type, defaults to OVERNIGHT.
  const LCS_SERVICE_LABELS: Record<string, string> = {
    OVERNIGHT: "Overnight",
    DETAIN: "Detain",
    OVERLAND: "Overland",
  };
  const TCS_SERVICE_OPTIONS = [
    { value: "O", label: "Overnight" },
    { value: "X", label: "Express" },
  ];

  const serviceOptions = useMemo((): { value: string; label: string }[] => {
    if (courierCode === "tcs") return TCS_SERVICE_OPTIONS;
    if (courierCode === "leopards") {
      const types = selectedCity?.courierMappings?.["leopards"]?.shipment_type as string[] | undefined;
      if (Array.isArray(types) && types.length > 0) {
        return types.map((t) => ({ value: t, label: LCS_SERVICE_LABELS[t] ?? t.charAt(0) + t.slice(1).toLowerCase() }));
      }
      return [{ value: "OVERNIGHT", label: "Overnight" }];
    }
    return [];
  }, [courierCode, selectedCity]);

  // Reset serviceLevel when courier or city changes and current value is no longer valid.
  useEffect(() => {
    if (serviceOptions.length === 0) return;
    const isValid = serviceOptions.some((o) => o.value === draft.serviceLevel);
    if (!isValid) {
      // Preference order: shop's saved default → OVERNIGHT/O → first available.
      const shopDefault = shopCourierDefaults[courierCode];
      const preferred =
        (shopDefault && serviceOptions.find((o) => o.value === shopDefault)) ||
        serviceOptions.find((o) => o.value === "OVERNIGHT" || o.value === "O") ||
        serviceOptions[0];
      updateDraft({ serviceLevel: preferred.value });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serviceOptions]);

  return (
    <div className="bmo-shipment-editor">
      <div className="bmo-editor-status-bar">
        <div className="bmo-status-title">Order Status Summary:</div>
        <div className="bmo-status-badges">
          {issues.length > 0 ? (
            issues.map((issue) => (
              <span key={issue} className="bmo-editor-badge bmo-badge-issue">
                <span className="bmo-badge-dot">●</span> {issue}
              </span>
            ))
          ) : (
            <span className="bmo-editor-badge bmo-badge-ready">
              <span className="bmo-badge-dot">●</span> Ready
            </span>
          )}
        </div>
      </div>

      <div className="bmo-editor-grid">
        <section className="bmo-editor-section">
          <div className="bmo-section-heading">
            <h3>Courier assignment</h3>
            {saveStatus === "saving" && <span>Saving location…</span>}
            {saveStatus === "saved" && <span>Location saved</span>}
          </div>
          <div className="bmo-courier-assign">
            <div
              className="bmo-courier-logo-chip"
              style={{ borderColor: courierColor, background: courierChipBg }}
            >
              {courierLogo ? (
                <img src={courierLogo} alt={`${courierLabel} logo`} loading="lazy" />
              ) : (
                <span>{(courierLabel || "?").slice(0, 2).toUpperCase()}</span>
              )}
            </div>
            <div className="bmo-field-grid two bmo-courier-assign-fields">
              <label className="bmo-field">
                <span>Courier</span>
                <select
                  value={courierCode}
                  disabled={locked}
                  onChange={(event) => onCourierChange(order.id, event.target.value)}
                >
                  {courierOptions.map((option) => (
                    <option key={option.value || "empty"} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              {serviceOptions.length > 0 && (
                <label className="bmo-field">
                  <span>Courier service</span>
                  <select
                    value={draft.serviceLevel}
                    disabled={locked}
                    onChange={(event) => updateDraft({ serviceLevel: event.target.value })}
                  >
                    {serviceOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          </div>
        </section>

        <section className="bmo-editor-section">
          <div className="bmo-section-heading">
            <h3>Recipient</h3>
          </div>
          <div className="bmo-field-grid two">
            <label className="bmo-field">
              <span>Customer name</span>
              <input
                value={draft.customerName}
                onChange={(event) => updateDraft({ customerName: event.target.value })}
              />
            </label>
            <label className="bmo-field">
              <span>Phone</span>
              <input
                value={draft.phone}
                onChange={(event) => updateDraft({ phone: event.target.value })}
              />
            </label>
          </div>
        </section>

        <section className="bmo-editor-section bmo-editor-section-wide">
          <div className="bmo-section-heading">
            <h3>Address and location mapping</h3>
            <span>{locked ? "Locked — parcel already booked" : "Compare customer entry with courier mappings"}</span>
          </div>

          <div className="bmo-mapping-layout">
            <div className="bmo-comparison-grid">
              <div className="bmo-comparison-header">
                <div className="bmo-comparison-col">Shopify Customer Input (Read-only)</div>
                <div className="bmo-comparison-col">
                  Courier API Matches {locked ? "(Locked)" : "(Editable)"}
                </div>
              </div>

              {/* Address → area */}
              <div className="bmo-comparison-row bmo-comparison-row-address">
                <div className="bmo-comparison-col raw-val">
                  <span className="bmo-comparison-label">Order Address</span>
                  <div className="bmo-comparison-address-stack">
                    <div className="bmo-comparison-text bmo-highlight-area">{rawAddress || "—"}</div>
                  </div>
                </div>
                <div className="bmo-comparison-col edit-field">
                  <label className="bmo-field">
                    <span>
                      Matched area
                      <span className="bmo-field-badges">
                        {areaScore !== null && <em>{areaScore}% match</em>}
                        {!locked && (
                          <span
                            className="bmo-optional-badge"
                            title="Area matching is optional, but a correct area helps route to the right delivery hub and improves your delivery success ratio."
                          >
                            Optional
                          </span>
                        )}
                      </span>
                    </span>
                    {locked ? (
                      <div className="bmo-locked-value">{matchedAreaName || "Not specified"}</div>
                    ) : (
                      <select
                        disabled={!cityId || areas.length === 0}
                        value={areaId}
                        onChange={(event) => onLocationChange(order.id, cityId, event.target.value)}
                      >
                        <option value="">
                          {areaFetcher.state === "loading" ? "Loading areas..." : "Select area..."}
                        </option>
                        {areas.map((area) => (
                          <option key={area.id} value={area.id}>
                            {area.name}
                          </option>
                        ))}
                      </select>
                    )}
                  </label>
                </div>
              </div>

              {/* City */}
              <div className="bmo-comparison-row">
                <div className="bmo-comparison-col raw-val">
                  <span className="bmo-comparison-label">Order City</span>
                  <div className="bmo-comparison-text bmo-highlight-city">{order.rawCity || "—"}</div>
                </div>
                <div className="bmo-comparison-col edit-field">
                  <label className="bmo-field">
                    <span>
                      Matched city
                      {cityScore !== null && <em>{cityScore}% match</em>}
                    </span>
                    {locked ? (
                      <div className="bmo-locked-value">{selectedCity?.name || "—"}</div>
                    ) : (
                      <CityCombobox
                        cities={cities}
                        selectedCityId={cityId}
                        onCitySelect={(newCityId) => onLocationChange(order.id, newCityId, "")}
                      />
                    )}
                  </label>
                </div>
              </div>
            </div>

            {/* Summary aside — fills the previously-empty right column and gives
                the merchant an at-a-glance read on the match quality. */}
            <aside className="bmo-mapping-aside">
              <div className="bmo-mapping-aside-title">Match summary</div>
              <ul className="bmo-mapping-stats">
                <li>
                  <span>City match</span>
                  <strong className={cityScore === null ? "" : cityScore < 50 ? "is-warn" : "is-ok"}>
                    {cityScore !== null ? `${cityScore}%` : "—"}
                  </strong>
                </li>
                <li>
                  <span>Area</span>
                  <strong className={areaId ? "is-ok" : "is-muted"}>
                    {areaId ? "Matched" : "Optional"}
                  </strong>
                </li>
                <li>
                  <span>Courier coverage</span>
                  <strong className={servesCity ? "is-ok" : "is-warn"}>
                    {servesCity ? "Serves city" : "No coverage"}
                  </strong>
                </li>
              </ul>
              <p className="bmo-mapping-tip">
                Matching the area is optional, but a correct area routes the parcel to the
                right delivery hub and improves your delivery success ratio.
              </p>
            </aside>
          </div>
        </section>

        <section className="bmo-editor-section">
          <div className="bmo-section-heading">
            <h3>Parcel</h3>
          </div>
          <div className="bmo-field-grid two">
            <label className="bmo-field">
              <span>COD amount (locked)</span>
              <input
                inputMode="decimal"
                value={draft.codAmount}
                readOnly
                aria-readonly="true"
                title="COD is taken from Shopify and can't be edited here."
                className="bmo-field-locked"
                onChange={() => {}}
              />
            </label>
            <label className="bmo-field">
              <span>Parcel weight (kg)</span>
              <input
                inputMode="decimal"
                value={draft.weight}
                onChange={(event) => updateDraft({ weight: event.target.value })}
              />
              <div className="bmo-weight-save-row">
                <button
                  type="button"
                  className="bmo-mini-button"
                  disabled={!weightDirty || weightStatus === "saving"}
                  onClick={saveWeight}
                >
                  {weightStatus === "saving" ? "Saving…" : "Save weight"}
                </button>
                {weightStatus === "saved" && (
                  <span className="bmo-weight-status is-ok">Saved ✓</span>
                )}
                {weightStatus === "error" && (
                  <span className="bmo-weight-status is-err">
                    {weightFetcher.data?.error ?? "Couldn’t save"}
                  </span>
                )}
              </div>
            </label>
          </div>
        </section>

        <section className="bmo-editor-section">
          <div className="bmo-section-heading">
            <h3>Courier metadata</h3>
            <span>{order.areaMatchMethod ? `Area method: ${order.areaMatchMethod}` : "No area metadata"}</span>
          </div>
          <label className="bmo-field">
            <span>
              Special instructions
              {courierDefaultInstructions && <em className="bmo-field-hint">from courier settings</em>}
            </span>
            <textarea
              rows={3}
              value={draft.instructions}
              onChange={(event) => updateDraft({ instructions: event.target.value })}
              placeholder="Order-specific rider notes…"
            />
          </label>
          <div className="bmo-meta-grid">
            <span>Courier</span>
            <strong>{courierLabel}</strong>
            <span>Reference</span>
            <strong>{order.shopifyOrderGid ?? order.id}</strong>
          </div>
        </section>
      </div>
    </div>
  );
}
