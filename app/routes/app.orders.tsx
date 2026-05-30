import { useEffect, useMemo, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useRevalidator } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { BookingActionBar } from "../components/orders/BookingActionBar";
import { BookingProgressModal } from "../components/orders/BookingProgressModal";
import type { BookingSnapshotItem } from "../components/orders/BookingProgressModal";
import { OrdersTable } from "../components/orders/OrdersTable";
import { createBookingDraft, formatCod, getCourierLabel, getOrderIssues } from "../components/orders/orderUi";
import {
  DATE_PRESET_OPTIONS,
  DEFAULT_TABS,
  matchesTab,
  type ActionButtonId,
  type DateRange,
  type DateRangePreset,
  type TabConfig,
  type TabFilters,
} from "../components/orders/tabConfig";
import { CustomTabModal, type CustomTabDraft } from "../components/orders/CustomTabModal";
import type {
  BookingDraft,
  CourierSelectOption,
  OrderRow,
  OrderStatus,
  ShopCourierRow,
  ValidationMap,
} from "../components/orders/types";
import prisma from "../db.server";
import { applyCorrection } from "../services/address-match-log.server";
import { bookOrders } from "../services/bookOrders.server";
import { syncShopData } from "../services/sync.server";
import { triggerOrderRefresh } from "../services/triggerOrderSync.server";
import { authenticate } from "../shopify.server";

function deriveStatus(
  fulfillmentStatus: string,
  fulfillments: { status: string; deliveryOutcome: string }[],
): OrderStatus {
  if (fulfillmentStatus === "FULFILLED") return "fulfilled";
  // Cancelled/failed fulfillments stay on the row for audit, but they must not
  // drive the current status — otherwise a cancel from the Fulfilled tab would
  // leave the order stuck there (its stale deliveryOutcome is still 'delivered').
  const active = fulfillments.filter(
    (f) => f.status !== "cancelled" && f.status !== "failed",
  );
  if (active.length === 0) return "pending";
  const latest = active[active.length - 1];
  if (latest.deliveryOutcome === "delivered") return "fulfilled";
  if (["returned", "failed"].includes(latest.deliveryOutcome)) return "failed";
  if (latest.status === "booked") return "booked";
  return "assigned";
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const shopRecord = await prisma.shop.findUnique({
    where: { shopDomain: session.shop },
    select: { id: true },
  });

  if (!shopRecord) {
    return {
      orders: [] as OrderRow[],
      cities: [] as { id: string; name: string; courierMappings: Record<string, any> | null }[],
      shopCouriers: [] as ShopCourierRow[],
      customTabs: [] as TabConfig[],
    };
  }

  const [dbOrders, cities, dbCouriers, dbCustomTabs] = await Promise.all([
    prisma.order.findMany({
      where: { shopId: shopRecord.id },
      include: {
        fulfillments: {
          orderBy: { createdAt: "asc" },
          // Select-by-default picks everything, so just leaving it gives us
          // lastTrackingStatus / lastTrackingAt / source / trackingNumber.
        },
        city: { select: { name: true } },
        area: { select: { name: true } },
        addressMatchLog: { select: { matchConfidence: true, matchMethod: true } },
      },
      orderBy: { shopifyCreatedAt: "desc" },
      take: 250,
    }),
    prisma.city.findMany({
      where: { courierMappings: { not: null } },
      select: { id: true, name: true, courierMappings: true },
      orderBy: { name: "asc" },
    }),
    prisma.shopCourier.findMany({
      where: { shopId: shopRecord.id, isEnabled: true },
      select: { courierCode: true, courierName: true, credentials: true, meta_data: true, isDefault: true },
      orderBy: { courierCode: "asc" },
    }),
    prisma.customTab.findMany({
      where: { shopId: shopRecord.id },
      orderBy: { position: "asc" },
    }),
  ]);

  const customTabs: TabConfig[] = dbCustomTabs.map((t) => ({
    id: t.id,
    name: t.name,
    isCustom: true,
    filters: (t.filters as TabFilters) ?? {},
    actionButtons: (t.actionButtons as ActionButtonId[]) ?? [],
  }));

  const orders: OrderRow[] = dbOrders.map((order) => ({
    id: order.id,
    orderName: order.orderName,
    customerName: order.customerName,
    phone: order.customerPhone,
    city: order.city?.name ?? order.rawCity,
    area: order.area?.name ?? null,
    codAmount: order.codAmount,
    status: deriveStatus(order.fulfillmentStatus, order.fulfillments),
    courierCode: order.fulfillments[order.fulfillments.length - 1]?.courierCode ?? null,
    rawCity: order.rawCity,
    addressLine1: order.addressLine1,
    addressLine2: order.addressLine2,
    cityId: order.cityId,
    areaId: order.areaId,
    shopifyOrderGid: order.shopifyOrderGid,
    shopifyOrderId: order.shopifyOrderId.toString(),
    shopifyFulfillmentOrderId: order.shopifyFulfillmentOrderId?.toString() ?? null,
    fulfillmentStatus: order.fulfillmentStatus,
    shopifyFulfillmentOrderStatus: order.shopifyFulfillmentOrderStatus,
    financialStatus: order.financialStatus,
    orderStatus: (order as any).orderStatus ?? "Open",
    tags: (order.tags ?? "")
      .split(",")
      .map((t: string) => t.trim())
      .filter(Boolean),
    shopifyCreatedAt: order.shopifyCreatedAt.toISOString(),
    lineItemCount: Array.isArray(order.lineItems) ? order.lineItems.length : 0,
    areaMatchConfidence: order.addressMatchLog?.matchConfidence ?? null,
    areaMatchMethod: order.addressMatchLog?.matchMethod ?? null,
    tracking: (() => {
      // Show tracking for the most-recent app-booked fulfillment that has a
      // tracking number. Includes already-DELIVERED rows so the merchant
      // sees the final state on the row.
      const appFulfillments = order.fulfillments
        .filter((f) => f.source === "app" && f.trackingNumber)
        .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
      const latest = appFulfillments[0];
      if (!latest) return null;
      return {
        fulfillmentId: latest.id,
        status: latest.lastTrackingStatus ?? null,
        fetchedAt: latest.lastTrackingAt?.toISOString() ?? null,
      };
    })(),
  }));

  const shopCouriers: ShopCourierRow[] = dbCouriers.map((c) => ({
    courierCode: c.courierCode,
    courierName: c.courierName,
    credentials: (c.credentials as Record<string, any>) ?? {},
    meta_data: (c.meta_data as Record<string, any>) ?? {},
    isDefault: c.isDefault,
  }));

  return { orders, cities, shopCouriers, customTabs };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "updateAddress") {
    const orderId = formData.get("orderId") as string;
    const cityIdRaw = (formData.get("cityId") as string) || "";
    const areaIdRaw = (formData.get("areaId") as string) || "";
    const cityId = cityIdRaw || null;
    const areaId = areaIdRaw || null;

    // Pull the order's raw address snapshot too so we can either update an
    // existing AddressMatchLog or create a fresh one for a manual pick.
    const before = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        shopId: true,
        addressMatchLogId: true,
        addressLine1: true,
        addressLine2: true,
        rawCity: true,
      },
    });

    await prisma.order.update({
      where: { id: orderId },
      data: { cityId, areaId },
    });

    if (before?.addressMatchLogId) {
      // Existing log → record the merchant's correction.
      await applyCorrection({
        logId: before.addressMatchLogId,
        chosenCityId: cityId,
        chosenAreaId: areaId,
      }).catch((err) => {
        console.error("applyCorrection failed:", err);
      });
    } else if (before && cityId) {
      // No prior log + the merchant manually picked → create a manual_picked row
      // so the matcher-learning pipeline still sees the ground truth.
      try {
        const chosenArea = areaId
          ? await prisma.area.findUnique({ where: { id: areaId }, select: { name: true } })
          : null;
        const created = await prisma.addressMatchLog.create({
          data: {
            shopId: before.shopId,
            orderId,
            rawAddress1: before.addressLine1 ?? "",
            rawAddress2: before.addressLine2 ?? null,
            rawCity: before.rawCity ?? null,
            chosenCityId: cityId,
            chosenAreaId: areaId,
            chosenAreaName: chosenArea?.name ?? null,
            chosenAt: new Date(),
            outcome: "manual_picked",
          },
          select: { id: true },
        });
        await prisma.order.update({
          where: { id: orderId },
          data: { addressMatchLogId: created.id },
        });
      } catch (err) {
        console.error("manual address-match log failed:", err);
      }
    }

    return { success: true };
  }

  if (intent === "bookOrders") {
    const ordersJson = formData.get("orders") as string;
    const inputs = JSON.parse(ordersJson ?? "[]");
    const result = await bookOrders(session.shop, session.accessToken ?? "", inputs);
    return { intent: "bookOrders", ...result };
  }

  if (intent === "cancelOrders") {
    const orderIdsJson = formData.get("orderIds") as string;
    const orderIds: string[] = JSON.parse(orderIdsJson ?? "[]");

    const BACKEND_URL = process.env.BACKEND_URL;
    const BACKEND_INTERNAL_SECRET = process.env.BACKEND_INTERNAL_SECRET;

    if (!BACKEND_URL || !BACKEND_INTERNAL_SECRET) {
      return { intent: "cancelOrders", success: false, error: "Backend not configured" };
    }

    // Cancels the courier parcel AND the Shopify fulfillment, then marks the
    // order unfulfilled. We await so the UI reflects the real outcome.
    try {
      const res = await fetch(`${BACKEND_URL}/api/fulfillment/batch-cancel-orders`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-secret": BACKEND_INTERNAL_SECRET,
        },
        body: JSON.stringify({ shopDomain: session.shop, orderIds }),
      });
      const data = await res.json().catch(() => ({} as any));

      if (!res.ok || !data.success) {
        const reason = data?.failed?.[0]?.error ?? data?.error;
        const message =
          data?.summary?.total === 0
            ? "No active bookings to cancel for the selected orders."
            : reason ?? `Cancel failed (${res.status})`;
        return { intent: "cancelOrders", success: false, error: message };
      }

      return { intent: "cancelOrders", success: true, cancelled: data.summary?.success ?? orderIds.length };
    } catch (err: any) {
      return { intent: "cancelOrders", success: false, error: `Backend unreachable: ${err.message}` };
    }
  }

  if (
    intent === "createCustomTab" ||
    intent === "updateCustomTab" ||
    intent === "deleteCustomTab"
  ) {
    const shopRecord = await prisma.shop.findUnique({
      where: { shopDomain: session.shop },
      select: { id: true },
    });
    if (!shopRecord) {
      return { intent, success: false, error: "Shop not found" };
    }

    if (intent === "deleteCustomTab") {
      const id = formData.get("id") as string;
      await prisma.customTab.deleteMany({ where: { id, shopId: shopRecord.id } });
      return { intent, success: true };
    }

    const name = ((formData.get("name") as string) || "").trim();
    if (!name) return { intent, success: false, error: "Tab name is required" };

    let filters: any = {};
    let actionButtons: any = [];
    try {
      filters = JSON.parse((formData.get("filters") as string) || "{}");
      actionButtons = JSON.parse((formData.get("actionButtons") as string) || "[]");
    } catch {
      return { intent, success: false, error: "Invalid filter data" };
    }

    if (intent === "updateCustomTab") {
      const id = formData.get("id") as string;
      await prisma.customTab.updateMany({
        where: { id, shopId: shopRecord.id },
        data: { name, filters, actionButtons },
      });
      return { intent, success: true };
    }

    // create
    const count = await prisma.customTab.count({ where: { shopId: shopRecord.id } });
    await prisma.customTab.create({
      data: { shopId: shopRecord.id, name, filters, actionButtons, position: count },
    });
    return { intent, success: true };
  }

  await syncShopData(session, admin);
  triggerOrderRefresh(session.shop, session.accessToken ?? "");
  return { synced: true, background: true };
};

export default function OrdersPage() {
  const { orders, cities, shopCouriers, customTabs } = useLoaderData<typeof loader>();
  const revalidator = useRevalidator();
  const fetcher = useFetcher<typeof action>();
  const bookingFetcher = useFetcher<typeof action>();
  const cancelFetcher = useFetcher<typeof action>();
  const tabFetcher = useFetcher<typeof action>();
  const isSyncing = fetcher.state !== "idle";
  const isCancelling = cancelFetcher.state !== "idle";
  const isSavingTab = tabFetcher.state !== "idle";
  const noCouriers = shopCouriers.length === 0;

  // Fixed default tabs first, then the merchant's saved custom tabs.
  const TABS: TabConfig[] = useMemo(() => [...DEFAULT_TABS, ...customTabs], [customTabs]);

  const [tabIndex, setTabIndex] = useState(0);
  const [tabModalOpen, setTabModalOpen] = useState(false);
  const [editingTab, setEditingTab] = useState<TabConfig | null>(null);
  const [deletingTab, setDeletingTab] = useState<TabConfig | null>(null);
  // Per-view date range override (resets when the tab changes). When null, the
  // tab's configured dateRange (or "all" if absent) is used.
  const [dateOverride, setDateOverride] = useState<DateRange | null>(null);
  const [search, setSearch] = useState("");
  const [courierFilter, setCourierFilter] = useState("all");
  const [cityFilter, setCityFilter] = useState("all");
  const [sortBy, setSortBy] = useState<string>("issues");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [expandedIds, setExpandedIds] = useState<string[]>([]);
  const [rowCouriers, setRowCouriers] = useState<Record<string, string>>(() =>
    Object.fromEntries(orders.map((order) => [order.id, order.courierCode ?? ""])),
  );
  const [cityIds, setCityIds] = useState<Record<string, string>>(() =>
    Object.fromEntries(orders.map((order) => [order.id, order.cityId ?? ""])),
  );
  const [areaIds, setAreaIds] = useState<Record<string, string>>(() =>
    Object.fromEntries(orders.map((order) => [order.id, order.areaId ?? ""])),
  );
  const [drafts, setDrafts] = useState<Record<string, BookingDraft>>(() =>
    Object.fromEntries(orders.map((order) => [order.id, createBookingDraft(order)])),
  );
  const [validationRequested, setValidationRequested] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [globalInstructions, setGlobalInstructions] = useState("");
  const [autoGenerateTracking, setAutoGenerateTracking] = useState(true);
  const [isDownloadingSlips, setIsDownloadingSlips] = useState(false);
  const [isPrintingInvoice, setIsPrintingInvoice] = useState(false);

  // Booking progress modal
  const [bookingModalOpen, setBookingModalOpen] = useState(false);
  const [bookingPhase, setBookingPhase] = useState<"booking" | "done">("booking");
  const [bookingSnapshot, setBookingSnapshot] = useState<BookingSnapshotItem[]>([]);

  // Post-booking polling: revalidate loader up to 4 times (every 30 s) so
  // fulfilled orders move to the Fulfilled tab without a manual refresh.
  const [pollCount, setPollCount] = useState(0);
  const [pollingActive, setPollingActive] = useState(false);

  useEffect(() => {
    setRowCouriers((current) => {
      let changed = false;
      const next = { ...current };
      for (const order of orders) {
        if (!(order.id in next)) {
          next[order.id] = order.courierCode ?? "";
          changed = true;
        }
      }
      return changed ? next : current;
    });

    setCityIds((current) => {
      let changed = false;
      const next = { ...current };
      for (const order of orders) {
        if (!(order.id in next)) {
          next[order.id] = order.cityId ?? "";
          changed = true;
        }
      }
      return changed ? next : current;
    });

    setAreaIds((current) => {
      let changed = false;
      const next = { ...current };
      for (const order of orders) {
        if (!(order.id in next)) {
          next[order.id] = order.areaId ?? "";
          changed = true;
        }
      }
      return changed ? next : current;
    });

    setDrafts((current) => {
      let changed = false;
      const next = { ...current };
      for (const order of orders) {
        if (!(order.id in next)) {
          next[order.id] = createBookingDraft(order);
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [orders]);

  // Booking results arrived — flip the modal to its "done" phase. The modal
  // itself renders per-order success/failure; we no longer use the page notice
  // for booking (it was being cleared immediately by clearSelection before).
  useEffect(() => {
    const data = bookingFetcher.data as any;
    if (!data || data.intent !== "bookOrders") return;
    setBookingPhase("done");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookingFetcher.data]);

  useEffect(() => {
    const data = cancelFetcher.data as any;
    if (!data || data.intent !== "cancelOrders") return;
    if (data.success) {
      setNotice(`${data.cancelled} order${data.cancelled !== 1 ? "s" : ""} cancelled.`);
      clearSelection();
      revalidator.revalidate();
    } else {
      setNotice(data.error ?? "Cancel failed.");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cancelFetcher.data]);

  // Custom tab created/updated/deleted — close the modal and refresh the list.
  useEffect(() => {
    const data = tabFetcher.data as any;
    if (!data || !["createCustomTab", "updateCustomTab", "deleteCustomTab"].includes(data.intent)) return;
    if (data.success) {
      setTabModalOpen(false);
      setEditingTab(null);
      setDeletingTab(null);
      revalidator.revalidate();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabFetcher.data]);

  // Start polling when booking succeeds with at least one booked order.
  useEffect(() => {
    const data = bookingFetcher.data as any;
    if (!data || data.intent !== "bookOrders" || !data.success) return;
    if ((data.booked?.length ?? 0) > 0) {
      setPollingActive(true);
      setPollCount(0);
    }
  }, [bookingFetcher.data]);

  // Polling tick: revalidate loader every 30 s, max 4 times.
  useEffect(() => {
    if (!pollingActive) return;
    if (pollCount >= 4) { setPollingActive(false); return; }
    const id = setTimeout(() => {
      revalidator.revalidate();
      setPollCount((c) => c + 1);
    }, 30_000);
    return () => clearTimeout(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pollingActive, pollCount]);

  const courierOptions = useMemo<CourierSelectOption[]>(
    () => [
      { label: "Select courier", value: "" },
      ...shopCouriers.map((c) => ({ label: c.courierName, value: c.courierCode })),
    ],
    [shopCouriers],
  );
  // Shop-saved default service per courier (e.g. leopards → "OVERNIGHT" /
  // "DETAIN"). The ShipmentEditor uses it as the preferred fallback when the
  // current draft.serviceLevel isn't valid for the selected city.
  const shopCourierDefaults = useMemo(
    () =>
      Object.fromEntries(
        shopCouriers.map((c) => [
          c.courierCode,
          (c.credentials?.defaultShipmentType as string) || "",
        ]),
      ),
    [shopCouriers],
  );
  const courierFilterOptions = useMemo(
    () => [
      { label: "All couriers", value: "all" },
      ...shopCouriers.map((c) => ({ label: c.courierName, value: c.courierCode })),
    ],
    [shopCouriers],
  );

  const cityNameById = useMemo(
    () => new Map(cities.map((city) => [city.id, city.name])),
    [cities],
  );
  const cityMappingsById = useMemo(
    () =>
      new Map<string, Record<string, any> | null>(
        cities.map((city) => [city.id, (city.courierMappings as Record<string, any> | null) ?? null]),
      ),
    [cities],
  );
  const cityLabels = useMemo(
    () =>
      Object.fromEntries(
        orders.map((order) => [
          order.id,
          cityNameById.get(cityIds[order.id] ?? "") ?? order.city ?? "City missing",
        ]),
      ),
    [cityIds, cityNameById, orders],
  );

  const cityFilterOptions = useMemo(() => {
    const cityNames = Array.from(new Set(Object.values(cityLabels).filter(Boolean))).sort();
    return [
      { label: "All cities", value: "all" },
      ...cityNames.map((cityName) => ({ label: cityName, value: cityName })),
    ];
  }, [cityLabels]);

  // All distinct tags present on loaded orders — feeds the custom-tab tag picker.
  const availableTags = useMemo(() => {
    const set = new Set<string>();
    for (const o of orders) for (const t of o.tags) set.add(t);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [orders]);

  const currentTab = TABS[tabIndex] ?? TABS[0];
  const effectiveTabFilters: TabFilters = useMemo(
    () => (dateOverride ? { ...currentTab.filters, dateRange: dateOverride } : currentTab.filters),
    [currentTab, dateOverride],
  );

  const filteredOrders = useMemo(() => {
    const searchTerm = search.trim().toLowerCase();

    return orders.filter((order) => {
      if (!matchesTab(order, effectiveTabFilters)) return false;

      if (searchTerm) {
        const haystack = [
          order.orderName,
          order.customerName,
          order.phone,
          cityLabels[order.id],
          order.rawCity,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(searchTerm)) return false;
      }

      const currentCourier = rowCouriers[order.id] ?? order.courierCode ?? "";
      if (courierFilter !== "all" && currentCourier !== courierFilter) return false;
      if (cityFilter !== "all" && cityLabels[order.id] !== cityFilter) return false;

      return true;
    });
  }, [cityFilter, cityLabels, courierFilter, orders, rowCouriers, search, effectiveTabFilters]);

  const orderIndexMap = useMemo(() => new Map(orders.map((o, idx) => [o.id, idx])), [orders]);

  // Sort is computed from each order's PERSISTED state (not live edits), so
  // assigning a courier or city in a row doesn't make it jump position while
  // the user is working. Position only settles on reload/revalidate.
  const sortedOrders = useMemo(() => {
    const result = [...filteredOrders];
    if (sortBy === "issues") {
      const rankOf = (o: OrderRow) =>
        getOrderIssues(
          o,
          createBookingDraft(o),
          o.courierCode ?? "",
          o.cityId ?? "",
          cityNameById.get(o.cityId ?? ""),
          cityMappingsById.get(o.cityId ?? ""),
        ).length;
      result.sort((a, b) => {
        const countA = rankOf(a);
        const countB = rankOf(b);
        if (countA !== countB) return countB - countA; // more issues first
        return (orderIndexMap.get(a.id) ?? 0) - (orderIndexMap.get(b.id) ?? 0);
      });
    }
    return result;
  }, [filteredOrders, sortBy, cityNameById, cityMappingsById, orderIndexMap]);

  const selectedOrders = useMemo(
    () =>
      selectedIds
        .map((id) => orders.find((order) => order.id === id))
        .filter((order): order is OrderRow => Boolean(order)),
    [orders, selectedIds],
  );

  // Subsets each bulk action actually applies to — so a mixed selection of
  // unfulfilled + fulfilled orders does the right thing per action.
  const bookableSelected = useMemo(
    () =>
      selectedOrders.filter(
        (o) => (o.status === "pending" || o.status === "assigned") && o.orderStatus !== "Cancelled",
      ),
    [selectedOrders],
  );
  // Booked/fulfilled orders are the ones that have a courier booking — these are
  // the only ones with a slip to download or a booking to cancel.
  const fulfilledSelected = useMemo(
    () => selectedOrders.filter((o) => o.status === "booked" || o.status === "fulfilled"),
    [selectedOrders],
  );

  const totalCod = useMemo(
    () =>
      selectedOrders.reduce((sum, order) => {
        const draftAmount = Number(drafts[order.id]?.codAmount ?? order.codAmount);
        return sum + (Number.isNaN(draftAmount) ? 0 : draftAmount);
      }, 0),
    [drafts, selectedOrders],
  );

  const aggregateWeight = useMemo(
    () =>
      selectedOrders.reduce((sum, order) => {
        const weight = Number(drafts[order.id]?.weight ?? 0);
        return sum + (Number.isNaN(weight) ? 0 : weight);
      }, 0),
    [drafts, selectedOrders],
  );

  const validationErrors = useMemo<ValidationMap>(() => {
    const errors: ValidationMap = {};

    for (const order of selectedOrders) {
      const draft = drafts[order.id] ?? createBookingDraft(order);
      const courierCode = rowCouriers[order.id] ?? order.courierCode ?? "";
      const mappedCityId = cityIds[order.id] ?? order.cityId ?? "";
      const orderErrors = getOrderIssues(
        order,
        draft,
        courierCode,
        mappedCityId,
        cityNameById.get(mappedCityId),
        cityMappingsById.get(mappedCityId),
      );

      if (orderErrors.length > 0) errors[order.id] = orderErrors;
    }

    return errors;
  }, [cityIds, drafts, rowCouriers, selectedOrders, cityNameById, cityMappingsById]);

  const attentionCount = Object.keys(validationErrors).length;
  const visibleValidationErrors = validationRequested ? validationErrors : {};

  const tabCounts = useMemo(
    () =>
      Object.fromEntries(
        TABS.map((tab) => [
          tab.id,
          // The active tab uses its date override (if any); other tabs always
          // count against their configured filters so their badges are stable.
          orders.filter((order) =>
            matchesTab(order, tab.id === currentTab.id ? effectiveTabFilters : tab.filters),
          ).length,
        ]),
      ),
    [orders, currentTab, effectiveTabFilters],
  );

  const selectOrder = (orderId: string, selected: boolean) => {
    setSelectedIds((current) => {
      if (selected) {
        return current.includes(orderId) ? current : [...current, orderId];
      }
      return current.filter((id) => id !== orderId);
    });
    if (!selected) {
      setRowCouriers((current) => ({ ...current, [orderId]: "" }));
    }
  };


  const selectAllVisible = (selected: boolean) => {
    const visibleIds = filteredOrders.map((order) => order.id);
    setSelectedIds((current) => {
      if (!selected) return current.filter((id) => !visibleIds.includes(id));
      return Array.from(new Set([...current, ...visibleIds]));
    });
    if (!selected) {
      setRowCouriers((current) => {
        const next = { ...current };
        for (const id of visibleIds) {
          next[id] = "";
        }
        return next;
      });
    }
  };

  const clearSelection = () => {
    setRowCouriers((current) => {
      const next = { ...current };
      for (const id of selectedIds) {
        next[id] = "";
      }
      return next;
    });
    setSelectedIds([]);
    setExpandedIds([]);
    setValidationRequested(false);
    setNotice(null);
  };

  const autoSelectCouriers = () => {
    const fallbackCourier = shopCouriers.find((c) => c.isDefault)?.courierCode ?? shopCouriers[0]?.courierCode ?? "";
    if (!fallbackCourier) return;

    setRowCouriers((current) => {
      const next = { ...current };
      for (const order of selectedOrders) {
        next[order.id] = next[order.id] || order.courierCode || fallbackCourier;
      }
      return next;
    });
    setNotice("Missing courier assignments were filled from active courier defaults.");
  };

  const validateBookings = () => {
    setValidationRequested(true);
    setNotice(
      attentionCount > 0
        ? `${attentionCount} queued ${attentionCount === 1 ? "order needs" : "orders need"} attention before booking.`
        : "All queued orders passed validation.",
    );
  };

  const bookAllSelected = () => {
    setValidationRequested(true);

    // Only unfulfilled, non-cancelled orders can be booked. A fulfilled order
    // must be cancelled before it can be re-booked.
    const toBook = bookableSelected;
    if (toBook.length === 0) {
      setNotice("None of the selected orders can be booked (they're already booked, fulfilled, or cancelled).");
      return;
    }

    if (attentionCount > 0) {
      setNotice("Resolve the highlighted queue issues before booking all selected orders.");
      return;
    }

    const inputs = toBook.map((order) => {
      const draft = drafts[order.id] ?? createBookingDraft(order);
      return {
        orderId: order.id,
        orderName: order.orderName,
        courierCode: rowCouriers[order.id] ?? order.courierCode ?? "",
        cityId: cityIds[order.id] ?? order.cityId ?? "",
        draft: {
          customerName: draft.customerName,
          phone: draft.phone,
          addressLine1: draft.addressLine1,
          addressLine2: draft.addressLine2,
          codAmount: draft.codAmount,
          weight: draft.weight,
          instructions: globalInstructions || draft.instructions,
          serviceLevel: draft.serviceLevel,
        },
      };
    });

    const snapshot: BookingSnapshotItem[] = toBook.map((order) => {
      const draft = drafts[order.id] ?? createBookingDraft(order);
      return {
        orderId: order.id,
        orderName: order.orderName,
        customerName: draft.customerName || order.customerName,
        city: cityLabels[order.id] ?? order.city,
        courierLabel: getCourierLabel(rowCouriers[order.id] ?? order.courierCode ?? "", courierOptions),
        codAmount: Number(draft.codAmount ?? order.codAmount) || 0,
      };
    });

    setBookingSnapshot(snapshot);
    setBookingPhase("booking");
    setBookingModalOpen(true);

    bookingFetcher.submit(
      { intent: "bookOrders", orders: JSON.stringify(inputs) },
      { method: "post" },
    );
  };

  const closeBookingModal = () => {
    setBookingModalOpen(false);
    clearSelection();
  };

  const cancelSelected = () => {
    const ids = fulfilledSelected.map((o) => o.id);
    if (ids.length === 0) {
      setNotice("None of the selected orders have an active booking to cancel.");
      return;
    }
    cancelFetcher.submit(
      { intent: "cancelOrders", orderIds: JSON.stringify(ids) },
      { method: "post" },
    );
  };

  const downloadSlipsFor = async (orderIds: string[]) => {
    if (orderIds.length === 0 || isDownloadingSlips) return;
    setIsDownloadingSlips(true);
    try {
      const formData = new FormData();
      formData.append("orderIds", JSON.stringify(orderIds));

      // Posts to a dedicated resource route (api.slips) so the raw PDF Response
      // is returned untouched. App Bridge patches fetch to attach the Shopify
      // session token, so this authenticates like the React Router fetchers.
      const res = await fetch("/api/slips", { method: "POST", body: formData });

      const contentType = res.headers.get("content-type") ?? "";
      if (!res.ok || !contentType.includes("application/pdf")) {
        const detail = contentType.includes("application/json")
          ? await res.json().catch(() => ({}))
          : {};
        throw new Error(detail.error ?? `Slip generation failed (${res.status})`);
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `slips-${new Date().toISOString().split("T")[0]}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setNotice(`Slip generation failed: ${err.message}`);
    } finally {
      setIsDownloadingSlips(false);
    }
  };

  const downloadSlips = () => {
    const ids = fulfilledSelected.map((o) => o.id);
    if (ids.length === 0) {
      setNotice("None of the selected orders have a slip to download (only booked/fulfilled orders do).");
      return;
    }
    downloadSlipsFor(ids);
  };

  const printInvoice = async () => {
    if (selectedIds.length === 0 || isPrintingInvoice) return;
    setIsPrintingInvoice(true);
    try {
      const formData = new FormData();
      formData.append("orderIds", JSON.stringify(selectedIds));
      const res = await fetch("/api/invoices", { method: "POST", body: formData });
      const contentType = res.headers.get("content-type") ?? "";
      if (!res.ok || !contentType.includes("application/pdf")) {
        const detail = contentType.includes("application/json")
          ? await res.json().catch(() => ({}))
          : {};
        throw new Error(detail.error ?? `Invoice generation failed (${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `invoices-${new Date().toISOString().split("T")[0]}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setNotice(`Invoice generation failed: ${err.message}`);
    } finally {
      setIsPrintingInvoice(false);
    }
  };

  const refreshOrders = () => {
    revalidator.revalidate();
  };

  const openCreateTab = () => {
    setEditingTab(null);
    setTabModalOpen(true);
  };

  const openEditTab = (tab: TabConfig) => {
    setEditingTab(tab);
    setTabModalOpen(true);
  };

  const saveCustomTab = (draft: CustomTabDraft) => {
    const payload: Record<string, string> = {
      intent: editingTab ? "updateCustomTab" : "createCustomTab",
      name: draft.name,
      filters: JSON.stringify(draft.filters),
      actionButtons: JSON.stringify(draft.actionButtons),
    };
    if (editingTab) payload.id = editingTab.id;
    tabFetcher.submit(payload, { method: "post" });
  };

  const deleteCustomTab = (id: string) => {
    tabFetcher.submit({ intent: "deleteCustomTab", id }, { method: "post" });
    if (currentTab.id === id) setTabIndex(0);
  };

  const updateDraft = (orderId: string, patch: Partial<BookingDraft>) => {
    setDrafts((current) => {
      const order = orders.find((item) => item.id === orderId);
      if (!order && !current[orderId]) return current;

      return {
        ...current,
        [orderId]: {
          ...(current[orderId] ?? createBookingDraft(order!)),
          ...patch,
        },
      };
    });
  };

  const updateLocation = (orderId: string, cityId: string, areaId: string) => {
    setCityIds((current) => ({ ...current, [orderId]: cityId }));
    setAreaIds((current) => ({ ...current, [orderId]: areaId }));
  };

  const toggleExpanded = (orderId: string) => {
    setExpandedIds((current) =>
      current.includes(orderId)
        ? current.filter((id) => id !== orderId)
        : [...current, orderId],
    );
  };

  return (
    <main className="bmo-orders-shell">
      {noCouriers && (
        <div className="bmo-banner bmo-banner-warning" role="alert">
          <strong>No courier configured.</strong> Go to{" "}
          <a href="/app/settings">Settings → Courier</a> to add and enable a courier before booking orders.
        </div>
      )}

      <header className="bmo-page-header">
        <div>
          <span className="bmo-eyebrow">Book My Order</span>
          <h1>Orders</h1>
        </div>
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <button
            className="bmo-secondary-button"
            disabled={revalidator.state !== "idle"}
            type="button"
            onClick={refreshOrders}
          >
            {revalidator.state !== "idle" ? "Refreshing…" : "Refresh"}
          </button>
          <button
            className="bmo-primary-button"
            disabled={isSyncing}
            type="button"
            onClick={() => fetcher.submit({}, { method: "post" })}
          >
            {isSyncing ? "Syncing..." : "Sync orders"}
          </button>
        </div>
      </header>

      <section className="bmo-dashboard-strip" aria-label="Order summary">
        <div>
          <span>Visible</span>
          <strong>{filteredOrders.length}</strong>
        </div>
        <div>
          <span>Selected</span>
          <strong>{selectedIds.length}</strong>
        </div>
        <div>
          <span>Queued COD</span>
          <strong>{formatCod(totalCod)}</strong>
        </div>
        <div>
          <span>Unfulfilled</span>
          <strong>{tabCounts.unfulfilled ?? 0}</strong>
        </div>
      </section>

      <section className="bmo-orders-panel">
        <div className="bmo-panel-topbar">
          <div>
            <h2>Orders list</h2>
            <p>{filteredOrders.length} matching orders from the latest sync</p>
          </div>
        </div>

        <div className="bmo-tabs" role="tablist" aria-label="Order status">
          {TABS.map((tab, index) => {
            const active = tabIndex === index;
            return (
              <div key={tab.id} className={`bmo-tab${active ? " is-active" : ""}`}>
                <button
                  aria-selected={active}
                  className="bmo-tab-button"
                  role="tab"
                  type="button"
                  onClick={() => {
                    setTabIndex(index);
                    setDateOverride(null);
                  }}
                >
                  {tab.name}
                  <span>{tabCounts[tab.id] ?? 0}</span>
                </button>
                {tab.isCustom && (
                  <>
                    <button
                      className="bmo-tab-icon"
                      type="button"
                      aria-label={`Edit ${tab.name}`}
                      title="Edit tab"
                      onClick={() => openEditTab(tab)}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                      </svg>
                    </button>
                    <button
                      className="bmo-tab-icon bmo-tab-icon-danger"
                      type="button"
                      aria-label={`Delete ${tab.name}`}
                      title="Delete tab"
                      onClick={() => setDeletingTab(tab)}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                        <path d="M10 11v6" />
                        <path d="M14 11v6" />
                        <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                      </svg>
                    </button>
                  </>
                )}
              </div>
            );
          })}
          <button
            className="bmo-tab-add"
            type="button"
            onClick={openCreateTab}
            aria-label="Create custom tab"
            title="Create custom tab"
          >
            + Custom tab
          </button>
        </div>

        <div className="bmo-filter-row">
          <label className="bmo-search-field">
            <span>Search orders</span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Order #, customer, phone, city"
            />
          </label>
          <label className="bmo-filter-field">
            <span>Courier</span>
            <select value={courierFilter} onChange={(event) => setCourierFilter(event.target.value)}>
              {courierFilterOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="bmo-filter-field">
            <span>City</span>
            <select value={cityFilter} onChange={(event) => setCityFilter(event.target.value)}>
              {cityFilterOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="bmo-filter-field">
            <span>Date</span>
            <select
              value={(dateOverride?.preset ?? currentTab.filters.dateRange?.preset ?? "all")}
              onChange={(event) => {
                const preset = event.target.value as DateRangePreset;
                if (preset === "custom") {
                  setDateOverride({ preset, from: dateOverride?.from ?? null, to: dateOverride?.to ?? null });
                } else {
                  setDateOverride({ preset });
                }
              }}
            >
              {DATE_PRESET_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </label>
          {(dateOverride?.preset ?? currentTab.filters.dateRange?.preset) === "custom" && (
            <>
              <label className="bmo-filter-field">
                <span>From</span>
                <input
                  type="date"
                  value={dateOverride?.from ?? ""}
                  onChange={(event) =>
                    setDateOverride((d) => ({ preset: "custom", from: event.target.value || null, to: d?.to ?? null }))
                  }
                />
              </label>
              <label className="bmo-filter-field">
                <span>To</span>
                <input
                  type="date"
                  value={dateOverride?.to ?? ""}
                  onChange={(event) =>
                    setDateOverride((d) => ({ preset: "custom", from: d?.from ?? null, to: event.target.value || null }))
                  }
                />
              </label>
            </>
          )}
          <label className="bmo-filter-field">
            <span>Sort by</span>
            <select value={sortBy} onChange={(event) => setSortBy(event.target.value)}>
              <option value="issues">Issues (Default)</option>
              <option value="date">Date (Newest first)</option>
            </select>
          </label>
          <button
            className="bmo-ghost-button"
            type="button"
            onClick={() => {
              setSearch("");
              setCourierFilter("all");
              setCityFilter("all");
              setSortBy("issues");
              setDateOverride(null);
            }}
          >
            Clear filters
          </button>
        </div>

        {selectedOrders.length > 0 && currentTab.actionButtons.length > 0 && (
          <BookingActionBar
            actionButtons={currentTab.actionButtons}
            aggregateWeight={aggregateWeight}
            attentionCount={attentionCount}
            autoGenerateTracking={autoGenerateTracking}
            globalInstructions={globalInstructions}
            selectedCount={selectedOrders.length}
            totalCod={totalCod}
            bookableCount={bookableSelected.length}
            slipableCount={fulfilledSelected.length}
            cancellableCount={fulfilledSelected.length}
            isCancelling={isCancelling}
            isDownloadingSlips={isDownloadingSlips}
            isPrintingInvoice={isPrintingInvoice}
            onAutoGenerateTrackingChange={setAutoGenerateTracking}
            onAutoSelectCouriers={autoSelectCouriers}
            onBookAllSelected={bookAllSelected}
            onCancelSelected={cancelSelected}
            onDownloadSlips={downloadSlips}
            onPrintInvoice={printInvoice}
            onClearSelection={clearSelection}
            onGlobalInstructionsChange={setGlobalInstructions}
            onValidateBookings={validateBookings}
          />
        )}

        {notice && selectedOrders.length > 0 && (
          <div className="bmo-action-bar-notice">{notice}</div>
        )}
        {pollingActive && (
          <div className="bmo-action-bar-notice">
            Checking fulfillment status… ({pollCount}/4)
          </div>
        )}

        {filteredOrders.length === 0 ? (
          <div className="bmo-table-empty">
            <span>No matching orders</span>
            <h3>{orders.length === 0 ? "No orders synced yet" : "No orders in this view"}</h3>
            <p>
              {orders.length === 0
                ? "Sync Shopify orders to start building a booking queue."
                : "Try a different status tab or adjust the active filters."}
            </p>
            {orders.length === 0 && (
              <button
                className="bmo-primary-button"
                disabled={isSyncing}
                type="button"
                onClick={() => fetcher.submit({}, { method: "post" })}
              >
                {isSyncing ? "Syncing..." : "Sync orders"}
              </button>
            )}
          </div>
        ) : (
          <OrdersTable
            areaIds={areaIds}
            cities={cities.map((c) => ({ ...c, courierMappings: (c.courierMappings as Record<string, any> | null) ?? null }))}
            cityIds={cityIds}
            cityLabels={cityLabels}
            courierOptions={courierOptions}
            drafts={drafts}
            expandedIds={expandedIds}
            orders={sortedOrders}
            rowCouriers={rowCouriers}
            selectedIds={selectedIds}
            shopCourierDefaults={shopCourierDefaults}
            validationErrors={visibleValidationErrors}
            onCourierChange={(orderId, courierCode) =>
              setRowCouriers((current) => ({ ...current, [orderId]: courierCode }))
            }
            onDraftChange={updateDraft}
            onLocationChange={updateLocation}
            onSelectAllVisible={selectAllVisible}
            onToggleExpanded={toggleExpanded}
            onToggleSelected={selectOrder}
          />
        )}
      </section>

      <BookingProgressModal
        open={bookingModalOpen}
        phase={bookingPhase}
        orders={bookingSnapshot}
        details={(bookingFetcher.data as any)?.intent === "bookOrders" ? ((bookingFetcher.data as any).details ?? []) : []}
        topLevelError={(bookingFetcher.data as any)?.error}
        isDownloadingSlips={isDownloadingSlips}
        onDownloadSlips={downloadSlipsFor}
        onClose={closeBookingModal}
      />

      <CustomTabModal
        open={tabModalOpen}
        editing={editingTab}
        availableTags={availableTags}
        isSaving={isSavingTab}
        onSave={saveCustomTab}
        onDelete={(id) => {
          // From inside the editor modal, route through the same confirmation.
          const tab = customTabs.find((t) => t.id === id) ?? null;
          if (tab) {
            setTabModalOpen(false);
            setDeletingTab(tab);
          }
        }}
        onClose={() => {
          setTabModalOpen(false);
          setEditingTab(null);
        }}
      />

      {deletingTab && (
        <div
          className="bmo-modal-overlay is-visible"
          role="presentation"
          onClick={() => !isSavingTab && setDeletingTab(null)}
        >
          <div
            className="bmo-modal bmo-modal-confirm is-visible"
            role="dialog"
            aria-modal="true"
            aria-label="Confirm delete"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="bmo-modal-header">
              <div>
                <h2>Delete custom tab?</h2>
                <p>
                  This will remove the <strong>“{deletingTab.name}”</strong> tab. Your orders are not affected.
                </p>
              </div>
            </header>
            <footer className="bmo-modal-footer">
              <button
                className="bmo-ghost-button"
                type="button"
                disabled={isSavingTab}
                onClick={() => setDeletingTab(null)}
              >
                Cancel
              </button>
              <button
                className="bmo-danger-button"
                type="button"
                disabled={isSavingTab}
                onClick={() => deleteCustomTab(deletingTab.id)}
              >
                {isSavingTab ? "Deleting…" : "Delete tab"}
              </button>
            </footer>
          </div>
        </div>
      )}
    </main>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
