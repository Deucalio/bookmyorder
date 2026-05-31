/**
 * prisma/migrate-courier-codes.ts
 *
 * One-time data migration: convert the per-order `courierCode` columns from the
 * internal id (e.g. "leopards") to the external courier code (e.g. "LCS"), so
 * stored values match `utils/courierCompanies.js` `courier_code`. Applies to:
 *   - Fulfillment.courierCode
 *   - BookingAttempt.courierCode
 *
 * Idempotent: re-running is a no-op (values already external resolve to
 * themselves). Rows whose code `findCourier` can't resolve are left untouched.
 *
 * Usage:
 *   npx tsx prisma/migrate-courier-codes.ts            # apply
 *   DRY_RUN=1 npx tsx prisma/migrate-courier-codes.ts  # preview, no writes
 */

import { PrismaClient } from "@prisma/client";
// CommonJS source-of-truth courier list.
import { findCourier } from "../utils/courierCompanies.js";

const prisma = new PrismaClient();
const DRY_RUN = process.env.DRY_RUN === "1";

async function migrateModel(
  label: string,
  groupBy: () => Promise<Array<{ courierCode: string | null }>>,
  updateMany: (from: string, to: string) => Promise<{ count: number }>,
) {
  const groups = await groupBy();
  let changed = 0;
  for (const { courierCode } of groups) {
    if (!courierCode) continue;
    const external = findCourier(courierCode)?.courier_code;
    if (!external || external === courierCode) continue;
    if (DRY_RUN) {
      console.log(`  [dry-run] ${label}: "${courierCode}" -> "${external}"`);
      continue;
    }
    const { count } = await updateMany(courierCode, external);
    changed += count;
    console.log(`  ${label}: "${courierCode}" -> "${external}" (${count} rows)`);
  }
  return changed;
}

async function main() {
  console.log(DRY_RUN ? "DRY RUN — no writes\n" : "Migrating courier codes…\n");

  const fulfillments = await migrateModel(
    "Fulfillment",
    () => prisma.fulfillment.groupBy({ by: ["courierCode"] }) as any,
    (from, to) =>
      prisma.fulfillment.updateMany({ where: { courierCode: from }, data: { courierCode: to } }),
  );

  const attempts = await migrateModel(
    "BookingAttempt",
    () => prisma.bookingAttempt.groupBy({ by: ["courierCode"] }) as any,
    (from, to) =>
      prisma.bookingAttempt.updateMany({ where: { courierCode: from }, data: { courierCode: to } }),
  );

  console.log(
    `\nDone. ${DRY_RUN ? "Would update" : "Updated"} ${fulfillments} Fulfillment + ${attempts} BookingAttempt rows.`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
