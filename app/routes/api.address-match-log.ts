import {
  type LoaderFunctionArgs,
  type ActionFunctionArgs,
} from 'react-router';
import {
  logMatchAttempt,
  applyCorrection,
  getReviewQueue,
} from '../services/address-match-log.server';
import { authenticate } from "../shopify.server";


export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const onlyUnmatched = url.searchParams.get('onlyUnmatched') === '1';
  const limit = Math.min(Number(url.searchParams.get('limit') ?? '50'), 200);

  const rows = await getReviewQueue({
    shopId: session.shop,
    limit,
    onlyUnmatched,
  });
  return { rows };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const body = await request.json();
  const op = body.op as 'log' | 'correct' | undefined;

  if (op === 'log') {
    const id = await logMatchAttempt({
      shopId: session.shop,
      orderId: body.orderId ?? null,
      rawAddress1: body.rawAddress1,
      rawAddress2: body.rawAddress2 ?? null,
      rawCity: body.rawCity ?? null,
      matchedCityId: body.matchedCityId ?? null,
      match: body.match ?? null,
    });
    return { ok: true, id };
  }

  if (op === 'correct') {
    if (!body.logId) {
      return { ok: false, error: 'logId required' };
    }
    const row = await applyCorrection({
      logId: body.logId,
      chosenAreaId: body.chosenAreaId ?? null,
      chosenCityId: body.chosenCityId ?? null,
      confirmed: body.confirmed ?? false,
    });
    return { ok: true, row };
  }

  return { ok: false, error: 'unknown op' };
};