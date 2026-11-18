# Build spec — "Auction purchase in transit" reconciling item

Written for: whoever builds this in the Hub (management app). Ready to implement.

## Why
October's Level 2 left **+4,424 bags unexplained**. It turned out to be Finance's **"Sale 4 posted in Nov'26" (4,463 bags)** — coffee bought at the 27 Oct Nairobi auction, in Comtras inventory at the 31 Oct cut-off, but **not yet physically at Ibero** (delivered/invoiced in November). This is the **inbound twin of the afloat rule** (afloat = stuffed-not-invoiced, outbound in transit; this = bought-not-delivered, inbound in transit).

### Evidence it is real and matchable (from our own data)
The Sale 4 allocation (3 contracts) maps exactly to our October 537 purchase tranche booked **30 Oct**:

| Contract | 537 voucher (booked 30 Oct) | Bags | Finance Sale 4 |
|---|---|---|---|
| 90567 | 74483 | 662 | 662 |
| 90603 | 74484 | 3,243 | 3,243 |
| 90533 | 74485 | 559 | 559 |
| | | **4,464** | 4,464 (≈4,463) |

All three are in Comtras Kenya inventory (IBERO KE: 90567=3,152, 90603=18,479, 90533=3,799) — i.e. inside the 37,464 BRIC — but absent from the physical count.

### Why a booking-date-only rule does NOT work (tested on Aug/Sep/Oct)
"Purchases booked in the last 14 days before the count" over-catches badly:

| Month | Final booking day tranche | Actual not-delivered |
|---|---|---|
| Oct | 30 Oct: **4,464** ✓ | Sale 4 = 4,464 |
| Aug | 28 Aug: **5,349** ✗ | Sale 37 ≈ 1,720 |
| Sep | 30 Sep: **11,660** ✗ | ≈ 0 |

October matches only by luck. The distinguishing signal is **the invoice/posting date is after the count date** (Sale 4 invoiced in Nov; Aug/Sep finals invoiced within their period). That date is **not** in our 537 — it comes from the **auction allocation report**. So the rule needs that report.

## Data source — auction allocation report
The report (Finance / Trade) has: Auction Date, Auction Sale No., Contract No., Invoice No., Kilos, Bags. **Ask Finance to include the Invoice Date** (the Comtras posting date) — the rule depends on it.

### New table `stk_auctionlot` (locked, create-only snapshot, one set per stock take)
Add to `scripts/dataverse/schema.mjs` (follow the `stk_xbsstuffing` / `stk_contractinvoice` pattern), include in the LOCKED list, add a data source, run `dv:schema` + `dv:roles` (verify lock).

| Column | Type | Note |
|---|---|---|
| `stk_auctiondate` | date | 27/10/2026 |
| `stk_sale` | string(10) | "4" |
| `stk_contract` | string(20) | 90567 / 90603 / 90533 |
| `stk_invoice` | string(20) | 11070–11072 |
| `stk_invoicedate` | date | **Comtras posting date — the rule hinges on this** |
| `stk_kg` | decimal(2) | 39727 … |
| `stk_bags` | decimal(2) | 662 … (cross-check = kg / 60) |
| `stk_source` | string(200) | file name |
| `stk_key` | string(60) | `contract\|invoice` — alternate key |
| lookup `stk_stocktake` | → stk_stocktake | required |

## Parser — `src/data/auction-parse.ts`
Model on `contracts-parse.ts`: read the xlsx by header, Kenya only, parse dates, `bags = kg / 60` and warn if it disagrees with the file's Bags column by > 0.5. Export `parseAuction(file)` → `AuctionLot[]` and `auctionTotals()`.

## The rule — `src/data/bridge-proposals.ts`
Add a proposal (new `kind: "auctionInTransit"`, label e.g. **"Auction purchases bought, not yet at Ibero"**) to `bridgeProposals()`:

```
For each auction lot where stk_invoicedate > stockTake.countDate  (posted after the cut-off):
  include it. (Fallback when invoicedate is blank: stk_auctiondate within PurchaseInTransitDays of the count.)
Exclude any lot whose outturn already appears in the XBS count (it did arrive).
Group the remainder by sale number; sum bags.
Emit one Proposal per sale: label "Auction Sale <N> — bought, not yet at Ibero",
  note "<contracts> · inv <invoices> · bought <auctiondate>", bags = sum,
  evidence = the contracts + invoice numbers.
```

Finance accepts it on the BRIC bridge like afloat/longs/sub-products (proposal → accept → it becomes a `stk_reconitem`). On October it emits exactly **Sale 4 = 4,464**; on Aug/Sep only the portion invoiced after the count (Aug ≈ 1,720, Sep ≈ 0), fixing the over-catch.

Note: `recon-items.ts` already has a `"Sale not delivered"` count-item kind for third-party lots at the latest sale (`saleRank`/`latest`); this new item is the **Comtras/purchase-side** equivalent and belongs on the bridge, not in the count items. Keep them distinct.

## Setting
`PurchaseInTransitDays` (default 14) — the fallback window used only when a lot has no invoice date. Tunable like `AfloatAgeingDays` (decision D6).

## Import UI
Add an "Auction allocation" upload to the Level 2 / XBS-import area (same panel pattern as the 537 multi-file loader): load → preview (lots, bags, how many invoice after the cut-off) → save as `stk_auctionlot` for the stock take. Then the bridge shows the new proposal.

## Also update
- `src/data/types.ts` — `AuctionLot` type; add `"auctionInTransit"` to `ReconItem["kind"]` / `LABELS`.
- `src/data/source/dataverse.ts` + `store.tsx` — load/save auction lots per stock take.
- `power.config.json` — the new data source; `npm run build:dv`.
- `docs/dataverse-schema.md` — document `stk_auctionlot`.
- Tests — parser (the 3 Sale 4 rows → 4,464) and the rule (invoice-after-count include/exclude; Aug/Sep/Oct scores above).
- Engine — if the bridge rule runs server-side, rebuild `engine/dist`.

## Acceptance
Loading October's Sale 4 allocation produces one bridge proposal "Auction Sale 4 — bought, not yet at Ibero · 4,464 bags" with contracts 90567/90603/90533 and invoices 11070–11072 as evidence; accepting it drops October's unexplained residual to ≈ −48 bags (Finance's figure). Aug/Sep do not over-catch.
