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
  shopifyOrderId: string;
  shopifyFulfillmentOrderId: string | null;
  fulfillmentStatus: string;
  shopifyFulfillmentOrderStatus: string | null;
  // New filter dimensions (Shopify-aligned)
  financialStatus: string;
  orderStatus: string;        // Open | Closed | Cancelled
  tags: string[];             // parsed from the comma-separated DB field
  shopifyCreatedAt: string;   // ISO string
  areaMatchConfidence: number | null;
  areaMatchMethod: string | null;
};

export type CityOption = {
  id: string;
  name: string;
  courierMappings: Record<string, any> | null;
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

export type ShopCourierRow = {
  courierCode: string;
  courierName: string;
  credentials: Record<string, any>;
  meta_data: Record<string, any>;
  isDefault: boolean;
};

export type ValidationMap = Record<string, string[]>;
