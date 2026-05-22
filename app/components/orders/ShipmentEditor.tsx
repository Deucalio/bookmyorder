import { useEffect, useMemo, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { distance } from "fastest-levenshtein";

import type {
  BookingDraft,
  CityOption,
  CourierSelectOption,
  OrderRow,
} from "./types";
import { getCourierLabel } from "./orderUi";

type ShipmentEditorProps = {
  order: OrderRow;
  draft: BookingDraft;
  courierCode: string;
  cities: CityOption[];
  cityId: string;
  areaId: string;
  courierOptions: CourierSelectOption[];
  validationErrors: string[];
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
  validationErrors,
  onCourierChange,
  onDraftChange,
  onLocationChange,
}: ShipmentEditorProps) {
  const areaFetcher = useFetcher<{ areas: CityOption[] }>();
  const saveFetcher = useFetcher<Record<string, unknown>>();
  const [areas, setAreas] = useState<CityOption[]>([]);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const initialCityId = useRef(order.cityId || "");
  const initialAreaId = useRef(order.areaId || "");

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
  }, [cityId, areaId, order.id]);

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
  const fragileInputId = `bmo-fragile-${order.id}`;

  const updateDraft = (patch: Partial<BookingDraft>) => onDraftChange(order.id, patch);

  return (
    <div className="bmo-shipment-editor">
      {validationErrors.length > 0 && (
        <div className="bmo-validation-strip">
          {validationErrors.map((error) => (
            <span key={error}>{error}</span>
          ))}
        </div>
      )}

      <div className="bmo-editor-grid">
        <section className="bmo-editor-section">
          <div className="bmo-section-heading">
            <h3>Courier assignment</h3>
            {saveStatus === "saving" && <span>Saving location...</span>}
            {saveStatus === "saved" && <span>Location saved</span>}
          </div>
          <div className="bmo-field-grid two">
            <label className="bmo-field">
              <span>Courier</span>
              <select
                value={courierCode}
                onChange={(event) => onCourierChange(order.id, event.target.value)}
              >
                {courierOptions.map((option) => (
                  <option key={option.value || "empty"} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="bmo-field">
              <span>Courier service</span>
              <select
                value={draft.serviceLevel}
                onChange={(event) => updateDraft({ serviceLevel: event.target.value })}
              >
                <option value="Standard">Standard</option>
                <option value="Express">Express</option>
                <option value="Economy">Economy</option>
                <option value="Same Day">Same Day</option>
              </select>
            </label>
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
            <span>{order.rawCity ? `Raw city: ${order.rawCity}` : "Raw city unavailable"}</span>
          </div>
          <div className="bmo-field-grid two">
            <label className="bmo-field">
              <span>Address line 1</span>
              <input
                value={draft.addressLine1}
                onChange={(event) => updateDraft({ addressLine1: event.target.value })}
              />
            </label>
            <label className="bmo-field">
              <span>Address line 2</span>
              <input
                value={draft.addressLine2}
                onChange={(event) => updateDraft({ addressLine2: event.target.value })}
              />
            </label>
          </div>
          <div className="bmo-field-grid two">
            <label className="bmo-field">
              <span>
                Matched city
                {cityScore !== null && <em>{cityScore}% match</em>}
              </span>
              <select
                value={cityId}
                onChange={(event) => onLocationChange(order.id, event.target.value, "")}
              >
                <option value="">Select city...</option>
                {cities.map((city) => (
                  <option key={city.id} value={city.id}>
                    {city.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="bmo-field">
              <span>
                Matched area
                {areaScore !== null && <em>{areaScore}% match</em>}
              </span>
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
            </label>
          </div>
          <div className="bmo-raw-address">
            <span>Shopify raw address</span>
            <p>{rawAddress || "No raw address captured."}</p>
          </div>
        </section>

        <section className="bmo-editor-section">
          <div className="bmo-section-heading">
            <h3>Parcel</h3>
          </div>
          <div className="bmo-field-grid two">
            <label className="bmo-field">
              <span>COD amount</span>
              <input
                inputMode="decimal"
                value={draft.codAmount}
                onChange={(event) => updateDraft({ codAmount: event.target.value })}
              />
            </label>
            <label className="bmo-field">
              <span>Parcel weight</span>
              <input
                inputMode="decimal"
                value={draft.weight}
                onChange={(event) => updateDraft({ weight: event.target.value })}
              />
            </label>
            <label className="bmo-field">
              <span>Shipment type</span>
              <select
                value={draft.shipmentType}
                onChange={(event) => updateDraft({ shipmentType: event.target.value })}
              >
                <option value="Parcel">Parcel</option>
                <option value="Document">Document</option>
                <option value="Fragile parcel">Fragile parcel</option>
                <option value="Return pickup">Return pickup</option>
              </select>
            </label>
            <label className="bmo-field">
              <span>Pickup window</span>
              <select
                value={draft.pickupWindow}
                onChange={(event) => updateDraft({ pickupWindow: event.target.value })}
              >
                <option value="Today">Today</option>
                <option value="Tomorrow">Tomorrow</option>
                <option value="Next business day">Next business day</option>
              </select>
            </label>
          </div>
        </section>

        <section className="bmo-editor-section">
          <div className="bmo-section-heading">
            <h3>Courier metadata</h3>
            <span>{order.areaMatchMethod ? `Area method: ${order.areaMatchMethod}` : "No area metadata"}</span>
          </div>
          <div className="bmo-toggle-row compact">
            <label htmlFor={fragileInputId}>
              <strong>Fragile handling</strong>
              <small>Mark this parcel for careful handling.</small>
            </label>
            <input
              id={fragileInputId}
              checked={draft.fragile}
              type="checkbox"
              onChange={(event) => updateDraft({ fragile: event.target.checked })}
            />
          </div>
          <label className="bmo-field">
            <span>Special instructions</span>
            <textarea
              rows={3}
              value={draft.instructions}
              onChange={(event) => updateDraft({ instructions: event.target.value })}
              placeholder="Order-specific rider notes..."
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
