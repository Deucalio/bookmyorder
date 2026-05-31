// book-my-order/utils/courierCompanies.js
//
// SINGLE SOURCE OF TRUTH for everything courier-shaped: id, display name,
// API code (the value stored in every DB courierCode column + in every
// City.courierMappings JSON key), brand colour, logo, alias matchers, and
// onboarding form fields.
//
// Mirror at backend-bookmyorder/utils/courierCompanies.js — keep both
// files byte-identical. Any code that needs courier data MUST go through
// this file (or its backend mirror). Never inline 'tcs' / 'lcs' /
// 'leopards' string literals anywhere else.

// `city_mapping_key` is the JSON key under which a city's courier mapping
// lives inside City.courierMappings (e.g. courierMappings.leopards.id for
// LCS, courierMappings.tcs.cityID for TCS). Null when no mapping exists
// for this courier yet — booking flow must guard for null.
const courier_companies = [
  {
    id: 'tcs',
    name: 'TCS Express',
    courier_code: 'TCS',
    courier_name: 'TCS Express',
    city_mapping_key: 'tcs',
    possible_matches: ['tcs', 'tcs (overnight) pesh', 'tcs (overland) pesh', 'tcs express'],
    color: '#FF0000',
    logo: 'https://trackmyorder.pk/TCS.svg',
  },
  {
    id: 'leopards',
    name: 'Leopards Courier',
    courier_code: 'LCS',
    courier_name: 'Leopards Courier',
    city_mapping_key: 'leopards',
    possible_matches: ['leopards', 'leopards courier services', 'lcs'],
    color: '#FFA500',
    logo: 'https://trackmyorder.pk/leopards-logo.png',
  },
  {
    id: 'mnp',
    name: 'M&P Courier',
    courier_code: 'MNP',
    courier_name: 'M&P Courier',
    city_mapping_key: null,
    possible_matches: ['mnp', 'm&p', 'm & p', 'mnp courier', 'm&p courier', 'M-P-Logistic'],
    color: '#ffffff',
    logo: 'https://trackmyorder.pk/mnp-logo.png',
  },
  {
    id: 'postex',
    name: 'Postex',
    courier_code: 'PST',
    courier_name: 'Postex',
    city_mapping_key: null,
    possible_matches: ['postex', 'pst', 'post ex', 'warsak - postex'],
    color: '#000000',
    logo: 'https://trackmyorder.pk/postex-logo.png',
    possible_fields: [{ name: 'Token', type: 'string', save_key: 'token' }],
  },
  {
    id: 'speedaf',
    name: 'Speedaf Express',
    courier_code: 'SPD',
    courier_name: 'Speedaf Express',
    city_mapping_key: null,
    possible_matches: ['speedaf', 'speedaf courier services', 'spd', 'speedaf express'],
    color: '#ff9d36',
    logo: 'https://trackmyorder.pk/speedaf-logo.png',
  },
  {
    id: 'trax',
    name: 'Trax',
    courier_code: 'TRX',
    courier_name: 'Trax',
    city_mapping_key: null,
    possible_matches: ['trax', 'trx', 'trax express', 'trax courier'],
    color: '#FFFFFF',
    logo: 'https://trackmyorder.pk/trax-logo.png',
  },
];

function normalizeString(str) {
  if (typeof str !== 'string') return '';
  return str
    .toLowerCase()
    .trim()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ');
}

function findCourier(identifier) {
  const normalized = normalizeString(identifier);
  if (!normalized) return null;

  for (const c of courier_companies) {
    if (c.id.toLowerCase() === normalized || c.courier_code.toLowerCase() === normalized) {
      return c;
    }
  }
  for (const c of courier_companies) {
    const matches = (c.possible_matches || []).map(normalizeString);
    if (matches.includes(normalized)) return c;
  }
  for (const c of courier_companies) {
    const matches = (c.possible_matches || []).map(normalizeString);
    for (const m of matches) {
      if (normalized.startsWith(m) || m.startsWith(normalized)) return c;
    }
  }
  for (const c of courier_companies) {
    const matches = (c.possible_matches || []).map(normalizeString);
    for (const m of matches) {
      if (m.length >= 3 && normalized.includes(m)) return c;
    }
  }
  return null;
}

function getCourierCode(identifier) {
  return findCourier(identifier)?.courier_code ?? 'UNKNOWN';
}

function getCourierName(identifier) {
  return findCourier(identifier)?.courier_name ?? 'Unknown';
}

function getCourierDetailsByCode(courier_code) {
  if (typeof courier_code !== 'string') return null;
  const normalized = courier_code.toUpperCase().trim();
  return courier_companies.find((c) => c.courier_code === normalized) || null;
}

function getCourierNameByCode(courier_code) {
  return getCourierDetailsByCode(courier_code)?.courier_name ?? 'Unknown';
}

// ESM exports — this file is consumed by Vite/Remix SSR which can't evaluate
// CommonJS. The backend mirror at backend-bookmyorder/utils/courierCompanies.js
// uses module.exports because the backend is CJS-only. The data above is
// byte-identical between the two files; only this footer differs.
export {
  courier_companies,
  findCourier,
  getCourierCode,
  getCourierName,
  getCourierDetailsByCode,
  getCourierNameByCode,
};
