// stk-level1: runs the Hub's Level 1 (src/data/level1.ts) on a server, with no browser and no
// Hub open. Built into one file by `npm run engine:build` (engine/dist/stk-level1.mjs); needs
// only Node 20, no npm packages.
//
//   node stk-level1.mjs                         every stock take in "Count in progress"
//   node stk-level1.mjs --stocktake <id>        one stock take
//   node stk-level1.mjs ... --dry-run           read everything, write nothing, list what it would write
//
// Sign-in, from environment variables:
//   DATAVERSE_URL                                      e.g. https://org6c75cfc0.crm4.dynamics.com
//   AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET   app user (client credentials), or
//   DATAVERSE_TOKEN                                    a ready access token (local runs)
// Exit code 0 = ran (or nothing to do), 1 = failed.

import { ENGINE_SILENT_MINUTES, isDuplicateKey, level1Settings, runLevel1, type Level1Db, type Level1Report } from "../data/level1";

declare const process: { argv: string[]; env: Record<string, string | undefined>; exitCode?: number };

const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const only = args.includes("--stocktake") ? args[args.indexOf("--stocktake") + 1] : undefined;
const env = (k: string, alt?: string) => process.env[k] ?? (alt ? process.env[alt] : undefined);
const URL_ = (env("DATAVERSE_URL", "IBKY_DV_URL") ?? "").replace(/\/$/, "");
const API = `${URL_}/api/data/v9.2/`;

async function token(): Promise<string> {
  const ready = env("DATAVERSE_TOKEN");
  if (ready) return ready;
  const tenant = env("AZURE_TENANT_ID", "IBKY_DV_TENANT_ID");
  const client = env("AZURE_CLIENT_ID", "IBKY_DV_CLIENT_ID");
  const secret = env("AZURE_CLIENT_SECRET", "IBKY_DV_CLIENT_SECRET");
  if (!tenant || !client || !secret) throw new Error("Set AZURE_TENANT_ID, AZURE_CLIENT_ID and AZURE_CLIENT_SECRET (or DATAVERSE_TOKEN).");
  const res = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: client, client_secret: secret, scope: `${URL_}/.default` }),
  });
  const j = (await res.json()) as { access_token?: string; error_description?: string };
  if (!j.access_token) throw new Error(`Sign-in failed: ${j.error_description ?? res.status}`);
  return j.access_token;
}

/** The Dataverse Web API as Level 1 expects it. Retries throttling and gateway errors. */
function webApi(bearer: string): Level1Db {
  const call = async (method: string, path: string, body?: unknown, extra: Record<string, string> = {}) => {
    for (let attempt = 1; ; attempt++) {
      const res = await fetch(path.startsWith("http") ? path : API + path, {
        method,
        headers: { Authorization: `Bearer ${bearer}`, Accept: "application/json", "Content-Type": "application/json; charset=utf-8", "OData-MaxVersion": "4.0", "OData-Version": "4.0", ...extra },
        body: body ? JSON.stringify(body) : undefined,
      });
      if ((res.status === 429 || res.status >= 502) && attempt < 6) {
        await new Promise((r) => setTimeout(r, (Number(res.headers.get("Retry-After")) || attempt * 3) * 1000));
        continue;
      }
      const text = await res.text();
      if (!res.ok) {
        const err = (text ? JSON.parse(text) : {}) as { error?: { code?: string; message?: string } };
        throw Object.assign(new Error(`${method} ${path.split("?")[0]}: ${err.error?.message ?? res.status}`), { code: err.error?.code });
      }
      return text ? JSON.parse(text) : {};
    }
  };
  return {
    async list<T>(set: string, q: { select: string[]; filter?: string; orderBy?: string[]; top?: number }) {
      const qs = [`$select=${q.select.join(",")}`, q.filter && `$filter=${encodeURIComponent(q.filter)}`, q.orderBy?.length && `$orderby=${encodeURIComponent(q.orderBy.join(","))}`, q.top && `$top=${q.top}`].filter(Boolean).join("&");
      const out: T[] = [];
      let next: string | undefined = `${set}?${qs}`;
      while (next) {
        const page: { value: T[]; "@odata.nextLink"?: string } = await call("GET", next, undefined, { Prefer: "odata.maxpagesize=500" });
        out.push(...page.value);
        next = page["@odata.nextLink"];
      }
      return out;
    },
    create: async (set, body) => void (await call("POST", set, body)),
    update: async (set, id, body) => void (await call("PATCH", `${set}(${id})`, body)),
  };
}

/**
 * Counts what a run writes. In a dry run nothing is written: every create and update is listed instead.
 */
function recorder(db: Level1Db, dry: boolean) {
  const writes: string[] = [];
  const show = (body: Record<string, unknown>) =>
    Object.entries(body)
      .filter(([k]) => !k.endsWith("@odata.bind") && k !== "documentbody" && k !== "stk_l1summary")
      .map(([k, v]) => `${k.replace(/^stk_/, "")}=${String(v).slice(0, 80)}`)
      .join(" · ");
  const wrapped: Level1Db = {
    list: (set, q) => db.list(set, q),
    create: async (set, body) => {
      writes.push(`create ${set}: ${show(body)}`);
      if (!dry) await db.create(set, body);
    },
    update: async (set, id, body) => {
      writes.push(`update ${set}(${id.slice(0, 8)}): ${show(body)}`);
      if (!dry) await db.update(set, id, body);
    },
  };
  return { db: wrapped, writes };
}

const MODE = { Engine: 614500000, "Dry run": 614500001 };
const OUTCOME = { Running: 614500000, Done: 614500001, Failed: 614500002, Skipped: 614500003 };
const RUNS = "stk_engineruns";

/**
 * Starts a run row. A writing run also takes the stock take's lock (stk_lock, an alternate key, so
 * only one run can hold it); a lock older than 15 minutes is a run that died and is released.
 * Returns the run id, or undefined when another run holds the lock.
 */
async function startRun(db: Level1Db, stockTakeId: string, dry: boolean): Promise<string | undefined> {
  const id = globalThis.crypto.randomUUID();
  const row = {
    stk_enginerunid: id,
    stk_name: `Level 1 · ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`,
    stk_mode: dry ? MODE["Dry run"] : MODE.Engine,
    stk_startedon: new Date().toISOString(),
    stk_outcome: OUTCOME.Running,
    "stk_stocktake@odata.bind": `/stk_stocktakes(${stockTakeId})`,
    ...(dry ? {} : { stk_lock: stockTakeId }),
  };
  for (let attempt = 1; ; attempt++) {
    try {
      await db.create(RUNS, row);
      return id;
    } catch (e) {
      if (dry || !isDuplicateKey(e as Error) || attempt > 1) throw e;
      const [holder] = await db.list<{ stk_enginerunid: string; stk_startedon?: string }>(RUNS, { select: ["stk_enginerunid", "stk_startedon"], filter: `stk_lock eq '${stockTakeId}'`, top: 1 });
      const age = holder?.stk_startedon ? Date.now() - new Date(holder.stk_startedon).getTime() : Infinity;
      if (holder && age < ENGINE_SILENT_MINUTES * 60_000) {
        await db.create(RUNS, { ...row, stk_lock: null, stk_outcome: OUTCOME.Skipped, stk_finishedon: new Date().toISOString(), stk_result: `Another run has been working on this stock take since ${holder.stk_startedon}.` });
        return undefined;
      }
      if (holder) await db.update(RUNS, holder.stk_enginerunid, { stk_lock: null, stk_outcome: OUTCOME.Failed, stk_result: "Lock released by a later run: this run did not finish within 15 minutes." });
    }
  }
}

async function main() {
  if (!URL_) throw new Error("Set DATAVERSE_URL.");
  const real = webApi(await token());
  // Only Level1Runs = Engine lets the engine write; otherwise every run is a dry run.
  const runs = level1Settings(await real.list("stk_settings", { select: ["stk_name", "stk_value"] })).runs;
  const dry = DRY || runs !== "Engine";
  if (!DRY && dry) console.log("Setting Level1Runs is not Engine: dry run (nothing written).");
  const ids = only
    ? [only]
    : (await real.list<{ stk_stocktakeid: string }>("stk_stocktakes", { select: ["stk_stocktakeid"], filter: "stk_status eq 614500000" })).map((r) => r.stk_stocktakeid);
  if (!ids.length) {
    console.log("No stock take in Count in progress: nothing to do.");
    return;
  }
  for (const id of ids) {
    const runId = await startRun(real, id, dry);
    if (!runId) {
      console.log(`${id}: another run is working on this stock take; skipped.`);
      continue;
    }
    const { db, writes } = recorder(real, dry);
    const started = Date.now();
    try {
      const r: Level1Report = await runLevel1(db, id);
      const line = `${r.stockTake} (${r.status}): ${r.drafts} differences in the count, ${r.decided} decided automatically, count ${r.close.closedNow ? "closed now" : r.close.ready ? "ready / already closed" : "not ready"}, ${writes.length} ${dry ? "would be written" : "written"}, ${((Date.now() - started) / 1000).toFixed(1)} s${dry ? " [dry run]" : ""}`;
      console.log(line);
      if (!r.close.ready && r.close.missing.length) console.log(`  still missing: ${r.close.missing.join("; ")}`);
      if (dry) for (const w of writes) console.log(`   - ${w}`);
      const result = [line, ...(r.close.missing.length ? [`Still missing: ${r.close.missing.join("; ")}`] : []), ...(dry ? writes.map((w) => `- ${w}`) : [])].join("\n");
      await real.update(RUNS, runId, { stk_outcome: OUTCOME.Done, stk_finishedon: new Date().toISOString(), stk_writes: writes.length, stk_result: result.slice(0, 4000), stk_lock: null });
    } catch (e) {
      await real.update(RUNS, runId, { stk_outcome: OUTCOME.Failed, stk_finishedon: new Date().toISOString(), stk_writes: writes.length, stk_result: String(e instanceof Error ? e.message : e).slice(0, 4000), stk_lock: null }).catch(() => {});
      throw e;
    }
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
