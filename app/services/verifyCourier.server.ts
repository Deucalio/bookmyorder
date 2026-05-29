const BACKEND_URL = process.env.BACKEND_URL;
const BACKEND_INTERNAL_SECRET = process.env.BACKEND_INTERNAL_SECRET;

type VerifyResult =
  | { success: true }
  | { success: false; error: string };

function mapLeopardsCredentials(raw: Record<string, any>) {
  return {
    api_key: raw.apiKey || '',
    api_password: raw.apiPassword || '',
    default_shipment_type: raw.defaultShipmentType || 'OVERNIGHT',
  };
}

function mapTcsCredentials(raw: Record<string, any>, meta: Record<string, any>) {
  return {
    bearertoken: raw.bearerToken || '',
    username: raw.username || '',
    password: raw.password || '',
    account_number: raw.accountNumber || '',
    cost_center_code: raw.costCenterCode || '',
    shipper_details: {
      name:    meta.shipment_name_eng || '',
      address: meta.shipment_address  || '',
      phone:   meta.shipment_phone    || '',
      email:   meta.shipment_email    || '',
      tcs_origin: {
        tcs_account:      raw.accountNumber       || '',
        cityName:         meta.origin_city_name   || '',
        cityCode:         meta.origin_city_code   || '',
        cityID:           meta.origin_city_id ? Number(meta.origin_city_id) : null,
        cost_center_code: raw.costCenterCode      || '',
      },
    },
  };
}

export async function verifyCourier(
  courierCode: 'leopards' | 'tcs',
  rawCredentials: Record<string, any>,
  rawMeta: Record<string, any> = {},
): Promise<VerifyResult> {
  if (!BACKEND_URL || !BACKEND_INTERNAL_SECRET) {
    console.warn('[verifyCourier] BACKEND_URL or BACKEND_INTERNAL_SECRET not set — skipping verification');
    return { success: true };
  }

  const courier = courierCode === 'leopards' ? 'LCS' : 'TCS';
  const credentials =
    courierCode === 'leopards'
      ? mapLeopardsCredentials(rawCredentials)
      : mapTcsCredentials(rawCredentials, rawMeta);

  // TCS: use verify-courier (book+cancel) so an invalid city code surfaces as an error.
  // Leopards: lightweight test-credentials check is sufficient.
  const endpoint = courierCode === 'tcs' ? 'verify-courier' : 'test-credentials';

  try {
    const res = await fetch(`${BACKEND_URL}/api/courier/${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-secret': BACKEND_INTERNAL_SECRET,
      },
      body: JSON.stringify({ courier, credentials }),
    });

    const json = (await res.json()) as { success: boolean; error?: string; message?: string };

    if (json.success) return { success: true };
    return { success: false, error: json.error || json.message || 'Invalid credentials' };
  } catch (err) {
    console.error('[verifyCourier] request failed:', err);
    return { success: false, error: 'Could not reach the courier service. Please try again.' };
  }
}
