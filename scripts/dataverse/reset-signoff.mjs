// Resets sign-off on the latest stock take so a sign-off can be demonstrated again:
// deletes its sign-off rows and puts the stock take back to Reconciliation
// (clears the closed-on date and comment that flow F5 sets after Finance signs).
// Nothing else is touched: counts, variances, exceptions and XBS stay as they are.
//
//   npm run dv:reset-signoff -- --dry-run     show what would change
//   npm run dv:reset-signoff                  Pathways dev
//   npm run dv:reset-signoff -- --counting    back to Count in progress, so the counter app opens it again
//   NKG_Demo: set DATAVERSE_URL / DATAVERSE_TENANT first (see docs/dataverse-schema.md)

import { dv } from "./api.mjs";
import { ORG_URL } from "./auth.mjs";
import { CHOICES } from "./schema.mjs";

const DRY = process.argv.includes("--dry-run");
const TO = process.argv.includes("--counting") ? "Count in progress" : "Reconciliation";
const status = (name) => 614500000 + CHOICES.stk_stocktakestatus[1].indexOf(name);

const st = (await dv("GET", "stk_stocktakes?$select=stk_stocktakeid,stk_name,stk_status&$orderby=createdon desc&$top=1")).value[0];
if (!st) {
  console.log(`No stock take in ${ORG_URL}.`);
  process.exit(0);
}
const rows = (await dv("GET", `stk_signoffs?$select=stk_signoffid,stk_name,createdon&$filter=_stk_stocktake_value eq ${st.stk_stocktakeid}&$orderby=createdon asc`)).value;
const from = CHOICES.stk_stocktakestatus[1][st.stk_status - 614500000] ?? st.stk_status;

console.log(`${ORG_URL}\n${st.stk_name}: status ${from}, ${rows.length} sign-off row(s)`);
for (const r of rows) console.log(`  - ${r.stk_name} (${r.createdon})`);
if (DRY) {
  console.log("Dry run: nothing changed.");
  process.exit(0);
}

for (const r of rows) await dv("DELETE", `stk_signoffs(${r.stk_signoffid})`);
await dv("PATCH", `stk_stocktakes(${st.stk_stocktakeid})`, { stk_status: status(TO), stk_closedon: null, stk_closecomment: null });
console.log(`Deleted ${rows.length} sign-off row(s); ${st.stk_name} is back in ${TO}.`);
