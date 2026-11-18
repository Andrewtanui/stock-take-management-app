// Tests the auction "bought, not yet at Ibero" rule on the real October Sale 4 allocation.
//   npm run test:auction
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const root = new URL("..", import.meta.url);
const out = await build({
  stdin: { contents: `export * from "./src/data/auction-parse";`, resolveDir: fileURLToPath(root), loader: "ts" },
  bundle: true, format: "esm", platform: "node", write: false,
});
const { parseAuction, auctionInTransit, toISODate } = await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString("base64")}`);

let pass = 0, fail = 0;
const ok = (name, cond) => (cond ? (pass++, console.log(`  ok  ${name}`)) : (fail++, console.log(`  FAIL ${name}`)));
const near = (a, b, e = 0.5) => Math.abs(a - b) <= e;

// The real Sale 4 allocation (as shown by Finance), with a header row.
const sheet = [
  ["Report: Auction Allocation"],
  ["Auction Date", "Auction Sale", "Contract No.", "Invoice No.", "Kilos", "Bags"],
  ["27/10/2026", 4, "90567", "11070", 39727, 662],
  ["27/10/2026", 4, "90603", "11071", 194598, 3243],
  ["27/10/2026", 4, "90533", "11072", 33514, 559],
];
const lots = parseAuction(sheet);
ok("parses 3 lots", lots.length === 3);
ok("bags = kg/60 (90603 ~ 3243)", near(lots.find((l) => l.contract === "90603").bags, 3243, 1));
ok("Sale 4 total ~ 4,464 bags", near(lots.reduce((s, l) => s + l.bags, 0), 4464, 1.5));
ok("auction date parsed d/m/y", lots[0].auctionDate === "2026-10-27");

// Rule: auctioned within 14 days of a 31 Oct count -> caught.
const t1 = auctionInTransit(lots, "2026-10-31");
ok("Sale 4 caught by the 14-day window", t1.length === 1 && t1[0].sale === "4" && near(t1[0].bags, 4464, 1.5));
ok("carries contracts + invoices as evidence", t1[0].contracts.length === 3 && t1[0].invoices.includes("11070"));

// An earlier auction (well before the window) is NOT caught.
const older = [...lots, { auctionDate: "2026-10-01", sale: "2", contract: "90400", invoice: "11000", kg: 60000, bags: 1000 }];
const t2 = auctionInTransit(older, "2026-10-31");
ok("earlier Sale 2 excluded (delivered)", !t2.some((s) => s.sale === "2"));

// Invoice date beats the window: invoiced after the count -> caught; invoiced before -> excluded.
const withInv = [
  { auctionDate: "2026-10-05", sale: "3", contract: "90500", invoice: "11050", invoiceDate: "2026-11-04", kg: 60000, bags: 1000 }, // posted Nov -> caught
  { auctionDate: "2026-10-28", sale: "9", contract: "90999", invoice: "11099", invoiceDate: "2026-10-30", kg: 60000, bags: 1000 }, // posted before count -> excluded
];
const t3 = auctionInTransit(withInv, "2026-10-31");
ok("invoiced-after-count caught despite old auction date", t3.some((s) => s.sale === "3"));
ok("invoiced-before-count excluded despite recent auction", !t3.some((s) => s.sale === "9"));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
