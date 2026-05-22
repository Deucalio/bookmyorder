import { useEffect, useMemo, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { BookingActionBar } from "../components/orders/BookingActionBar";
import { OrdersTable } from "../components/orders/OrdersTable";
import { createBookingDraft, formatCod, getOrderIssues } from "../components/orders/orderUi";
import type {
  BookingDraft,
  CourierSelectOption,
  OrderRow,
  OrderStatus,
  ValidationMap,
} from "../components/orders/types";
import { getActiveCouriers } from "../config/couriers";
import prisma from "../db.server";
import { applyCorrection } from "../services/address-match-log.server";
import { syncRecentOrders, syncShopData } from "../services/sync.server";
import { authenticate } from "../shopify.server";

function deriveStatus(
  fulfillmentStatus: string,
  fulfillments: { status: string; deliveryOutcome: string }[],
): OrderStatus {
  if (fulfillmentStatus === "FULFILLED") return "fulfilled";
  if (fulfillments.length === 0) return "pending";
  const latest = fulfillments[fulfillments.length - 1];
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

  if (!shopRecord) return { orders: [] as OrderRow[], cities: [] as { id: string; name: string }[] };

  const dbOrders = await prisma.order.findMany({
    where: { shopId: shopRecord.id },
    include: {
      fulfillments: { orderBy: { createdAt: "asc" } },
      city: { select: { name: true } },
      area: { select: { name: true } },
      addressMatchLog: { select: { matchConfidence: true, matchMethod: true } },
    },
    orderBy: { shopifyCreatedAt: "desc" },
    take: 250,
  });

  const cities = await prisma.city.findMany({
    select: { id: true, name: true, courierMappings: true },
    orderBy: { name: "asc" },
  });

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
    areaMatchConfidence: order.addressMatchLog?.matchConfidence ?? null,
    areaMatchMethod: order.addressMatchLog?.matchMethod ?? null,
  }));

  return { orders, cities };
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

    const order = await prisma.order.update({
      where: { id: orderId },
      data: { cityId, areaId },
      select: { addressMatchLogId: true },
    });

    if (order.addressMatchLogId) {
      await applyCorrection({
        logId: order.addressMatchLogId,
        chosenCityId: cityId,
        chosenAreaId: areaId,
      }).catch((err) => {
        console.error("applyCorrection failed:", err);
      });
    }

    return { success: true };
  }

  await syncShopData(session, admin);
  await syncRecentOrders(session, admin, 10);
  return { synced: true };
};

const TABS = [
  { id: "pending", label: "Pending Booking", status: "pending" as const },
  { id: "booked", label: "Booked", status: "booked" as const },
  { id: "fulfilled", label: "Fulfilled", status: "fulfilled" as const },
  { id: "failed", label: "Failed", status: "failed" as const },
];

const getTabMatch = (order: OrderRow, status: OrderStatus) => {
  if (status === "pending") return order.status === "pending" || order.status === "assigned";
  return order.status === status;
};

export default function OrdersPage() {
  const { orders, cities } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const isSyncing = fetcher.state !== "idle";

  const [tabIndex, setTabIndex] = useState(0);
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

  const activeCouriers = useMemo(() => getActiveCouriers(), []);
  const courierOptions = useMemo<CourierSelectOption[]>(
    () => [
      { label: "Select courier", value: "" },
      ...activeCouriers.map((courier) => ({ label: courier.name, value: courier.code })),
    ],
    [activeCouriers],
  );
  const courierFilterOptions = useMemo(
    () => [
      { label: "All couriers", value: "all" },
      ...activeCouriers.map((courier) => ({ label: courier.name, value: courier.code })),
    ],
    [activeCouriers],
  );

  const cityNameById = useMemo(
    () => new Map(cities.map((city) => [city.id, city.name])),
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

  const filteredOrders = useMemo(() => {
    const activeStatus = TABS[tabIndex]?.status ?? "pending";
    const searchTerm = search.trim().toLowerCase();

    return orders.filter((order) => {
      if (!getTabMatch(order, activeStatus)) return false;

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
  }, [cityFilter, cityLabels, courierFilter, orders, rowCouriers, search, tabIndex]);

  const orderIndexMap = useMemo(() => new Map(orders.map((o, idx) => [o.id, idx])), [orders]);

  const sortedOrders = useMemo(() => {
    const result = [...filteredOrders];
    if (sortBy === "issues") {
      result.sort((a, b) => {
        const draftA = drafts[a.id] ?? createBookingDraft(a);
        const courierA = rowCouriers[a.id] ?? a.courierCode ?? "";
        const cityA = cityIds[a.id] ?? a.cityId ?? "";
        const countA = getOrderIssues(a, draftA, courierA, cityA, cityNameById.get(cityA)).length;

        const draftB = drafts[b.id] ?? createBookingDraft(b);
        const courierB = rowCouriers[b.id] ?? b.courierCode ?? "";
        const cityB = cityIds[b.id] ?? b.cityId ?? "";
        const countB = getOrderIssues(b, draftB, courierB, cityB, cityNameById.get(cityB)).length;

        if (countA !== countB) {
          return countB - countA; // Orders with more issues come first
        }
        return (orderIndexMap.get(a.id) ?? 0) - (orderIndexMap.get(b.id) ?? 0); // Chronological stable fallback
      });
    }
    return result;
  }, [filteredOrders, sortBy, drafts, rowCouriers, cityIds, orderIndexMap]);

  const selectedOrders = useMemo(
    () =>
      selectedIds
        .map((id) => orders.find((order) => order.id === id))
        .filter((order): order is OrderRow => Boolean(order)),
    [orders, selectedIds],
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
      const orderErrors = getOrderIssues(order, draft, courierCode, mappedCityId, cityNameById.get(mappedCityId));

      if (orderErrors.length > 0) errors[order.id] = orderErrors;
    }

    return errors;
  }, [cityIds, drafts, rowCouriers, selectedOrders]);

  const attentionCount = Object.keys(validationErrors).length;
  const visibleValidationErrors = validationRequested ? validationErrors : {};

  const tabCounts = useMemo(
    () =>
      Object.fromEntries(
        TABS.map((tab) => [
          tab.id,
          orders.filter((order) => getTabMatch(order, tab.status)).length,
        ]),
      ),
    [orders],
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
    const fallbackCourier = activeCouriers[0]?.code ?? "";
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

    if (attentionCount > 0) {
      setNotice("Resolve the highlighted queue issues before booking all selected orders.");
      return;
    }

    const payload = selectedOrders.map((order) => ({
      orderId: order.id,
      orderName: order.orderName,
      courierCode: rowCouriers[order.id] ?? order.courierCode ?? "",
      cityId: cityIds[order.id] ?? order.cityId ?? "",
      areaId: areaIds[order.id] ?? order.areaId ?? "",
      shipment: drafts[order.id] ?? createBookingDraft(order),
    }));

    console.log("Book selected orders", {
      autoGenerateTracking,
      globalInstructions,
      orders: payload,
    });
    setNotice(`${selectedOrders.length} selected ${selectedOrders.length === 1 ? "order is" : "orders are"} ready for booking.`);
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
      <header className="bmo-page-header">
        <div>
          <span className="bmo-eyebrow">Book My Order</span>
          <h1>Orders</h1>
          <p>Scan orders, assign couriers, and book shipments without leaving the page.</p>
        </div>
        <button
          className="bmo-primary-button"
          disabled={isSyncing}
          type="button"
          onClick={() => fetcher.submit({}, { method: "post" })}
        >
          {isSyncing ? "Syncing..." : "Sync orders"}
        </button>
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
          <span>Pending booking</span>
          <strong>{tabCounts.pending ?? 0}</strong>
        </div>
      </section>

      <section className="bmo-orders-panel">
        <div className="bmo-panel-topbar">
          <div>
            <h2>Orders list</h2>
            <p>{filteredOrders.length} matching orders from the latest sync</p>
          </div>
          <button
            className="bmo-secondary-button"
            disabled={selectedIds.length === 0}
            type="button"
            onClick={bookAllSelected}
          >
            Book selected
          </button>
        </div>

        <div className="bmo-tabs" role="tablist" aria-label="Order status">
          {TABS.map((tab, index) => (
            <button
              aria-selected={tabIndex === index}
              className={tabIndex === index ? "is-active" : ""}
              key={tab.id}
              role="tab"
              type="button"
              onClick={() => setTabIndex(index)}
            >
              {tab.label}
              <span>{tabCounts[tab.id] ?? 0}</span>
            </button>
          ))}
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
            }}
          >
            Clear filters
          </button>
        </div>

        {selectedOrders.length > 0 && (
          <BookingActionBar
            aggregateWeight={aggregateWeight}
            attentionCount={attentionCount}
            autoGenerateTracking={autoGenerateTracking}
            globalInstructions={globalInstructions}
            selectedCount={selectedOrders.length}
            totalCod={totalCod}
            onAutoGenerateTrackingChange={setAutoGenerateTracking}
            onAutoSelectCouriers={autoSelectCouriers}
            onBookAllSelected={bookAllSelected}
            onClearSelection={clearSelection}
            onGlobalInstructionsChange={setGlobalInstructions}
            onValidateBookings={validateBookings}
          />
        )}

        {notice && selectedOrders.length > 0 && (
          <div className="bmo-action-bar-notice">{notice}</div>
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
            cities={cities}
            cityIds={cityIds}
            cityLabels={cityLabels}
            courierOptions={courierOptions}
            drafts={drafts}
            expandedIds={expandedIds}
            orders={sortedOrders}
            rowCouriers={rowCouriers}
            selectedIds={selectedIds}
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
    </main>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
