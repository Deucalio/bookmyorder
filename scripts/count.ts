import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  console.log('Cities:', await prisma.city.count());
  console.log('Areas:', await prisma.area.count());
}
main().then(() => prisma.$disconnect());
