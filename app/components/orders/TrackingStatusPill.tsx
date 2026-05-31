// Small status badge shown on every row whose order was booked via our app
// and has tracking data. Renders on every tab (default + custom) because
// it's based on the row's `tracking` field, not the active tab filter.

import { Badge, Tooltip } from "@shopify/polaris";

type Props = {
  status: string | null;
  fetchedAt: string | null;
};

const TONE_MAP: Record<string, "success" | "info" | "warning" | "critical" | "attention"> = {
  DELIVERED: "success",
  OUT_FOR_DELIVERY: "attention",
  IN_TRANSIT: "info",
  AT_STATION: "info",
  ASSIGNED: "info",
  PICKED_UP: "info",
  BOOKED: "info",
  READY_FOR_RETURN: "warning",
  RETURNED: "critical",
  FAILED: "critical",
};

function prettify(s: string | null) {
  if (!s) return "Awaiting first sync";
  return s.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

export function TrackingStatusPill({ status, fetchedAt }: Props) {
  const tone = status ? TONE_MAP[status] ?? "info" : "info";
  const label = prettify(status);
  const fetchedLabel = fetchedAt
    ? `Synced ${new Date(fetchedAt).toLocaleString()}`
    : "Not yet synced";
  return (
    <Tooltip content={fetchedLabel}>
      <Badge tone={tone}>{label}</Badge>
    </Tooltip>
  );
}
