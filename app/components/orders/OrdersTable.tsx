import { Fragment, useEffect, useRef } from "react";
import { useFetcher } from "react-router";
import { CityCombobox } from "./CityCombobox";


import type {
  BookingDraft,
  CityOption,
  CourierSelectOption,
  OrderRow,
  ValidationMap,
} from "./types";
import { createBookingDraft, formatCod, getCourierLabel, getOrderIssues, STATUS_META, calculateScore } from "./orderUi";
import { ShipmentEditor } from "./ShipmentEditor";

function DestinationCell({
  order,
  cities,
  cityId,
  cityLabel,
  cityScore,
  onLocationChange,
}: {
  order: OrderRow;
  cities: CityOption[];
  cityId: string;
  cityLabel: string;
  cityScore: number | null;
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
      <div className="bmo-strong-text flex flex-col gap-1">
        <div className="flex items-center justify-between gap-2 mr-2">
          <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">City</span>
          {cityScore !== null && (
            <span className={`bmo-badge-score ${cityScore >= 70 ? "success" : "warning"}`}>
              {cityScore}% Match
            </span>
          )}
        </div>
        <CityCombobox
          cities={cities}
          selectedCityId={cityId}
          onCitySelect={(newCityId) => onLocationChange(order.id, newCityId, "")}
        />
      </div>
      <div className="bmo-row-muted mt-1.5 pl-1">
        {order.area ?? order.rawCity ?? "Area not mapped"}
      </div>
    </td>
  );
}

type OrdersTableProps = {
  orders: OrderRow[];
  selectedIds: string[];
  expandedIds: string[];
  rowCouriers: Record<string, string>;
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

const COLUMN_COUNT = 8;

export function OrdersTable({
  orders,
  selectedIds,
  expandedIds,
  rowCouriers,
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

  return (
    <div className="bmo-table-wrap">
      <table className="bmo-orders-table">
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
            <th>COD</th>
            <th>Courier</th>
            <th>Status</th>
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

            // Compute real-time issues
            const issues = getOrderIssues(order, draft, courierCode, mappedCityId, cityLabel);
            
            const badge = STATUS_META[order.status];
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
                  </td>
                  <td>
                    <div className="bmo-strong-text">{order.customerName || "No customer"}</div>
                    {order.phone && <div className="bmo-row-muted">{order.phone}</div>}
                  </td>
                  <DestinationCell
                    order={order}
                    cities={cities}
                    cityId={mappedCityId}
                    cityLabel={cityLabel}
                    cityScore={cityScore}
                    onLocationChange={onLocationChange}
                  />
                  <td>
                    <span className="bmo-money">{formatCod(order.codAmount)}</span>
                  </td>
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
                    <span className={badge.className}>{badge.tableLabel}</span>
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
