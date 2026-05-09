/**
 * Create fake orders in the Shopify store using the addresses listed below.
 *
 * Usage:
 *   npx tsx scripts/create-fake-orders.ts
 *
 * Behavior:
 *   - Pulls the offline access token from the Session table (auto-picks the
 *     single shop). If multiple sessions exist, the most-recently-used one
 *     (highest expires) is used.
 *   - Fetches up to 50 product variants from the store and assigns one at
 *     random to each order.
 *   - financial_status = "paid" (with a matching successful sale transaction).
 *   - 600ms delay between requests to stay within Shopify's REST rate limit.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const API_VERSION = "2025-10";
const REQUEST_DELAY_MS = 3000;

type Address = {
  first_name: string;
  last_name: string;
  name?: string;
  phone: string;
  address1: string;
  address2: string | null;
  city: string;
  province: string | null;
  zip: string | null;
  country: string;
};

const SHIPPING_ADDRESSES: Address[] = [
  { first_name: "Abdullah", last_name: "Tajik", name: "Abdullah Tajik", phone: "03019779018", address1: "Margaba mega mart maidan bypass road hayseri", address2: null, city: "Khyber pakhtonkhwa(Dir Lower)", province: null, zip: null, country: "Pakistan" },
  { first_name: "Amna Hameed", last_name: "Gorsi", phone: "+923249400900", address1: "Chaudhary Abdul Hameed Gorsi House, Opposite to WAPDA, Railway Road", address2: null, city: "Shakargarh", province: null, zip: "51800", country: "Pakistan" },
  { first_name: "Rai", last_name: "Dawood", phone: "+923003381848", address1: "Shah Rukn-e-alam colony , Street no 1 , house no 22 , multan", address2: null, city: "Multan", province: null, zip: "60000", country: "Pakistan" },
  { first_name: "Umer", last_name: "Zeeshan", phone: "3208515099", address1: "P6 Nawaz town Sargodha Road near Chaniot hospital Faisalabad", address2: null, city: "Faisalabad", province: null, zip: null, country: "Pakistan" },
  { first_name: "Zainab", last_name: "Asif", phone: "03254749471", address1: "House no.63 Block C 1 Engineers Town Lahore", address2: "House no.63 Block C 1 Engineers Town Lahore", city: "LAHORE", province: null, zip: null, country: "Pakistan" },
  { first_name: "Asad", last_name: "Lalang", phone: "+923242121318", address1: "Bundle road falak corporation bilding 2 room namber karachi", address2: "Memom masjid kharadar karachi", city: "Karachi", province: null, zip: "730000", country: "Pakistan" },
  { first_name: "Sheharyar", last_name: "Bhatti", phone: "03034775198", address1: "Gujranwala college road near al noor bakery", address2: "Mahala Islamabed street number 14", city: "Gujranwala", province: null, zip: "1234", country: "Pakistan" },
  { first_name: "saad", last_name: "abid", phone: "03295679929", address1: "kot najeebullah muhallah bhandi near post ofc district haripur", address2: null, city: "Haripur", province: null, zip: "00226", country: "Pakistan" },
  { first_name: "Alvenish", last_name: "baloch", phone: "03301387274", address1: "Alkani house near floor mil jampur  1", address2: "", city: "Jampur", province: "", zip: "", country: "Pakistan" },
  { first_name: "Ahsaan", last_name: "Ali", phone: "03474014374", address1: "Doctors hostel, Allama Iqbal Memorial Teaching Hospital Sialkot", address2: null, city: "Sialkot", province: null, zip: null, country: "Pakistan" },
  { first_name: "Yusra", last_name: "Jahan", phone: "03124607737", address1: "House E-8/3-I Lane 5 St 06, Cavalry Ground", address2: "Sajid Naan Shop Must Call  (call on only  whatsapp) ", city: "Lahore", province: "", zip: "54000", country: "Pakistan" },
  { first_name: "Fida", last_name: "Hassan", phone: "03151787461", address1: "Village dharekan  kalan tehsil phalia district mandi baha uddin  self pick up  tcs office phalia", address2: null, city: "Phalia", province: null, zip: null, country: "Pakistan" },
  { first_name: "ALI", last_name: "MUSTAFA SIYAL", phone: "03293884828", address1: "33 street khayaban-e-muhaffiz dha phase 6", address2: "house no 127", city: "karachi", province: null, zip: null, country: "Pakistan" },
  { first_name: "Bilal", last_name: "Kamil", phone: "03322997405", address1: "Apartment 5D, Building # 12. Sector J. Askari V. Malir Cantt. Karachi.", address2: null, city: "Karachi", province: null, zip: "75080", country: "Pakistan" },
  { first_name: "Muhammad", last_name: "waqas", phone: "3284314277", address1: "Ahmadpur east", address2: null, city: "Bahwalpur", province: null, zip: null, country: "Pakistan" },
  { first_name: "zahra", last_name: "balouch", phone: "03052966119", address1: "Sheikh Zayed hospital", address2: "Haji Muhammed colony", city: "Rahim yar khan", province: null, zip: "64200", country: "Pakistan" },
  { first_name: "syed", last_name: "ADEEL", phone: "03452842801", address1: "B-58,central govt. housing society", address2: "Gulshan e iqbal block 10-A", city: "KARACHI", province: null, zip: "75300", country: "Pakistan" },
  { first_name: "Tariq", last_name: "Mehmood", phone: "03466447778", address1: "Flat #201, 2nd Floor, Doctors Hostel, Shaikh Zayed Medical Complex", address2: null, city: "Lahore", province: null, zip: "54500", country: "Pakistan" },
  { first_name: "Noor", last_name: "", phone: "+92 318 5833623", address1: "Sanam filling station lakki marwat kpk.", address2: null, city: "Marwat", province: null, zip: "2840", country: "Pakistan" },
  { first_name: "Faiza", last_name: "Riaz", phone: "03127929850", address1: "Trauma center ,Allama Iqbal Memorial and teaching Hospital commissioner road sialkot", address2: null, city: "Sialkot", province: null, zip: "51311", country: "Pakistan" },
  { first_name: "Aizal", last_name: "Fatima", phone: "03292352972", address1: "District Narowal City Shakargarh Honda Showroom Near Punjab Public School  ", address2: "", city: "Shakargarh", province: "", zip: "", country: "Pakistan" },
  { first_name: "Zubair", last_name: "Khalid", phone: "03215111882", address1: "House#285 street #154 G11/1", address2: "House#285 street #154 G11/1", city: "Islamabad", province: null, zip: "44000", country: "Pakistan" },
  { first_name: "minaal", last_name: "Fatima", phone: "03198654113", address1: "hno 3 d 2 st no 55 ittehad colony sheraz park lahore", address2: null, city: "lahore", province: null, zip: null, country: "Pakistan" },
  { first_name: "Fajar", last_name: "Noor", phone: "03092858324", address1: "Noorabad near Ameen masjid Sialkot Pakistan", address2: null, city: "Sialkot", province: null, zip: null, country: "Pakistan" },
  { first_name: "Amar Sohaib", last_name: "Ahmad", phone: "+923144296479", address1: "Rana Iqbal Road", address2: "Quran College and islamic training institute Markaz al badar bunga blocha", city: "Bhai Pheru Phool Nagar", province: null, zip: "55260", country: "Pakistan" },
  { first_name: "Aqsa", last_name: "Shoukat", phone: "03217631506", address1: "Iqbal Town Near Wapda Office Changa Manga Road Chunian", address2: null, city: "Kasur", province: null, zip: "55220", country: "Pakistan" },
  { first_name: "abida", last_name: "rehman", phone: "00923165664787", address1: "House 14 ,Street 14 block F ,Naval Anchorage", address2: null, city: "Islamabad", province: null, zip: null, country: "Pakistan" },
  { first_name: "Muhammad Junaid", last_name: "Khalid", phone: "03340555660", address1: "H. No. 35C Street 1d, Gulshan e Iqbal Phase 5, Dhamial Road", address2: null, city: "Rawalpindi", province: null, zip: "46000", country: "Pakistan" },
  { first_name: "Ayesha", last_name: "Mansoor", phone: "03335642145", address1: "Hitec girls hostel 2", address2: null, city: "Taxila", province: null, zip: null, country: "Pakistan" },
  { first_name: "Ali rao", last_name: "Ali rao", phone: "03030609421", address1: "38 amir colony afzal electronic street park facing okara", address2: null, city: "Okara", province: null, zip: null, country: "Pakistan" },
];

function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "") || "x";
}

// Shopify validates phones strictly. Normalize Pakistani numbers to +92XXXXXXXXXX (E.164).
function normalizePhone(raw: string): string {
  let p = (raw || "").replace(/[\s\-()]/g, "");
  if (p.startsWith("+92")) return p;
  if (p.startsWith("0092")) return "+" + p.slice(2);
  if (p.startsWith("92")) return "+" + p;
  if (p.startsWith("0")) return "+92" + p.slice(1);
  // Bare 10-digit national number like "3208515099"
  if (/^3\d{9}$/.test(p)) return "+92" + p;
  return p;
}

function buildAddressBlock(a: Address) {
  return {
    first_name: a.first_name,
    last_name: a.last_name || a.first_name,
    address1: a.address1,
    address2: a.address2 || "",
    city: a.city,
    province: a.province || "",
    country: a.country,
    zip: a.zip || "",
    phone: normalizePhone(a.phone),
  };
}

async function getSession() {
  const sessions = await prisma.session.findMany({
    where: { isOnline: false },
    orderBy: { expires: "desc" },
  });
  if (sessions.length === 0) {
    throw new Error("No offline Session rows found in the database. Install the app on a store first.");
  }
  if (sessions.length > 1) {
    console.warn(
      `[warn] Found ${sessions.length} sessions, using shop=${sessions[0].shop}. ` +
        `Set SHOP_DOMAIN env to override.`
    );
  }
  const target = process.env.SHOP_DOMAIN
    ? sessions.find((s) => s.shop === process.env.SHOP_DOMAIN)
    : sessions[0];
  if (!target) {
    throw new Error(`No session for SHOP_DOMAIN=${process.env.SHOP_DOMAIN}.`);
  }
  return { shop: target.shop, accessToken: target.accessToken };
}

async function fetchVariants(shop: string, token: string): Promise<Array<{ id: number; price: string; product_id: number }>> {
  const url = `https://${shop}/admin/api/${API_VERSION}/products.json?limit=50&status=active`;
  const res = await fetch(url, {
    headers: { "X-Shopify-Access-Token": token },
  });
  console.log(`Fetching product variants from ${url}...`, shop, token , "\n");
  if (!res.ok) {
    throw new Error(`Failed to fetch products (${res.status}): ${await res.text()}`);
  }
  const json: any = await res.json();
  const variants = (json.products || []).flatMap((p: any) =>
    (p.variants || []).map((v: any) => ({ id: v.id, price: v.price, product_id: p.id }))
  );
  if (variants.length === 0) {
    throw new Error("No active product variants found in the store.");
  }
  return variants;
}

async function createOrder(shop: string, token: string, address: Address, variantId: number, variantPrice: string) {
  const ship = buildAddressBlock(address);
  const phone = normalizePhone(address.phone);
  const email = `${slug(address.first_name)}.${slug(address.last_name)}+${Date.now()}@example.com`;

  const body = {
    order: {
      line_items: [{ variant_id: variantId, quantity: 1 }],
      customer: {
        first_name: address.first_name,
        last_name: address.last_name || address.first_name,
        phone,
        email,
      },
      email,
      phone,
      shipping_address: ship,
      billing_address: ship,
      financial_status: "paid",
      currency: "PKR",
      send_receipt: false,
      send_fulfillment_receipt: false,
      tags: "fake-order, test-script",
      transactions: [
        {
          kind: "sale",
          status: "success",
          amount: variantPrice,
          gateway: "manual",
        },
      ],
    },
  };

  // Short, escalating backoff on 429: 3s -> 5s -> 10s (capped). Ignore Retry-After header.
  const BACKOFF_SCHEDULE_MS = [3000, 5000, 10000, 10000, 10000, 10000, 10000, 10000];
  for (let attempt = 0; attempt <= BACKOFF_SCHEDULE_MS.length; attempt++) {
    const res = await fetch(`https://${shop}/admin/api/${API_VERSION}/orders.json`, {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": token,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    });

    const text = await res.text();
    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }

    if (res.ok) return data.order;

    if (res.status === 429 && attempt < BACKOFF_SCHEDULE_MS.length) {
      const wait = BACKOFF_SCHEDULE_MS[attempt];
      console.log(`    [429] rate-limited, sleeping ${wait / 1000}s (retry ${attempt + 1})...`);
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }

    throw new Error(`HTTP ${res.status} — ${JSON.stringify(data.errors ?? data)}`);
  }
  throw new Error("Exhausted retries");
}

async function main() {
  const { shop, accessToken } = await getSession();
  console.log(`Using shop: ${shop}`);

  const variants = await fetchVariants(shop, accessToken);
  console.log(`Loaded ${variants.length} variant(s) from the store.\n`);

  let ok = 0;
  let failed = 0;

  const startIndex = Number(process.env.START_INDEX) || 0;
  if (startIndex > 0) console.log(`Starting at index ${startIndex} (skipping first ${startIndex}).`);

  for (let i = startIndex; i < SHIPPING_ADDRESSES.length; i++) {
    const addr = SHIPPING_ADDRESSES[i];
    const variant = variants[Math.floor(Math.random() * variants.length)];
    const label = `${i + 1}/${SHIPPING_ADDRESSES.length} ${addr.first_name} ${addr.last_name}`.trim();

    try {
      const order = await createOrder(shop, accessToken, addr, variant.id, variant.price);
      ok++;
      console.log(`[OK] ${label} -> ${order.name} (variant ${variant.id}, PKR ${variant.price})`);
    } catch (err: any) {
      failed++;
      console.error(`[FAIL] ${label} -> ${err.message}`);
    }

    if (i < SHIPPING_ADDRESSES.length - 1) {
      await new Promise((r) => setTimeout(r, REQUEST_DELAY_MS));
    }
  }

  console.log(`\nDone. Created: ${ok}, Failed: ${failed}, Total: ${SHIPPING_ADDRESSES.length}`);
}

main()
  .catch((e) => {
    console.error("Fatal:", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
