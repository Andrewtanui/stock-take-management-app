# Dataverse schema — IBKY Stock Take

Status: **live in the development environment** (built 9 Oct 2026, last changed
27 Oct 2026: tables 27-28 loaded, afloat rule) and in **NKG_Demo** (last updated 26 Oct: same tables, roles and apps as dev,
and its `stk_` data replaced with an exact copy of dev's August month-end). Only in dev so
far: nothing; the shipment tracker `stk_shipment` (table 27) and the direct purchase lots `stk_directlot` (table 28), added 27 Oct, are in NKG_Demo too with the same rows (1,253 and 150), like the 537 (table 26). Flows in NKG_Demo are saved
but switched off until its connections exist. This document describes what exists in
Dataverse today.
The source of truth is `scripts/dataverse/schema.mjs`; `npm run dv:schema`
creates or extends the tables from it (it only adds, never drops).

Shared by both code apps: the **Stock Take** app (counters, phone) and the
**Stock Management Hub** (Operations, Warehouse, Trading, Finance, IT). The apps
never call each other: they read and write these tables, and Power Automate
flows react to changes in them.

| | |
|---|---|
| Environment | Andrew Tanui's Environment · `fbbef02c-fb2e-e56f-926c-4fe610004640` · https://org6c75cfc0.crm4.dynamics.com/ |
| Web API | `https://org6c75cfc0.crm4.dynamics.com/api/data/v9.2/` (entity set = plural logical name, e.g. `stk_xbslines`) |
| Solution | `IBKYStockTake` — "IBKY Stock Take" (unmanaged in dev) |
| Publisher | `IberoKenya` — "Ibero Kenya" · prefix **`stk`** · choice values start at **614500000** |
| Auditing | Dataverse auditing on for every table (no custom audit log) |
| Notes (files) | Enabled on `stk_countline` and `stk_issue` (photos) and `stk_stocktake` (Level 1 summary PDF) |
| Security roles | 9 `STK …` roles (7 for people, STK Engine and STK Level 1 Engine for application users), see [security-roles.md](security-roles.md). Every user also needs the built-in **Basic User** role |
| NKG copy | NKG_Demo · `61203bbf-8829-e6fd-bbdd-bb98d7fa1d56` · https://orged86d520.crm4.dynamics.com/ |

## How to look at it

- **Tables and data:** make.powerapps.com → this environment → Tables → filter
  on "stk" (or Solutions → IBKY Stock Take → Tables).
- **Power BI / Fabric:** Get data → Dataverse → tables starting `stk_`. NKG accounts
  connect to **NKG_Demo, `orged86d520.crm4.dynamics.com`** (dev, `org6c75cfc0`, is in the
  Pathways tenant and refuses NKG sign-ins with "Invalid connection credentials").
  Choice columns come through as numbers; the labels are in the "Shared choices"
  table below, or use the `…name` virtual column.
- **Web API / scripts:** `scripts/dataverse/api.mjs` (signs in with the Power
  Platform CLI's account).

## Ground rules

1. **XBS is never changed.** XBS and Comtras data arrives as an *import* and is
   stored as a frozen snapshot (`stk_xbsimport`, `stk_xbsline`,
   `stk_comtrasposition`, `stk_contractinvoice`, `stk_shipment`, `stk_directlot`, `stk_xbsstuffing`). No role can update or delete those rows. Anything
   wrong in XBS becomes an **exception** that a person fixes in XBS by hand; the
   next import shows whether it was fixed. The same snapshot can't be imported
   twice.
2. **Counts are facts from the floor.** A count line records what the counter
   saw. Supervisors decide what a difference means (variance → cause); they
   don't overwrite the count. A blind recount adds a new line that replaces the
   first in comparisons.
3. **Counting is blind.** Counters' roles and screens never expose XBS
   quantities; only management roles read variances.
4. **Every decision has a who and when.** Decisions are their own columns
   (decided by / on) or rows (`stk_signoff`), plus Dataverse audit history.
5. **Retry-safe writes.** Rows created on a phone carry a device-generated
   `stk_clientid` (alternate key), so a re-sent save updates instead of
   duplicating. Variances carry a unique `stk_lotkey` for the same reason.
6. **Nothing is deleted.** Records are closed, superseded or accepted; delete
   behaviour is Restrict everywhere. One exception: flow F5 deletes a sign-off
   made by someone who already signed another gate when separation of duties is on. Snapshot rows loaded by
   mistake are removed only by an administrator, with a backup (27 Oct: 74 October direct purchase
   lots loaded into the August stock take in dev).

## Tables at a glance

Rows = what is in the dev environment on 26 Oct 2026: the **August 2026 month-end
replayed end to end** (Finance's XBS exports, P526, 537 and count; see PLAN.md), with Level 1
decided by the Hub's automatic rules and counting closed automatically. NKG_Demo holds the
same rows, except the 537 lines and the engine runs.

| # | Table | Ownership | Written by | Read by | Rows |
|---|---|---|---|---|---|
| | **Reference & settings** | | | | |
| 1 | `stk_site` Warehouse | Org | IT Admin | everyone | 6 |
| 2 | `stk_packtype` Packing type | Org | IT Admin | everyone | 2 |
| 3 | `stk_setting` Setting | Org | IT Admin | everyone | 16 |
| | **Source data (locked)** | | | | |
| 4 | `stk_xbsimport` XBS import | Org | Importer (create; status by import only) | everyone | 1 |
| 5 | `stk_xbsline` XBS line | Org | Importer (**create only**) | everyone | 786 |
| 6 | `stk_comtrasposition` Comtras position (P526) | Org | Importer (**create only**) | mgmt roles | 222 |
| 26 | `stk_contractinvoice` Contract invoice line (Comtras 537) | Org | Importer (**create only**) | mgmt roles | 939 |
| 27 | `stk_shipment` Shipment (Trade tracker) | Org | Importer (**create only**) | mgmt roles | 1,253 |
| 28 | `stk_directlot` Direct purchase lot (Trading) | Org | Importer (**create only**) | mgmt roles | 150 |
| 29 | `stk_xbsstuffing` XBS stuffing (shipped report) | Org | Importer (**create only**) | mgmt roles | 0 (dev, new) |
| | **Mapping** | | | | |
| 7 | `stk_basketmap` Basket mapping | Org | via approved change only | everyone | 72 |
| 8 | `stk_outturnmap` Outturn mapping | Org | via approved change only | everyone | 0 |
| 9 | `stk_mappingchange` Mapping change | User | Trading, Finance, Ops (request); Finance (decide) | mgmt roles | 1 |
| | **Stock take** | | | | |
| 10 | `stk_stocktake` Stock take | Org | Ops Admin; the Hub closes counting | everyone | 1 |
| 11 | `stk_assignment` Assignment | Org | Ops Admin (published by the counter allocation) | everyone (counters: own) | 7 |
| 12 | `stk_countsheet` Count sheet | User (= counter) | Counter (create/submit); Ops/WH Mgr (decide) | counter: own; mgmt: all | 7 |
| 13 | `stk_stack` Stack | Org | Counter (create/submit/close a site); Ops/WH Mgr | everyone | 163 |
| 14 | `stk_countline` Count line | User (= counter) | Counter (own lines) | counters: all (for "already counted" warnings, never XBS figures); mgmt: all | 702 |
| 15 | `stk_recount` Recount | User (= assignee) | Hub rules or Ops/WH Mgr (create); counter (complete) | assignee; mgmt | 43 |
| | **Reconcile & sign-off** | | | | |
| 16 | `stk_variance` Variance | Org | Hub (generate and decide by rule); Ops/WH Mgr/Finance (override) | mgmt roles | 686 |
| 17 | `stk_exception` Exception | User (= owner) | Hub rules, mgmt roles, flows, the IBKY engine | mgmt roles | 21 |
| 18 | `stk_signoff` Sign-off | Org | the gate's role | everyone | 0 |
| 23 | `stk_reconitem` Reconciling item | Org | Finance, Ops Admin | mgmt roles | 8 |
| 24 | `stk_kpisnapshot` KPI snapshot | Org | the Hub (any mgmt role's session); frozen at Finance sign-off | mgmt roles, STK Engine | 12 |
| 25 | `stk_enginerun` Engine run | Org | the Level 1 engine (stk-level1) | mgmt roles | 2 (dry runs) |
| | **Counter allocation** | | | | |
| 21 | `stk_counterprofile` Counter profile | Org | Ops Admin, IT Admin | mgmt roles | 4 |
| 22 | `stk_allocationrun` Allocation run | Org | Ops Admin | mgmt roles | 4 |
| | **Other** | | | | |
| 19 | `stk_directpurchase` Direct purchase | Org | Trading | mgmt roles | 0 |
| 20 | `stk_issue` Problem report | User (= raiser) | Counter (create); Ops/IT (triage) | raiser: own; mgmt: all | 0 |

Org-owned = shared data with no per-person ownership. User-owned = rows belong
to a person, so "counters see only their own" is enforced by role depth (User
level) without custom filtering.

## Shared choices (global option sets)

Values are numbered in the order listed, from 614500000 (first value =
614500000, second = 614500001, …). New values are only ever **appended**, so
existing numbers, which flows and reports use, never change.

| Choice | Values |
|---|---|
| `stk_stocktype` | Warehouse · Blocked for processing |
| `stk_stocktaketype` | Monthly · 100% (zero-out) |
| `stk_stocktakestatus` | Count in progress · Reconciliation · Sign-off · Completed |
| `stk_sheetstatus` | In progress · Submitted · Approved · Sent back |
| `stk_stackstatus` | Not started · In progress · Submitted · Approved · Sent back |
| `stk_importstatus` | Validating · Imported · Failed · Superseded |
| `stk_primarybasket` | Plus · FAQ · Grinder |
| `stk_stockcategory` | Current stock · Processing stock · Work in progress · Sweepings · Loose bags · Disputed stock · Direct purchase (not in XBS) · Ex-office stock |
| `stk_countreason` (counter's reason) | Part of the lot is at another location · Bags moved here, not yet received in XBS · Bags left this stack, not yet posted out · Torn or re-bagged bags · Pocket weighed differently · Tag missing or unreadable · Stack blocked, couldn't reach every bag · Not sure, supervisor to check |
| `stk_rootcause` (supervisor's cause) | Split lot · Unposted receipt · Unposted gate-out · Duplicate entry · Mapping error · Pocket / unit difference · Wrong basket on sale · In transit · Cancelled contract · Not yet known · Partial delivery: rest still at third party · Weight loss: claim from warehouse · Posting timing / late posting |
| `stk_variancestate` | Open · Recount sent · Accepted · Exception raised |
| `stk_exceptionkind` | the first ten `stk_rootcause` values · Master data · Third party · Direct purchase · Partial delivery: rest still at third party · Weight loss: claim from warehouse · Posting timing / late posting |
| `stk_exceptionsource` | Count · Import · Pre-count check · Reconciliation · IBKY engine (added 25 Oct) |
| `stk_exceptionstatus` | Open · In progress · Escalated · Closed |
| `stk_department` | Operations · Warehouse · Trading · Finance · Logistics · Quality · IT |
| `stk_gate` | Operations Lead · Warehouse Manager · Trading Admin Manager · Country Finance Manager · Senior Accountant · Chief Accountant (the first four renamed in place from Operations · Warehouse · Trading · Finance on 28 Oct 2026) |
| `stk_issuecategory` | App not working · Network or saving · Lot not on the list · Tag missing or unreadable · Stack blocked or unsafe · Third-party staff not available · Other |
| `stk_issuestatus` | Open · In progress · Resolved |

The last three `stk_rootcause` values were added on 11 Oct 2026 from the
Finance and Logistics discovery sessions. In `stk_exceptionkind` they come after
Direct purchase, so their numbers differ between the two choices; match on the
label, not the number, when joining the two.

Local (table-only) choices: `stk_mappingchange.stk_target` (Basket · Outturn),
`stk_mappingchange.stk_state` (Pending · Approved · Rejected),
`stk_recount.stk_status` (Open · Done), `stk_exception.stk_escalationlevel`
(Owner · Head of department · Country Finance Manager), `stk_signoff.stk_action`
(Signed · Sent back), `stk_directpurchase.stk_suppliertype` (Co-operative · Agent).

## Table details

Conventions: every table also has the standard `createdon`, `createdby`,
`modifiedon`, `modifiedby`, `ownerid` (user-owned) and `statecode`. **PK** =
primary name column. **AK** = alternate key. Lookups are N:1 unless stated.

### 1. `stk_site` — Warehouse
| Column | Type | Notes |
|---|---|---|
| `stk_name` PK | Text 100 | "Ibero Export Warehouse" |
| `stk_code` AK | Text 10 | IBR, AGL, KPCU, MAXA, MCF, KCCE |
| `stk_shortname` | Text 40 | "Ibero" |
| `stk_isthirdparty` | Yes/No | |
| `stk_manualentry` | Yes/No | Counters may type outturns not in the XBS list (switch in Set-up) |
| `stk_ceilingbags` | Whole number | Count-day ceiling, default 6000 |
| `stk_hasbaylayout` | Yes/No | Ibero = Yes (rows A–G × bays 1–14) |

The XBS import matches a warehouse by the **first word** of the XBS name
("MITCHEL COTTS FREIGHT KENYA LIMITED" → Mitchel Cotts).

### 2. `stk_packtype` — Packing type
| Column | Type | Notes |
|---|---|---|
| `stk_name` PK | Text 50 | "60 kg jute bag" |
| `stk_code` AK | Text 10 | JUTE60, JUTE50 |
| `stk_kgperbag` | Decimal (2) | 60, 50 |
| `stk_gradepattern` | Text 100 | Grades that default to it, e.g. `LIGHT` |

### 3. `stk_setting` — Setting (key/value)
| Column | Type | Notes |
|---|---|---|
| `stk_name` PK, AK | Text 60 | Key |
| `stk_value` | Text 2000 | Value (JSON allowed, e.g. HeadsOfDepartment) |
| `stk_description` | Text 400 | |

| Key | Dev value | Used by |
|---|---|---|
| `TargetNetVariancePct` | 0.10 | Net variance target, ± % |
| `SignOffWorkingDays` | 7 | SOP sign-off window |
| `ExceptionSlaWorkingDays` | 5 | Exception due date |
| `ThirdPartyAgeDays` | 21 | Pre-count check (call-off rule) |
| `MatchToleranceKg` | 1 | Weight still treated as a match (pockets are weighed to the whole kg; XBS keeps 0.1 kg). Mirrors `MATCH_TOLERANCE_KG` in the apps' shared rules |
| `AvgValueUsdPerTonne` | 7383 | Value at risk |
| `EnforceSeparationOfDuties` | false | true for go-live (requester ≠ approver; one person signs one sign-off gate; named signers only) |
| `MappingApprovers` | email(s) | Flow F6 |
| `SignOffDistribution` | email(s) | Flow F5 pack email |
| `SignOffSigners` | JSON | Optional. Gate → `{ "name", "email"?, "standIn"?: { "name", "email"? } }`; gates left out show the name on Finance's signature block. With an email and separation of duties on, only that person or the stand-in can sign the gate |
| `HeadsOfDepartment` | JSON department → email | Flow F4 (3+ days overdue) |
| `CountryFinanceManager` | email | Flow F4 (7+ days overdue) |
| `CountReportDistribution` | email(s) | Flow F8; never counters (it shows XBS figures) |
| `CountReportDate` | auto | Flow F8; a yyyy-MM-dd date re-sends that day's report |

### 4. `stk_xbsimport` — XBS import (header)
| Column | Type | Notes |
|---|---|---|
| `stk_name` PK, AK | Text 30 | `IMP-260302-0852` (from the snapshot time) |
| `stk_snapshotat` | Date & time | "Report Generated On" in the XBS report header (EAT) |
| `stk_filenames` | Multiline 2000 | Both report file names |
| `stk_rowcount` | Whole number | |
| `stk_status` | `stk_importstatus` | Validating → Imported / Failed; Superseded when a newer import lands |
| `stk_checks` | Multiline 100k | The 8 import check results as JSON |
| `stk_warningcount` / `stk_failcount` | Whole number | |
| `stk_importedby` | Lookup → systemuser | |

### 5. `stk_xbsline` — XBS line (locked)
One row per line of either XBS report (*Current Stock – Batch Wise Detail*,
Type Warehouse or Blocked for Processing).

| Column | Type | XBS column |
|---|---|---|
| `stk_name` PK | Text 100 | Batch No. |
| `stk_import` | Lookup → stk_xbsimport | |
| `stk_rownumber` | Whole number | AK with `stk_import`, so a re-run load can't duplicate |
| `stk_site` | Lookup → stk_site | Warehouse |
| `stk_stocktype` | `stk_stocktype` | Which report |
| `stk_zone` | Text 40 | Zone ("D-05-1", "A/B-14-1", "TEMP-0-0") |
| `stk_outturn` | Text 30 | Outturn No |
| `stk_grade` | Text 30 | Item Name |
| `stk_basketcode` / `stk_basketname` | Text 10 / Text 100 | Secondary Basket, split: "10030 (AA Plus)" → 10030 / AA Plus |
| `stk_bags` | Whole number | Bags |
| `stk_pocketkg` | Decimal (2) | Pockets (kg) |
| `stk_units` | Whole number | Units |
| `stk_kg` | Decimal (2) | Qty. |
| `stk_growermark` | Text 100 | Grower Marks |
| `stk_warrant` | Text 40 | Warrant No |
| `stk_certification` | Text 200 | Certification |
| `stk_cupscore` | Text 40 | Cup Score |
| `stk_blocked` | Yes/No | Blocked (always Yes for the Blocked for Processing report) |
| `stk_salescontract` | Text 20 | SO No. |
| `stk_instruction` | Text 40 | Instruction No. |
| `stk_daysinstock` | Whole number | Stock In Day(s) |
| `stk_cropyear` | Text 12 | Inventory Type |

XBS can split one batch into several lines at the same zone; comparisons always
add all lines of a batch at a place. Old imports stay (Superseded) for history.

### 6. `stk_comtrasposition` — Comtras position (locked)
One row per contract line of the Comtras **P526** long/short report, loaded once per
stock take on the Hub's import page (`src/data/comtras-parse.ts`).

| Column | Type | Notes |
|---|---|---|
| `stk_name` PK | Text 100 | "Inventory 90523 10057" (line type, contract, quality code) |
| `stk_stocktake` | Lookup | The stock take it reconciles (added 18 Oct) |
| `stk_linetype` | Text 20 | `Inventory` · `Longs` · `Short` |
| `stk_contract` | Text 20 | Comtras contract number (`Ctr.No.`) |
| `stk_origin` | Text 60 | `Arabica Kenya`, `Arabica Ethiopia` |
| `stk_counterparty` | Text 60 | Comtras matchcode (e.g. `NKG BERO I`, `IAC USA`) |
| `stk_basketcode` | Text 10 | Comtras quality code (`QualCode`). Matches our secondary basket codes where they're the same basket; 10057 and 10027 aren't in the mapping |
| `stk_bags` | Decimal (2) | 60 kg bags |
| `stk_kg` | Decimal (2) | |
| `stk_snapshotdate` | Date | Load date |
| `stk_source` | Text 200 | File name |

**Finance's "Total BRIC (Comtras)"** = `Arabica Kenya` Inventory + Longs
(August 2026: 62,060.70 + 2,631.07 = 64,691.77). Other origins and Shorts are kept
but not part of it. The P526's 60 kg column is spelt differently between exports
("60Kg Bags" / "60 Kgs Bag"); the parser accepts both.

### 7. `stk_basketmap` — Basket mapping (secondary → primary)
| Column | Type | Notes |
|---|---|---|
| `stk_name` PK | Text 120 | "10070 AB/PB FAQ" |
| `stk_basketcode` AK | Text 10 | |
| `stk_primarybasket` | `stk_primarybasket` | |
| `stk_lastchange` | Lookup → stk_mappingchange | Change that set the current value |

38 rows seeded. **Known issue:** Minus / Natural baskets are under Grinder;
September shipments show them under FAQ 10057. Waiting for Trade & QC's mapping
document.

### 8. `stk_outturnmap` — Outturn mapping (overrides)
Only for outturns whose basket is missing or wrong in XBS.

| Column | Type | Notes |
|---|---|---|
| `stk_name` PK, AK | Text 30 | Outturn |
| `stk_basketcode` | Text 10 | |
| `stk_change` | Lookup → stk_mappingchange | |

### 9. `stk_mappingchange` — Mapping change request
| Column | Type | Notes |
|---|---|---|
| `stk_name` PK | Text 30 | `MC-014` |
| `stk_target` | Choice: Basket · Outturn | |
| `stk_targetkey` | Text 30 | Basket code or outturn |
| `stk_from` / `stk_to` | Text 120 | |
| `stk_reason` | Multiline 2000 | |
| `stk_state` | Choice: Pending · Approved · Rejected | Decided in the Hub or via the Teams approval (flow F6) |
| `stk_decidedby` / `stk_decidedon` | Lookup systemuser / Date & time | Must differ from `createdby` when separation of duties is on |

### 10. `stk_stocktake` — Stock take
| Column | Type | Notes |
|---|---|---|
| `stk_name` PK | Text 100 | "Monthly Stock Take - 12/10/2026" |
| `stk_type` | `stk_stocktaketype` | |
| `stk_status` | `stk_stocktakestatus` | Counting is open only in Count in progress |
| `stk_countdate` | Date | |
| `stk_import` | Lookup → stk_xbsimport | Expected stock for this count |
| `stk_sites` | **N:N** ↔ stk_site (`stk_stocktake_site`) | Warehouses included. Not written yet: the generated services can't write N:N, so every stock take covers all warehouses for now |
| `stk_preparedby` | Lookup → systemuser | Not used since 28 Oct 2026: preparing is now the Senior Accountant gate |
| `stk_closedon` / `stk_closecomment` | Date & time / Multiline | Stock take completed (flow F5 after the chain's last gate signs) |
| `stk_countclosedon` | Date & time | **Counting closed** (added 23 Oct). Set by the Hub when every Ibero stack XBS has stock on is submitted, every third-party site is closed, no recount is open and every variance is decided; the status moves to Reconciliation at the same time. Triggers flow F10 |
| `stk_l1summary` | Multiline 20000 | **Level 1 summary** written at that moment: an HTML block (physical vs XBS by warehouse, variances, exceptions) used as the body of F10's email |

Notes are on for this table: the Hub saves the branded **Level 1 summary PDF** as a note
with subject `Level 1 summary` (one per stock take); F10 attaches it and the Overview
offers it for download.

### 11. `stk_assignment` — Assignment (who counts where)
| Column | Type | Notes |
|---|---|---|
| `stk_name` PK | Text 100 | "Achieng O. · Ibero rows D–E" |
| `stk_stocktake` | Lookup | |
| `stk_counter` | Lookup → systemuser | The counter app finds the signed-in user's row |
| `stk_site` | Lookup → stk_site | |
| `stk_rows` | Text 20 | "D,E"; empty = whole site (third parties) |

Copied to each new stock take from the previous one. No Hub screen to edit
assignments yet; they are created in Dataverse.

### 12. `stk_countsheet` — Count sheet (the approval unit)
One per counter per assignment. Owner = the counter.

| Column | Type | Notes |
|---|---|---|
| `stk_name` PK | Text 30 | `CS-MV0PXKYM` |
| `stk_stocktake` / `stk_assignment` / `stk_site` | Lookups | |
| `stk_status` | `stk_sheetstatus` | Submitted → flow F2; Sent back → flow F3a |
| `stk_submittedon` | Date & time | |
| `stk_countercomment` | Multiline 2000 | |
| `stk_decidedby` / `stk_decidedon` / `stk_decisioncomment` | Lookup / Date & time / Multiline | Comment required to send back; shown to the counter (no XBS figures) |
| `stk_linecount` / `stk_variancecount` / `stk_bags` | Whole number | Kept up to date by the app |

### 13. `stk_stack` — Stack (submission unit on the floor)
One per stock take × site × stack code. At Ibero the codes are bay locations
("D-05-1", "D-05/06-1", "A/B-14-1"); at third parties counters create them
("Site 2 · Stack 1") with a landmark.

| Column | Type | Notes |
|---|---|---|
| `stk_name` PK | Text 60 | "D-05-1" |
| `stk_stocktake` / `stk_site` / `stk_countsheet` | Lookups | |
| `stk_landmark` | Text 200 | Third parties |
| `stk_status` | `stk_stackstatus` | Submitting a stack is what makes its lots comparable |
| `stk_submittedby` / `stk_submittedon` | Lookup / Date & time | |
| `stk_comment` | Multiline 2000 | Reason, for a site reported empty |
| `stk_nothinghere` | Yes/No | Third-party site reported **empty** by its counter (added 18 Oct) |
| `stk_sitefinished` | Yes/No | Third-party site **finished**: every stack counted (added 19 Oct) |

Third-party sites are closed with one marker stack named `Whole site` flagged
`stk_nothinghere` or `stk_sitefinished`. Once closed, every XBS lot at that site that
nobody counted is judged as counted 0 (variance rules). Until then, lots nobody
counted aren't variances.

### 14. `stk_countline` — Count line
One per outturn counted at a stack. **Notes enabled**: the tag photo is an
annotation on the line, subject "Photo of the tag".

| Column | Type | Notes |
|---|---|---|
| `stk_name` PK | Text 60 | "KGT2605 @ D-05-1" |
| `stk_clientid` AK | Text 40 | GUID made on the device |
| `stk_countsheet` / `stk_stack` / `stk_site` | Lookups | |
| `stk_xbsline` | Lookup → stk_xbsline | First XBS line of the lot; empty for found / other stock |
| `stk_outturn` / `stk_batch` / `stk_grade` | Text | As read from the tag |
| `stk_category` | `stk_stockcategory` | |
| `stk_packtype` | Lookup → stk_packtype | |
| `stk_bags` | Whole number | Full bags |
| `stk_pocketbags` | Whole number | 0 or 1 (one pocket per outturn per location) |
| `stk_pocketkg` | Decimal (2) | Whole kg from the app |
| `stk_units` | Whole number | Full bags + 1 if there is a pocket |
| `stk_kg` | Decimal (2) | Full bags × pack kg + pocket kg |
| `stk_bags60` | Decimal (2) | kg ÷ 60 |
| `stk_reason` | `stk_countreason` | Optional "anything unusual" |
| `stk_note` | Multiline 2000 | |
| `stk_isfound` / `stk_isother` / `stk_isblind` | Yes/No | Not expected here · other stock · blind recount |
| `stk_reference` | Text 60 | Contract / delivery note (other stock, direct purchases) |
| `stk_recount` | Lookup → stk_recount | When this line answers a recount |
| `stk_countedon` | Date & time | Device time |

### 15. `stk_recount` — Recount request
| Column | Type | Notes |
|---|---|---|
| `stk_name` PK | Text 30 | `R-001` |
| `stk_stocktake` / `stk_stack` / `stk_variance` | Lookups | |
| `stk_outturn` / `stk_batch` | Text | |
| `stk_why` | Multiline 2000 | Shown to the counter; fixed text, never the earlier figure |
| `stk_status` | Choice: Open · Done | |
| owner | = the counter who counted it | Created → flow F3b |

### 16. `stk_variance` — Variance
Generated by the Hub from count lines vs XBS lines once a stack is submitted
(rules in `src/data/variance-rules.ts`), then decided by a person.

| Column | Type | Notes |
|---|---|---|
| `stk_name` PK | Text 30 | `V-0001` |
| `stk_lotkey` AK | Text 300 | `<stock take id>\|<site>\|<stack, empty at third parties>\|<batch>`; one variance per lot |
| `stk_stocktake` / `stk_site` / `stk_stack` | Lookups | |
| `stk_outturn` | Text 30 | |
| `stk_grade` | Text 100 | Grade · grower mark |
| `stk_expectedunits` / `stk_countedunits` | Whole number | |
| `stk_expectedkg` / `stk_countedkg` | Decimal (2) | |
| `stk_suggestedcause` | `stk_rootcause` | From the rules (advisory) |
| `stk_suggestionwhy` | Multiline 2000 | The evidence behind the suggestion, or why it was auto-accepted |
| `stk_cause` | `stk_rootcause` | Person's decision |
| `stk_state` | `stk_variancestate` | |
| `stk_decidedby` / `stk_decidedon` | Lookup / Date & time | |
| `stk_countline` | Lookup → stk_countline | |

A lot matches (no variance) when units are equal, kg are within
`MatchToleranceKg`, and one person counted it. An open variance that later
matches is set to Accepted automatically.

### 17. `stk_exception` — Exception register
Owner = the person who must fix it (must hold an STK role).

| Column | Type | Notes |
|---|---|---|
| `stk_name` PK | Text 200 | "EX-201 — title" |
| `stk_kind` | `stk_exceptionkind` | |
| `stk_source` | `stk_exceptionsource` | Import (flow F1), Pre-count check, Count (variance, incl. the Hub's automatic rules), IBKY engine (the Stock Assistant's checks); Reconciliation reserved |
| `stk_reference` | Text 60 | V-0415, IMP-…, contract no. |
| `stk_stocktake` / `stk_variance` / `stk_import` | Lookups (optional) | |
| `stk_department` | `stk_department` | |
| `stk_bags` | Whole number | |
| `stk_duedate` | Date | Raised + `ExceptionSlaWorkingDays` working days |
| `stk_status` | `stk_exceptionstatus` | |
| `stk_escalationlevel` | Choice: Owner · Head of department · Country Finance Manager | Set by flow F4 (3 / 7 days overdue) |
| `stk_priority` | Choice: High · Medium · Low | By size in 60 kg bags (added 23 Oct): High = `ExceptionHighBags` (10) or more, Low = `ExceptionLowBags` (2) or less, Medium between. Low lots are grouped into **one low-priority list per warehouse**. Due date by priority: High 2, Medium `ExceptionSlaWorkingDays` (5), Low 10 working days |
| `stk_rule` | Text 20 | Rule that raised it, e.g. "EX14" (added 25 Oct) |
| `stk_rulekey` | Text 200, **alternate key** | Unique per rule and subject, e.g. "MASSBAL\|&lt;stock take&gt;\|&lt;warehouse&gt;". A rule re-run upserts on it (`PATCH stk_exceptions(stk_rulekey='…')`), so it never duplicates. Empty for exceptions raised without a rule |
| `stk_resolution` / `stk_closedon` | Multiline / Date & time | Resolution required to close |

### 18. `stk_signoff` — Sign-off event
| Column | Type | Notes |
|---|---|---|
| `stk_name` PK | Text 60 | "Operations Lead · signed" |
| `stk_stocktake` | Lookup | |
| `stk_gate` | `stk_gate` | |
| `stk_action` | Choice: Signed · Sent back | |
| `stk_signedby` / `stk_signedon` | Lookup / Date & time | |
| `stk_comment` | Multiline 2000 | Required to send back |

Gates follow Finance's signed month-end page (August 2026, signed 22 Sep), by stock take type:

| Type | Chain (→ = next step; + = same step, either order) |
|---|---|
| Monthly | Senior Accountant (prepared) → Chief Accountant + Operations Lead (reviewed) → Trading Admin Manager + Warehouse Manager (approved) → Country Finance Manager (approved, always last) |
| Ad hoc | Operations Lead → Warehouse Manager |
| 100% | Operations Lead → Warehouse Manager → Country Finance Manager |

Rules (app and flow F5): every gate of a step signs before the next step; the first
signature moves the stock take to Sign-off; with separation of duties on, one person
signs one gate (the Hub refuses, F5 deletes a second signature) and a gate with a
named signer in `SignOffSigners` takes only that person or the stand-in; a send-back
returns to the first gate and clears the earlier signatures (the rows stay for
history). The chain's last gate → KPIs frozen, pack email and status Completed.

### 19. `stk_directpurchase` — Direct purchase
| Column | Type | Notes |
|---|---|---|
| `stk_name` PK, AK | Text 20 | Contract `DP-0219` |
| `stk_supplier` | Text 100 | |
| `stk_suppliertype` | Choice: Co-operative · Agent | |
| `stk_outturn` / `stk_warrant` / `stk_grade` | Text | |
| `stk_bagscontracted` / `stk_bagsinvoiced` / `stk_bagsdelivered` | Whole number | |
| `stk_invoicedate` | Date | |

Flags (invoiced-not-delivered, longs, delivered-not-in-XBS) are computed in the
app.

### 20. `stk_issue` — Problem report
**Notes enabled**: the photo is an annotation on the report, subject "Photo of
the problem".

| Column | Type | Notes |
|---|---|---|
| `stk_name` PK | Text 30 | `C-121` |
| `stk_category` | `stk_issuecategory` | |
| `stk_site` | Lookup | |
| `stk_screen` | Text 60 | Filled by the app |
| `stk_description` | Multiline 4000 | |
| `stk_status` | `stk_issuestatus` | Flows F7a (new), F7c (resolved) |
| `stk_assignedto` | Lookup → systemuser | Flow F7b |
| `stk_linkedcause` | `stk_rootcause` | Feeds variance analysis |
| `stk_resolution` | Multiline 2000 | Reply shown to the counter |
| `stk_photo` | File | Not used; photos are notes (see above) |

### 21. `stk_counterprofile` — Counter profile (added 18 Oct 2026)
One per person who counts. Used by the random counter allocation.

| Column | Type | Notes |
|---|---|---|
| `stk_name` PK | Text 100 | Person's name |
| `stk_user` AK | Lookup → systemuser | One profile per person |
| `stk_homesite` | Lookup → stk_site | Where they normally work |
| `stk_homerows` | Text 40 | "D,E" - never allocated to them (no counting your own stock) |
| `stk_thirdpartyok` | Yes/No | May be sent to third-party sites |
| `stk_active` | Yes/No | Takes part in allocation |
| `stk_notes` | Multiline 2000 | |

### 22. `stk_allocationrun` — Allocation run (added 18 Oct 2026)
Audit record of one random allocation of counters to areas.

| Column | Type | Notes |
|---|---|---|
| `stk_name` PK | Text 30 | `AR-001` |
| `stk_stocktake` | Lookup | |
| `stk_status` | Choice: Draft · Published · Superseded | |
| `stk_seed` | Whole number | Random seed - the plan can be reproduced |
| `stk_present` | Multiline 4000 | JSON: counters present |
| `stk_plan` | Multiline 100k | JSON: counter → areas, bags |
| `stk_swaps` | Multiline 4000 | JSON: supervisor swaps / rebalances, who and when |
| `stk_rules` | Multiline 1000 | JSON: rules applied (from setting `AllocationRules`) |
| `stk_spreadpct` | Decimal (2) | Workload spread between busiest and lightest counter |
| `stk_ranby` / `stk_publishedby` / `stk_publishedon` | Lookups / Date & time | |

`stk_assignment` gained `stk_sections` (Text 400, e.g. `D1-7,D8-14,C/D`; empty = use `stk_rows`),
`stk_plannedbags` (Whole number) and `stk_allocationrun` (Lookup).

### 23. `stk_reconitem` — Reconciling item (added 19 Oct 2026)
Finance's bridge from the Comtras (BRIC) total to the Ibero stock position, per stock
take: coffee afloat and the reconciling items. The Reconciliation page works out
Total Ibero, the difference and what is still unexplained (Finance's "franchise").

| Column | Type | Notes |
|---|---|---|
| `stk_name` PK | Text 200 | "Kenyan longs", "KCCE/MAXA/MC/NKPCU Sale 37" |
| `stk_stocktake` | Lookup (required) | |
| `stk_kind` | Choice: Coffee afloat · Reconciling item | |
| `stk_bags` | Decimal (2) | 60 kg bags; positive = BRIC has it, the warehouses don't |
| `stk_inxbs` | Yes/No | Also counts in the XBS column (afloat, Kenyan longs) |
| `stk_note` | Multiline 2000 | |

August 2026 replay: Finance's 8 items reproduce the signed page (unexplained (592)).

### 24. `stk_kpisnapshot` — KPI snapshot (added 26 Oct 2026)
Governance KPIs: whether each stock take met its targets. **One row per stock take per
KPI.** The Hub works them out from its own records (`src/data/kpi.ts`) and saves them each
time it opens while the stock take is open; when Finance signs, the rows get
`stk_frozenon` and are never recalculated, so a month's result can't change afterwards.
Shown on the Hub's **Governance** page (scorecard and trend by month).

| Column | Type | Notes |
|---|---|---|
| `stk_name` PK | Text 200 | "<stock take> · <KPI>" |
| `stk_stocktake` | Lookup (required) | |
| `stk_code` | Text 40 | Stable KPI code, see below; use this in reports, not the name |
| `stk_kpiname` | Text 100 | Display name |
| `stk_kpisource` | Text 60 | Where the target comes from, e.g. `SOP-UG-LOG #104` |
| `stk_owner` | Text 60 | Accountable department |
| `stk_value` | Decimal (4) | The number to chart (%, days, bags or count; see below). Empty = not measurable |
| `stk_display` | Text 60 | As shown in the Hub, e.g. "-9.17%" |
| `stk_target` | Text 60 | As shown, e.g. "within ±0.1%" |
| `stk_status` | Choice: On target · Off target · Running · For information · Not measurable | Running = still open and not late yet |
| `stk_detail` | Multiline 1000 | One-line explanation with the underlying figures |
| `stk_measuredon` | Date & time | Last calculated |
| `stk_frozenon` | Date & time | Set at Finance sign-off; empty = still live |
| `stk_kpikey` | Text 200, **alternate key** | "<stock take id>\|<code>": one row per stock take per KPI |

| Code | KPI | `stk_value` unit | Target (setting) | Source |
|---|---|---|---|---|
| `STOCK_VARIANCE` | Stock variance, whole stock take (physical − XBS) ÷ XBS | % | ±0.1% (`TargetNetVariancePct`) | SOP-UG-LOG #104 |
| `COVERAGE` | XBS lots in counted scope (submitted stacks, closed third-party sites) | % | 100% (`KpiCoveragePct`) | Stock take SOP s.10 |
| `FIRST_COUNT_MATCH` | Counted XBS lots with no variance | % | for information | Stock take SOP s.10 |
| `BLIND_COUNT` | Count lines captured in the counter app (no XBS figures shown) | % | 100% | Stock take SOP s.10 |
| `COUNT_DURATION` | Count date to counting closed | days | 1 day | Business case |
| `INVESTIGATED_IN_TIME` | Variances decided within N working days of being raised | % | 100%, N = 2 (`KpiInvestigateWorkingDays`) | SOP-UG-ACC&FIN #29 |
| `AGED_ITEMS` | Open exceptions raised more than N days ago | count | 0, N = 30 (`KpiAgedDays`) | SOP-UG-ACC&FIN #22 |
| `EXCEPTION_CLOSURE` | Exceptions closed | % | 90% (`KpiExceptionClosurePct`) | Stock take SOP s.10 |
| `UNEXPLAINED` | BRIC vs Ibero position after reconciling items (Level 2) | bags (signed) | 0 at sign-off | Business case |
| `SIGNOFF_DAYS` | Working days from the count date to Finance's signature | working days | 7 (`SignOffWorkingDays`) | Business case |
| `RECON_BY_DAY` | Finance signed by the Nth of the next month | days after the deadline (negative = early) | the 8th (`KpiReconByDayOfMonth`) | SOP-UG-ACC&FIN #29 |
| `AUTO_DECIDED` | Variances decided by the Level 1 rules | % | for information | Hub |

Only this stock take's exceptions count (`stk_exception.stk_stocktake`; older rows without
one count when raised on or after the count date). August 2026 in dev: the date-based KPIs
(duration, days to sign-off, by the 8th) reflect when the month was replayed in dev, not
NKG's process; they are meaningful from the October count on.

### 25. `stk_enginerun` — Engine run (added 26 Oct 2026)
One row per run of the server engine **stk-level1** (the Hub's Level 1 code run on the IBKY worker),
and its **run lock**. Who runs Level 1 is the setting `Level1Runs`: **Hub** (default: the Hub runs it
when it opens) or **Engine** (the engine writes; the Hub only reads, unless no engine run has finished
in the last 15 minutes, then the Hub runs it so counting never waits). With any value other than
Engine the engine only dry-runs.

| Column | Type | Notes |
|---|---|---|
| `stk_name` PK | Text 200 | "Level 1 · 2026-10-26 13:11 UTC" |
| `stk_stocktake` | Lookup | the stock take the run worked on |
| `stk_mode` | Choice: Engine · Dry run | Dry run = read everything, wrote nothing |
| `stk_startedon` / `stk_finishedon` | Date & time | |
| `stk_outcome` | Choice: Running · Done · Failed · Skipped | Skipped = another run held the lock |
| `stk_result` | Multiline 4000 | Summary line; for a dry run, the list of writes it would have made |
| `stk_writes` | Whole number | Records written (dry run: would have written) |
| `stk_lock` | Text 100, **alternate key** | The stock take id while a writing run works on it, emptied at the end. A second run can't take it (duplicate key) and is Skipped; a lock older than 15 minutes is released |

Level 1 exceptions (from the Hub or the engine) are owned by the **head of the department** from the
setting `HeadsOfDepartment`, so flow F4 reminds and escalates the right person.

### 26. `stk_contractinvoice` — Contract invoice line (Comtras 537, locked; added 26 Oct 2026)
The Comtras **537** contract invoicing journal (D537CCPDF): one row per booked invoice or credit-note line
against a purchase contract and/or a sales contract. **Kenya only** (company `CC`; `GG` = Tanzania and
`DD` = Uganda are refused at upload). Loaded once per stock take on the XBS import page and never changed:
no role can write or delete these rows. `stk_salescontract` is the number XBS shows as "sales contract
blocked to" (`stk_xbsline.stk_salescontract`), which links an invoice to a lot in the warehouse.

| Column | Type | Notes |
|---|---|---|
| `stk_name` PK | Text 100 | "<voucher> · <counterparty>" |
| `stk_stocktake` | Lookup (required) | |
| `stk_rownumber` | Whole number | Row in the file; **alternate key with the stock take** |
| `stk_source` | Text 200 | File name |
| `stk_side` | Choice: Customer · Supplier | FIBU2 D / K |
| `stk_account` / `stk_counterparty` / `stk_profile` | Text | FIBU3, Kurz-Name, Profil |
| `stk_bookedon` / `stk_voucherdate` | Date | BookDat / VouchDat |
| `stk_voucher` | Text 20 | VouchNo |
| `stk_doctype` | Whole number | Symbol: 11 purchase invoice, 21 sales invoice, 65 purchase credit note, 71 sales credit note; 15 / 25 / 61 / 75 corrections |
| `stk_purchasecontract` (+ date) | Text 20 / Date | P.Ctr. (90xxx) |
| `stk_salescontract` (+ date) | Text 20 / Date | S.Ctr. (3787xxx) |
| `stk_buybags` / `stk_buykg` / `stk_buy60` / `stk_buyvalue` | Decimal | EK: purchase; credit notes negative |
| `stk_sellbags` / `stk_sellkg` / `stk_sell60` / `stk_sellvalue` | Decimal | VK: sale |

Loaded in dev on 26 Oct from Finance's August file (D537CCPDF.xlsx), checked against it: 939 lines booked 2 Jul to 30 Sep, 87 purchase and 228 sales contracts, 48 counterparties;
net 75,057.9 bags bought and 120,807.0 sold (by 31 Aug: 40,876.4 and 69,596.5). 5 of the 14 sales contracts
XBS lots are blocked to appear in it.

### 27. `stk_shipment` — Shipment (Trade / Logistics tracker, locked; added 27 Oct 2026)
Trade and Logistics' shipment tracker (`Kenya_Operational_PL.xlsx`, sheet KENYA): one row per sales contract and
shipping instruction. Loaded once per stock take on the XBS import page and never changed. `stk_salescontract`
joins the 537 (S.Ctr.) and XBS ("sales contract blocked to"). ETA at the port of discharge is filled on few rows,
so arrival can't come from this file.

| Column | Type | Notes |
|---|---|---|
| `stk_name` PK | Text 100 | "<sales contract> · SI <no>" |
| `stk_stocktake` | Lookup (required) | |
| `stk_rownumber` | Whole number | Row in the file; **alternate key with the stock take** |
| `stk_source` | Text 200 | File name |
| `stk_salescontract` / `stk_purchasecontract` / `stk_si` | Text | Sale Contract Ref, Purchase Contract Ref (filled on ~40% of rows), SI No. |
| `stk_buyer` / `stk_destination` | Text | Buyer, Destination Country |
| `stk_bags` | Decimal | Bags |
| `stk_qualitycode` / `stk_quality` / `stk_packaging` | Text | Quality Code, Quality Basket / Grade, Packaging Type |
| `stk_contractdate` / `stk_stuffedon` / `stk_sailedon` / `stk_etapod` | Date | Contract Date, Actual Stuffing Date, Actual Sailing Date, ETA POD |
| `stk_bl` / `stk_vessel` | Text | B/L No, Vessel |
| `stk_status` | Text 20 | Open · Closed · Cancelled, as Trade keys it |
| `stk_usdvalue` | Decimal | USD Value of Shipment |

Read-checked on the 26 Oct tracker: 1,253 shipments; for 31 Aug, 95,581 bags stuffed June-August of which 13,126 not
sailed on the count date. Typed dates in the tracker are mixed ("11/18/2026", "27/02/2025", "09-28-2026", serials as
text): read day first unless the first part is over 12; text such as "APS" is left empty.

Loaded in dev on 27 Oct into the August stock take: 1,253 rows from `Kenya_Operational_PL .xlsx` (tracker of 26 Oct).
A load that stops part way can be finished with the same file: saved rows are skipped (the key prevents doubles).

### 28. `stk_directlot` — Direct purchase lot (Trading, locked; added 27 Oct 2026)
Trading's direct purchase list (Daniel): one row per outturn and grade bought on a direct contract (905xx), from the
running list (season 2026-27, one sheet) or the older workbook with one sheet per contract (season 2025-26). Loaded
once per stock take on the XBS import page and never changed. Explains coffee counted but not yet in XBS and gives each
outturn's baskets. A sheet for two contracts with no contract per row ("90579&80") is stored as "90579/90580"; a
quality code typed in the contract column is resolved from the Overview sheet by grower and quality.

| Column | Type | Notes |
|---|---|---|
| `stk_name` PK | Text 100 | "<contract> · <outturn> <grade>" |
| `stk_stocktake` | Lookup (required) | |
| `stk_rownumber` | Whole number | Order in the upload; **alternate key with the stock take** |
| `stk_source` / `stk_sheet` | Text | File and sheet |
| `stk_contract` / `stk_contractdate` | Text 20 / Date | Direct contract and its date (Overview) |
| `stk_grower` / `stk_outturn` / `stk_grade` / `stk_cert` | Text | |
| `stk_bags` / `stk_pocketkg` / `stk_kg` | Decimal | Bags, pocket (kg), kg bought |
| `stk_primary` / `stk_secondary` | Text | Primary and secondary basket |
| `stk_warrant` / `stk_warrantkg` / `stk_receivedkg` | Text / Decimal | Warrant, warrant weight, weight received |
| `stk_warehouse` / `stk_receivedon` | Text / Date | Where it is stored and when it arrived (asked of Trading for the running list) |

Read-checked: season 2025-26 file 150 lots (19 contracts, 44 outturns); running list 74 lots (8 contracts, 20 outturns).
Loaded in dev on 27 Oct into the August stock take: the 2025-26 file, 150 lots. The upload warns when no lot was
received or contracted by the count date (a later season's list).

### 29. `stk_xbsstuffing` — XBS stuffing (shipped report, locked; added 29 Oct 2026)
XBS's "All Party Shipped Quantity Per Contract" report (CSV or Excel), one lot line per bag lot stuffed, summed on
upload per sales contract + shipping instruction + stuffing date: the warehouse's own record of when coffee left.
Afloat uses its date instead of the tracker's where XBS has the shipment. A stock take takes one report per month of
the look-back; rows already saved are skipped, so each report loads once. Never changed.

| Column | Type | Notes |
|---|---|---|
| `stk_name` PK | Text 100 | "<contract> · SI <si> · <date>" |
| `stk_stocktake` | Lookup (required) | |
| `stk_key` | Text 60 | "contract\|SI\|date"; **alternate key with the stock take** (the name column is too long for a key) |
| `stk_source` | Text 200 | File |
| `stk_salescontract` / `stk_si` | Text 20 | SO No. and the SI number ("- 5622 ( 5689 )" -> 5622) |
| `stk_stuffedon` | Date | Stuffing date |
| `stk_bags` / `stk_lots` | Decimal / Whole number | 60 kg bags (kg / 60) and lot lines summed |

Read-checked on Caroline's September report (5 Oct): 17,237 lot lines -> 34 shipments, 19,307.68 bags, 4-30 Sep.

## Relationships (summary)

```
stk_xbsimport 1─* stk_xbsline *─1 stk_site
stk_xbsimport 1─* stk_stocktake *─* stk_site                 (N:N stk_stocktake_site, unused yet)
stk_stocktake 1─* stk_assignment *─1 systemuser (counter)
stk_stocktake 1─* stk_countsheet 1─* stk_stack 1─* stk_countline *─0..1 stk_xbsline
stk_countline *─1 stk_packtype
stk_countline *─0..1 stk_recount
stk_stocktake 1─* stk_variance 1─* stk_recount
stk_variance  1─* stk_exception *─0..1 stk_xbsimport
stk_stocktake 1─* stk_signoff
stk_mappingchange 1─* stk_basketmap / stk_outturnmap          (last change)
stk_countline, stk_issue 1─* annotation (photos)
stk_stocktake 1─* stk_comtrasposition
stk_stocktake 1─* stk_reconitem
stk_stocktake 1─* stk_kpisnapshot
stk_stocktake 1─* stk_enginerun
stk_stocktake 1─* stk_contractinvoice
stk_stocktake 1─* stk_allocationrun 1─* stk_assignment
stk_counterprofile *─1 systemuser
```

Delete behaviour: **Restrict** everywhere (nothing cascades). Records are
closed/superseded, not deleted.

## Security roles

| Role | Key rights |
|---|---|
| **STK Counter** | Read reference + XBS lines (Org) and assignments. Create/Write stacks; own count sheets, count lines, problem reports and their photo notes (User); read all count lines (duplicate warnings). Read/Write own recounts. No variances. |
| **STK Operations Admin** | Stock takes, assignments, counter profiles and allocation runs, sheet decisions, variances, exceptions, reconciling items (Org). Request mapping changes. Sign Operations gate. |
| **STK Warehouse Manager** | Sheet decisions, variances (Org). Sign Warehouse gate. |
| **STK Trading** | Direct purchases, exceptions, mapping requests. Sign Trading gate. |
| **STK Finance** | Decide mapping changes, variances. Reconciling items (create/edit/delete). Sign Finance gate. |
| **STK IT Admin** | Sites, pack types, settings, users. |
| **STK Importer** | **Create only** on `stk_xbsline`, `stk_comtrasposition`, `stk_contractinvoice`, `stk_shipment`, `stk_directlot`, `stk_xbsstuffing`; Create + Write on `stk_xbsimport`. Given with Ops Admin and IT Admin. |
| **STK Level 1 Engine** | For the server engine stk-level1 (application user), active only when `Level1Runs` = Engine: create/update variances, recounts (assign), exceptions (assign), the stock take's count close and summary, its PDF note and `stk_enginerun`; reads all `stk_` tables and users. Never deletes. Added 26 Oct. |
| **STK Engine** | For the Stock Assistant's engine (application user "IBKY Refresh (Azure Automation)", not a person): read every `stk_` table; create, update and assign `stk_exception` (its own rule exceptions, upsert on `stk_rulekey`, owned by the department head); full rights on the `ibky_` tables where that solution is installed. Added 26 Oct. |

No role has Write or Delete on `stk_xbsline`, `stk_comtrasposition`, `stk_contractinvoice`, `stk_shipment`, `stk_directlot` or `stk_xbsstuffing`.
Full privilege matrix: [security-roles.md](security-roles.md).
**Caveat:** System Administrators bypass roles. The lock is also enforced in the
apps; proving the role lock itself needs a non-admin test user (Stage 5).

## Flows that write to these tables

| Flow | Trigger | Writes |
|---|---|---|
| F1 | `stk_xbsimport` → Imported | `stk_exception` (one per warning check) |
| F4 | Weekdays 07:00 EAT | `stk_exception.stk_status`, `stk_escalationlevel` |
| F5 | `stk_signoff` created | Announces who signs next; after the chain's last gate `stk_stocktake.stk_status` → Completed and the pack is emailed; deletes a second gate signed by the same person (separation of duties on) |
| F6 | `stk_mappingchange` created | `stk_mappingchange.stk_state`, `stk_basketmap` / `stk_outturnmap` |
| Hub (Level 1 rules) | Each Hub load after counts change, while `Level1Runs` = Hub (or the engine has been silent 15 min) | `stk_variance` (decided by rule), `stk_recount`, `stk_exception` (with priority, owned by the department head), `stk_stocktake` (count closed + Level 1 summary) and its PDF note; `stk_kpisnapshot` on every load |
| stk-level1 (server engine, Level 1) | Runbook STK-Level1 on the IBKY worker: stack submitted / recount done / site closed, and every 5 min during a count | The same Level 1 rows as the Hub, only when `Level1Runs` = Engine; otherwise a dry run. Always `stk_enginerun` |
| IBKY engine (Stock Assistant) | Its scheduled refresh | `stk_exception` (source IBKY engine, `EN-###`, upsert on `stk_rulekey`; 10 rules, dry run until switched on); its own `ibky_` tables |

F2, F3a, F3b, F7a–c, F8, F9 (allocation published → each counter's area in Teams) and
F10 (counting closed → Level 1 summary email with the PDF attached, plus a Teams note)
only read and notify (Teams / email). Flow
definitions: `scripts/dataverse/flows.mjs`.

## For reporting (Power BI, Fabric)

Rules that make a report match the Hub and Finance's signed figures:

1. **Physical stock:** count lines where a blind recount (`stk_recount` set) replaces the
   earlier lines of its lot. A lot is batch + stack at Ibero, batch + **whole site** at a
   third-party warehouse. Applying the recount per stack at third parties overstates
   August by 962 bags (AGL 4,898 instead of 4,196.5; New KPCU 1,434 instead of 1,172.6).
   Skip `stk_isother` lines. August: physical **24,809.5** against XBS **27,313.3** bags.
2. **60 kg bags = kg ÷ 60** on count lines and XBS lines. XBS stock = Warehouse +
   Blocked for Processing.
3. **Variances:** read `stk_variance` rather than recomputing. `stk_state` is the decision
   (Open, Recount sent, Accepted, Exception raised); an automatic decision's
   `stk_suggestionwhy` starts "Decided automatically (rule)".
4. **Exceptions:** use `stk_priority`; Low ones are one list per warehouse, so count lists,
   not lots, when reporting how many exceptions are open.
5. **Baskets:** `stk_basketmap` now holds XBS's own mapping (72 rows, approved as MC-001):
   primary FAQ, FAQ + (shown as Plus) and LOW GRADES (shown as Grinder), plus the primary
   codes **10057 (FAQ)** and **10027 (FAQ +)** that Comtras uses. BRIC = Arabica Kenya,
   Inventory + Longs (August 64,691.8).
6. **Counting closed:** `stk_countclosedon` set = Level 1 complete; `stk_l1summary` holds
   the summary.
7. **Governance KPIs:** read `stk_kpisnapshot` rather than recomputing; filter on
   `stk_code` and chart `stk_value` by the stock take's count date. Rows with
   `stk_frozenon` are final; rows without it are the open stock take, still changing.
8. **Contract journal (537):** `stk_contractinvoice` is Kenya only. Sales (`stk_sell60`) and purchases
   (`stk_buy60`) are net of credit notes (negative lines); filter `stk_bookedon` on or before the count
   date for what was invoiced by the cut-off. Join to XBS on `stk_salescontract` = `stk_xbsline.stk_salescontract`.
9. **Shipments and afloat:** `stk_shipment` joins the 537 and XBS on the sales contract. The Hub's afloat
   (Reconciliation › Afloat from shipments) takes shipments with `stk_stuffedon` in the look-back (1-3 months up to
   the count date) and groups them by the first sales invoice (537 document type 21, `stk_voucherdate`) and
   `stk_sailedon`. Finance's rule (worked back 28 Oct): bags stuffed in the count's month and the two before, less
   the bags sales-invoiced (537 type 21, `stk_sell60`) on the contract by the count date, cancelled shipments out;
   groups not sailed · sailed, not invoiced · not in the 537 (no sales invoice at all and stuffed > 50 days before
   the count; not counted) · invoiced by the count. Stuffing dates from `stk_xbsstuffing` where XBS has the
   shipment, else the tracker's; a tracker date in a month XBS covers but doesn't list is set aside and flagged.
   Matches Finance for July (41,584), August (36,076) and September (19,060). Ageing buckets by days since
   stuffing use the setting `AfloatAgeingDays` (default 30,60). The figure the Hub uses is the Coffee afloat item
   on the bridge (`stk_reconitem`), with the rule in its note.
10. **Direct purchase lots:** `stk_directlot` is one row per outturn and grade. Lots received or contracted by the
   count date (`stk_receivedon`, else `stk_contractdate`) whose outturn has no `stk_xbsline` are provisional stock:
   counted, not yet in XBS. `stk_primary` / `stk_secondary` give the outturn's baskets.
11. **Stock Assistant tables (`ibky_`):** in dev, Jones's engine publishes its snapshot
   tables from these `stk_` tables from the October count on; August and September in the
   `ibky_` tables are its own history.

## Settings (stk_setting)

| Key | Value in dev | What it does |
|---|---|---|
| `MatchToleranceKg` | 1 | A count within this many kg of XBS is not a variance |
| `ExceptionSlaWorkingDays` | 5 | Due date for Medium exceptions |
| `ThirdPartyAgeDays` | 21 | Pre-count check: third-party stock held longer |
| `TargetNetVariancePct` | 0.10 | Net variance target on the Overview and the stock variance KPI |
| `SignOffWorkingDays` | 7 | Sign-off deadline after the count; also the days-to-sign-off KPI |
| `EnforceSeparationOfDuties` | false (dev) | One person signs one sign-off gate; named signers only; mapping requester can't approve |
| `Level1Runs` | Hub | Who runs Level 1: Hub, or Engine (server engine stk-level1, see table 25) |
| `CounterAppOpenAfterClose` | true (dev only) | Counter app still opens after counting has closed, for demonstrations. **false** in NKG and production |
| Not stored yet (defaults in code) | | `AutoDecide` (on), `AutoWeightLossKg` (20), `AutoUnitOnlyKg` (5), `AutoNetUnits` (1), `AutoAcceptPocket` (on), `ExceptionHighBags` (10), `ExceptionLowBags` (2), `ExceptionHighDays` (2), `ExceptionLowDays` (10), `AutoCloseCount` (on); governance KPI targets `KpiCoveragePct` (100), `KpiInvestigateWorkingDays` (2), `KpiAgedDays` (30), `KpiExceptionClosurePct` (90), `KpiReconByDayOfMonth` (8) |

Also stored: allocation rules, distribution lists (count report, sign-off pack), heads of
department, mapping approvers, average value per tonne.

## Open points

1. **Stock take ↔ warehouse (N:N):** not written yet; every stock take covers
   all warehouses.
2. **Coffee afloat** is now worked out from `stk_shipment` + the 537 (reporting rule 9); which groups count and
   how far back to look is for Finance (Njambi) to confirm. Bulk and 1 MT bag rows: confirm the tracker's bags are
   60 kg equivalents. Until then Finance's own figure can stay on the bridge instead.
3. **Low Grade:** XBS's third primary basket is LOW GRADES; the apps still call it
   Grinder. Renaming waits on decision D4 and Nicole's reports.
4. **100% counts** (Ibero only, May/June and December; dispatcher counts out at A, receiver counts in at B,
   Finance relies on the receiver) are planned as Stage 6 in PLAN.md: move records, dispatcher/receiver pairs,
   blind receiving. Also the new stock take type **Ad hoc** (any date, differences only). Not modelled yet.
5. **Retention:** keep old imports forever, or purge after N months?
6. **Replaced lines:** a "replaced by a recount" flag on count lines would make rule 1
   above a simple filter. Planned.
7. **Governance KPI targets:** the defaults are the SOP KPI register (Uganda, SOP-UG-*)
   and the business case; Finance to confirm they apply to Kenya, and to define a
   like-for-like stock variance (the KPI uses the whole stock take). Frozen KPI rows are
   protected by the Hub only; a role can't stop an edit to one row and allow another.
8. **Warehouse layout:** no location master yet; Ibero's rows A–G and 14 bays are in code
   and the locations come from the XBS zone codes.
