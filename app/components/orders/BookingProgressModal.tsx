import { useEffect, useMemo, useState } from "react";

import type { BookOrderResultDetail } from "../../services/bookOrders.server";
import { formatCod } from "./orderUi";

export type BookingSnapshotItem = {
  orderId: string;
  orderName: string;
  customerName: string;
  city: string | null;
  courierLabel: string;
  codAmount: number;
};

type BookingProgressModalProps = {
  open: boolean;
  phase: "booking" | "done";
  orders: BookingSnapshotItem[];
  details: BookOrderResultDetail[];
  topLevelError?: string;
  isDownloadingSlips: boolean;
  onDownloadSlips: (orderIds: string[]) => void;
  onClose: () => void;
};

export function BookingProgressModal({
  open,
  phase,
  orders,
  details,
  topLevelError,
  isDownloadingSlips,
  onDownloadSlips,
  onClose,
}: BookingProgressModalProps) {
  // Drive the enter/exit animation without unmounting mid-transition.
  const [render, setRender] = useState(open);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (open) {
      setRender(true);
      const id = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(id);
    }
    setVisible(false);
    const id = setTimeout(() => setRender(false), 200);
    return () => clearTimeout(id);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && phase === "done") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, phase, onClose]);

  const detailByName = useMemo(
    () => new Map(details.map((d) => [d.orderName, d])),
    [details],
  );

  const successIds = useMemo(
    () =>
      orders
        .filter((o) => detailByName.get(o.orderName)?.status === "success")
        .map((o) => o.orderId),
    [orders, detailByName],
  );

  const successCount = successIds.length;
  const failedCount = phase === "done" ? orders.length - successCount : 0;

  if (!render) return null;

  return (
    <div
      className={`bmo-modal-overlay${visible ? " is-visible" : ""}`}
      role="presentation"
      onClick={() => phase === "done" && onClose()}
    >
      <div
        className={`bmo-modal${visible ? " is-visible" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label="Booking progress"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="bmo-modal-header">
          <div>
            <h2>
              {phase === "booking"
                ? "Booking orders…"
                : successCount === orders.length
                  ? "All orders booked"
                  : successCount === 0
                    ? "Booking failed"
                    : "Booking complete"}
            </h2>
            <p>
              {phase === "booking"
                ? `Submitting ${orders.length} ${orders.length === 1 ? "order" : "orders"} to the courier…`
                : `${successCount} booked · ${failedCount} failed`}
            </p>
          </div>
          {phase === "done" && (
            <button
              className="bmo-modal-close"
              type="button"
              aria-label="Close"
              onClick={onClose}
            >
              ×
            </button>
          )}
        </header>

        {topLevelError && phase === "done" && successCount === 0 && (
          <div className="bmo-modal-banner">{topLevelError}</div>
        )}

        <div className="bmo-modal-body">
          {orders.map((order) => {
            const detail = detailByName.get(order.orderName);
            const state =
              phase === "booking"
                ? "loading"
                : detail?.status === "success"
                  ? "success"
                  : "failed";

            return (
              <div key={order.orderId} className={`bmo-booking-row is-${state}`}>
                <span className="bmo-booking-status" aria-hidden="true">
                  {state === "loading" && <span className="bmo-spinner" />}
                  {state === "success" && <span className="bmo-tick">✓</span>}
                  {state === "failed" && <span className="bmo-cross">✕</span>}
                </span>

                <div className="bmo-booking-info">
                  <div className="bmo-booking-info-top">
                    <strong>{order.orderName}</strong>
                    <span className="bmo-booking-courier">{order.courierLabel}</span>
                  </div>
                  <div className="bmo-booking-info-sub">
                    {order.customerName}
                    {order.city ? ` · ${order.city}` : ""} · {formatCod(order.codAmount)}
                  </div>

                  {state === "loading" && (
                    <div className="bmo-booking-message bmo-booking-pending">
                      Booking with courier…
                    </div>
                  )}
                  {state === "success" && (
                    <div className="bmo-booking-message bmo-booking-ok">
                      {detail?.trackingNumber
                        ? `Tracking #${detail.trackingNumber}`
                        : "Booked"}
                      {detail && detail.fulfillmentMarked === false
                        ? " · Shopify fulfillment not marked"
                        : ""}
                    </div>
                  )}
                  {state === "failed" && (
                    <div className="bmo-booking-message bmo-booking-error">
                      {detail?.error ?? topLevelError ?? "Booking failed"}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <footer className="bmo-modal-footer">
          {phase === "done" && successCount > 0 && (
            <button
              className="bmo-primary-button"
              type="button"
              disabled={isDownloadingSlips}
              onClick={() => onDownloadSlips(successIds)}
            >
              {isDownloadingSlips
                ? "Generating…"
                : `Download Slip${successCount === 1 ? "" : "s"} (${successCount})`}
            </button>
          )}
          <button
            className="bmo-secondary-button"
            type="button"
            disabled={phase === "booking"}
            onClick={onClose}
          >
            {phase === "booking" ? "Please wait…" : "Close"}
          </button>
        </footer>
      </div>
    </div>
  );
}
