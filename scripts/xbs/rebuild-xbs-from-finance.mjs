// Rebuilds the two raw XBS "Current Stock – Batch Wise Detail" exports
// (Type: Warehouse, Type: Blocked for Processing) from the XBS and Blocked for
// Processing sheets that Finance pastes into its month-end stock take workbook,
// so the Hub's XBS import can read them exactly like the files XBS produces.
//
// The workbook is only read, never changed. Clean-up applied:
//   - Finance's added 60 kg-equivalent column is dropped (XBS has no such column)
//   - trailing blank and total rows are dropped
//   - "Batch No" is renamed "Batch No." as in the XBS export
//   - the report header block is rebuilt; the as-on date comes from the data
//     (intake date + days in stock), the generation time is not known and is 00:00
//
//   node scripts/xbs/rebuild-xbs-from-finance.mjs "<finance workbook.xlsx>" "<output folder>"

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import readXlsxFile from "read-excel-file/node";
import writeXlsxFile from "write-excel-file/node";

const [, , workbook, outDir] = process.argv;
if (!workbook || !outDir) throw new Error('Usage: node rebuild-xbs-from-finance.mjs "<workbook.xlsx>" "<output folder>"');

// Column order of the real XBS exports (from the 2 Mar 2026 reports).
const WAREHOUSE_COLS = [
  "Item Group Name", "Item Name", "Item Code", "Secondary Basket", "Item Phase", "Inventory Type", "Stock In", "Warehouse", "Zone",
  "Intake Date", "Batch No.", "Outturn No", "Grower Marks", "Stock In Day(s)", "Bags", "Pockets", "Units", "Packing Type", "Qty.",
  "UOM", "Blocked", "LB No.", "SO No.", "PO No.", "Supplier", "Supplier Address", "Certification", "Outturn / Factor", "Warrant No", "Cup Score",
];
const BLOCKED_COLS = [
  "Item Group Name", "Item Name", "Item Code", "Item Phase", "Inventory Type", "Warehouse", "Zone", "Batch No.", "Outturn No",
  "Instruction No.", "Bags", "Pockets", "Units", "Packing Type", "Qty.", "UOM", "Secondary Basket", "Cup Score",
];
const RENAME = { "Batch No": "Batch No." };

const sheets = await readXlsxFile(workbook);
const sheet = (name) => {
  const s = sheets.find((x) => x.sheet.trim() === name);
  if (!s) throw new Error(`Sheet "${name}" not found in ${workbook}`);
  return s.data;
};

/** Rows of a Finance sheet as objects keyed by XBS column name; skips blank and total rows. */
function rowsOf(data, required) {
  const header = data[0].map((h) => (h == null ? null : RENAME[String(h).trim()] ?? String(h).trim()));
  return data
    .slice(1)
    .filter((r) => r && r[header.indexOf(required)] != null && String(r[header.indexOf(required)]).trim() !== "")
    .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]]).filter(([h]) => h)));
}

const warehouse = rowsOf(sheet("XBS"), "Warehouse");
const blocked = rowsOf(sheet("Blocked for Processing"), "Warehouse");

// As-on date: every row's intake date + days in stock should agree.
const asOn = new Map();
for (const r of warehouse)
  if (r["Intake Date"] instanceof Date && typeof r["Stock In Day(s)"] === "number") {
    const d = new Date(r["Intake Date"].getTime() + r["Stock In Day(s)"] * 864e5).toISOString().slice(0, 10);
    asOn.set(d, (asOn.get(d) ?? 0) + 1);
  }
const [asOnDate] = [...asOn.entries()].sort((a, b) => b[1] - a[1])[0];
const day = new Date(`${asOnDate}T00:00:00Z`);
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const stamp = `${String(day.getUTCDate()).padStart(2, "0")}-${MON[day.getUTCMonth()]}-${day.getUTCFullYear()}`;

// Excel stores dates as days since 30 Dec 1899; the XBS export writes intake dates that way.
const serial = (d) => Math.round((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - Date.UTC(1899, 11, 30)) / 864e5);
const cell = (v) => {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) return { value: serial(v), type: Number };
  if (typeof v === "number") return { value: v, type: Number };
  return { value: String(v), type: String };
};

function report(type, cols, rows) {
  const meta = (k, v) => [{ value: k, type: String }, v];
  return [
    meta("Report Name:", { value: "Current Stock", type: String }),
    meta("Report Generated On:", { value: `${stamp}  -  00:00:00`, type: String }),
    meta("Generate By:", { value: "rebuilt from Finance month-end workbook", type: String }),
    meta("Printed Using:", { value: "InvenSoft XBS", type: String }),
    [],
    [{ value: "Selection Criteria:", type: String }],
    meta("Branch Name:", { value: "BERNHARD ROTHFOS INTERCAFE AG", type: String }),
    meta("Type:", { value: type, type: String }),
    meta("Show In Transit:", { value: "Not Included", type: String }),
    meta("As On Date:", { value: day, type: Date, format: "dd-mmm-yyyy" }),
    meta("Report Type:", { value: "Batch Wise Detail", type: String }),
    [],
    cols.map((c) => ({ value: c, type: String, fontWeight: "bold" })),
    ...rows.map((r) => cols.map((c) => cell(r[c]))),
  ];
}

mkdirSync(outDir, { recursive: true });
const files = [
  [`9_XBS - Current Stock - ${stamp} - Warehouse (rebuilt from Finance workbook).xlsx`, report("Warehouse", WAREHOUSE_COLS, warehouse)],
  [`9_XBS - Current Stock - ${stamp} - Blocked for Processing (rebuilt from Finance workbook).xlsx`, report("Blocked for Processing", BLOCKED_COLS, blocked)],
];
for (const [name, data] of files) {
  await writeXlsxFile(data, { sheet: "Current Stock" }).toFile(join(outDir, name));
  console.log(`wrote ${name}`);
}
const missing = (rows, cols) => cols.filter((c) => !rows.some((r) => c in r));
console.log(`as-on date ${asOnDate} (${asOn.get(asOnDate)} of ${warehouse.length} rows agree)`);
console.log(`Warehouse rows ${warehouse.length}, Blocked for Processing rows ${blocked.length}`);
console.log(`columns not found in Finance's sheets (left blank): Warehouse ${JSON.stringify(missing(warehouse, WAREHOUSE_COLS))}, Blocked ${JSON.stringify(missing(blocked, BLOCKED_COLS))}`);
