# IBKY Stock Management app (UI demo)

The **Stock Management app** for Ibero Kenya: the browser and tablet portal used
by Operations, the Warehouse Manager, Trading, Finance and IT to run a stock
take from XBS import to certified sign-off. Built as a **Power Apps code app**
(React + TypeScript + Vite, `@microsoft/power-apps` SDK).

Counters use the separate **Stock Take app** (`../stocktake-app`). Both read the
same XBS import and NKG_config settings.

This is a **UI/UX demo**. Every screen works, and actions carry across screens
while the tab is open (approve a sheet and sign-off unblocks; approve a mapping
change and the reconciliation moves), but nothing is saved. Expected stock is
the real XBS snapshot of 2 Mar 2026; counts, Comtras figures, names, exceptions
and direct purchases are samples. **"Viewing as"** in the top bar switches role,
so you can see what each role may change and walk the approval chain.

## Screens

| Area | Screen | What it does |
|---|---|---|
| | Overview | Stage of the stock take, what's waiting for whom, coverage, net variance, SOP sign-off clock |
| Stock take | Stock takes | List, create (type, warehouses, XBS import), close and lock |
| | XBS import | Upload the two XBS reports, run checks (duplicates, pack weights, unmapped baskets, warrant format, missing locations, remnants), import history |
| | Pre-count checks | Stuffed-not-posted, cancelled/shipped contracts, sites over the 6,000-bag ceiling, ageing over 21 days, split outturns; raise as exceptions |
| | Count day live | Coverage by site, bags per hour, counter pace against 6,000–7,000 bags/day |
| | Count approval | Approve each counter's sheet or send it back with a reason |
| Reconcile | Variances | Suggested cause (advisory), agreed cause list, source records, blind recount / accept / raise exception |
| | Reconciliation | Physical vs XBS vs Comtras, drill-down primary basket → secondary basket → outturn, ±0.10% gauge |
| | Exceptions | Register with owner, department, due date, age, escalation ladder (owner → HOD → Country Finance Manager), analysis by cause |
| | Sign-off | Operations → Warehouse → Trading → Finance, readiness checks, separation of duties, sign-off pack (template layout), PDF/Excel |
| Master data | Mapping | Secondary → primary basket, outturn → basket, change requests approved by Finance, packing and unit rules |
| | Direct purchases | Co-operative and agent purchases; invoiced-not-delivered and longs flagged |
| Support | Problem reports | Complaints raised by counters; assign, link to a variance cause, reply |
| | Reports | The standard report list with on-screen preview and export |
| Admin | Set-up & audit | Warehouses (manual-entry switch), locations and formats, stock take groups, grades, users and permission matrix, audit log with restore |

### Demo path

1. **Overview** as Operations Admin: 3 sheets waiting, 5 variances.
2. **Count approval**: approve CS-104 and CS-106 (CS-109 too).
3. **Variances**: decide each (accept, recount or raise exception).
4. **Sign-off**: sign as Operations, then switch "Viewing as" to Warehouse Manager, Trading and Finance in turn.
5. **Mapping → Changes** as Finance: approve MC-014 and watch Reconciliation move. Try approving as Trading (blocked: requester can't approve).
6. **Set-up** as IT Admin: switch manual entry at a site and check the audit log.

## Run it

```bash
npm install
npm run dev              # http://localhost:3001 (the counter app uses 3000)
```

Before running inside Power Apps, create the app's `power.config.json`:

```bash
pa app init --display-name "Stock Management" --environment-id <environment-id>
```

## How it's put together

```
src/
  App.tsx             top bar, role switcher, grouped navigation
  data/
    types.ts          shapes the screens work with
    repository.ts     reference data, checks and calculations (mock today)
    store.tsx         in-memory actions shared across screens + audit log
    xbs-2026-03-02.json  XBS snapshot shared with the counter app
  screens/            one file per screen
  ui/kit.tsx          shared pieces: tabs, chips, dialog, stats, diff cells
```

## Wiring real data later

- XBS import → Dataverse staging tables via the import dataflow
- Stock takes, count sheets → the Stock Takes and Count Sheets SharePoint lists the counter app writes
- Mapping, settings, warehouses → NKG_config and a mapping list with an approval flow
- Exceptions, sign-off → lists with Power Automate for Teams/Outlook alerts and escalation
- Comtras/BRIC positions → the Comtras extract, net of 537 sales relief

## Brand

Follows the NKG Brand Book "Uniting Contrasts" (v1.0, 2022). Tokens live in
`src/theme.css`, identical in both apps.

- **Colours:** the seven brand colours only. FRESH (Neumann green, fresh green,
  turquoise) for facts and numbers, WARM (yellow, magenta, orange, Neumann red)
  for people and alerts. Text is black or white.
- **Brand bar:** the FRESH gradient (turquoise → green) under the header.
- **Logo:** the official negative "NKG East Africa" lockup (`public/brand/nkg-mark.svg`,
  unmodified) on a Neumann green header, as the brand book allows for dark
  surfaces, followed by the app name.
- **Type:** Bricolage Grotesque (free, SIL Open Font License), bundled via
  `@fontsource-variable/bricolage-grotesque`, stands in for the licensed Aptifer Sans LT Pro: a
  characterful grotesque with lining figures and a 200–800 weight range. Headlines pair a BLACK statement
  with a light line.

## Dataverse

Schema spec: [docs/dataverse-schema.md](docs/dataverse-schema.md). The schema is
built by script and is safe to re-run (it only adds what's missing):

```bash
npm run dv:schema:dry   # list what would be created
npm run dv:schema       # create in the environment (browser sign-in on first run)
```

Defaults point at the dev environment; override with `DATAVERSE_URL`,
`DATAVERSE_TENANT`. The token is cached in `~/.ibky-stocktake/`, not the repo.

Security roles: `npm run dv:roles` creates or updates the 7 STK roles from `scripts/dataverse/roles.mjs`, checks that no role can edit XBS/Comtras rows, and regenerates [docs/security-roles.md](docs/security-roles.md).

`solution/` holds the exported unmanaged solution (`IBKYStockTake_unmanaged.zip`)
and its unpacked source, for import into another environment:
`pac solution import --path solution/IBKYStockTake_unmanaged.zip`.
