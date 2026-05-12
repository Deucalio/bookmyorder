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
// In-memory area cache (per city)
// =============================================================================
//
// Areas don't change often. Caching the per-city area list with pre-normalized
// names avoids hitting Prisma + re-normalizing on every order.
//
// TTL: 1 hour. Call `invalidateAreaCache(cityId)` after admin updates an area.

// =============================================================================
// Indexed area loader
// =============================================================================
//
// Designed for serverless deploys (Vercel). No in-memory cache: each Lambda
// invocation queries Postgres directly. Prisma + indexed query on cityId
// returns the per-city area list in 10-30ms, which is negligible for an
// order-booking flow. This avoids stale-cache bugs across instances.

type IndexedArea = {
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

async function getAreasForCity(cityId: string): Promise<IndexedArea[]> {
  const rows = await prisma.area.findMany({
    where: { cityId },
    select: { id: true, name: true, zone: true, aliases: true },
  });

  return rows.map((a) => {
    const primary = normalize(a.name);
    // Normalize each alias, drop empties, dedupe against primary
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
  });
}

/**
 * No-op kept for backwards compatibility with code that imported it
 * (e.g., the aliases API route). Safe to remove the import sites later.
 */
export function invalidateAreaCache(_cityId?: string): void {
  // Intentionally empty: no in-memory cache to invalidate.
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

export async function matchArea(
  cityId: string,
  address1: string | null | undefined,
  address2?: string | null | undefined,
  options: MatchAreaOptions = {},
): Promise<AreaMatch | null> {
  const minConfidence = options.minConfidence ?? 0;
  const blob = normalize(`${address1 ?? ""} ${address2 ?? ""}`);
  if (!blob) return null;

  const areas = await getAreasForCity(cityId);
  if (areas.length === 0) return null;

  // Helper: enforces the minConfidence floor on every candidate match
  const gate = (match: AreaMatch): AreaMatch | null =>
    match.confidence >= minConfidence ? match : null;

  // ──────────────────────────────────────────────────────────────────────
  // Stage 1 — Substring scan, longest area name first
  //
  // Sorting by descending length means "Hayatabad Industrial Estate" wins
  // over "Hayatabad" if both appear in the address. Word boundaries prevent
  // "phase 1" matching inside "alphasen 1".
  // ──────────────────────────────────────────────────────────────────────
// Pre-compute zone names appearing in the address blob — used for
  // disambiguating areas that share names across zones (e.g., "Block 17"
  // exists under both Gulistan-e-Johar and F.B Area).
  const zonesInAddress = new Set<string>();
  const allZones = new Set(
    areas.map((x) => x.zone).filter((z): z is string => !!z),
  );
  for (const z of allZones) {
    const zNorm = normalize(z);
    if (zNorm.length >= 3 && new RegExp(`\\b${escapeRegex(zNorm)}\\b`).test(blob)) {
      zonesInAddress.add(z);
    }
  }

// Build (area, normToTest) pairs, sorted by norm length desc so the most
  // specific name wins (canonical first, then aliases).
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

    // Disambiguation: if the address mentions a zone other than this area's
    // zone, and another area with the same primary norm exists under that
    // mentioned zone, prefer that one.
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
  //
  // Many areas have generic short names ("Block 8", "Phase 6", "Sector 4")
  // that exist under multiple zones. Stage 1 skips them because their length
  // is below STAGE1_MIN_AREA_LEN. But when the address explicitly mentions
  // BOTH a zone name AND such a short area name, the pair is unambiguous.
  //
  // Example: "Clifton block 8 Quality heights" → looks for an area named
  // "Block 8" whose zone is "Clifton". Found → return.
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
  //
  // Tokenize the address and check whether any token equals an area name's
  // first token. Catches partial mentions and abbreviations Stage 1 misses.
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
        method: "token",
      };
      const gated = gate(m);
      if (gated) return gated;
      break; // token confidence is fixed; if floor rejects, no other token will pass
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  // Stage 3 — Fuzzy via Levenshtein
  //
  // Last-resort typo handling. Compares each address token to each area's
  // first token, only when their lengths are similar (Levenshtein on
  // wildly different lengths is meaningless). Keep the best match above
  // the confidence threshold.
  // ──────────────────────────────────────────────────────────────────────
  // Multi-token fuzzy matching. For each area, count how many of its
  // meaningful tokens (length >= 4, not in deny list) have a near-match
  // among address tokens. Require >= half to match.
  let best: { area: IndexedArea; score: number } | null = null;

  for (const a of areas) {
    const candidateTokens = a.norm
      .split(' ')
      .filter((t) => t.length >= CONFIG.MIN_STAGE3_TOKEN_LEN);
    if (candidateTokens.length === 0) continue;

  const meaningfulCandidates = candidateTokens.filter(
  (t) => !FUZZY_DENY_FIRST_TOKENS.has(t),
);
// Require area to have at least 2 meaningful tokens, OR 1 token that's >= 6 chars.
// Single-token areas with short names produce too many false matches.
if (meaningfulCandidates.length === 0) continue;
if (meaningfulCandidates.length === 1 && meaningfulCandidates[0].length < 6) continue;

    let hits = 0;
    for (const ct of meaningfulCandidates) {
      let matched = false;
      for (const at of tokens) {
        if (Math.abs(at.length - ct.length) > CONFIG.FUZZY_MAX_LEN_DIFF) continue;
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
  //
  // No specific area matched. If the address mentions a zone name, return
  // it so the caller can still book at zone-level (some couriers accept
  // zone-only bookings; others can route from the zone hub).
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
        areaId: "",
        areaName: "",
        zone: z,
        confidence: 0.6,
        method: "zone-only",
      };
      const gated = gate(m);
      if (gated) return gated;
      break; // zone-only is fixed at 0.6; if floor rejects, no other zone will pass
    }
  }

  return null;
}

// =============================================================================
// Test helpers (exported for unit tests; not used in production code paths)
// =============================================================================
export const __test = {
  normalize,
  normalizeSectors,
  tokenize,
};
