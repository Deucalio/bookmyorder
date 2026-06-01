/**
 * prisma/migrate-courier-codes.ts
 *
 * One-time data migration: normalize the per-order courier fields to the
 * source-of-truth values in `utils/courierCompanies.js`:
 *   - Fulfillment.courierCode  → external code   (e.g. "leopards" → "LCS")
 *   - Fulfillment.courierName  → display name     (e.g. "LCS"      → "Leopards Courier")
 *   - BookingAttempt.courierCode → external code
 *
 * Idempotent: re-running is a no-op. Rows whose code `findCourier` can't resolve
 * are left untouched.
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

async function migrateFulfillments() {
  // Group by both fields so we can fix code + name together per distinct combo.
  const groups = await prisma.fulfillment.groupBy({ by: ["courierCode", "courierName"] });
  let changed = 0;
  for (const { courierCode, courierName } of groups) {
    const c = findCourier(courierCode);
    if (!c) continue;
    if (courierCode === c.courier_code && courierName === c.courier_name) continue;
    if (DRY_RUN) {
      console.log(`  [dry-run] Fulfillment: code "${courierCode}"→"${c.courier_code}", name "${courierName}"→"${c.courier_name}"`);
      continue;
    }
    const { count } = await prisma.fulfillment.updateMany({
      where: { courierCode: courierCode ?? undefined, courierName: courierName ?? undefined },
      data: { courierCode: c.courier_code, courierName: c.courier_name },
    });
    changed += count;
    console.log(`  Fulfillment: "${courierCode}"/"${courierName}" → "${c.courier_code}"/"${c.courier_name}" (${count} rows)`);
  }
  return changed;
}

async function migrateBookingAttempts() {
  const groups = await prisma.bookingAttempt.groupBy({ by: ["courierCode"] });
  let changed = 0;
  for (const { courierCode } of groups) {
    const external = findCourier(courierCode)?.courier_code;
    if (!external || external === courierCode) continue;
    if (DRY_RUN) {
      console.log(`  [dry-run] BookingAttempt: "${courierCode}" → "${external}"`);
      continue;
    }
    const { count } = await prisma.bookingAttempt.updateMany({
      where: { courierCode },
      data: { courierCode: external },
    });
    changed += count;
    console.log(`  BookingAttempt: "${courierCode}" → "${external}" (${count} rows)`);
  }
  return changed;
}

async function main() {
  console.log(DRY_RUN ? "DRY RUN — no writes\n" : "Migrating courier codes + names…\n");
  const f = await migrateFulfillments();
  const b = await migrateBookingAttempts();
  console.log(`\nDone. ${DRY_RUN ? "Would update" : "Updated"} ${f} Fulfillment + ${b} BookingAttempt rows.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
