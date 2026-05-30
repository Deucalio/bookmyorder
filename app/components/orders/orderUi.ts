import type { BookingDraft, OrderRow } from "./types";
import { distance } from "fastest-levenshtein";

export const STATUS_META: Record<
  OrderRow["status"],
  { label: string; className: string; tableLabel: string }
> = {
  pending: {
    label: "Pending",
    tableLabel: "Pending",
    className: "bmo-chip bmo-chip-warning",
  },
  assigned: {
    label: "Assigned",
    tableLabel: "Courier Assigned",
    className: "bmo-chip bmo-chip-info",
  },
  booked: {
    label: "Booked",
    tableLabel: "Booked",
    className: "bmo-chip bmo-chip-attention",
  },
  fulfilled: {
    label: "Fulfilled",
    tableLabel: "Fulfilled",
    className: "bmo-chip bmo-chip-success",
  },
  failed: {
    label: "Failed",
    tableLabel: "Failed",
    className: "bmo-chip bmo-chip-critical",
  },
};

const SHOPIFY_FULFILLMENT_STATUS_LABELS: Record<string, { label: string; className: string }> = {
  UNFULFILLED:      { label: "Unfulfilled",   className: "bmo-chip bmo-chip-warning" },
  PARTIAL:          { label: "Partial",        className: "bmo-chip bmo-chip-info" },
  FULFILLED:        { label: "Fulfilled",      className: "bmo-chip bmo-chip-success" },
  ON_HOLD:          { label: "On Hold",        className: "bmo-chip bmo-chip-subdued" },
  SCHEDULED:        { label: "Scheduled",      className: "bmo-chip bmo-chip-subdued" },
  RESTOCKED:        { label: "Restocked",      className: "bmo-chip bmo-chip-subdued" },
  OPEN:             { label: "Open",           className: "bmo-chip bmo-chip-info" },
};

export const getStatusChip = (order: OrderRow): { label: string; className: string } => {
  // Cancelled order wins over everything else — there's nothing else worth
  // saying about its fulfillment state.
  if (order.orderStatus === "Cancelled") {
    return { label: "Cancelled", className: "bmo-chip bmo-chip-critical" };
  }
  // For orders not yet touched by our booking flow, show the Shopify status
  if (order.status === "pending") {
    const shopify = SHOPIFY_FULFILLMENT_STATUS_LABELS[order.fulfillmentStatus]
      ?? SHOPIFY_FULFILLMENT_STATUS_LABELS[order.shopifyFulfillmentOrderStatus ?? ""]
      ?? { label: order.fulfillmentStatus, className: "bmo-chip bmo-chip-warning" };
    return shopify;
  }
  const meta = STATUS_META[order.status];
  return { label: meta.tableLabel, className: meta.className };
};

export const formatCod = (amount: number | string) => {
  const numericAmount = typeof amount === "string" ? Number(amount) : amount;
  if (Number.isNaN(numericAmount)) return "Rs. 0";
  // COD is always whole rupees — round so display matches what we book / print.
  return `Rs. ${Math.round(numericAmount).toLocaleString("en-PK")}`;
};

export const getCourierLabel = (
  courierCode: string | null | undefined,
  options: { label: string; value: string }[],
) => {
  if (!courierCode) return "Unassigned";
  return options.find((option) => option.value === courierCode)?.label ?? courierCode;
};

export const createBookingDraft = (order: OrderRow): BookingDraft => ({
  customerName: order.customerName ?? "",
  phone: order.phone ?? "",
  addressLine1: order.addressLine1 ?? "",
  addressLine2: order.addressLine2 ?? "",
  codAmount: String(Math.round(Number(order.codAmount) || 0)),
  weight: "1.2",
  shipmentType: "Parcel",
  serviceLevel: "",
  instructions: "",
  pickupWindow: "Today",
  fragile: false,
});

export const calculateScore = (str1: string | null | undefined, str2: string | null | undefined) => {
  if (!str1 || !str2) return 0;
  const s1 = str1.toLowerCase().trim();
  const s2 = str2.toLowerCase().trim();
  const d = distance(s1, s2);
  const maxLen = Math.max(s1.length, s2.length);
  if (maxLen === 0) return 100;
  return Math.round((1 - d / maxLen) * 100);
};

/**
 * Whether the selected courier has a city mapping for the selected city.
 * Returns true when it can't be determined (no courier/city/mappings yet) so we
 * don't flag prematurely.
 */
export const courierServesCity = (
  courierCode: string,
  courierMappings: Record<string, any> | null | undefined,
): boolean => {
  if (!courierCode || !courierMappings) return true;
  if (courierCode === "leopards") return courierMappings.leopards?.id != null;
  if (courierCode === "tcs") {
    return courierMappings.tcs?.cityID != null || courierMappings.tcs?.cityCode != null;
  }
  return true;
};

export const COURIER_CITY_MISMATCH = "Courier doesn't deliver to this city";

export const getOrderIssues = (
  order: OrderRow,
  draft: BookingDraft,
  courierCode: string,
  cityId: string,
  cityName: string | null | undefined,
  courierMappings?: Record<string, any> | null,
): string[] => {
  const issues: string[] = [];
  const weight = Number(draft.weight);
  const codAmount = Number(draft.codAmount);

  // Hard blockers — the order can never be booked while these are true.
  if (order.orderStatus === "Cancelled") issues.push("Order cancelled in Shopify");
  if (order.lineItemCount === 0) issues.push("No items to ship");
  const refundedLike = order.financialStatus === "REFUNDED" || order.financialStatus === "VOIDED";
  if (refundedLike) issues.push("Order refunded — review before booking");

  if (!courierCode) issues.push("Courier not selected");
  if (!order.shopifyFulfillmentOrderId) issues.push("Fulfillment order ID missing — re-sync or reinstall");
  if (!cityId) issues.push("City not selected");
  if (!draft.customerName.trim()) issues.push("Customer name missing");
  if (!draft.phone.trim()) issues.push("Phone number missing");
  if (!draft.addressLine1.trim() && !draft.addressLine2.trim()) issues.push("Address missing");
  if (!draft.weight || Number.isNaN(weight) || weight <= 0) issues.push("Weight invalid");
  if (!draft.codAmount || Number.isNaN(codAmount) || codAmount < 0) issues.push("COD invalid");

  // Selected courier has no mapping for the selected city → can't be booked.
  if (courierCode && cityId && !courierServesCity(courierCode, courierMappings)) {
    issues.push(COURIER_CITY_MISMATCH);
  }

  // NOTE: a low city-match score is intentionally NOT an issue — it doesn't
  // block booking. It's surfaced as a non-blocking score badge on the row.

  return issues;
};

const PAYMENT_STATUS_LABELS: Record<string, { label: string; className: string }> = {
  PAID:                { label: "Paid",                className: "bmo-chip bmo-chip-success" },
  PENDING:             { label: "Pending",             className: "bmo-chip bmo-chip-warning" },
  AUTHORIZED:          { label: "Authorized",          className: "bmo-chip bmo-chip-info" },
  PARTIALLY_PAID:      { label: "Partially paid",      className: "bmo-chip bmo-chip-info" },
  PARTIALLY_REFUNDED:  { label: "Partially refunded",  className: "bmo-chip bmo-chip-subdued" },
  REFUNDED:            { label: "Refunded",            className: "bmo-chip bmo-chip-subdued" },
  VOIDED:              { label: "Voided",              className: "bmo-chip bmo-chip-critical" },
  EXPIRED:             { label: "Expired",             className: "bmo-chip bmo-chip-subdued" },
};

export const getPaymentChip = (financialStatus: string): { label: string; className: string } => {
  const key = (financialStatus || "").toUpperCase();
  if (PAYMENT_STATUS_LABELS[key]) return PAYMENT_STATUS_LABELS[key];
  const label = key
    ? key.charAt(0) + key.slice(1).toLowerCase().replace(/_/g, " ")
    : "—";
  return { label, className: "bmo-chip bmo-chip-subdued" };
};

