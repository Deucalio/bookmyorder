/**
 * app/services/area-matcher.server.ts
 *
 * Resolves a customer's free-text address (address1 / address2) to an Area
 * within an already-matched City. Designed for Pakistani addresses where:
 *
 *   - Sector codes are written inconsistently (G-11/1, G11/1, g 11/1, etc.)
 *   - Customers stuff landmarks, shop names, and instructions into address fields
 *   - Some orders mention only a zone (e.g., "Hayatabad") with no specific
 *     neighborhood
 *
 * Resolution strategy: a 4-stage cascade, stop at first hit.
 *
 *   Stage 1 — Substring scan: longest area name first, regex-bounded match
 *             inside the normalized address blob. Handles 90%+ of real cases.
 *
 *   Stage 2 — Token scan: split the address into tokens, check each against
 *             area names' first tokens. Catches partial mentions like
 *             "Hayatabad" matching "Hayatabad Industrial Estate".
 *
 *   Stage 3 — Fuzzy: Levenshtein distance, only on tokens of similar length.
 *             Catches typos like "hayatbad" → "hayatabad".
 *
 *   Stage 4 — Zone-only fallback: address mentions the zone but no specific
 *             area. Returns zone with no areaId so the order can still book
 *             at the zone level.
 *
 * Returns null only if all four stages miss; those orders go to manual review.
 *
 * Usage:
 *   import { matchArea } from "~/services/area-matcher.server";
 *   const result = await matchArea(cityId, order.address1, order.address2);
 *   if (result) {
 *     order.areaId = result.areaId || null;
 *     order.matchedZone = result.zone;
 *     order.areaMatchMethod = result.method;
 *     order.areaMatchConfidence = result.confidence;
 *   }
 */

import { distance } from "fastest-levenshtein";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// =============================================================================
// Public types
// =============================================================================
export type AreaMatchMethod =
  | "substring" // Stage 1: literal substring of address blob
  | "token" // Stage 2: address token == area's first token
  | "fuzzy" // Stage 3: Levenshtein distance under threshold
  | "zone-only"; // Stage 4: zone matched but no specific area

export type AreaMatch = {
  /** Empty string when method is 'zone-only' (no specific area resolved). */
  areaId: string;
  areaName: string;
  zone: string | null;
  /** 0.0 - 1.0. 1.0 = exact substring, lower for token / fuzzy / zone-only. */
  confidence: number;
  method: AreaMatchMethod;
};

// =============================================================================
// Configuration knobs (tune these against real delivery success data)
// =============================================================================
const CONFIG = {
  STAGE1_MIN_AREA_LEN: 8,
  /** Minimum token length to consider for matching. Skips noise like "no", "st". */
  MIN_TOKEN_LEN: 3,

  /** Minimum first-token length for Stage 2 token-scan match. */
  MIN_STAGE2_TOKEN_LEN: 4,

  /** Minimum token length for Stage 3 fuzzy comparison. */
  MIN_STAGE3_TOKEN_LEN: 4,

  /** Stage 3 Levenshtein similarity threshold (0-1). Lower = more permissive. */
  FUZZY_THRESHOLD: 0.85,

  /** Stage 3 max length difference between candidate and token (chars). */
  FUZZY_MAX_LEN_DIFF: 2,

  /** Penalty multiplier on fuzzy confidence (already-imperfect matches). */
  FUZZY_CONFIDENCE_PENALTY: 0.9,
};

// =============================================================================
// Address normalization
// =============================================================================

/**
 * Pakistani sector codes (G-11/1, F-7/2, I-8/4, D 12, etc.) appear in many
 * inconsistent forms. Collapse all variants to a single canonical token like
 * "g11_1" so substring matching finds them regardless of how the customer
 * typed them.
 *
 * Pattern: single letter + digits + optional /digits or -digits subsector.
 * Requires the letter to be either standalone or directly attached/separated
 * from a digit, to avoid mangling unrelated single letters.
 */
const SECTOR_RX = /\b([a-z])(?:-|\/|\s)?(\d{1,2})(?:[-/](\d{1,2}))?\b/gi;

function normalizeSectors(s: string): string {
  return s.replace(
    SECTOR_RX,
    (match, letter: string, num: string, sub?: string) => {
      // Heuristic guard: bare single letter followed by space + number
      // (e.g. "a 1 bedroom") is too aggressive. Only fire when letter and digits
      // are joined OR explicitly punctuated together.
      const original = match;
      const isJoined = /^[a-z]\d/i.test(original);
      const isPunctuated = /^[a-z][-/]/i.test(original);
      if (!isJoined && !isPunctuated) return match;

      const base = `${letter.toLowerCase()}${num}`;
      return sub ? `${base}_${sub}` : base;
    },
  );
}

/** Strip everything except letters, digits, spaces, and underscores (sector marker). */
const NOISE_RX = /[^\p{L}\p{N}\s_]/gu;

/**
 * Address-aware normalization. Order matters:
 *   1. lowercase
 *   2. collapse sector codes (must run before separators are stripped)
 *   3. strip noise punctuation
 *   4. collapse whitespace
 */

const CONNECTORS_RX = /\b(e|ul|al|i|wal|wala)\b/g;

function normalize(s: string | null | undefined): string {
  if (!s) return '';
  let out = s.toLowerCase();
  // Collapse single-letter dot sequences BEFORE we strip dots:
  // F.B → FB, I.I → II, P.E.C.H.S → PECHS, M.A → MA
  out = out.replace(
    /\b([a-z])\.([a-z])\.?([a-z])?\.?([a-z])?\.?([a-z])?\b/g,
    (_, a, b, c, d, e) => [a, b, c, d, e].filter(Boolean).join(''),
  );
  out = applyTypoFixes(out);
  out = normalizeSectors(out);
  out = out.replace(NOISE_RX, ' ');
  out = out.replace(/\s+/g, ' ').trim();
  out = out.replace(CONNECTORS_RX, '').replace(/\s+/g, ' ').trim();
  return out;
}
/**
 * Common Urdu/English words customers stuff into addresses that should never
 * be treated as area-name candidates. Filtered out at tokenization time so
 * Stage 2 / Stage 3 don't waste cycles on them.
 */
const STOPWORDS = new Set([
  "house",
  "home",
  "flat",
  "plot",
  "apt",
  "apartment",
  "floor",
  "street",
  "st",
  "road",
  "rd",
  "lane",
  "gali",
  "mohallah",
  "muhalla",
  "block",
  "sector",
  "phase",
  "town",
  "colony",
  "society",
  "no",
  "number",
  "near",
  "opposite",
  "opp",
  "behind",
  "shop",
  "market",
  "bazar",
  "bazaar",
  "plaza",
  "tower",
  "main",
  "side",
  "pakistan",
  "pak",
]);

const FUZZY_DENY_FIRST_TOKENS = new Set([
  // City names
  'karachi', 'lahore', 'islamabad', 'faisalabad', 'multan', 'peshawar',
  'rawalpindi', 'gujranwala', 'sialkot', 'quetta', 'hyderabad',
  // Zone names that are also area-name first tokens
  'korangi', 'malir', 'clifton', 'gulshan', 'gulistan',
  'nazimabad', 'landhi', 'orangi', 'saadi',
  // Generic place words
  'block', 'sector', 'phase', 'street', 'house', 'plot', 'flat',
  'main', 'colony', 'town', 'society', 'gali', 'lane', 'road',
  'muslim', 'green', 'new', 'old', 'north', 'south', 'east', 'west',

  'area', 'avenue', 'park', 'garden', 'city', 'centre', 'center',
'apartment', 'tower', 'plaza', 'masjid', 'mosque',
]);

/**
 * Common Pakistani address typos. Applied during normalization so address
 * tokens match canonical area names. Add new entries as you find them in
 * unmatched samples.
 */
const COMMON_TYPOS: Array<[RegExp, string]> = [
  [/\bbahira\b/g, 'bahria'],
  [/\bmehmod/g, 'mehmood'],
  [/\bnazimbad\b/g, 'nazimabad'],
  [/\bsoilder\b/g, 'soldier'],
  [/\bkemari\b/g, 'keamari'],
  [/\bbufferzone\b/g, 'buffer zone'],
  [/\bgulistan e johar\b/g, 'gulistan-e-johar'],
  
  [/\bmehmood\s+abad\b/g, 'mehmoodabad'],
   [/\bnazmabad\b/g, 'nazimabad'],
   [/\bgulstan\b/g, 'gulistan'],
   [/\bsaaditown\b/g, 'saadi town'],
   [/\bscheme(\d)/g, 'scheme $1'],
];

function applyTypoFixes(s: string): string {
  let out = s;
  for (const [rx, replacement] of COMMON_TYPOS) {
    out = out.replace(rx, replacement);
  }
  return out;
}

function tokenize(blob: string): string[] {
  return blob
    .split(" ")
    .filter((t) => t.length >= CONFIG.MIN_TOKEN_LEN && !STOPWORDS.has(t));
}

/** Escape user-supplied string for safe use inside a RegExp. */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
// =============================================================================
// Indexed area loader
// =============================================================================
//
// No in-memory cache: every call to loadAreasForCity hits Postgres. This is
// safe across serverless instances (Vercel) at the cost of one query per call.
//
// For batch workloads (importing many orders for one city, or the test harness)
// callers should call loadAreasForCity ONCE for that city, then call
// matchAreaWithIndex repeatedly against the result.
//
// For multi-city batches, use loadAreasForCities to fetch every needed city
// in a single Postgres query, then dispatch matches per-city.

export type IndexedArea = {
  id: string;
  name: string;
  zone: string | null;
  /** Primary normalized name (the canonical Area.name). */
  norm: string;
  /** All normalized forms: [primaryNorm, ...aliasNorms]. Stage 1/1.5 try each. */
  norms: string[];
  /** First whitespace-delimited token of the primary norm. */
  firstToken: string;
};

function indexAreaRow(a: {
  id: string;
  name: string;
  zone: string | null;
  aliases: string[];
}): IndexedArea {
  const primary = normalize(a.name);
  const aliasNorms = (a.aliases ?? [])
    .map((al) => normalize(al))
    .filter((n) => n.length > 0 && n !== primary);
  const allNorms = Array.from(
    new Set([primary, ...aliasNorms].filter((n) => n.length > 0)),
  );
  return {
    id: a.id,
    name: a.name,
    zone: a.zone,
    norm: primary,
    norms: allNorms,
    firstToken: primary.split(' ')[0] ?? '',
  };
}

/**
 * Load and index all areas for a single city.
 * One Postgres query. Use this once before a batch of matches for that city.
 */
export async function loadAreasForCity(
  cityId: string,
): Promise<IndexedArea[]> {
  const rows = await prisma.area.findMany({
    where: { cityId },
    select: { id: true, name: true, zone: true, aliases: true },
  });
  return rows.map(indexAreaRow);
}

/**
 * Load and index areas for many cities in a single Postgres query.
 * Returns a Map keyed by cityId. Use this for multi-city batch jobs.
 *
 * Example — processing 1000 orders spread across 50 cities:
 *   const uniqueCityIds = [...new Set(orders.map(o => o.cityId))];
 *   const areasByCity = await loadAreasForCities(uniqueCityIds);
 *   for (const order of orders) {
 *     const areas = areasByCity.get(order.cityId) ?? [];
 *     const match = matchAreaWithIndex(areas, order.address1, order.address2);
 *   }
 *
 * Cost: 1 Postgres query total, regardless of how many cities.
 */
export async function loadAreasForCities(
  cityIds: string[],
): Promise<Map<string, IndexedArea[]>> {
  const unique = Array.from(new Set(cityIds));
  if (unique.length === 0) return new Map();

  const rows = await prisma.area.findMany({
    where: { cityId: { in: unique } },
    select: { id: true, cityId: true, name: true, zone: true, aliases: true },
  });

  const out = new Map<string, IndexedArea[]>();
  for (const id of unique) out.set(id, []);
  for (const row of rows) {
    const indexed = indexAreaRow(row);
    out.get(row.cityId)?.push(indexed);
  }
  return out;
}

/**
 * No-op kept for callers that still import this name. Cache was removed.
 * Safe to delete the import sites later.
 */
export function invalidateAreaCache(_cityId?: string): void {
  // intentionally empty
}

// =============================================================================
// The matcher
// =============================================================================

/**
 * Match an address to an Area within `cityId`.
 *
 * @param cityId    Pre-resolved canonical city ID (from your city matcher)
 * @param address1  Required. Customer's primary address line.
 * @param address2  Optional. Secondary address line (apt, landmark, etc.)
 * @returns AreaMatch on hit, null on miss → caller should send to review.
 */
export type MatchAreaOptions = {
  /**
   * Minimum confidence required for a match to be returned. Any match below
   * this floor is treated as a miss and the function returns null (caller
   * should send to review queue).
   *
   * Default: 0 (return any match, no floor).
   *
   * Useful values:
   *   1.0  - only accept perfect substring matches (Stage 1)
   *   0.85 - accept substring + token, reject fuzzy and zone-only
   *   0.7  - accept substring + token + good fuzzy, reject zone-only
   *   0.6  - accept everything (default cascade behavior)
   */
  minConfidence?: number;
};

/**
 * Pure synchronous matcher. Takes a pre-loaded, pre-indexed area list and
 * matches a single address against it. No DB calls.
 *
 * Use this directly when you've batched the area load (test scripts, queue
 * workers, multi-order import jobs). For one-shot callers, use matchArea
 * which loads + matches in one step.
 */
export function matchAreaWithIndex(
  areas: IndexedArea[],
  address1: string | null | undefined,
  address2?: string | null | undefined,
  options: MatchAreaOptions = {},
): AreaMatch | null {
  const minConfidence = options.minConfidence ?? 0;
  const blob = normalize(`${address1 ?? ''} ${address2 ?? ''}`);
  if (!blob) return null;
  if (areas.length === 0) return null;

  // Helper: enforces the minConfidence floor on every candidate match
  const gate = (match: AreaMatch): AreaMatch | null =>
    match.confidence >= minConfidence ? match : null;

  // ──────────────────────────────────────────────────────────────────────
  // Pre-compute zone names appearing in the address blob — used by Stage 1
  // (disambiguation) and Stage 1.5 (zone + short-area composite).
  // ──────────────────────────────────────────────────────────────────────
  const zonesInAddress = new Set<string>();
  const allZones = new Set(
    areas.map((x) => x.zone).filter((z): z is string => !!z),
  );
  for (const z of allZones) {
    const zNorm = normalize(z);
    if (
      zNorm.length >= 3 &&
      new RegExp(`\\b${escapeRegex(zNorm)}\\b`).test(blob)
    ) {
      zonesInAddress.add(z);
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  // Stage 1 — Substring scan, longest norm first (across primary + aliases)
  // ──────────────────────────────────────────────────────────────────────
  type Candidate = { area: IndexedArea; norm: string };
  const candidates: Candidate[] = [];
  for (const a of areas) {
    for (const n of a.norms) {
      if (n.length >= CONFIG.STAGE1_MIN_AREA_LEN) {
        candidates.push({ area: a, norm: n });
      }
    }
  }
  candidates.sort((x, y) => y.norm.length - x.norm.length);

  for (const { area: a, norm: n } of candidates) {
    const rx = new RegExp(`\\b${escapeRegex(n)}\\b`);
    if (!rx.test(blob)) continue;

    let chosen = a;
    if (zonesInAddress.size > 0 && a.zone && !zonesInAddress.has(a.zone)) {
      const better = areas.find(
        (x) =>
          x.norm === a.norm &&
          x.zone &&
          zonesInAddress.has(x.zone) &&
          x.id !== a.id,
      );
      if (better) chosen = better;
    }

    const m: AreaMatch = {
      areaId: chosen.id,
      areaName: chosen.name,
      zone: chosen.zone,
      confidence: 1.0,
      method: 'substring',
    };
    const gated = gate(m);
    if (gated) return gated;
    break;
  }

  // ──────────────────────────────────────────────────────────────────────
  // Stage 1.5 — Zone + short-area composite match
  // ──────────────────────────────────────────────────────────────────────
  if (zonesInAddress.size > 0) {
    type ShortCandidate = { area: IndexedArea; norm: string };
    const shortCandidates: ShortCandidate[] = [];
    for (const a of areas) {
      if (!a.zone || !zonesInAddress.has(a.zone)) continue;
      for (const n of a.norms) {
        if (n.length >= 4 && n.length < CONFIG.STAGE1_MIN_AREA_LEN) {
          shortCandidates.push({ area: a, norm: n });
        }
      }
    }
    shortCandidates.sort((x, y) => y.norm.length - x.norm.length);

    for (const { area: a, norm: n } of shortCandidates) {
      const rx = new RegExp(`\\b${escapeRegex(n)}\\b`);
      if (rx.test(blob)) {
        const m: AreaMatch = {
          areaId: a.id,
          areaName: a.name,
          zone: a.zone,
          confidence: 0.95,
          method: 'substring',
        };
        const gated = gate(m);
        if (gated) return gated;
        break;
      }
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  // Stage 2 — Token scan
  // ──────────────────────────────────────────────────────────────────────
  const tokens = tokenize(blob);
  const tokenSet = new Set(tokens);

  for (const a of areas) {
    if (a.firstToken.length < CONFIG.MIN_STAGE2_TOKEN_LEN) continue;
    if (tokenSet.has(a.firstToken)) {
      const m: AreaMatch = {
        areaId: a.id,
        areaName: a.name,
        zone: a.zone,
        confidence: 0.85,
        method: 'token',
      };
      const gated = gate(m);
      if (gated) return gated;
      break;
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  // Stage 3 — Multi-token fuzzy
  // ──────────────────────────────────────────────────────────────────────
  let best: { area: IndexedArea; score: number } | null = null;

  for (const a of areas) {
    const candidateTokens = a.norm
      .split(' ')
      .filter((t) => t.length >= CONFIG.MIN_STAGE3_TOKEN_LEN);
    if (candidateTokens.length === 0) continue;

    const meaningfulCandidates = candidateTokens.filter(
      (t) => !FUZZY_DENY_FIRST_TOKENS.has(t),
    );
    if (meaningfulCandidates.length === 0) continue;
    if (
      meaningfulCandidates.length === 1 &&
      meaningfulCandidates[0].length < 6
    )
      continue;

    let hits = 0;
    for (const ct of meaningfulCandidates) {
      let matched = false;
      for (const at of tokens) {
        if (Math.abs(at.length - ct.length) > CONFIG.FUZZY_MAX_LEN_DIFF)
          continue;
        const d = distance(at, ct);
        const score = 1 - d / Math.max(at.length, ct.length);
        if (score >= CONFIG.FUZZY_THRESHOLD) {
          matched = true;
          break;
        }
      }
      if (matched) hits++;
    }

    const required = Math.max(1, Math.ceil(meaningfulCandidates.length / 2));
    if (hits >= required) {
      const score = hits / meaningfulCandidates.length;
      if (!best || score > best.score) {
        best = { area: a, score };
      }
    }
  }

  if (best) {
    const m: AreaMatch = {
      areaId: best.area.id,
      areaName: best.area.name,
      zone: best.area.zone,
      confidence: best.score * CONFIG.FUZZY_CONFIDENCE_PENALTY,
      method: 'fuzzy',
    };
    const gated = gate(m);
    if (gated) return gated;
  }

  // ──────────────────────────────────────────────────────────────────────
  // Stage 4 — Zone-only fallback
  // ──────────────────────────────────────────────────────────────────────
  const zoneSet = new Set(
    areas.map((a) => a.zone).filter((z): z is string => !!z),
  );
  const zonesByLen = [...zoneSet].sort((a, b) => b.length - a.length);

  for (const z of zonesByLen) {
    const zNorm = normalize(z);
    if (zNorm.length < CONFIG.MIN_TOKEN_LEN) continue;
    const rx = new RegExp(`\\b${escapeRegex(zNorm)}\\b`);
    if (rx.test(blob)) {
      const m: AreaMatch = {
        areaId: '',
        areaName: '',
        zone: z,
        confidence: 0.6,
        method: 'zone-only',
      };
      const gated = gate(m);
      if (gated) return gated;
      break;
    }
  }

  return null;
}

/**
 * Async wrapper for one-shot callers: loads areas for the city, then matches.
 * Costs 1 Postgres query per call. For batch workloads, prefer the explicit
 * loadAreasForCity / loadAreasForCities + matchAreaWithIndex pattern.
 */
export async function matchArea(
  cityId: string,
  address1: string | null | undefined,
  address2?: string | null | undefined,
  options: MatchAreaOptions = {},
): Promise<AreaMatch | null> {
  const areas = await loadAreasForCity(cityId);
  if (areas.length === 0) return null;
  return matchAreaWithIndex(areas, address1, address2, options);
}

// =============================================================================
// Test helpers (exported for unit tests; not used in production code paths)
// =============================================================================
export const __test = {
  normalize,
  normalizeSectors,
  tokenize,
};
