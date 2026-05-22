/**
 * prisma/build-residual-viewer.ts
 *
 * Generates a static HTML viewer for the 632 cities inserted by
 * append-residual-cities.ts (id LIKE 'SCS-%'). Self-contained — embeds
 * the city data as JSON and renders a searchable / filterable table.
 *
 * Output: prisma/data/residual-cities-view.html (open in browser).
 *
 * Run:
 *   npx tsx prisma/build-residual-viewer.ts
 */

import { PrismaClient } from "@prisma/client";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const prisma = new PrismaClient();

type Row = {
  id: string;
  name: string;
  province: string;
  couriers: string[];
  areaCount: number;
  mappings: unknown;
};

async function main() {
  const cities = await prisma.city.findMany({
    where: { id: { startsWith: "SCS-" } },
    select: {
      id: true,
      name: true,
      courierMappings: true,
      province: { select: { name: true } },
      _count: { select: { areas: true } },
    },
    orderBy: [{ province: { name: "asc" } }, { name: "asc" }],
  });

  const rows: Row[] = cities.map((c) => {
    const m = (c.courierMappings ?? {}) as Record<string, unknown>;
    return {
      id: c.id,
      name: c.name,
      province: c.province?.name ?? "—",
      couriers: Object.keys(m),
      areaCount: c._count.areas,
      mappings: c.courierMappings,
    };
  });

  // Aggregates for header counters
  const total = rows.length;
  const byProvince = rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.province] = (acc[r.province] ?? 0) + 1;
    return acc;
  }, {});
  const withAreas = rows.filter((r) => r.areaCount > 0).length;

  // Embed as JSON literal — keep it raw so the page works offline.
  const dataJson = JSON.stringify(rows);
  const provinceCountsJson = JSON.stringify(byProvince);

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Residual-batch cities (${total})</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    margin: 0; padding: 24px; background: #fafafa; color: #1a1a1a;
  }
  h1 { margin: 0 0 4px 0; font-size: 20px; font-weight: 700; }
  .sub { color: #666; margin-bottom: 16px; font-size: 13px; }
  .chips { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 12px; }
  .chip {
    padding: 4px 10px; border-radius: 999px; font-size: 12px; cursor: pointer;
    border: 1px solid #d0d0d0; background: #fff; user-select: none;
  }
  .chip.active { background: #1a1a1a; color: #fff; border-color: #1a1a1a; }
  .chip .count { opacity: 0.6; margin-left: 4px; font-variant-numeric: tabular-nums; }
  .toolbar {
    display: flex; gap: 8px; align-items: center; margin-bottom: 12px; flex-wrap: wrap;
  }
  input[type=search] {
    padding: 8px 12px; border: 1px solid #d0d0d0; border-radius: 6px;
    font-size: 13px; width: 260px; background: #fff;
  }
  .courier-filter { display: flex; gap: 8px; align-items: center; font-size: 12px; }
  .courier-filter label { display: flex; align-items: center; gap: 4px; cursor: pointer; }
  table { width: 100%; border-collapse: collapse; background: #fff; font-size: 13px; }
  thead { position: sticky; top: 0; background: #f0f0f0; box-shadow: 0 1px 0 #ddd; }
  th, td {
    text-align: left; padding: 8px 12px; border-bottom: 1px solid #eee;
    vertical-align: top;
  }
  th { font-weight: 600; font-size: 12px; color: #555; text-transform: uppercase; letter-spacing: 0.04em; }
  tr:hover td { background: #fafbff; }
  .id { font-family: ui-monospace, "SF Mono", Consolas, monospace; font-size: 12px; color: #777; }
  .name { font-weight: 600; }
  .badges { display: inline-flex; gap: 4px; }
  .badge {
    font-size: 10px; font-weight: 700; padding: 2px 6px; border-radius: 4px;
    letter-spacing: 0.04em; text-transform: uppercase;
  }
  .badge-tcs { background: #e7f3ff; color: #0b5394; }
  .badge-leopards { background: #fff4e5; color: #9a4f04; }
  .badge-daewoo { background: #eaf5e9; color: #1e6131; }
  .area-count.zero { color: #aaa; }
  .area-count.nonzero { color: #c44; font-weight: 600; }
  .empty {
    padding: 40px; text-align: center; color: #888; font-style: italic;
  }
  .footer-stats { margin-top: 12px; font-size: 12px; color: #666; }
  @media (prefers-color-scheme: dark) {
    body { background: #1a1a1a; color: #eee; }
    .chip { background: #2a2a2a; border-color: #444; color: #eee; }
    .chip.active { background: #eee; color: #1a1a1a; border-color: #eee; }
    input[type=search] { background: #2a2a2a; color: #eee; border-color: #444; }
    table { background: #222; }
    thead { background: #2a2a2a; box-shadow: 0 1px 0 #333; }
    th, td { border-bottom-color: #2e2e2e; }
    th { color: #aaa; }
    tr:hover td { background: #2a2a2a; }
    .id { color: #999; }
    .badge-tcs { background: #1d3a52; color: #99c8e8; }
    .badge-leopards { background: #4a3318; color: #f0c280; }
    .badge-daewoo { background: #1f3a23; color: #9ad9a5; }
  }
</style>
</head>
<body>
<h1>Residual-batch cities <span style="color:#888;font-weight:400">(${total})</span></h1>
<div class="sub">
  Inserted by <code>prisma/append-residual-cities.ts</code>. All IDs start with <code>SCS-</code>.
  ${withAreas === 0
    ? `<strong style="color:#1e6131">No areas attached</strong> — these cities exist in <code>City</code> only.`
    : `<strong style="color:#c44">${withAreas} have areas attached</strong> — unexpected.`}
</div>

<div class="chips" id="provinceChips"></div>

<div class="toolbar">
  <input type="search" id="search" placeholder="Search name or id…" autocomplete="off">
  <div class="courier-filter">
    <span style="color:#888;margin-right:4px">Courier:</span>
    <label><input type="checkbox" data-courier="tcs" checked> TCS</label>
    <label><input type="checkbox" data-courier="leopards" checked> Leopards</label>
    <label><input type="checkbox" data-courier="daewoo" checked> Daewoo</label>
    <label style="margin-left:12px"><input type="checkbox" id="anyAll" checked> match ANY</label>
  </div>
</div>

<table>
  <thead>
    <tr>
      <th style="width:38%">Name</th>
      <th style="width:18%">Province</th>
      <th style="width:22%">ID</th>
      <th style="width:14%">Couriers</th>
      <th style="width:8%">Areas</th>
    </tr>
  </thead>
  <tbody id="tbody"></tbody>
</table>

<div class="footer-stats" id="footerStats"></div>

<script>
  const ROWS = ${dataJson};
  const PROVINCE_COUNTS = ${provinceCountsJson};

  const state = {
    province: "all",        // "all" or a province name
    query: "",
    couriers: { tcs: true, leopards: true, daewoo: true },
    matchAny: true,
  };

  // Province chip bar
  const chips = document.getElementById("provinceChips");
  const allChip = mkChip("all", "All", ROWS.length);
  chips.appendChild(allChip);
  for (const [name, count] of Object.entries(PROVINCE_COUNTS).sort((a, b) => b[1] - a[1])) {
    chips.appendChild(mkChip(name, name, count));
  }
  function mkChip(value, label, count) {
    const el = document.createElement("div");
    el.className = "chip" + (state.province === value ? " active" : "");
    el.dataset.value = value;
    el.innerHTML = label + ' <span class="count">' + count + '</span>';
    el.addEventListener("click", () => {
      state.province = value;
      document.querySelectorAll(".chip").forEach(c => c.classList.toggle("active", c.dataset.value === value));
      render();
    });
    return el;
  }

  // Search
  document.getElementById("search").addEventListener("input", (e) => {
    state.query = e.target.value.toLowerCase().trim();
    render();
  });

  // Courier checkboxes
  document.querySelectorAll('[data-courier]').forEach(cb => {
    cb.addEventListener("change", () => {
      state.couriers[cb.dataset.courier] = cb.checked;
      render();
    });
  });
  document.getElementById("anyAll").addEventListener("change", (e) => {
    state.matchAny = e.target.checked;
    e.target.parentElement.firstChild.textContent = ""; // no-op, label stays
    render();
  });

  function badge(c) {
    return '<span class="badge badge-' + c + '">' + c + '</span>';
  }

  function passesFilter(row) {
    if (state.province !== "all" && row.province !== state.province) return false;
    if (state.query) {
      const hay = (row.name + " " + row.id).toLowerCase();
      if (!hay.includes(state.query)) return false;
    }
    const enabled = Object.entries(state.couriers).filter(([, v]) => v).map(([k]) => k);
    if (enabled.length === 0) return false;
    const rowCouriers = new Set(row.couriers);
    if (state.matchAny) {
      // row must have at least one enabled courier
      return enabled.some(c => rowCouriers.has(c));
    } else {
      // row must have ALL enabled couriers
      return enabled.every(c => rowCouriers.has(c));
    }
  }

  function render() {
    const filtered = ROWS.filter(passesFilter);
    const tbody = document.getElementById("tbody");
    if (filtered.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty">No matches.</td></tr>';
    } else {
      tbody.innerHTML = filtered.map(r => {
        const ac = r.areaCount;
        const acClass = ac === 0 ? "zero" : "nonzero";
        return '<tr>' +
          '<td class="name">' + escapeHtml(r.name) + '</td>' +
          '<td>' + escapeHtml(r.province) + '</td>' +
          '<td class="id">' + escapeHtml(r.id) + '</td>' +
          '<td><span class="badges">' + r.couriers.map(badge).join("") + '</span></td>' +
          '<td class="area-count ' + acClass + '">' + ac + '</td>' +
        '</tr>';
      }).join("");
    }
    document.getElementById("footerStats").textContent =
      "Showing " + filtered.length + " of " + ROWS.length + " rows.";
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  render();
</script>
</body>
</html>
`;

  const outPath = path.join(__dirname, "data", "residual-cities-view.html");
  fs.writeFileSync(outPath, html, "utf-8");

  console.log(`📦  Cities exported   : ${total}`);
  console.log(`🗺️   With ≥1 area      : ${withAreas}`);
  console.log(`📄  ${outPath}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
