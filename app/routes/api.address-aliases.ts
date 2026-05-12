import {
  type LoaderFunctionArgs,
  type ActionFunctionArgs,
} from 'react-router';
import prisma from "../db.server";
// import { invalidateAreaCache } from '../../scripts/area-matcher-server';
import { authenticate } from '../shopify.server';

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  const url = new URL(request.url);
  const target = url.searchParams.get('target'); // 'area' | 'city'
  const id = url.searchParams.get('id');
  if (!target || !id) return { aliases: [] };

  if (target === 'area') {
    const a = await prisma.area.findUnique({
      where: { id },
      select: { id: true, name: true, aliases: true },
    });
    return { aliases: a?.aliases ?? [], record: a };
  }
  if (target === 'city') {
    const c = await prisma.city.findUnique({
      where: { id },
      select: { id: true, name: true, aliases: true },
    });
    return { aliases: c?.aliases ?? [], record: c };
  }
  return { aliases: [] };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  await authenticate.admin(request);
  const body = await request.json();
  const { target, id, aliases } = body as {
    target: 'area' | 'city';
    id: string;
    aliases: string[];
  };

  if (!target || !id || !Array.isArray(aliases)) {
    return { ok: false, error: 'target, id, aliases required' };
  }

  // Dedupe + trim
  const cleaned = Array.from(
    new Set(aliases.map((a) => a.trim()).filter(Boolean)),
  );

  if (target === 'area') {
    const updated = await prisma.area.update({
      where: { id },
      data: { aliases: cleaned },
      select: { id: true, cityId: true, aliases: true },
    });
    return { ok: true, record: updated };
  }
  if (target === 'city') {
    const updated = await prisma.city.update({
      where: { id },
      data: { aliases: cleaned },
      select: { id: true, aliases: true },
    });
    return { ok: true, record: updated };
  }

  return { ok: false, error: 'unknown target' };
};