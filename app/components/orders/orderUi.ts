import type { BookingDraft, OrderRow } from "./types";

export const STATUS_META: Record<
  OrderRow["status"],
  { label: string; className: string; tableLabel: string }
> = {
  pending: {
    label: "Pending",
    tableLabel: "Unassigned",
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
