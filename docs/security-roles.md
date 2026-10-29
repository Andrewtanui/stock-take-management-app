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
- **STK Importer** — Loads XBS, Comtras, shipment tracker, XBS stuffing and direct purchase snapshots. Create-only on the locked tables — no role can edit or delete them.
- **STK Engine** — For the Stock Assistant's engine (application user, not a person): reads every stk_ table, raises and updates its own rule exceptions in stk_exception, and keeps its own ibky_ tables (when that solution is installed).
- **STK Level 1 Engine** — For the server engine stk-level1 (application user, not a person), active only when setting Level1Runs = Engine: turns the count into variances, decides them by the Level 1 rules, sends blind recounts, raises exceptions (owned by the department head) and closes the count with its summary and PDF. Never deletes.

| Table | Counter | Operations Admin | Warehouse Manager | Trading | Finance | IT Admin | Importer | Engine | Level 1 Engine |
|---|---|---|---|---|---|---|---|---|---|
| `stk_site` | R | RP | R | R | R | CRWD | R | R | R |
| `stk_packtype` | R | R | R | R | R | CRWD |  | R | R |
| `stk_setting` | R | R | R | R | R | CRWD |  | R | R |
| `stk_xbsimport` | R | R | R | R | R | R | CRW | R | R |
| `stk_xbsline` 🔒 | R | R | R | R | R | R | CR | R | R |
| `stk_comtrasposition` 🔒 |  | R | R | R | R | R | CR | R | R |
| `stk_contractinvoice` 🔒 |  | R | R | R | R | R | CR | R | R |
| `stk_shipment` 🔒 |  | R | R | R | R | R | CR | R | R |
| `stk_directlot` 🔒 |  | R | R | R | R | R | CR | R | R |
| `stk_xbsstuffing` 🔒 |  | R | R | R | R | R | CR | R | R |
| `stk_mappingchange` |  | R · CW (own) | R | R · CW (own) | CRW | R |  | R | R |
| `stk_basketmap` | R | R | R | R | CRW | R |  | R | R |
| `stk_outturnmap` | R | R | R | R | CRW | R |  | R | R |
| `stk_stocktake` | R | CRW | R | R | RW | R |  | R | RW |
| `stk_counterprofile` |  | CRW | R | R | R | CRWD |  | R | R |
| `stk_reconitem` |  | CRWD | R | R | CRWD | R |  | R | R |
| `stk_kpisnapshot` |  | CRW | CRW | CRW | CRW | R |  | R | R |
| `stk_enginerun` |  | R | R | R | R | R |  | R | CRW |
| `stk_allocationrun` |  | CRW | R | R | R | R |  | R | R |
| `stk_assignment` | R | CRWD | R | R | R | R |  | R | R |
| `stk_countsheet` | CRW (own) | RWA | RW | R | R | R |  | R | R |
| `stk_stack` | CRW | CRW | RW | R | R | R |  | R | R |
| `stk_variance` |  | CRW | RW | R | RW | R |  | R | CRW |
| `stk_recount` | RW (own) | CRWA | CRWA | R | R | R |  | R | CRWA |
| `stk_countline` | R · CW (own) | R | R | R | R | R |  | R | R |
| `stk_exception` |  | CRWA | CRWA | CRWA | CRWA | R |  | CRWA | CRWA |
| `stk_signoff` |  | CR | CR | CR | CR | R |  | R | R |
| `stk_directpurchase` |  | R | R | CRW | R | R |  | R | R |
| `stk_issue` | CRW (own) | RWA | R | R | R | RWA |  | R | R |
| `Note` | CRW (own) | R | R | R | R | R |  | R | CRW |

🔒 Locked: no role has Write or Delete. System Administrators bypass roles, so the apps also refuse edits to these tables.
