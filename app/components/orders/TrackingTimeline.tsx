// Lazy-loaded vertical tracking timeline rendered inside an expanded order
// row. Fetches /api/tracking/:fulfillmentId on mount; shows a small skeleton
// while loading and a friendly message when the upstream has no events yet.

import { useEffect, useState } from "react";
import { Badge, BlockStack, InlineStack, Text, Spinner, Card } from "@shopify/polaris";

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

export function TrackingTimeline({ fulfillmentId }: Props) {
  const [data, setData] = useState<ResponsePayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setData(null);
    fetch(`/api/tracking/${fulfillmentId}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return (await r.json()) as ResponsePayload;
      })
      .then((json) => {
        if (!cancelled) setData(json);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [fulfillmentId]);

  if (error) {
    return (
      <Card>
        <Text as="p" tone="critical">
          Failed to load tracking: {error}
        </Text>
      </Card>
    );
  }
  if (!data) {
    return (
      <Card>
        <InlineStack gap="200" blockAlign="center">
          <Spinner size="small" />
          <Text as="span">Loading tracking events…</Text>
        </InlineStack>
      </Card>
    );
  }
  if (data.events.length === 0) {
    return (
      <Card>
        <Text as="p" tone="subdued">
          No tracking events yet. The next daily sync will pick this up.
        </Text>
      </Card>
    );
  }

  return (
    <Card>
      <BlockStack gap="300">
        <Text as="h3" variant="headingSm">
          Tracking timeline
        </Text>
        <BlockStack gap="200">
          {data.events.map((e) => (
            <InlineStack key={e.id} gap="300" align="start">
              <div style={{ minWidth: 140 }}>
                <Text as="span" tone="subdued" variant="bodySm">
                  {new Date(e.at).toLocaleString()}
                </Text>
              </div>
              <Badge>{e.status.replace(/_/g, " ")}</Badge>
              <BlockStack gap="050">
                <Text as="span" variant="bodySm">
                  {e.description ?? "—"}
                </Text>
                {(e.receiver || e.reason) && (
                  <Text as="span" tone="subdued" variant="bodySm">
                    {[e.receiver && `Received by: ${e.receiver}`, e.reason && `Reason: ${e.reason}`]
                      .filter(Boolean)
                      .join(" · ")}
                  </Text>
                )}
              </BlockStack>
            </InlineStack>
          ))}
        </BlockStack>
      </BlockStack>
    </Card>
  );
}
