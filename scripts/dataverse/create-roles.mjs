// Creates / updates the IBKY Stock Take security roles from roles.mjs and
// writes docs/security-roles.md. Safe to re-run: each role's privileges are
// replaced with exactly what roles.mjs defines.
//
//   node scripts/dataverse/create-roles.mjs --dry-run
//   node scripts/dataverse/create-roles.mjs

import { writeFileSync } from "node:fs";
import { LOCKED, ROLES } from "./roles.mjs";
import { SOLUTION, TABLES } from "./schema.mjs";

const DRY = process.argv.includes("--dry-run");
const SOL = SOLUTION.uniquename;
const OWN = Object.fromEntries(TABLES.map((t) => [t.name, t.own]));
const LETTER = { C: "Create", R: "Read", W: "Write", D: "Delete", A: "Assign", S: "Share", P: "Append" };
const DEPTH = { G: "Global", B: "Basic" };

/** Expands a role's table spec into [{ table, privilege, depth }]. */
function expand(role) {
  const out = [];
  for (const [table, spec] of Object.entries(role.tables)) {
    if (!OWN[table]) throw new Error(`${role.name}: unknown table ${table}`);
    const byDepth = typeof spec === "string" ? { G: spec } : spec;
    const best = {}; // privilege → widest depth
    const grant = (p, d) => {
      if (best[p] !== "G") best[p] = d;
    };
    for (const [d, letters] of Object.entries(byDepth)) {
      if (d === "B" && OWN[table] !== "user") throw new Error(`${role.name}: ${table} is org-owned, "own records" depth not possible`);
      for (const l of letters) grant(LETTER[l], d);
      if (/[CW]/.test(letters)) grant("Append", d);
      if (letters.includes("R")) grant("AppendTo", d);
    }
    for (const [p, d] of Object.entries(best)) out.push({ table, privilege: p, depth: d });
  }
  for (const t of LOCKED)
    for (const g of out.filter((x) => x.table === t && (x.privilege === "Write" || x.privilege === "Delete")))
      throw new Error(`${role.name} would get ${g.privilege} on locked table ${t}`);
  return out;
}

/* ---------- docs/security-roles.md (always regenerated) ---------- */
const tables = TABLES.map((t) => t.name);
const cell = (role, t) => {
  const s = role.tables[t];
  if (!s) return "";
  if (typeof s === "string") return s;
  return Object.entries(s)
    .map(([d, l]) => (d === "B" ? `${l} (own)` : l))
    .join(" · ");
};
const md = [
  "# Security roles — IBKY Stock Take",
  "",
  "Generated from `scripts/dataverse/roles.mjs` by `create-roles.mjs`. Do not edit by hand.",
  "",
  "C create · R read · W write · D delete · A assign. Organisation-wide unless marked (own).",
  "Append/AppendTo follow automatically. Every user also needs the built-in **Basic User** role.",
  "",
  ...ROLES.map((r) => `- **${r.name}** — ${r.about}`),
  "",
  `| Table | ${ROLES.map((r) => r.name.replace("STK ", "")).join(" | ")} |`,
  `|---|${ROLES.map(() => "---").join("|")}|`,
  ...tables.map((t) => `| \`${t}\`${LOCKED.includes(t) ? " 🔒" : ""} | ${ROLES.map((r) => cell(r, t)).join(" | ")} |`),
  "",
  `🔒 Locked: no role has Write or Delete. System Administrators bypass roles, so the apps also refuse edits to these tables.`,
  "",
].join("\n");
const docPath = new URL("../../docs/security-roles.md", import.meta.url);
writeFileSync(docPath, md);
console.log("Wrote docs/security-roles.md");

/* ---------- plan ---------- */
for (const r of ROLES) {
  const ps = expand(r);
  console.log(`  ${r.name}: ${ps.length} privileges on ${Object.keys(r.tables).length} tables`);
}
if (DRY) process.exit(0);

/* ---------- apply ---------- */
const { dv } = await import("./api.mjs");

const bu = (await dv("GET", "businessunits?$select=businessunitid,name&$filter=_parentbusinessunitid_value eq null")).value[0];
console.log(`\nRoot business unit: ${bu.name}`);

// Privilege ids for every stk_ table, looked up once.
const privId = {};
for (const t of tables) {
  const r = await dv("GET", `privileges?$select=privilegeid,name&$filter=endswith(name,'${t}')`);
  for (const p of r.value) privId[p.name.toLowerCase()] = p.privilegeid;
}
const idFor = (table, privilege) => {
  const id = privId[`prv${privilege}${table}`.toLowerCase()];
  if (!id) throw new Error(`No privilege prv${privilege}${table}`);
  return id;
};

for (const r of ROLES) {
  process.stdout.write(`\n${r.name} … `);
  let role = (await dv("GET", `roles?$select=roleid&$filter=name eq '${r.name}' and _businessunitid_value eq ${bu.businessunitid}`)).value[0];
  if (!role) {
    await dv("POST", "roles", { name: r.name, description: r.about, "businessunitid@odata.bind": `/businessunits(${bu.businessunitid})` }, { solution: SOL });
    role = (await dv("GET", `roles?$select=roleid&$filter=name eq '${r.name}' and _businessunitid_value eq ${bu.businessunitid}`)).value[0];
    process.stdout.write("created, ");
  }
  const Privileges = expand(r).map((p) => ({
    "@odata.type": "Microsoft.Dynamics.CRM.RolePrivilege",
    PrivilegeId: idFor(p.table, p.privilege),
    BusinessUnitId: bu.businessunitid,
    Depth: DEPTH[p.depth],
  }));
  await dv("POST", `roles(${role.roleid})/Microsoft.Dynamics.CRM.ReplacePrivilegesRole`, { Privileges });
  await dv("POST", "AddSolutionComponent", { ComponentId: role.roleid, ComponentType: 20, SolutionUniqueName: SOL, AddRequiredComponents: false });
  process.stdout.write(`${Privileges.length} privileges set`);
}

/* ---------- verify the XBS lock ---------- */
console.log("\n\nVerifying locked tables …");
let ok = true;
for (const r of ROLES) {
  const role = (await dv("GET", `roles?$select=roleid&$filter=name eq '${r.name}' and _businessunitid_value eq ${bu.businessunitid}`)).value[0];
  const held = (await dv("GET", `roles(${role.roleid})/roleprivileges_association?$select=name`)).value.map((p) => p.name.toLowerCase());
  const bad = LOCKED.flatMap((t) => ["write", "delete"].map((p) => `prv${p}${t}`)).filter((n) => held.includes(n));
  console.log(`  ${r.name}: ${held.length} privileges${bad.length ? " — HOLDS " + bad.join(", ") : ", none on locked tables"}`);
  if (bad.length) ok = false;
}
console.log(ok ? "\nLock verified: no STK role can write or delete XBS or Comtras rows." : "\nLOCK BROKEN — fix roles.mjs");
if (!ok) process.exit(1);
