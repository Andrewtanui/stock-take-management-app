// Creates (or updates) the Stage 4 flows and their connection references in IBKYStockTake,
// then turns the flows on.
//   npm run dv:flows -- --team <teamId> --channel <channelId> [--dataverse <connId>] [--teams <connId>] [--approvals <connId>] [--outlook <connId>] [--dry-run]
// Connection ids: `npx pa connection list`. Team/channel: from a Teams "Get link to channel" URL.
import { dv } from "./api.mjs";
import { CONNECTION_REFERENCES, flows } from "./flows.mjs";

const SOLUTION = "IBKYStockTake";
const arg = (k) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const dry = process.argv.includes("--dry-run");
const cfg = { teamId: arg("team"), channelId: arg("channel") };
const conn = { dataverse: arg("dataverse"), teams: arg("teams"), approvals: arg("approvals"), outlook: arg("outlook") };
if (!cfg.teamId || !cfg.channelId) throw new Error("--team and --channel are required (from the Teams channel link)");

const esc = (s) => s.replace(/'/g, "''");

async function ensureReference(key, ref) {
  const found = (await dv("GET", `connectionreferences?$select=connectionreferenceid,connectionid&$filter=connectionreferencelogicalname eq '${ref.logicalName}'`)).value[0];
  const body = {
    connectionreferencelogicalname: ref.logicalName,
    connectionreferencedisplayname: ref.displayName,
    connectorid: `/providers/Microsoft.PowerApps/apis/${ref.api}`,
    ...(conn[key] ? { connectionid: conn[key] } : {}),
  };
  if (dry) return console.log(`[dry] connection reference ${ref.logicalName}`, found ? "update" : "create", body);
  if (found) {
    if (conn[key] && found.connectionid !== conn[key]) await dv("PATCH", `connectionreferences(${found.connectionreferenceid})`, { connectionid: conn[key] }, { solution: SOLUTION });
    console.log(`✓ connection reference ${ref.logicalName} (exists${conn[key] ? ", bound" : ""})`);
  } else {
    if (!conn[key]) throw new Error(`--${key} <connectionId> is needed to create ${ref.logicalName}`);
    await dv("POST", "connectionreferences", body, { solution: SOLUTION });
    console.log(`✓ connection reference ${ref.logicalName} created`);
  }
}

async function ensureFlow(f) {
  const found = (await dv("GET", `workflows?$select=workflowid,statecode&$filter=category eq 5 and name eq '${esc(f.name)}'`)).value[0];
  const clientdata = JSON.stringify(f.data);
  if (dry) return console.log(`[dry] flow "${f.name}"`, found ? "update" : "create", `(${clientdata.length} chars)`);
  let id = found?.workflowid;
  if (id) {
    if (found.statecode === 1) await dv("PATCH", `workflows(${id})`, { statecode: 0, statuscode: 1 });
    await dv("PATCH", `workflows(${id})`, { clientdata, description: f.description }, { solution: SOLUTION });
  } else {
    const r = await dv("POST", "workflows", { name: f.name, description: f.description, category: 5, type: 1, primaryentity: "none", clientdata }, { solution: SOLUTION });
    id = r.id.match(/\(([^)]+)\)/)[1];
  }
  try {
    await dv("PATCH", `workflows(${id})`, { statecode: 1, statuscode: 2 });
    console.log(`✓ ${f.name} — on`);
  } catch (e) {
    console.log(`! ${f.name} — saved but couldn't turn on:\n  ${String(e.message).split("\n").slice(0, 3).join("\n  ")}`);
  }
}

for (const [key, ref] of Object.entries(CONNECTION_REFERENCES)) await ensureReference(key, ref);
for (const f of flows(cfg)) await ensureFlow(f);
