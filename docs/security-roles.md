# Security roles — IBKY Stock Take

Generated from `scripts/dataverse/roles.mjs` by `create-roles.mjs`. Do not edit by hand.

C create · R read · W write · D delete · A assign. Organisation-wide unless marked (own).
Append/AppendTo follow automatically. Every user also needs the built-in **Basic User** role.

- **STK Counter** — Counts on the floor with the Stock Take app.
- **STK Operations Admin** — Runs the stock take: set-up, counter allocation, approvals, variances, exceptions; signs the Operations gate.
- **STK Warehouse Manager** — Approves count sheets, decides variances; signs the Warehouse gate.
- **STK Trading** — Direct purchases, contract exceptions, mapping requests; signs the Trading gate.
- **STK Finance** — Decides mapping changes and variances, prepares and certifies the position; signs the Finance gate.
- **STK IT Admin** — Warehouses, packing types, settings and problem-report triage.
- **STK Importer** — Loads XBS and Comtras snapshots. Create-only on the locked tables — no role can edit or delete them.

| Table | Counter | Operations Admin | Warehouse Manager | Trading | Finance | IT Admin | Importer |
|---|---|---|---|---|---|---|---|
| `stk_site` | R | RP | R | R | R | CRWD | R |
| `stk_packtype` | R | R | R | R | R | CRWD |  |
| `stk_setting` | R | R | R | R | R | CRWD |  |
| `stk_xbsimport` | R | R | R | R | R | R | CRW |
| `stk_xbsline` 🔒 | R | R | R | R | R | R | CR |
| `stk_comtrasposition` 🔒 |  | R | R | R | R | R | CR |
| `stk_mappingchange` |  | R · CW (own) | R | R · CW (own) | CRW | R |  |
| `stk_basketmap` | R | R | R | R | CRW | R |  |
| `stk_outturnmap` | R | R | R | R | CRW | R |  |
| `stk_stocktake` | R | CRW | R | R | RW | R |  |
| `stk_counterprofile` |  | CRW | R | R | R | CRWD |  |
| `stk_allocationrun` |  | CRW | R | R | R | R |  |
| `stk_assignment` | R | CRWD | R | R | R | R |  |
| `stk_countsheet` | CRW (own) | RWA | RW | R | R | R |  |
| `stk_stack` | CRW | CRW | RW | R | R | R |  |
| `stk_variance` |  | CRW | RW | R | RW | R |  |
| `stk_recount` | RW (own) | CRWA | CRWA | R | R | R |  |
| `stk_countline` | R · CW (own) | R | R | R | R | R |  |
| `stk_exception` |  | CRWA | CRWA | CRWA | CRWA | R |  |
| `stk_signoff` |  | CR | CR | CR | CR | R |  |
| `stk_directpurchase` |  | R | R | CRW | R | R |  |
| `stk_issue` | CRW (own) | RWA | R | R | R | RWA |  |
| `Note` | CRW (own) | R | R | R | R | R |  |

🔒 Locked: no role has Write or Delete. System Administrators bypass roles, so the apps also refuse edits to these tables.
