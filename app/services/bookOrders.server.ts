import prisma from "../db.server";

const BACKEND_URL = process.env.BACKEND_URL;
const BACKEND_INTERNAL_SECRET = process.env.BACKEND_INTERNAL_SECRET;

export type BookOrderInput = {
  orderId: string;
  orderName: string;
  courierCode: string;
  cityId: string;
  draft: {
    customerName: string;
    phone: string;
    addressLine1: string;
    addressLine2: string;
    codAmount: string;
    weight: string;
    instructions: string;
    serviceLevel: string;
  };
};

export type BookOrderResultDetail = {
  orderName: string;
  status: "success" | "failed";
  error?: string;
  trackingNumber?: string | null;
  slipLink?: string | null;
  fulfillmentMarked?: boolean;
};

export type BookOrdersResult = {
  success: boolean;
  booked: string[];
  failed: { orderName: string; error: string }[];
  fulfillmentFailed: string[];
  details: BookOrderResultDetail[];
  summary: { total: number; success: number; failed: number; fulfillmentFailed: number };
  error?: string;
};

function buildAccessData(
  courierCode: string,
  credentials: Record<string, any>,
  meta: Record<string, any>,
) {
  if (courierCode === 'leopards') {
    return {
      api_key: credentials.apiKey || '',
      api_password: credentials.apiPassword || '',
      default_shipment_type: credentials.defaultShipmentType || 'OVERNIGHT',
    };
  }
  // TCS — include shipper_details so the TCS service can populate origin city
  return {
    bearertoken: credentials.bearerToken || '',
    username: credentials.username || '',
    password: credentials.password || '',
    account_number: credentials.accountNumber || '',
    cost_center_code: credentials.costCenterCode || '',
    shipper_details: {
      name:    meta.shipment_name_eng || '',
      address: meta.shipment_address  || '',
      phone:   meta.shipment_phone    || '',
      email:   meta.shipment_email    || '',
      tcs_origin: {
        tcs_account:       credentials.accountNumber   || '',
        cityName:          meta.origin_city_name       || '',
        cityCode:          meta.origin_city_code       || '',
        cityID:            meta.origin_city_id ? Number(meta.origin_city_id) : null,
        cost_center_code:  credentials.costCenterCode  || '',
      },
    },
  };
}

function buildShipperDetails(
  courierCode: string,
  credentials: Record<string, any>,
  meta: Record<string, any>,
): Record<string, any> {
  if (courierCode === 'leopards') {
    return {
      name:            meta.shipment_name_eng || '',
      address:         meta.shipment_address  || '',
      phone:           meta.shipment_phone    || '',
      email:           meta.shipment_email    || '',
      city:            meta.shipment_city     || '',
      default_remarks: meta.default_remarks   || '',
    };
  }
  // TCS
  return {
    name:    meta.shipment_name_eng || '',
    address: meta.shipment_address  || '',
    phone:   meta.shipment_phone    || '',
    email:   meta.shipment_email    || '',
    city:    meta.origin_city_name  || '',
    default_remarks: '',
    tcs_origin: {
      tcs_account:      credentials.accountNumber  || '',
      cityName:         meta.origin_city_name      || '',
      cityCode:         meta.origin_city_code      || '',
      cityID:           meta.origin_city_id ? Number(meta.origin_city_id) : null,
      cost_center_code: credentials.costCenterCode || '',
    },
  };
}

function buildSelectedCourierCity(
  courierCode: string,
  city: { id: string; name: string; courierMappings: any } | undefined,
): Record<string, any> {
  const mappings = (city?.courierMappings ?? {}) as Record<string, any>;
  if (courierCode === 'leopards') {
    const lcs = mappings.leopards ?? {};
    return {
      courier_city_id: String(lcs.id ?? ''),
      services_available: lcs.shipment_type ?? [],
      meta_data: { name: city?.name ?? '', cityName: null, cityCode: null, cityID: null },
    };
  }
  // TCS
  const tcs = mappings.tcs ?? {};
  return {
    courier_city_id: String(tcs.cityID ?? ''),
    services_available: ['OVERNIGHT', 'EXPRESS'],
    meta_data: {
      cityName: tcs.cityName ?? '',
      cityCode: tcs.cityCode ?? '',
      name:     city?.name  ?? '',
      cityID:   tcs.cityID  ?? null,
    },
  };
}

export async function bookOrders(
  shopDomain: string,
  accessToken: string,
  inputs: BookOrderInput[],
): Promise<BookOrdersResult> {
  if (!BACKEND_URL || !BACKEND_INTERNAL_SECRET) {
    return { success: false, booked: [], failed: [], fulfillmentFailed: [], details: [], summary: { total: inputs.length, success: 0, failed: inputs.length, fulfillmentFailed: 0 }, error: 'Backend not configured' };
  }

  if (inputs.length === 0) {
    return { success: true, booked: [], failed: [], fulfillmentFailed: [], details: [], summary: { total: 0, success: 0, failed: 0, fulfillmentFailed: 0 } };
  }

  // Load orders from DB to get shopify fields + city courierMappings
  const orderIds = inputs.map((i) => i.orderId);
  const dbOrders = await prisma.order.findMany({
    where: { id: { in: orderIds } },
    select: {
      id: true,
      orderName: true,
      shopifyOrderId: true,
      shopifyFulfillmentOrderId: true,
      lineItems: true,
    },
  });
  const orderMap = new Map(dbOrders.map((o) => [o.id, o]));

  // Load city courierMappings for all distinct cityIds
  const cityIds = [...new Set(inputs.map((i) => i.cityId).filter(Boolean))];
  const dbCities = cityIds.length
    ? await prisma.city.findMany({
        where: { id: { in: cityIds } },
        select: { id: true, name: true, courierMappings: true },
      })
    : [];
  const cityMap = new Map(dbCities.map((c) => [c.id, c]));

  // Load enabled couriers for the shop
  const shopRecord = await prisma.shop.findUnique({
    where: { shopDomain },
    select: { id: true },
  });
  if (!shopRecord) {
    return { success: false, booked: [], failed: [], fulfillmentFailed: [], details: [], summary: { total: inputs.length, success: 0, failed: inputs.length, fulfillmentFailed: 0 }, error: 'Shop not found' };
  }
  const dbCouriers = await prisma.shopCourier.findMany({
    where: { shopId: shopRecord.id, isEnabled: true },
    select: { courierCode: true, credentials: true, meta_data: true },
  });
  const courierMap = new Map(dbCouriers.map((c) => [c.courierCode, c]));

  // Build payloads
  const payloads: unknown[] = [];
  const skipped: { orderName: string; error: string }[] = [];
  // Keyed by orderName so result processing can retrieve the snapshot
  const slipDataMap = new Map<string, { slipData: any; fulfillmentItems: any[] }>();

  for (const input of inputs) {
    const dbOrder = orderMap.get(input.orderId);
    if (!dbOrder?.shopifyFulfillmentOrderId) {
      skipped.push({ orderName: input.orderName, error: 'Missing Shopify fulfillment order ID' });
      continue;
    }

    const courierRow = courierMap.get(input.courierCode);
    if (!courierRow) {
      skipped.push({ orderName: input.orderName, error: `Courier "${input.courierCode}" not found or not enabled` });
      continue;
    }

    const city = cityMap.get(input.cityId);
    const mappings = (city?.courierMappings ?? {}) as Record<string, any>;
    const backendCourier = input.courierCode === 'leopards' ? 'LCS' : 'TCS';
    const meta = (courierRow.meta_data ?? {}) as Record<string, any>;
    const creds = (courierRow.credentials ?? {}) as Record<string, any>;
    const credentials = buildAccessData(input.courierCode, creds, meta);

    const cityId = input.courierCode === 'leopards' ? mappings?.leopards?.id : undefined;
    const cityName = input.courierCode === 'tcs' ? (mappings?.tcs?.cityName ?? city?.name) : (city?.name ?? '');

    const address = [input.draft.addressLine1, input.draft.addressLine2].filter(Boolean).join(', ');

    // Resolve a valid courier service for this order. The frontend draft can
    // hold "Standard" or "" if the editor wasn't opened; the city's mapping
    // only lists certain services (e.g. ["OVERNIGHT","DETAIN","OVERLAND"]), so
    // we have to validate-or-substitute before sending to the courier.
    const resolveServiceLevel = (): string => {
      const draftLevel = (input.draft.serviceLevel || '').trim();
      if (input.courierCode === 'leopards') {
        const cityServices: string[] = Array.isArray(mappings?.leopards?.shipment_type)
          ? mappings.leopards.shipment_type
          : [];
        const shopDefault: string = creds.defaultShipmentType || 'OVERNIGHT';
        if (cityServices.length === 0) return shopDefault; // unknown — best guess
        if (draftLevel && cityServices.includes(draftLevel)) return draftLevel;
        if (cityServices.includes(shopDefault)) return shopDefault;
        return cityServices[0];
      }
      if (input.courierCode === 'tcs') {
        const validTcs = ['O', 'X', 'E'];
        if (draftLevel && validTcs.includes(draftLevel)) return draftLevel;
        return creds.defaultShipmentType || 'O';
      }
      return draftLevel || 'OVERNIGHT';
    };
    const serviceLevel = resolveServiceLevel();

    // Build slip data snapshot — captured at booking time so slips can be
    // regenerated later without re-joining City / ShopCourier tables.
    // default_remarks drives the slip's "Customer Notes" — use the per-order
    // special instructions, falling back to the courier's saved defaults.
    const shipperDetails = buildShipperDetails(input.courierCode, creds, meta);
    shipperDetails.default_remarks =
      input.draft.instructions || meta.default_special_instructions || meta.default_remarks || '';
    const slipData = {
      selectedCourierCity: buildSelectedCourierCity(input.courierCode, city ? { ...city, courierMappings: city.courierMappings } : undefined),
      courierAccount: {
        courier: { name: backendCourier },
        metadata: { shipper_details: shipperDetails },
      },
      service_level: serviceLevel,
    };

    // Build fulfillment line items from the order's lineItems JSON
    const fulfillmentItems = ((dbOrder.lineItems as any[]) ?? [])
      .filter((li: any) => li.variant?.id)
      .map((li: any) => ({
        line_item_id: li.id ?? null,
        variant_id: li.variant.id,
        fulfillment_order_quantity: li.quantity ?? 1,
      }));

    slipDataMap.set(input.orderName, { slipData, fulfillmentItems });

    payloads.push({
      courier: backendCourier,
      credentials,
      order_info: {
        order_id: input.orderId,
        order_number: input.orderName,
        cod_amount: Math.round(parseFloat(input.draft.codAmount) || 0),
        weight: parseFloat(input.draft.weight) || 1,
        pieces: 1,
        product_details: input.draft.instructions || '',
      },
      customer_info: {
        name: input.draft.customerName,
        phone: input.draft.phone,
        address,
        city: cityName,
        city_name: cityName,
        ...(cityId != null ? { city_id: cityId } : {}),
      },
      courier_data: {
        ...(input.courierCode === 'leopards'
          ? {
              service_type: serviceLevel,
              origin_city_id: meta?.shipment_origin_city_id || 1,
              shipper_name: meta?.shipment_name_eng || '',
              shipper_phone: meta?.shipment_phone || '',
              shipper_address: meta?.shipment_address || '',
              shipment_id: meta?.shipment_id || '',
              special_instructions: input.draft.instructions || meta?.default_special_instructions || meta?.default_remarks || '',
            }
          : {
              service_code: serviceLevel,
              cost_center_code: (credentials as any).cost_center_code || '',
              city_name: cityName,
            }),
      },
      shopify: {
        platform_store_id: shopDomain,
        access_token: accessToken,
        fulfillment_order_id: dbOrder.shopifyFulfillmentOrderId.toString(),
        platform_order_id: dbOrder.shopifyOrderId.toString(),
        notify_customer: true,
      },
    });
  }

  if (payloads.length === 0) {
    return {
      success: false,
      booked: [],
      failed: skipped,
      fulfillmentFailed: [],
      details: skipped.map((s) => ({ orderName: s.orderName, status: 'failed' as const, error: s.error })),
      summary: { total: inputs.length, success: 0, failed: inputs.length, fulfillmentFailed: 0 },
    };
  }

  // Call backend
  let backendResponse: any;
  try {
    const res = await fetch(`${BACKEND_URL}/api/courier/batch-book-and-fulfill`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-secret': BACKEND_INTERNAL_SECRET!,
      },
      body: JSON.stringify({ payloads }),
    });
    backendResponse = await res.json();
  } catch (err: any) {
    return {
      success: false,
      booked: [],
      failed: [{ orderName: 'batch', error: `Backend unreachable: ${err.message}` }],
      fulfillmentFailed: [],
      details: inputs.map((i) => ({ orderName: i.orderName, status: 'failed' as const, error: `Backend unreachable: ${err.message}` })),
      summary: { total: inputs.length, success: 0, failed: inputs.length, fulfillmentFailed: 0 },
    };
  }

  // Build lookups: orderName → orderId, orderName → full input.
  const nameToId = new Map(inputs.map((i) => [i.orderName, i.orderId]));
  const inputByName = new Map(inputs.map((i) => [i.orderName, i]));

  // Persist booking results to DB
  const booked: string[] = [];
  const fulfillmentFailed: string[] = [];
  const successDetails: BookOrderResultDetail[] = [];

  for (const s of backendResponse.successful ?? []) {
    const orderId = nameToId.get(s.order_number);
    if (!orderId) continue;
    booked.push(s.order_number);

    const fulfillOk = s.fulfillment?.status === 'success';
    if (!fulfillOk) fulfillmentFailed.push(s.order_number);

    successDetails.push({
      orderName: s.order_number,
      status: 'success',
      trackingNumber: s.booking?.tracking_number ?? null,
      slipLink: s.booking?.slip_link ?? null,
      fulfillmentMarked: fulfillOk,
    });

    // Courier booking always succeeded here (it's in the successful array).
    // Status is always 'booked' regardless of whether Shopify mark succeeded —
    // the order has a tracking number and is with the courier.
    const slipLink: string | null = s.booking?.slip_link ?? null;
    const snapshot = slipDataMap.get(s.order_number);

    let fulfillmentId: string | null = null;
    try {
      const created = await prisma.fulfillment.create({
        data: {
          orderId,
          courierCode: s.booking?.courier_code ?? s.booking?.courier_name?.toLowerCase().replace(/\s+/g, '_') ?? '',
          courierName: s.booking?.courier_name ?? '',
          trackingNumber: s.booking?.tracking_number ?? null,
          trackingUrl: s.booking?.tracking_url ?? null,
          slipLink,
          status: 'booked',
          deliveryOutcome: 'pending',
          bookedAt: new Date(),
          bookingResponse: s.booking ?? null,
          source: 'app',
          items: snapshot?.fulfillmentItems ?? [],
          slipData: snapshot?.slipData ?? null,
          ...(fulfillOk && s.fulfillment?.data?.id
            ? {
                shopifyFulfillmentGid: s.fulfillment.data.id,
                shopifyFulfillmentId: s.fulfillment.data.id.split('/').pop(),
              }
            : {}),
        },
      });
      fulfillmentId = created.id;

      // Mirror the Shopify fulfillment status into our Order row immediately so
      // the orders page reflects the correct tab without waiting for a sync.
      if (fulfillOk) {
        await prisma.order.update({
          where: { id: orderId },
          data: { fulfillmentStatus: 'FULFILLED' },
        }).catch((err: any) => {
          console.error(`[bookOrders] failed to update fulfillmentStatus for ${s.order_number}:`, err);
        });
      }
    } catch (err: any) {
      console.error(`[bookOrders] failed to save fulfillment for ${s.order_number}:`, err);
    }

    // BookingAttempt audit record — meta_data carries courier-specific extras.
    // courierCode + cityId come from the input we sent (the backend response
    // doesn't always echo courier_code back), so the audit row is reliable.
    const successInput = inputByName.get(s.order_number);
    await prisma.bookingAttempt.create({
      data: {
        orderId,
        fulfillmentId,
        cityId: successInput?.cityId || null,
        courierCode: successInput?.courierCode || s.booking?.courier_code || '',
        status: 'success',
        attemptNumber: 1,
        requestPayload: {},
        responsePayload: s.booking ?? null,
        meta_data: {
          slip_link: slipLink,
          tracking_number: s.booking?.tracking_number ?? null,
          tracking_url: s.booking?.tracking_url ?? null,
          courier_reference: s.booking?.courier_reference ?? null,
          fulfillment_marked: fulfillOk,
          ...(s.booking?.response_data ? { raw_response: s.booking.response_data } : {}),
        },
      },
    }).catch((err: any) => {
      console.error(`[bookOrders] failed to save BookingAttempt for ${s.order_number}:`, err);
    });

    console.log(`[bookOrders] ${s.order_number} booked — tracking: ${s.booking?.tracking_number ?? 'n/a'}${slipLink ? ` slip: ${slipLink}` : ''} fulfillment_marked: ${fulfillOk}`);
  }

  const failed: { orderName: string; error: string }[] = [
    ...skipped,
    ...(backendResponse.failed ?? []).map((f: any) => ({ orderName: f.order_number, error: f.error })),
  ];

  // Log each failed attempt for audit — courierCode + cityId from the input.
  for (const f of failed) {
    const failInput = inputByName.get(f.orderName);
    if (!failInput) continue;
    await prisma.bookingAttempt.create({
      data: {
        orderId: failInput.orderId,
        fulfillmentId: null,
        cityId: failInput.cityId || null,
        courierCode: failInput.courierCode || '',
        status: 'failed',
        attemptNumber: 1,
        requestPayload: {},
        errorMessage: f.error,
        meta_data: {},
      },
    }).catch((err: any) => {
      console.error(`[bookOrders] failed to save failed BookingAttempt for ${f.orderName}:`, err);
    });
  }

  return {
    success: backendResponse.success ?? booked.length > 0,
    booked,
    failed,
    fulfillmentFailed,
    details: [
      ...successDetails,
      ...failed.map((f) => ({ orderName: f.orderName, status: 'failed' as const, error: f.error })),
    ],
    summary: {
      total: inputs.length,
      success: booked.length,
      failed: failed.length,
      fulfillmentFailed: fulfillmentFailed.length,
    },
  };
}
