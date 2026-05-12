/**
 * app/services/address-match-log.server.ts
 *
 * Persists every address-match attempt and merchant correction so we have
 * ground truth to derive new aliases and improve the matcher over time.
 *
 * Workflow:
 *   1. Order arrives → call matchArea() → call logMatchAttempt() with the result.
 *      Stores rawAddress + matcher output + outcome ('auto_matched' or 'unmatched').
 *   2. Merchant reviews in UI:
 *        - Confirms → applyCorrection(logId, { confirmed: true })
 *        - Changes  → applyCorrection(logId, { chosenAreaId, chosenCityId })
 *        - Picks for a previously unmatched order → same applyCorrection call.
 *   3. A weekly cron (not implemented here) reads rows where outcome ∈
 *      ['corrected', 'manual_picked'] and aliasReviewed = false, surfaces
 *      candidate aliases for human approval.
 */

import prisma from './../db.server';
import type { AreaMatch } from '../../scripts/area-matcher-server';

export type LogMatchAttemptInput = {
  shopId?: string | null;
  orderId?: string | null;
  rawAddress1: string;
  rawAddress2?: string | null;
  rawCity?: string | null;
  matchedCityId?: string | null;
  /** Result from matchArea(). null = unmatched. */
  match: AreaMatch | null;
};

/**
 * Record a match attempt. Returns the log row's id (use it for correction later).
 * Never throws — logging should not block order flow. Errors are swallowed
 * and surfaced via console.error.
 */
export async function logMatchAttempt(
  input: LogMatchAttemptInput,
): Promise<string | null> {
  try {
    const outcome = input.match ? 'auto_matched' : 'unmatched';
    const row = await prisma.addressMatchLog.create({
      data: {
        shopId: input.shopId ?? null,
        orderId: input.orderId ?? null,
        rawAddress1: input.rawAddress1,
        rawAddress2: input.rawAddress2 ?? null,
        rawCity: input.rawCity ?? null,
        matchedCityId: input.matchedCityId ?? null,
        matchedAreaId: input.match?.areaId || null,
        matchMethod: input.match?.method ?? null,
        matchConfidence: input.match?.confidence ?? null,
        matchedZone: input.match?.zone ?? null,
        outcome,
      },
      select: { id: true },
    });
    return row.id;
  } catch (err) {
    console.error('[address-match-log] failed to log attempt:', err);
    return null;
  }
}

export type ApplyCorrectionInput = {
  logId: string;
  /** Merchant's chosen area. If unchanged, omit and pass `confirmed: true`. */
  chosenAreaId?: string | null;
  /** Merchant's chosen city (if they corrected city too). */
  chosenCityId?: string | null;
  /** True when merchant explicitly accepts the matcher's suggestion. */
  confirmed?: boolean;
};

export async function applyCorrection(input: ApplyCorrectionInput) {
  const existing = await prisma.addressMatchLog.findUnique({
    where: { id: input.logId },
    select: {
      matchedAreaId: true,
      matchedCityId: true,
      outcome: true,
    },
  });
  if (!existing) {
    throw new Error(`AddressMatchLog ${input.logId} not found`);
  }

  // Decide the new outcome based on what the merchant did
  let outcome: string;
  if (input.confirmed && !input.chosenAreaId && !input.chosenCityId) {
    outcome = 'confirmed';
  } else if (existing.outcome === 'unmatched') {
    outcome = 'manual_picked';
  } else {
    // Was auto_matched; merchant changed something
    const sameArea = input.chosenAreaId === existing.matchedAreaId;
    const sameCity = input.chosenCityId === existing.matchedCityId;
    outcome = sameArea && sameCity ? 'confirmed' : 'corrected';
  }

  return prisma.addressMatchLog.update({
    where: { id: input.logId },
    data: {
      chosenAreaId: input.chosenAreaId ?? existing.matchedAreaId ?? null,
      chosenCityId: input.chosenCityId ?? existing.matchedCityId ?? null,
      chosenAt: new Date(),
      outcome,
    },
  });
}

/** Review queue: rows the merchant should look at. */
export async function getReviewQueue(opts: {
  shopId: string;
  limit?: number;
  onlyUnmatched?: boolean;
}) {
  const where: Record<string, unknown> = {
    shopId: opts.shopId,
    chosenAt: null, // not yet reviewed
  };
  if (opts.onlyUnmatched) {
    where.outcome = 'unmatched';
  } else {
    where.outcome = { in: ['unmatched', 'auto_matched'] };
  }

  return prisma.addressMatchLog.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: opts.limit ?? 50,
  });
}