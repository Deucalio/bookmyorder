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
  return `Rs. ${numericAmount.toLocaleString("en-PK", {
    maximumFractionDigits: 2,
  })}`;
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
  codAmount: String(order.codAmount ?? 0),
  weight: "1.2",
  shipmentType: "Parcel",
  serviceLevel: "Standard",
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

export const getOrderIssues = (
  order: OrderRow,
  draft: BookingDraft,
  courierCode: string,
  cityId: string,
  cityName: string | null | undefined
): string[] => {
  const issues: string[] = [];
  const weight = Number(draft.weight);
  const codAmount = Number(draft.codAmount);

  if (!courierCode) issues.push("Courier not selected");
  if (!order.shopifyFulfillmentOrderId) issues.push("Fulfillment order ID missing — re-sync or reinstall");
  if (!cityId) issues.push("City not selected");
  if (!draft.customerName.trim()) issues.push("Customer name missing");
  if (!draft.phone.trim()) issues.push("Phone number missing");
  if (!draft.addressLine1.trim() && !draft.addressLine2.trim()) issues.push("Address missing");
  if (!draft.weight || Number.isNaN(weight) || weight <= 0) issues.push("Weight invalid");
  if (!draft.codAmount || Number.isNaN(codAmount) || codAmount < 0) issues.push("COD invalid");

  if (cityId && order.rawCity && cityName) {
    const score = calculateScore(order.rawCity, cityName);
    if (score < 70) {
      issues.push("Low city match score");
    }
  }

  return issues;
};

