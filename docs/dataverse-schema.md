# Dataverse schema — IBKY Stock Take

Status: **draft for review (Step 1)**. Nothing here exists in Dataverse yet.

Shared by both code apps: the **Stock Take** app (counters) and the **Stock
Management** app (Operations, Warehouse, Trading, Finance, IT). The apps never
call each other — they read and write these tables, and Power Automate reacts to
changes in them.

| | |
|---|---|
| Environment | Andrew Tanui's Environment · `fbbef02c-fb2e-e56f-926c-4fe610004640` · https://org6c75cfc0.crm4.dynamics.com/ |
| Solution | `IBKYStockTake` — "IBKY Stock Take" |
| Publisher | `IberoKenya` — "Ibero Kenya" · prefix **`stk`** · choice value prefix **61450** (values 614500000+) |
| Auditing | Dataverse auditing on for every table below (replaces a custom audit log) |

## Ground rules

1. **XBS is never changed.** XBS and Comtras data arrives as an *import* and is
   stored as a frozen snapshot (`stk_xbsimport`, `stk_xbsline`,
   `stk_comtrasposition`). No role can update or delete those rows. Anything
   wrong in XBS becomes an **exception** that a person fixes in XBS by hand; the
   next import shows whether it was fixed.
2. **Counts are facts from the floor.** A count line records what the counter
   saw. Supervisors decide what a difference means (variance → cause), they
   don't overwrite the count.
3. **Every decision has a who and when.** Decisions are their own columns
   (decided by / on) or rows (`stk_signoff`), plus Dataverse audit history.
4. **Offline-safe writes.** Rows created on a phone carry a device-generated
   `stk_clientid` (alternate key), so a re-sent save updates instead of
   duplicating.

## Tables at a glance

| # | Table | Ownership | Written by | Read by |
|---|---|---|---|---|
| | **Reference & settings** | | | |
| 1 | `stk_site` Warehouse | Org | IT Admin | everyone |
| 2 | `stk_packtype` Packing type | Org | IT Admin | everyone |
| 3 | `stk_setting` Setting | Org | IT Admin | everyone |
| | **Source data (locked)** | | | |
| 4 | `stk_xbsimport` XBS import | Org | Importer (create; status by import only) | everyone |
| 5 | `stk_xbsline` XBS line | Org | Importer (**create only**) | everyone |
| 6 | `stk_comtrasposition` Comtras position | Org | Importer (**create only**) | mgmt roles |
| | **Mapping** | | | |
| 7 | `stk_basketmap` Basket mapping | Org | via approved change only | everyone |
| 8 | `stk_outturnmap` Outturn mapping | Org | via approved change only | everyone |
| 9 | `stk_mappingchange` Mapping change | User | Trading, Finance, Ops (request); Finance (decide) | mgmt roles |
| | **Stock take** | | | |
| 10 | `stk_stocktake` Stock take | Org | Ops Admin | everyone |
| 11 | `stk_assignment` Assignment | Org | Ops Admin | everyone (counters: own) |
| 12 | `stk_countsheet` Count sheet | User (= counter) | Counter (create/submit); Ops/WH Mgr (decide) | counter: own; mgmt: all |
| 13 | `stk_stack` Stack | Org | Counter (submit); Ops/WH Mgr | everyone |
| 14 | `stk_countline` Count line | User (= counter) | Counter | counter: own sheet; mgmt: all |
| 15 | `stk_recount` Recount | User (= assignee) | Ops/WH Mgr (create); counter (complete) | assignee; mgmt |
| | **Reconcile & sign-off** | | | |
| 16 | `stk_variance` Variance | Org | Mgmt app (generate); Ops/WH Mgr/Finance (decide) | mgmt roles |
| 17 | `stk_exception` Exception | User (= owner) | mgmt roles, flows | mgmt roles |
| 18 | `stk_signoff` Sign-off | Org | the gate's role | everyone |
| | **Other** | | | |
| 19 | `stk_directpurchase` Direct purchase | Org | Trading | mgmt roles |
| 20 | `stk_issue` Problem report | User (= raiser) | Counter (create); Ops/IT (triage) | raiser: own; mgmt: all |

Org-owned = shared reference data with no per-person ownership. User-owned =
rows belong to a person, so "counters see only their own" can be enforced by
role depth (User level) without custom filtering.

## Shared choices (global option sets)

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
| `stk_rootcause` (supervisor's cause) | Split lot · Unposted receipt · Unposted gate-out · Duplicate entry · Mapping error · Pocket / unit difference · Wrong basket on sale · In transit · Cancelled contract · Not yet known |
| `stk_variancestate` | Open · Recount sent · Accepted · Exception raised |
| `stk_exceptionkind` | all `stk_rootcause` values + Master data · Third party · Direct purchase |
| `stk_exceptionsource` | Count · Import · Pre-count check · Reconciliation |
| `stk_exceptionstatus` | Open · In progress · Escalated · Closed |
| `stk_department` | Operations · Warehouse · Trading · Finance · Logistics · Quality · IT |
| `stk_gate` | Operations · Warehouse · Trading · Finance |
| `stk_issuecategory` | App not working · Network or saving · Lot not on the list · Tag missing or unreadable · Stack blocked or unsafe · Third-party staff not available · Other |
| `stk_issuestatus` | Open · In progress · Resolved |

## Table details

Conventions: every table also has the standard `createdon`, `createdby`,
`modifiedon`, `modifiedby`, `ownerid` (user-owned) and `statecode`. **PK** =
primary name column. **AK** = alternate key. Lookups are N:1 unless stated.

### 1. `stk_site` — Warehouse (replaces NKG_config)
| Column | Type | Notes |
|---|---|---|
| `stk_name` PK | Text 100 | "Ibero Export Warehouse" |
| `stk_code` AK | Text 10 | IBR, AGL, KPCU, MAXA, MCF, KCCE — matches XBS |
| `stk_shortname` | Text 40 | "Ibero" |
| `stk_isthirdparty` | Yes/No | |
| `stk_manualentry` | Yes/No | Off at third parties (counters pick from XBS list only) |
| `stk_ceilingbags` | Whole number | Count-day ceiling, default 6000 |
| `stk_hasbaylayout` | Yes/No | Ibero = Yes (rows A–G × bays 1–14) |

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

Seed keys: `TargetNetVariancePct` 0.10 · `SignOffWorkingDays` 7 ·
`ExceptionSlaWorkingDays` 5 · `ThirdPartyAgeDays` 21 · `MatchToleranceKg` 0.05 ·
`AvgValueUsdPerTonne` 7383.

### 4. `stk_xbsimport` — XBS import (header)
| Column | Type | Notes |
|---|---|---|
| `stk_name` PK, AK | Text 30 | `IMP-260302-0852` |
| `stk_snapshotat` | Date & time | XBS export time (from file name) |
| `stk_filenames` | Multiline 2000 | Both report file names |
| `stk_rowcount` | Whole number | |
| `stk_status` | `stk_importstatus` | Only Validating → Imported/Failed; later Superseded |
| `stk_checks` | Multiline 100k | Check results as JSON (shown on the import screen) |
| `stk_warningcount` / `stk_failcount` | Whole number | |
| `stk_importedby` | Lookup → systemuser | |

### 5. `stk_xbsline` — XBS line (locked)
One row per line of either XBS report. Field names mirror the JSON snapshot.

| Column | Type | XBS / JSON |
|---|---|---|
| `stk_name` PK | Text 100 | batch no. (`b`) |
| `stk_import` | Lookup → stk_xbsimport | |
| `stk_rownumber` | Whole number | AK with `stk_import` — makes re-runs of a load safe |
| `stk_site` | Lookup → stk_site | `wh` |
| `stk_stocktype` | `stk_stocktype` | `t` |
| `stk_zone` | Text 40 | `z` ("D-05-1", "TEMP-0-0") |
| `stk_outturn` | Text 30 | `o` |
| `stk_grade` | Text 30 | `i` |
| `stk_basketcode` / `stk_basketname` | Text 10 / Text 100 | `bc` / `bn` |
| `stk_bags` | Whole number | `bg` |
| `stk_pocketkg` | Decimal (2) | `pk` |
| `stk_units` | Whole number | `u` |
| `stk_kg` | Decimal (2) | `kg` |
| `stk_growermark` | Text 100 | `g` |
| `stk_warrant` | Text 40 | `wr` |
| `stk_certification` | Text 200 | `c` |
| `stk_cupscore` | Text 40 | `cs` |
| `stk_blocked` | Yes/No | `bl` |
| `stk_salescontract` | Text 20 | `so` |
| `stk_instruction` | Text 40 | `in` |
| `stk_daysinstock` | Whole number | `d` |
| `stk_cropyear` | Text 12 | `cy` |

~1,750 rows per import. Old imports stay (Superseded) for history.

### 6. `stk_comtrasposition` — Comtras position (locked)
| Column | Type | Notes |
|---|---|---|
| `stk_name` PK | Text 100 | "10070 AB/PB FAQ @ 2026-03-02" |
| `stk_snapshotdate` | Date | |
| `stk_basketcode` | Text 10 | Secondary basket |
| `stk_bags` | Decimal (2) | Net of 537 sales relief |
| `stk_source` | Text 200 | File name |

Sample values until a real Comtras extract is provided.

### 7. `stk_basketmap` — Basket mapping
| Column | Type | Notes |
|---|---|---|
| `stk_name` PK | Text 120 | "10070 AB/PB FAQ" |
| `stk_basketcode` AK | Text 10 | |
| `stk_primarybasket` | `stk_primarybasket` | |
| `stk_lastchange` | Lookup → stk_mappingchange | Change that set the current value |

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
| `stk_state` | Choice: Pending · Approved · Rejected | |
| `stk_decidedby` / `stk_decidedon` | Lookup systemuser / Date & time | Must differ from `createdby` (separation of duties) |

### 10. `stk_stocktake` — Stock take
| Column | Type | Notes |
|---|---|---|
| `stk_name` PK | Text 100 | "Monthly Stock Take - 02/03/2026" |
| `stk_type` | `stk_stocktaketype` | |
| `stk_status` | `stk_stocktakestatus` | |
| `stk_countdate` | Date | |
| `stk_import` | Lookup → stk_xbsimport | Expected stock for this count |
| `stk_sites` | **N:N** ↔ stk_site | Warehouses included |
| `stk_preparedby` | Lookup → systemuser | Prepares the reconciliation pack; can't sign Finance |
| `stk_closedon` / `stk_closecomment` | Date & time / Multiline | |

### 11. `stk_assignment` — Assignment
| Column | Type | Notes |
|---|---|---|
| `stk_name` PK | Text 100 | "Achieng O. · Ibero rows D–E" |
| `stk_stocktake` | Lookup | |
| `stk_counter` | Lookup → systemuser | |
| `stk_site` | Lookup → stk_site | |
| `stk_rows` | Text 20 | "D,E"; empty = whole site |

### 12. `stk_countsheet` — Count sheet (the approval unit)
One per counter per assignment. Owner = the counter.

| Column | Type | Notes |
|---|---|---|
| `stk_name` PK | Text 30 | `CS-105` |
| `stk_stocktake` / `stk_assignment` / `stk_site` | Lookups | |
| `stk_status` | `stk_sheetstatus` | |
| `stk_submittedon` | Date & time | |
| `stk_countercomment` | Multiline 2000 | |
| `stk_decidedby` / `stk_decidedon` / `stk_decisioncomment` | Lookup / Date & time / Multiline | Comment required to send back |
| `stk_linecount` / `stk_variancecount` / `stk_bags` | Whole number | Kept up to date by the app on submit |

### 13. `stk_stack` — Stack (submission unit on the floor)
One per stock take × site × stack code. At Ibero the codes come from XBS zones;
at third parties counters create them ("Site 2 · Stack 1").

| Column | Type | Notes |
|---|---|---|
| `stk_name` PK | Text 60 | "D-05-1" |
| `stk_stocktake` / `stk_site` / `stk_countsheet` | Lookups | |
| `stk_landmark` | Text 200 | Third parties |
| `stk_status` | `stk_stackstatus` | |
| `stk_submittedby` / `stk_submittedon` | Lookup / Date & time | |
| `stk_comment` | Multiline 2000 | |

### 14. `stk_countline` — Count line
| Column | Type | Notes |
|---|---|---|
| `stk_name` PK | Text 60 | "KGT2605 @ D-05-1" |
| `stk_clientid` AK | Text 40 | GUID made on the device |
| `stk_countsheet` / `stk_stack` / `stk_site` | Lookups | |
| `stk_xbsline` | Lookup → stk_xbsline | Empty for found / other stock |
| `stk_outturn` / `stk_batch` / `stk_grade` | Text | As read from the tag |
| `stk_category` | `stk_stockcategory` | |
| `stk_packtype` | Lookup → stk_packtype | |
| `stk_bags` / `stk_pocketbags` | Whole number | |
| `stk_pocketkg` | Decimal (2) | |
| `stk_units` / `stk_kg` / `stk_bags60` | Whole / Decimal | Calculated by the app's shared rules and stored, so reports don't recompute |
| `stk_reason` | `stk_countreason` | Required when units/kg differ from XBS |
| `stk_note` | Multiline 2000 | |
| `stk_isfound` / `stk_isother` / `stk_isblind` | Yes/No | Not expected here · other stock · blind recount |
| `stk_reference` | Text 60 | Contract / delivery note for direct purchases |
| `stk_recount` | Lookup → stk_recount | When this line answers a recount |
| `stk_countedon` | Date & time | Device time (may be earlier than createdon if offline) |

### 15. `stk_recount` — Recount request
| Column | Type | Notes |
|---|---|---|
| `stk_name` PK | Text 30 | `R-031` |
| `stk_stocktake` / `stk_stack` / `stk_variance` | Lookups | |
| `stk_outturn` / `stk_batch` | Text | |
| `stk_why` | Multiline 2000 | Shown to the counter; never the earlier figure |
| `stk_status` | Choice: Open · Done | |
| owner | = counter assigned | |

### 16. `stk_variance` — Variance
Generated by the management app from count lines vs XBS lines when a sheet is
submitted (shared rules module), then decided by a person.

| Column | Type | Notes |
|---|---|---|
| `stk_name` PK | Text 30 | `V-0412` |
| `stk_stocktake` / `stk_site` / `stk_stack` | Lookups | |
| `stk_outturn` / `stk_grade` | Text | |
| `stk_expectedunits` / `stk_countedunits` | Whole number | |
| `stk_expectedkg` / `stk_countedkg` | Decimal (2) | |
| `stk_suggestedcause` | `stk_rootcause` | From the rules (advisory) |
| `stk_suggestionwhy` | Multiline 2000 | The evidence behind the suggestion |
| `stk_cause` | `stk_rootcause` | Person's decision |
| `stk_state` | `stk_variancestate` | |
| `stk_decidedby` / `stk_decidedon` | Lookup / Date & time | |
| `stk_countline` | Lookup → stk_countline | |

### 17. `stk_exception` — Exception register
Owner = the person who must fix it.

| Column | Type | Notes |
|---|---|---|
| `stk_name` PK | Text 200 | Title |
| `stk_kind` | `stk_exceptionkind` | |
| `stk_source` | `stk_exceptionsource` | |
| `stk_reference` | Text 60 | V-0415, IMP-…, contract no. |
| `stk_stocktake` / `stk_variance` / `stk_import` | Lookups (optional) | |
| `stk_department` | `stk_department` | |
| `stk_bags` | Whole number | |
| `stk_duedate` | Date | Raised + SLA working days |
| `stk_status` | `stk_exceptionstatus` | |
| `stk_escalationlevel` | Choice: Owner · Head of department · Country Finance Manager | Set by flow F4 |
| `stk_resolution` / `stk_closedon` | Multiline / Date & time | Resolution required to close |

### 18. `stk_signoff` — Sign-off event
| Column | Type | Notes |
|---|---|---|
| `stk_name` PK | Text 60 | "ST-2026-03 · Trading" |
| `stk_stocktake` | Lookup | |
| `stk_gate` | `stk_gate` | |
| `stk_action` | Choice: Signed · Sent back | |
| `stk_signedby` / `stk_signedon` | Lookup / Date & time | |
| `stk_comment` | Multiline 2000 | Required to send back |

Rules (checked in app and in flow F5): gates sign in order; Finance signer ≠
`stk_stocktake.stk_preparedby`; a send-back invalidates earlier signatures.

### 19. `stk_directpurchase` — Direct purchase
| Column | Type | Notes |
|---|---|---|
| `stk_name` PK, AK | Text 20 | Contract `DP-0219` |
| `stk_supplier` | Text 100 | |
| `stk_suppliertype` | Choice: Co-operative · Agent | |
| `stk_outturn` / `stk_warrant` / `stk_grade` | Text | |
| `stk_bagscontracted` / `stk_bagsinvoiced` / `stk_bagsdelivered` | Whole number | |
| `stk_invoicedate` | Date | |

Flags (invoiced-not-delivered, longs, no warrant) are computed in the app.

### 20. `stk_issue` — Problem report
| Column | Type | Notes |
|---|---|---|
| `stk_name` PK | Text 30 | `C-121` |
| `stk_category` | `stk_issuecategory` | |
| `stk_site` | Lookup | |
| `stk_screen` | Text 60 | Filled by the app |
| `stk_description` | Multiline 4000 | |
| `stk_status` | `stk_issuestatus` | |
| `stk_assignedto` | Lookup → systemuser | |
| `stk_linkedcause` | `stk_rootcause` | Feeds variance analysis |
| `stk_resolution` | Multiline 2000 | Reply shown to the counter |
| `stk_photo` | File | Optional |

## Relationships (summary)

```
stk_xbsimport 1─* stk_xbsline *─1 stk_site
stk_xbsimport 1─* stk_stocktake *─* stk_site          (N:N stk_stocktake_site)
stk_stocktake 1─* stk_assignment *─1 systemuser
stk_stocktake 1─* stk_countsheet 1─* stk_stack 1─* stk_countline *─0..1 stk_xbsline
stk_countline *─1 stk_packtype
stk_stocktake 1─* stk_variance 1─* stk_recount
stk_variance  1─* stk_exception
stk_stocktake 1─* stk_signoff
stk_mappingchange 1─* stk_basketmap / stk_outturnmap   (last change)
```

Delete behaviour: **Restrict** everywhere (nothing cascades). Records are
closed/superseded, not deleted.

## Security roles (detail in Step 3)

| Role | Key rights |
|---|---|
| **STK Counter** | Read reference + XBS (Org). Create/Write own count sheets, stacks, count lines, problem reports (User). Read/Write own recounts. |
| **STK Operations Admin** | Stock takes, assignments, sheet decisions, variances, exceptions (Org). Request mapping changes. Sign Operations gate. |
| **STK Warehouse Manager** | Sheet decisions, variances (Org). Sign Warehouse gate. |
| **STK Trading** | Direct purchases, exceptions, mapping requests. Sign Trading gate. |
| **STK Finance** | Decide mapping changes, variances. Sign Finance gate. |
| **STK IT Admin** | Sites, pack types, settings, users. |
| **STK Importer** | **Create only** on `stk_xbsline`, `stk_comtrasposition`; Create + Write on `stk_xbsimport`. Given to Ops Admin and IT Admin. |

No role has Write or Delete on `stk_xbsline` or `stk_comtrasposition`.
**Caveat:** System Administrators bypass roles. While we test with an admin
account the lock is also enforced in the apps; demonstrating the role lock
itself needs one non-admin test user.

## Open points to confirm

1. Approval unit: per **count sheet** (as in the current NKG app) with stacks
   inside it — or per stack only? Draft keeps both.
2. Should old imports be kept forever, or purged after N months?
3. Comtras extract: sample until a real file is shared.
4. 100% zero-out counts (issuing → receiving team) are not modelled yet; they'd
   add a receiving-side count line. Proposed for a later step.
