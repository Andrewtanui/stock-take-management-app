// Runs the built engine (engine/dist/stk-level1.mjs) from this PC with your own sign-in, the same
// way the worker runs it with the app user. Dev by default; DATAVERSE_URL / DATAVERSE_TENANT for NKG.
//   npm run engine:dry                       dry run on every stock take in Count in progress
//   npm run engine:dry -- --stocktake <id>   dry run on one stock take (any status)
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ORG_URL, getToken } from "./dataverse/auth.mjs";

const engine = fileURLToPath(new URL("../engine/dist/stk-level1.mjs", import.meta.url));
const r = spawnSync(process.execPath, [engine, ...process.argv.slice(2)], {
  stdio: "inherit",
  env: { ...process.env, DATAVERSE_URL: ORG_URL, DATAVERSE_TOKEN: await getToken() },
});
process.exitCode = r.status ?? 1;
