// Lazy-loaded tracking timeline rendered inside an expanded order row.

import { useEffect, useState } from "react";
import { Badge, InlineStack, Text, Spinner } from "@shopify/polaris";

type TrackingEvent = {
  id: string;
  status: string;
  description: string | null;
  location: string | null;
  receiver: string | null;
  reason: string | null;
  at: string;
};

type ResponsePayload = {
  fulfillmentId: string;
  lastStatus: string | null;
  lastSyncedAt: string | null;
  events: TrackingEvent[];
};

type Props = {
  fulfillmentId: string;
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

function prettify(status: string | null) {
  if (!status) return "Awaiting first sync";
  return status.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

function toneFor(status: string | null) {
  return status ? TONE_MAP[status] ?? "info" : "info";
}

export function TrackingTimeline({ fulfillmentId }: Props) {
  const [data, setData] = useState<ResponsePayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setData(null);
    fetch(`/api/tracking/${fulfillmentId}`)
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return (await response.json()) as ResponsePayload;
      })
      .then((json) => {
        if (!cancelled) setData(json);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [fulfillmentId]);

  if (error) {
    return (
      <div className="bmo-tracking-card is-error">
        <Text as="p" tone="critical">
          Failed to load tracking: {error}
        </Text>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="bmo-tracking-card">
        <InlineStack gap="200" blockAlign="center">
          <Spinner size="small" />
          <Text as="span">Loading tracking events...</Text>
        </InlineStack>
      </div>
    );
  }

  if (data.events.length === 0) {
    return (
      <div className="bmo-tracking-card is-empty">
        <Text as="p" tone="subdued">
          No tracking events yet. The next daily sync will pick this up.
        </Text>
      </div>
    );
  }

  return (
    <div className="bmo-tracking-card">
      <div className="bmo-tracking-header">
        <div>
          <Text as="h3" variant="headingSm">Tracking timeline</Text>
          <Text as="p" tone="subdued" variant="bodySm">
            {data.lastSyncedAt
              ? `Last synced ${new Date(data.lastSyncedAt).toLocaleString()}`
              : "Waiting for the first courier sync"}
          </Text>
        </div>
        <Badge tone={toneFor(data.lastStatus)}>
          {prettify(data.lastStatus)}
        </Badge>
      </div>

      <div className="bmo-tracking-timeline">
        {data.events.map((event, index) => (
          <article
            key={event.id}
            className={index === 0 ? "bmo-tracking-event is-latest" : "bmo-tracking-event"}
          >
            <div className="bmo-tracking-dot" aria-hidden="true" />
            <div className="bmo-tracking-time">
              <span>{new Date(event.at).toLocaleDateString()}</span>
              <strong>{new Date(event.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</strong>
            </div>
            <div className="bmo-tracking-body">
              <span className={`bmo-tracking-status-badge tone-${toneFor(event.status)}`}>
                {prettify(event.status)}
              </span>
              <p>{event.description ?? "No description from courier."}</p>
              {(event.location || event.receiver || event.reason) && (
                <small>
                  {[event.location, event.receiver && `Received by: ${event.receiver}`, event.reason && `Reason: ${event.reason}`]
                    .filter(Boolean)
                    .join(" | ")}
                </small>
              )}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
