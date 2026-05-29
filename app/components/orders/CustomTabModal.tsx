import { useEffect, useState } from "react";

import {
  ACTION_BUTTON_OPTIONS,
  DATE_PRESET_OPTIONS,
  FINANCIAL_STATUS_OPTIONS,
  FULFILLMENT_STATUS_OPTIONS,
  ORDER_STATUS_OPTIONS,
  type ActionButtonId,
  type DateRange,
  type DateRangePreset,
  type FinancialStatusValue,
  type FulfillmentStatusValue,
  type OrderStatusValue,
  type TabConfig,
  type TabFilters,
} from "./tabConfig";

export type CustomTabDraft = {
  name: string;
  filters: TabFilters;
  actionButtons: ActionButtonId[];
};

type CustomTabModalProps = {
  open: boolean;
  editing: TabConfig | null;
  availableTags: string[];
  isSaving: boolean;
  onSave: (draft: CustomTabDraft) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
};

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

function Chip({
  label,
  selected,
  onClick,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`bmo-chip-toggle${selected ? " is-selected" : ""}`}
      aria-pressed={selected}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

export function CustomTabModal({
  open,
  editing,
  availableTags,
  isSaving,
  onSave,
  onDelete,
  onClose,
}: CustomTabModalProps) {
  const [render, setRender] = useState(open);
  const [visible, setVisible] = useState(false);

  const [name, setName] = useState("");
  const [fulfillmentStatuses, setFulfillmentStatuses] = useState<FulfillmentStatusValue[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [financialStatuses, setFinancialStatuses] = useState<FinancialStatusValue[]>([]);
  const [orderStatuses, setOrderStatuses] = useState<OrderStatusValue[]>([]);
  const [dateRange, setDateRange] = useState<DateRange>({ preset: "all" });
  const [actionButtons, setActionButtons] = useState<ActionButtonId[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Seed the form whenever the modal opens (create = blank, edit = existing).
  useEffect(() => {
    if (!open) return;
    const f = editing?.filters ?? {};
    setName(editing?.name ?? "");
    setFulfillmentStatuses(f.fulfillmentStatuses ?? []);
    setTags(f.tags ?? []);
    setFinancialStatuses(f.financialStatuses ?? []);
    setOrderStatuses(f.orderStatuses ?? []);
    setDateRange(f.dateRange ?? { preset: "all" });
    setActionButtons(editing?.actionButtons ?? []);
    setError(null);
  }, [open, editing]);

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

  if (!render) return null;

  const handleSave = () => {
    if (!name.trim()) {
      setError("Please enter a tab name.");
      return;
    }
    const filters: TabFilters = {};
    if (fulfillmentStatuses.length) filters.fulfillmentStatuses = fulfillmentStatuses;
    if (tags.length) filters.tags = tags;
    if (financialStatuses.length) filters.financialStatuses = financialStatuses;
    if (orderStatuses.length) filters.orderStatuses = orderStatuses;
    if (dateRange.preset !== "all") filters.dateRange = dateRange;

    onSave({ name: name.trim(), filters, actionButtons });
  };

  return (
    <div
      className={`bmo-modal-overlay${visible ? " is-visible" : ""}`}
      role="presentation"
      onClick={onClose}
    >
      <div
        className={`bmo-modal bmo-modal-wide${visible ? " is-visible" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={editing ? "Edit custom tab" : "Create custom tab"}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="bmo-modal-header">
          <div>
            <h2>{editing ? "Edit Custom Tab" : "Create Custom Tab"}</h2>
            <p>Configure filters and action buttons for this tab</p>
          </div>
          <button className="bmo-modal-close" type="button" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </header>

        <div className="bmo-modal-body">
          {error && <div className="bmo-modal-banner">{error}</div>}

          <label className="bmo-field">
            <span>Tab Name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. My Priority Orders"
            />
          </label>

          <div className="bmo-tabcfg-section">
            <h3>Filters</h3>

            <div className="bmo-tabcfg-group">
              <span className="bmo-tabcfg-label">Fulfillment Statuses</span>
              <div className="bmo-chip-row">
                {FULFILLMENT_STATUS_OPTIONS.map((opt) => (
                  <Chip
                    key={opt.value}
                    label={opt.label}
                    selected={fulfillmentStatuses.includes(opt.value)}
                    onClick={() => setFulfillmentStatuses((s) => toggle(s, opt.value))}
                  />
                ))}
              </div>
            </div>

            <div className="bmo-tabcfg-group">
              <span className="bmo-tabcfg-label">Tags</span>
              {availableTags.length > 0 ? (
                <div className="bmo-chip-row">
                  {availableTags.map((tag) => (
                    <Chip
                      key={tag}
                      label={tag}
                      selected={tags.includes(tag)}
                      onClick={() => setTags((s) => toggle(s, tag))}
                    />
                  ))}
                </div>
              ) : (
                <p className="bmo-tabcfg-empty">No tags found on your orders yet.</p>
              )}
            </div>

            <div className="bmo-tabcfg-group">
              <span className="bmo-tabcfg-label">Financial Statuses</span>
              <div className="bmo-chip-row">
                {FINANCIAL_STATUS_OPTIONS.map((opt) => (
                  <Chip
                    key={opt.value}
                    label={opt.label}
                    selected={financialStatuses.includes(opt.value)}
                    onClick={() => setFinancialStatuses((s) => toggle(s, opt.value))}
                  />
                ))}
              </div>
            </div>

            <div className="bmo-tabcfg-group">
              <span className="bmo-tabcfg-label">Statuses</span>
              <div className="bmo-chip-row">
                {ORDER_STATUS_OPTIONS.map((opt) => (
                  <Chip
                    key={opt.value}
                    label={opt.label}
                    selected={orderStatuses.includes(opt.value)}
                    onClick={() => setOrderStatuses((s) => toggle(s, opt.value))}
                  />
                ))}
              </div>
            </div>

            <div className="bmo-tabcfg-group">
              <span className="bmo-tabcfg-label">Date Range</span>
              <div className="bmo-chip-row" style={{ alignItems: "center", gap: "8px" }}>
                <select
                  className="bmo-tabcfg-select"
                  value={dateRange.preset}
                  onChange={(e) => {
                    const preset = e.target.value as DateRangePreset;
                    setDateRange(preset === "custom" ? { preset, from: null, to: null } : { preset });
                  }}
                >
                  {DATE_PRESET_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
                {dateRange.preset === "custom" && (
                  <>
                    <input
                      type="date"
                      className="bmo-tabcfg-select"
                      value={dateRange.from ?? ""}
                      onChange={(e) => setDateRange((d) => ({ ...d, preset: "custom", from: e.target.value || null }))}
                    />
                    <input
                      type="date"
                      className="bmo-tabcfg-select"
                      value={dateRange.to ?? ""}
                      onChange={(e) => setDateRange((d) => ({ ...d, preset: "custom", to: e.target.value || null }))}
                    />
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="bmo-tabcfg-section">
            <h3>Action Buttons</h3>
            <p className="bmo-tabcfg-subtle">Choose which batch actions appear when this tab is active</p>
            <div className="bmo-chip-row">
              {ACTION_BUTTON_OPTIONS.map((opt) => (
                <Chip
                  key={opt.value}
                  label={opt.label}
                  selected={actionButtons.includes(opt.value)}
                  onClick={() => setActionButtons((s) => toggle(s, opt.value))}
                />
              ))}
            </div>
          </div>
        </div>

        <footer className="bmo-modal-footer">
          {editing && (
            <button
              className="bmo-danger-button"
              type="button"
              disabled={isSaving}
              style={{ marginRight: "auto" }}
              onClick={() => onDelete(editing.id)}
            >
              Delete tab
            </button>
          )}
          <button className="bmo-ghost-button" type="button" onClick={onClose} disabled={isSaving}>
            Cancel
          </button>
          <button className="bmo-primary-button" type="button" onClick={handleSave} disabled={isSaving}>
            {isSaving ? "Saving…" : editing ? "Save changes" : "Create tab"}
          </button>
        </footer>
      </div>
    </div>
  );
}
