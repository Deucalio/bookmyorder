import { Fragment } from "react";

import type {
  BookingDraft,
  CityOption,
  CourierSelectOption,
  OrderRow,
  ValidationMap,
} from "./types";
import { createBookingDraft, formatCod, getCourierLabel, STATUS_META } from "./orderUi";
import { ShipmentEditor } from "./ShipmentEditor";

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
  onOpenOrder: (orderId: string) => void;
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
  onOpenOrder,
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
            const badge = STATUS_META[order.status];
            const cityLabel = cityLabels[order.id] ?? order.city ?? "City missing";

            return (
              <Fragment key={order.id}>
                <tr
                  aria-selected={selected}
                  className={selected ? "is-selected" : ""}
                  onClick={() => onOpenOrder(order.id)}
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
                    <div className="bmo-order-id">{order.orderName}</div>
                    <div className="bmo-row-muted">
                      {order.shopifyOrderGid ? "Shopify order" : "Local order"}
                    </div>
                  </td>
                  <td>
                    <div className="bmo-strong-text">{order.customerName || "No customer"}</div>
                    {order.phone && <div className="bmo-row-muted">{order.phone}</div>}
                  </td>
                  <td>
                    <div className="bmo-strong-text">{cityLabel}</div>
                    <div className="bmo-row-muted">
                      {order.area ?? order.rawCity ?? "Area not mapped"}
                    </div>
                  </td>
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
                        cityId={cityIds[order.id] ?? order.cityId ?? ""}
                        courierCode={courierCode}
                        courierOptions={courierOptions}
                        draft={drafts[order.id] ?? createBookingDraft(order)}
                        order={order}
                        validationErrors={validationErrors[order.id] ?? []}
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
