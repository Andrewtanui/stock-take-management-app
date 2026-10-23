# Dataverse schema — IBKY Stock Take

Status: **live in the development environment** (built 9 Oct 2026, last changed
19 Oct 2026) and copied to **NKG_Demo** (14 Oct; this week's additions applied there
except `stk_stack` site flags, the Comtras columns and `stk_reconitem`, which follow
with the next NKG update). This document describes what exists in Dataverse today.
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
| Notes (photos) | Enabled on `stk_countline` and `stk_issue` |
| Security roles | 7 `STK …` roles, see [security-roles.md](security-roles.md). Every user also needs the built-in **Basic User** role |
| NKG copy | NKG_Demo · `61203bbf-8829-e6fd-bbdd-bb98d7fa1d56` · https://orged86d520.crm4.dynamics.com/ |

## How to look at it

- **Tables and data:** make.powerapps.com → this environment → Tables → filter
  on "stk" (or Solutions → IBKY Stock Take → Tables).
- **Power BI:** Get data → Dataverse → `org6c75cfc0.crm4.dynamics.com` → tables
  starting `stk_`. Choice columns come through as numbers; the labels are in
  the "Shared choices" table below, or use the `…name` virtual column.
- **Web API / scripts:** `scripts/dataverse/api.mjs` (signs in with the Power
  Platform CLI's account).

## Ground rules

1. **XBS is never changed.** XBS and Comtras data arrives as an *import* and is
   stored as a frozen snapshot (`stk_xbsimport`, `stk_xbsline`,
   `stk_comtrasposition`). No role can update or delete those rows. Anything
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
   behaviour is Restrict everywhere. One exception: flow F5 deletes a Finance
   sign-off made by the pack's preparer when separation of duties is on.

## Tables at a glance

Rows = what is in the dev environment on 19 Oct 2026: the **August 2026 month-end
replayed end to end** (Finance's XBS exports, P526 and 631-line count; see PLAN.md).

| # | Table | Ownership | Written by | Read by | Rows |
|---|---|---|---|---|---|
| | **Reference & settings** | | | | |
| 1 | `stk_site` Warehouse | Org | IT Admin | everyone | 6 |
| 2 | `stk_packtype` Packing type | Org | IT Admin | everyone | 2 |
| 3 | `stk_setting` Setting | Org | IT Admin | everyone | 14 |
| | **Source data (locked)** | | | | |
| 4 | `stk_xbsimport` XBS import | Org | Importer (create; status by import only) | everyone | 1 |
| 5 | `stk_xbsline` XBS line | Org | Importer (**create only**) | everyone | 786 |
| 6 | `stk_comtrasposition` Comtras position (P526) | Org | Importer (**create only**) | mgmt roles | 222 |
| | **Mapping** | | | | |
| 7 | `stk_basketmap` Basket mapping | Org | via approved change only | everyone | 38 |
| 8 | `stk_outturnmap` Outturn mapping | Org | via approved change only | everyone | 0 |
| 9 | `stk_mappingchange` Mapping change | User | Trading, Finance, Ops (request); Finance (decide) | mgmt roles | 0 |
| | **Stock take** | | | | |
| 10 | `stk_stocktake` Stock take | Org | Ops Admin | everyone | 1 |
| 11 | `stk_assignment` Assignment | Org | Ops Admin (published by the counter allocation) | everyone (counters: own) | 7 |
| 12 | `stk_countsheet` Count sheet | User (= counter) | Counter (create/submit); Ops/WH Mgr (decide) | counter: own; mgmt: all | 7 |
| 13 | `stk_stack` Stack | Org | Counter (create/submit/close a site); Ops/WH Mgr | everyone | 163 |
| 14 | `stk_countline` Count line | User (= counter) | Counter (own lines) | counters: all (for "already counted" warnings, never XBS figures); mgmt: all | 789 |
| 15 | `stk_recount` Recount | User (= assignee) | Ops/WH Mgr (create); counter (complete) | assignee; mgmt | 130 |
| | **Reconcile & sign-off** | | | | |
| 16 | `stk_variance` Variance | Org | Hub (generate); Ops/WH Mgr/Finance (decide) | mgmt roles | 686 |
| 17 | `stk_exception` Exception | User (= owner) | mgmt roles, flows | mgmt roles | 15 |
| 18 | `stk_signoff` Sign-off | Org | the gate's role | everyone | 0 |
| 23 | `stk_reconitem` Reconciling item | Org | Finance, Ops Admin | mgmt roles | 8 |
| | **Counter allocation** | | | | |
| 21 | `stk_counterprofile` Counter profile | Org | Ops Admin, IT Admin | mgmt roles | 2 |
| 22 | `stk_allocationrun` Allocation run | Org | Ops Admin | mgmt roles | 1 |
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
| `stk_exceptionsource` | Count · Import · Pre-count check · Reconciliation |
| `stk_exceptionstatus` | Open · In progress · Escalated · Closed |
| `stk_department` | Operations · Warehouse · Trading · Finance · Logistics · Quality · IT |
| `stk_gate` | Operations · Warehouse · Trading · Finance |
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
| `EnforceSeparationOfDuties` | false | true for go-live (requester ≠ approver, preparer ≠ Finance signer) |
| `MappingApprovers` | email(s) | Flow F6 |
| `SignOffDistribution` | email(s) | Flow F5 pack email |
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
| `stk_preparedby` | Lookup → systemuser | Prepares the reconciliation pack; can't sign Finance |
| `stk_closedon` / `stk_closecomment` | Date & time / Multiline | |

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
| `stk_source` | `stk_exceptionsource` | Import (flow F1), Pre-count check, Count (variance); Reconciliation reserved |
| `stk_reference` | Text 60 | V-0415, IMP-…, contract no. |
| `stk_stocktake` / `stk_variance` / `stk_import` | Lookups (optional) | |
| `stk_department` | `stk_department` | |
| `stk_bags` | Whole number | |
| `stk_duedate` | Date | Raised + `ExceptionSlaWorkingDays` working days |
| `stk_status` | `stk_exceptionstatus` | |
| `stk_escalationlevel` | Choice: Owner · Head of department · Country Finance Manager | Set by flow F4 (3 / 7 days overdue) |
| `stk_resolution` / `stk_closedon` | Multiline / Date & time | Resolution required to close |

### 18. `stk_signoff` — Sign-off event
| Column | Type | Notes |
|---|---|---|
| `stk_name` PK | Text 60 | "Operations · signed" |
| `stk_stocktake` | Lookup | |
| `stk_gate` | `stk_gate` | |
| `stk_action` | Choice: Signed · Sent back | |
| `stk_signedby` / `stk_signedon` | Lookup / Date & time | |
| `stk_comment` | Multiline 2000 | Required to send back |

Rules (app and flow F5): gates sign in order; the first signature moves the
stock take to Sign-off; Finance signer ≠ `stk_stocktake.stk_preparedby` (when
separation of duties is on); a send-back clears the earlier signatures (the rows
stay for history). Finance signing → pack email and status Completed.

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
| **STK Importer** | **Create only** on `stk_xbsline`, `stk_comtrasposition`; Create + Write on `stk_xbsimport`. Given with Ops Admin and IT Admin. |

No role has Write or Delete on `stk_xbsline` or `stk_comtrasposition`.
Full privilege matrix: [security-roles.md](security-roles.md).
**Caveat:** System Administrators bypass roles. The lock is also enforced in the
apps; proving the role lock itself needs a non-admin test user (Stage 5).

## Flows that write to these tables

| Flow | Trigger | Writes |
|---|---|---|
| F1 | `stk_xbsimport` → Imported | `stk_exception` (one per warning check) |
| F4 | Weekdays 07:00 EAT | `stk_exception.stk_status`, `stk_escalationlevel` |
| F5 | `stk_signoff` created | `stk_stocktake.stk_status` → Completed; deletes a Finance sign-off made by the preparer (separation of duties on) |
| F6 | `stk_mappingchange` created | `stk_mappingchange.stk_state`, `stk_basketmap` / `stk_outturnmap` |

F2, F3a, F3b, F7a–c, F8 and F9 (allocation published → each counter's area in Teams)
only read and notify (Teams / email). Flow
definitions: `scripts/dataverse/flows.mjs`.

## Open points

1. **Stock take ↔ warehouse (N:N):** not written yet; every stock take covers
   all warehouses.
2. **Comtras quality codes 10057 and 10027** (most of BRIC's Kenya stock) aren't
   secondary baskets in the mapping: compared in total only until Trading maps them.
3. **Coffee afloat** is entered by hand in `stk_reconitem` until the shipment
   tracker is a data source (or it's derived from P526 Shorts + XBS shipped report).
4. **Basket mapping:** Minus / Natural fix waiting for Trade & QC's document.
5. **100% zero-out counts** (issuing → receiving team) are not modelled; they
   would add a receiving-side count line.
6. **Retention:** keep old imports forever, or purge after N months?
