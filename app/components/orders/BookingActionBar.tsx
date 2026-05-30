import { useEffect, useRef, useState } from "react";

import { formatCod } from "./orderUi";
import type { ActionButtonId } from "./tabConfig";

type BookingActionBarProps = {
  actionButtons: ActionButtonId[];
  selectedCount: number;
  totalCod: number;
  aggregateWeight: number;
  attentionCount: number;
  // Counts of the selected orders each action actually applies to.
  bookableCount: number;
  slipableCount: number;
  cancellableCount: number;
  globalInstructions: string;
  autoGenerateTracking: boolean;
  isCancelling: boolean;
  isDownloadingSlips: boolean;
  isPrintingInvoice: boolean;
  onAutoSelectCouriers: () => void;
  onValidateBookings: () => void;
  onBookAllSelected: () => void;
  onCancelSelected: () => void;
  onDownloadSlips: () => void;
  onPrintInvoice: () => void;
  onClearSelection: () => void;
  onGlobalInstructionsChange: (value: string) => void;
  onAutoGenerateTrackingChange: (value: boolean) => void;
};

export function BookingActionBar({
  actionButtons,
  selectedCount,
  totalCod,
  aggregateWeight,
  attentionCount,
  bookableCount,
  slipableCount,
  cancellableCount,
  globalInstructions,
  autoGenerateTracking,
  isCancelling,
  isDownloadingSlips,
  isPrintingInvoice,
  onAutoSelectCouriers,
  onValidateBookings,
  onBookAllSelected,
  onCancelSelected,
  onDownloadSlips,
  onPrintInvoice,
  onClearSelection,
  onGlobalInstructionsChange,
  onAutoGenerateTrackingChange,
}: BookingActionBarProps) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsRef = useRef<HTMLDivElement | null>(null);

  const showBook = actionButtons.includes("bookOrders");
  const showCancel = actionButtons.includes("cancelBooking");
  const showDownload = actionButtons.includes("downloadSlips");
  const showInvoice = actionButtons.includes("printInvoice");

  useEffect(() => {
    if (!settingsOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (settingsRef.current && !settingsRef.current.contains(event.target as Node)) {
        setSettingsOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [settingsOpen]);

  return (
    <div className="bmo-action-bar" aria-label="Order actions">
      <div className="bmo-action-bar-stats">
        <div className="bmo-action-stat">
          <span>Selected</span>
          <strong>
            {selectedCount} {selectedCount === 1 ? "order" : "orders"}
          </strong>
        </div>
        <span className="bmo-action-divider" aria-hidden="true" />
        <div className="bmo-action-stat">
          <span>COD total</span>
          <strong>{formatCod(totalCod)}</strong>
        </div>
        {showBook && (
          <>
            <span className="bmo-action-divider" aria-hidden="true" />
            <div className="bmo-action-stat">
              <span>Weight</span>
              <strong>{aggregateWeight.toFixed(1)} kg</strong>
            </div>
            <span className="bmo-action-divider" aria-hidden="true" />
            <div className="bmo-action-stat">
              <span>Needs attention</span>
              <strong className={attentionCount > 0 ? "bmo-attention-flag" : ""}>
                {attentionCount}
              </strong>
            </div>
          </>
        )}
      </div>

      <div className="bmo-action-bar-buttons">
        {showBook && (
          <>
            <button className="bmo-secondary-button" type="button" onClick={onAutoSelectCouriers}>
              Auto-select couriers
            </button>
            <button className="bmo-secondary-button" type="button" onClick={onValidateBookings}>
              Validate
              {attentionCount > 0 && <span className="bmo-button-count">{attentionCount}</span>}
            </button>
            <button
              className="bmo-primary-button"
              type="button"
              disabled={bookableCount === 0}
              title={bookableCount === 0 ? "No unfulfilled orders in the selection" : undefined}
              onClick={onBookAllSelected}
            >
              Book selected{bookableCount > 0 ? ` (${bookableCount})` : ""}
            </button>
          </>
        )}
        {showCancel && (
          <button
            className="bmo-danger-button"
            type="button"
            disabled={isCancelling || cancellableCount === 0}
            title={cancellableCount === 0 ? "No booked orders in the selection" : undefined}
            onClick={onCancelSelected}
          >
            {isCancelling ? "Cancelling…" : `Cancel booking${cancellableCount > 0 ? ` (${cancellableCount})` : ""}`}
          </button>
        )}
        {showDownload && (
          <button
            className="bmo-secondary-button"
            type="button"
            disabled={isDownloadingSlips || slipableCount === 0}
            title={slipableCount === 0 ? "No booked orders with slips in the selection" : undefined}
            onClick={onDownloadSlips}
          >
            {isDownloadingSlips ? "Generating…" : `Download Slips${slipableCount > 0 ? ` (${slipableCount})` : ""}`}
          </button>
        )}
        {showInvoice && (
          <button
            className="bmo-secondary-button"
            type="button"
            disabled={isPrintingInvoice || selectedCount === 0}
            onClick={onPrintInvoice}
          >
            {isPrintingInvoice ? "Generating…" : `Print Invoice (${selectedCount})`}
          </button>
        )}
        <button className="bmo-ghost-button" type="button" onClick={onClearSelection}>
          Clear selection
        </button>

        {showBook && (
          <div className="bmo-action-settings" ref={settingsRef}>
            <button
              aria-expanded={settingsOpen}
              aria-label="Booking settings"
              className={settingsOpen ? "bmo-icon-button is-active" : "bmo-icon-button"}
              type="button"
              onClick={() => setSettingsOpen((open) => !open)}
            >
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">
                <path
                  d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                />
                <path
                  d="M19.4 13a7.8 7.8 0 0 0 0-2l2-1.6-2-3.4-2.4 1a7.7 7.7 0 0 0-1.7-1l-.4-2.5h-4l-.4 2.5a7.7 7.7 0 0 0-1.7 1l-2.4-1-2 3.4 2 1.6a7.8 7.8 0 0 0 0 2l-2 1.6 2 3.4 2.4-1a7.7 7.7 0 0 0 1.7 1l.4 2.5h4l.4-2.5a7.7 7.7 0 0 0 1.7-1l2.4 1 2-3.4-2-1.6Z"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinejoin="round"
                />
              </svg>
            </button>

            {settingsOpen && (
              <div className="bmo-settings-popover" role="group" aria-label="Booking settings">
                <div className="bmo-toggle-row">
                  <label htmlFor="bmo-auto-generate-tracking">
                    <strong>Auto-generate tracking</strong>
                    <small>Create tracking references as bookings are submitted.</small>
                  </label>
                  <input
                    id="bmo-auto-generate-tracking"
                    checked={autoGenerateTracking}
                    type="checkbox"
                    onChange={(event) => onAutoGenerateTrackingChange(event.target.checked)}
                  />
                </div>
                <label className="bmo-field">
                  <span>Global delivery instructions</span>
                  <textarea
                    rows={3}
                    value={globalInstructions}
                    onChange={(event) => onGlobalInstructionsChange(event.target.value)}
                    placeholder="Handle with care, delivery timing, rider notes..."
                  />
                </label>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
