import { Fragment, useEffect, useMemo, useRef } from "react";
import { useFetcher } from "react-router";
import { CityCombobox } from "./CityCombobox";


import type {
  BookingDraft,
  CityOption,
  CourierSelectOption,
  OrderRow,
  ValidationMap,
} from "./types";
import { createBookingDraft, formatCod, getCourierLabel, getOrderIssues, getStatusChip, getPaymentChip, calculateScore, courierServesCity } from "./orderUi";
import { ShipmentEditor } from "./ShipmentEditor";

function DestinationCell({
  order,
  cities,
  cityId,
  cityLabel,
  cityScore,
  courierMismatch,
  courierLabel,
  onLocationChange,
}: {
  order: OrderRow;
  cities: CityOption[];
  cityId: string;
  cityLabel: string;
  cityScore: number | null;
  courierMismatch: boolean;
  courierLabel: string;
  onLocationChange: (orderId: string, cityId: string, areaId: string) => void;
}) {
  const saveFetcher = useFetcher();
  const initialCityId = useRef(cityId);

  useEffect(() => {
    if (cityId === initialCityId.current) {
      return;
    }

    const timer = setTimeout(() => {
      const formData = new FormData();
      formData.append("intent", "updateAddress");
      formData.append("orderId", order.id);
      formData.append("cityId", cityId);
      formData.append("areaId", ""); // clear area when city changes
      saveFetcher.submit(formData, { method: "POST", action: "/app/orders" });
      initialCityId.current = cityId;
    }, 400);

    return () => clearTimeout(timer);
  }, [cityId, order.id, saveFetcher]);

  return (
    <td onClick={(event) => event.stopPropagation()}>
      {courierMismatch && (
        <div className="bmo-courier-mismatch" role="alert">
          {courierLabel} doesn’t deliver here
        </div>
      )}
      <CityCombobox
        cities={cities}
        selectedCityId={cityId}
        onCitySelect={(newCityId) => onLocationChange(order.id, newCityId, "")}
      />
      <div className="bmo-row-muted bmo-destination-meta">
        <span>{order.area ?? order.rawCity ?? "Area not mapped"}</span>
        {cityScore !== null && (
          <span className={`bmo-badge-score ${cityScore < 50 ? "warning" : "success"}`}>
            {cityScore}% Match
          </span>
        )}
      </div>
    </td>
  );
}

type OrdersTableProps = {
  orders: OrderRow[];
  selectedIds: string[];
  expandedIds: string[];
  rowCouriers: Record<string, string>;
  shopCourierDefaults: Record<string, string>;
  courierOptions: CourierSelectOption[];
  cityLabels: Record<string, string>;
  drafts: Record<string, BookingDraft>;
  cities: CityOption[];
  cityIds: Record<string, string>;
  areaIds: Record<string, string>;
  validationErrors: ValidationMap;
  onToggleSelected: (orderId: string, selected: boolean) => void;
  onSelectAllVisible: (selected: boolean) => void;
  onCourierChange: (orderId: string, courierCode: string) => void;
  onToggleExpanded: (orderId: string) => void;
  onDraftChange: (orderId: string, patch: Partial<BookingDraft>) => void;
  onLocationChange: (orderId: string, cityId: string, areaId: string) => void;
};

const COLUMN_COUNT = 9;

export function OrdersTable({
  orders,
  selectedIds,
  expandedIds,
  rowCouriers,
  shopCourierDefaults,
  courierOptions,
  cityLabels,
  drafts,
  cities,
  cityIds,
  areaIds,
  validationErrors,
  onToggleSelected,
  onSelectAllVisible,
  onCourierChange,
  onToggleExpanded,
  onDraftChange,
  onLocationChange,
}: OrdersTableProps) {
  const allVisibleSelected =
    orders.length > 0 && orders.every((order) => selectedIds.includes(order.id));

  const cityMappingsById = useMemo(
    () => new Map(cities.map((c) => [c.id, c.courierMappings])),
    [cities],
  );

  return (
    <div className="bmo-table-wrap">
      <table className="bmo-orders-table">
        <colgroup>
          <col style={{ width: "38px" }} />
          <col style={{ width: "20%" }} />
          <col style={{ width: "15%" }} />
          <col style={{ width: "18%" }} />
          <col style={{ width: "15%" }} />
          <col style={{ width: "12%" }} />
          <col style={{ width: "11%" }} />
          <col style={{ width: "9%" }} />
          <col style={{ width: "72px" }} />
        </colgroup>
        <thead>
          <tr>
            <th className="bmo-select-cell">
              <input
                aria-label="Select all visible orders"
                checked={allVisibleSelected}
                type="checkbox"
                onChange={(event) => onSelectAllVisible(event.target.checked)}
              />
            </th>
            <th>Order</th>
            <th>Customer</th>
            <th>Destination</th>
            <th>Courier</th>
            <th>Fulfillment Status</th>
            <th>Payment Status</th>
            <th>COD</th>
            <th className="bmo-action-cell">Editor</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => {
            const selected = selectedIds.includes(order.id);
            const expanded = expandedIds.includes(order.id);
            const courierCode = rowCouriers[order.id] ?? order.courierCode ?? "";
            const mappedCityId = cityIds[order.id] ?? order.cityId ?? "";
            const draft = drafts[order.id] ?? createBookingDraft(order);
            
            const cityLabel = cityLabels[order.id] ?? order.city ?? "City missing";
            const selectedCityMappings = mappedCityId ? cityMappingsById.get(mappedCityId) ?? null : null;
            const courierMismatch =
              !!courierCode && !!mappedCityId && !courierServesCity(courierCode, selectedCityMappings);

            // Compute real-time issues
            const issues = getOrderIssues(order, draft, courierCode, mappedCityId, cityLabel, selectedCityMappings);

            const badge = getStatusChip(order);
            const paymentBadge = getPaymentChip(order.financialStatus);
            const cityScore = mappedCityId && order.rawCity ? calculateScore(order.rawCity, cityLabel) : null;

            return (
              <Fragment key={order.id}>
                <tr
                  aria-selected={selected}
                  className={`${selected ? "is-selected" : ""} ${expanded ? "is-expanded" : ""}`}
                  onClick={() => onToggleExpanded(order.id)}
                >
                  <td className="bmo-select-cell" onClick={(event) => event.stopPropagation()}>
                    <input
                      aria-label={`Select ${order.orderName}`}
                      checked={selected}
                      type="checkbox"
                      onChange={(event) => onToggleSelected(order.id, event.target.checked)}
                    />
                  </td>
                  <td>
                    <div className="bmo-order-title-row">
                      <span className="bmo-order-id">{order.orderName}</span>
                      {issues.length > 0 ? (
                        <span className="bmo-issues-count-badge">{issues.length} {issues.length === 1 ? "issue" : "issues"}</span>
                      ) : (
                        <span className="bmo-ready-count-badge">Ready</span>
                      )}
                    </div>
                    <div className="bmo-row-muted">
                      {order.shopifyOrderGid ? "Shopify order" : "Local order"}
                    </div>
                    {issues.length > 0 && (
                      <div className="bmo-row-issues">
                        {issues.map((issue) => (
                          <span key={issue} className="bmo-issue-inline-tag">{issue}</span>
                        ))}
                      </div>
                    )}
                    {order.tags.length > 0 && (
                      <div className="bmo-row-tags">
                        {order.tags.map((tag) => (
                          <span key={tag} className="bmo-order-tag">{tag}</span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td>
                    <div className="bmo-strong-text">{order.customerName || "No customer"}</div>
                    {order.phone && <div className="bmo-row-muted">{order.phone}</div>}
                    {(order.addressLine1 || order.addressLine2) && (
                      <div className="bmo-row-address">
                        {[order.addressLine1, order.addressLine2].filter(Boolean).join(", ")}
                      </div>
                    )}
                  </td>
                  <DestinationCell
                    order={order}
                    cities={cities}
                    cityId={mappedCityId}
                    cityLabel={cityLabel}
                    cityScore={cityScore}
                    courierMismatch={courierMismatch}
                    courierLabel={getCourierLabel(courierCode, courierOptions)}
                    onLocationChange={onLocationChange}
                  />
                  <td onClick={(event) => event.stopPropagation()}>
                    <select
                      aria-label={`Courier for ${order.orderName}`}
                      className="bmo-select bmo-table-select"
                      value={courierCode}
                      onChange={(event) => onCourierChange(order.id, event.target.value)}
                    >
                      {courierOptions.map((option) => (
                        <option key={option.value || "empty"} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <div className="bmo-row-muted">
                      {getCourierLabel(courierCode, courierOptions)}
                    </div>
                  </td>
                  <td>
                    <span className={badge.className}>{badge.label}</span>
                  </td>
                  <td>
                    <span className={paymentBadge.className}>{paymentBadge.label}</span>
                  </td>
                  <td>
                    <span className="bmo-money">{formatCod(order.codAmount)}</span>
                  </td>
                  <td className="bmo-action-cell">
                    <button
                      aria-expanded={expanded}
                      className={expanded ? "bmo-row-action is-active" : "bmo-row-action"}
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        onToggleExpanded(order.id);
                      }}
                    >
                      {expanded ? "Close" : "Edit"}
                    </button>
                  </td>
                </tr>

                {expanded && (
                  <tr className="bmo-editor-row">
                    <td colSpan={COLUMN_COUNT}>
                      <ShipmentEditor
                        areaId={areaIds[order.id] ?? order.areaId ?? ""}
                        cities={cities}
                        cityId={mappedCityId}
                        courierCode={courierCode}
                        courierOptions={courierOptions}
                        draft={draft}
                        order={order}
                        shopCourierDefaults={shopCourierDefaults}
                        validationErrors={validationErrors[order.id] ?? []}
                        issues={issues}
                        onCourierChange={onCourierChange}
                        onDraftChange={onDraftChange}
                        onLocationChange={onLocationChange}
                      />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
