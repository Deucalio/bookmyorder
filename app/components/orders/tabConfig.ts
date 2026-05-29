// Tab configuration + filter matching for the orders page.
//
// Tabs are data-driven: a TabConfig declares a filter spec and which bulk
// action buttons appear. Default tabs are fixed; custom tabs (CRUD) share the
// same TabConfig shape and slot in alongside the defaults.

import type { OrderRow } from "./types";

// ─── Filter dimensions ────────────────────────────────────────────────────

export type FulfillmentStatusValue =
  | "UNFULFILLED"
  | "FULFILLED"
  | "PARTIALLY_FULFILLED"
  | "ON_HOLD"
  | "IN_PROGRESS"
  | "SCHEDULED"
  | "OPEN"
  | "RESTOCKED"
  | "PENDING_FULFILLMENT"
  | "REQUEST_DECLINED";

export type FinancialStatusValue =
  | "paid"
  | "pending"
  | "refunded"
  | "voided"
  | "partially_paid"
  | "partially_refunded";

export type OrderStatusValue = "Open" | "Closed" | "Cancelled";

export type DateRangePreset =
  | "today"
  | "yesterday"
  | "last7"
  | "last30"
  | "custom"
  | "all";

export type DateRange = {
  preset: DateRangePreset;
  from?: string | null; // ISO date (yyyy-MM-dd) when preset === "custom"
  to?: string | null;
};

export type TabFilters = {
  fulfillmentStatuses?: FulfillmentStatusValue[];
  tags?: string[];                       // match-any
  financialStatuses?: FinancialStatusValue[];
  orderStatuses?: OrderStatusValue[];
  dateRange?: DateRange;
};

export type ActionButtonId =
  | "bookOrders"
  | "cancelBooking"
  | "downloadSlips";

export type TabConfig = {
  id: string;
  name: string;
  isCustom?: boolean;
  filters: TabFilters;
  actionButtons: ActionButtonId[];
};

// ─── Display catalogues (for filter UI) ──────────────────────────────────

export const FULFILLMENT_STATUS_OPTIONS: { value: FulfillmentStatusValue; label: string }[] = [
  { value: "UNFULFILLED",          label: "Unfulfilled" },
  { value: "FULFILLED",            label: "Fulfilled" },
  { value: "PARTIALLY_FULFILLED",  label: "Partially Fulfilled" },
  { value: "ON_HOLD",              label: "On Hold" },
  { value: "IN_PROGRESS",          label: "In Progress" },
  { value: "SCHEDULED",            label: "Scheduled" },
];

export const FINANCIAL_STATUS_OPTIONS: { value: FinancialStatusValue; label: string }[] = [
  { value: "paid",     label: "Paid" },
  { value: "pending",  label: "Pending" },
  { value: "refunded", label: "Refunded" },
  { value: "voided",   label: "Voided" },
];

export const ORDER_STATUS_OPTIONS: { value: OrderStatusValue; label: string }[] = [
  { value: "Open",      label: "Open" },
  { value: "Closed",    label: "Closed" },
  { value: "Cancelled", label: "Cancelled" },
];

export const ACTION_BUTTON_OPTIONS: { value: ActionButtonId; label: string }[] = [
  { value: "bookOrders",     label: "Book Orders" },
  { value: "cancelBooking",  label: "Cancel Booking" },
  { value: "downloadSlips",  label: "Download Slips" },
];

export const DATE_PRESET_OPTIONS: { value: DateRangePreset; label: string }[] = [
  { value: "today",     label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "last7",     label: "Last 7 days" },
  { value: "last30",    label: "Last 30 days" },
  { value: "custom",    label: "Custom range" },
  { value: "all",       label: "All dates" },
];

// ─── Default tabs (fixed, non-editable) ──────────────────────────────────

export const DEFAULT_TABS: TabConfig[] = [
  {
    id: "unfulfilled-today",
    name: "Unfulfilled Today",
    filters: {
      fulfillmentStatuses: ["UNFULFILLED"],
      orderStatuses: ["Open"],
      dateRange: { preset: "today" },
    },
    actionButtons: ["bookOrders"],
  },
  {
    id: "fulfilled-today",
    name: "Fulfilled Today",
    filters: {
      // FULFILLED captures both "booked via our app" (we mark fulfilled on
      // Shopify) and "fulfilled elsewhere". Partially-fulfilled / in-progress
      // are included so multi-shipment / in-flight orders still show up.
      fulfillmentStatuses: ["FULFILLED", "PARTIALLY_FULFILLED", "IN_PROGRESS"],
      dateRange: { preset: "today" },
    },
    actionButtons: ["cancelBooking", "downloadSlips"],
  },
  {
    id: "unfulfilled",
    name: "Unfulfilled",
    filters: {
      fulfillmentStatuses: ["UNFULFILLED"],
      orderStatuses: ["Open"],
    },
    actionButtons: ["bookOrders"],
  },
  {
    id: "fulfilled",
    name: "Fulfilled",
    filters: {
      fulfillmentStatuses: ["FULFILLED", "PARTIALLY_FULFILLED", "IN_PROGRESS"],
    },
    actionButtons: ["cancelBooking", "downloadSlips"],
  },
];

// ─── Filter matching ─────────────────────────────────────────────────────

/** Resolve a DateRange into an inclusive [start, end) pair, or null for "all". */
export function resolveDateRange(range: DateRange | undefined): { start: Date; end: Date } | null {
  if (!range || range.preset === "all") return null;
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000);

  switch (range.preset) {
    case "today":
      return { start: startOfToday, end: tomorrow };
    case "yesterday": {
      const yest = new Date(startOfToday.getTime() - 24 * 60 * 60 * 1000);
      return { start: yest, end: startOfToday };
    }
    case "last7": {
      const start = new Date(startOfToday.getTime() - 6 * 24 * 60 * 60 * 1000);
      return { start, end: tomorrow };
    }
    case "last30": {
      const start = new Date(startOfToday.getTime() - 29 * 24 * 60 * 60 * 1000);
      return { start, end: tomorrow };
    }
    case "custom": {
      const start = range.from ? new Date(range.from) : new Date(0);
      const to = range.to ? new Date(range.to) : tomorrow;
      // Make the `to` end-of-day inclusive.
      const end = new Date(to.getFullYear(), to.getMonth(), to.getDate() + 1);
      return { start, end };
    }
  }
  return null;
}

/** Does an order match all of a tab's filters? */
export function matchesTab(order: OrderRow, filters: TabFilters): boolean {
  if (filters.fulfillmentStatuses?.length) {
    if (!filters.fulfillmentStatuses.includes(order.fulfillmentStatus as FulfillmentStatusValue)) {
      return false;
    }
  }
  if (filters.financialStatuses?.length) {
    if (!filters.financialStatuses.includes(order.financialStatus.toLowerCase() as FinancialStatusValue)) {
      return false;
    }
  }
  if (filters.orderStatuses?.length) {
    if (!filters.orderStatuses.includes(order.orderStatus as OrderStatusValue)) {
      return false;
    }
  }
  if (filters.tags?.length) {
    const orderTags = new Set(order.tags.map((t) => t.toLowerCase()));
    const anyMatch = filters.tags.some((t) => orderTags.has(t.toLowerCase()));
    if (!anyMatch) return false;
  }
  const window = resolveDateRange(filters.dateRange);
  if (window) {
    const created = new Date(order.shopifyCreatedAt);
    if (created < window.start || created >= window.end) return false;
  }
  return true;
}
