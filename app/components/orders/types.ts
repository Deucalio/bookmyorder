export type OrderStatus = "pending" | "assigned" | "booked" | "fulfilled" | "failed";

export type OrderRow = {
  id: string;
  orderName: string;
  customerName: string;
  phone: string | null;
  city: string | null;
  area: string | null;
  codAmount: number;
  status: OrderStatus;
  courierCode: string | null;
  rawCity: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  cityId: string | null;
  areaId: string | null;
  shopifyOrderGid: string | null;
  areaMatchConfidence: number | null;
  areaMatchMethod: string | null;
};

export type CityOption = {
  id: string;
  name: string;
};

export type CourierSelectOption = {
  label: string;
  value: string;
};

export type BookingDraft = {
  customerName: string;
  phone: string;
  addressLine1: string;
  addressLine2: string;
  codAmount: string;
  weight: string;
  shipmentType: string;
  serviceLevel: string;
  instructions: string;
  pickupWindow: string;
  fragile: boolean;
};

export type ValidationMap = Record<string, string[]>;
