// App state for the Stock Management app. Loaded once through the active data
// source (mock or Dataverse), then every action is applied on screen straight
// away and saved through the source, so one screen's action shows on the
// others (approve a sheet, close a variance, sign a gate). Power Automate
// reacts to the saved rows (notifications, escalations).

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { CHAIN, SITES, addImport, basketMap, setReference } from "./repository";
import { getSource, type AllocationData, type DataSource, type MgmtData, type Signature, type XbsUploadToSave } from "./source";
import { pickRecounter, type AllocCounter, type Plan } from "./allocate";
import type {
  AuditEntry,
  AllocationChange,
  AllocationRun,
  BasketMap,
  CounterProfile,
  CountRow,
  DirectPurchase,
  Exception,
  Issue,
  MappingChange,
  PrimaryBasket,
  Role,
  RootCause,
  SheetStatus,
  Site,
  SiteCode,
  StockTake,
  Variance,
} from "./types";
import { LoadError, Splash } from "../ui/Splash";

/** A count line's identity: its Dataverse id, or where and by whom in the demo data. */
const lineKeyOf = (l: CountRow) => l.id ?? `${l.site}|${l.stack}|${l.batch}|${l.by}`;

/** Demo identities for each role. */
export const PEOPLE: Record<Role, string> = {
  "Operations Admin": "Peter M.",
  "Warehouse Manager": "Joseph O.",
  Trading: "Mary W.",
  Finance: "Carol M.",
  "IT Admin": "Michael A.",
};
/** Who prepared the reconciliation pack. Separation of duties: they can't approve it. */
export const PREPARER = "Dennis I.";

export type { Signature };

function stamp() {
  const d = new Date();
  return `Today, ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function useStoreState(source: DataSource, data: MgmtData) {
  const [role, setRoleState] = useState<Role>("Operations Admin");
  const [toast, setToast] = useState<string | null>(null);
  const [stockTakes, setStockTakes] = useState<StockTake[]>(data.stockTakes);
  const [sheets, setSheets] = useState(data.sheets);
  const [variances, setVariances] = useState<Variance[]>(data.variances);
  const [causes, setCauses] = useState<Record<string, RootCause>>({});
  const [exceptions, setExceptions] = useState<Exception[]>(data.exceptions);
  const [changes, setChanges] = useState<MappingChange[]>(data.changes);
  const [baskets, setBaskets] = useState<BasketMap[]>(() => data.baskets ?? basketMap());
  const [sites, setSites] = useState<Site[]>(data.reference.sites);
  const [audit, setAudit] = useState<AuditEntry[]>(data.audit);
  const [issues, setIssues] = useState<Issue[]>(data.issues);
  const [directPurchases, setDirectPurchases] = useState<DirectPurchase[]>(data.reference.directPurchases);
  // Count lines and stacks are read-only here; they change in the counter app.
  const counts = data.counts ?? [];
  const [allocation, setAllocation] = useState<AllocationData>(
    data.allocation ?? { profiles: [], runs: [], lastAreas: {}, rules: { homeArea: true, rotation: true, thirdPartyClearance: true }, people: [] },
  );
  // Recounts asked from Count approval this session, by line (shown until the page reloads with them).
  const [lineRecounts, setLineRecounts] = useState<Record<string, string>>({});
  /** R-### → who was picked to do it (this session). */
  const [recountTo, setRecountTo] = useState<Record<string, string>>({});
  const stacks = data.stacks ?? [];
  const [signatures, setSignatures] = useState<Partial<Record<Role, Signature>>>(data.signatures ?? {});

  const me = PEOPLE[role];

  /**
   * A different counter for a blind recount: present on the published allocation
   * (or any active profile), not the original counter, not their home area.
   * Undefined when nobody else fits - the recount then goes to the original counter.
   */
  const recounterFor = (site: SiteCode, stack: string, original: { id?: string; name: string }) => {
    const live = allocation.runs.find((r) => r.status === "Published");
    const profiles = allocation.profiles.filter((p) => p.active);
    const ids = live?.present.length ? live.present : profiles.map((p) => p.userId);
    const nameOf = (id: string) => profiles.find((p) => p.userId === id)?.name ?? allocation.people.find((p) => p.id === id)?.name ?? "";
    const counters: AllocCounter[] = ids.map((id) => {
      const p = profiles.find((x) => x.userId === id);
      return p ? { id, name: p.name, homeRows: p.homeRows, homeSite: p.homeSite, thirdPartyOk: p.thirdPartyOk } : { id, name: nameOf(id), noProfile: true };
    });
    const originalId = original.id ?? counters.find((c) => c.name === original.name)?.id;
    const pick = pickRecounter({
      site,
      stack,
      exclude: [originalId, ...counters.filter((c) => c.name === original.name).map((c) => c.id)].filter(Boolean) as string[],
      counters,
      openRecounts: allocation.openRecounts ?? {},
      rules: allocation.rules,
      thirdParty: new Set(SITES.filter((x) => x.thirdParty).map((x) => x.code)),
    });
    if (!pick) return undefined;
    setAllocation((a) => ({ ...a, openRecounts: { ...a.openRecounts, [pick.id]: (a.openRecounts?.[pick.id] ?? 0) + 1 } }));
    return { id: pick.id, name: pick.name };
  };
  /** Next EX-### after the highest existing one. */
  const nextExceptionId = () => {
    const max = exceptions.reduce((m, e) => Math.max(m, Number(e.id.replace(/\D/g, "")) || 0), 0);
    return `EX-${String(max + 1).padStart(3, "0")}`;
  };
  const flash = (m: string) => {
    setToast(m);
    window.setTimeout(() => setToast((t) => (t === m ? null : t)), 3200);
  };
  /** Runs a save; on failure says so and runs `undo` so the screen doesn't lie. */
  const persist = (work: Promise<void>, what: string, undo?: () => void) =>
    work.catch((e: unknown) => {
      console.error(e);
      undo?.();
      flash(`Couldn't save ${what}. ${e instanceof Error ? e.message : ""}`.trim());
    });
  const log = (list: string, item: string, change: string) =>
    setAudit((a) => [{ at: stamp(), by: me, list, item, change }, ...a]);

  return {
    role,
    me,
    toast,
    stockTakes,
    sheets,
    variances,
    causes,
    exceptions,
    changes,
    baskets,
    sites,
    audit,
    issues,
    signatures,
    counts,
    allocation,
    stacks,
    directPurchases,
    people: data.reference.people,
    source: source.kind,
    flash,
    /** A counter's photo (Dataverse Note), loaded when someone opens it. */
    photo: (id: string) => source.photo(id),

    setRole(r: Role) {
      setRoleState(r);
      flash(`Viewing as ${PEOPLE[r]}, ${r}.`);
    },

    createStockTake(st: StockTake) {
      setStockTakes((xs) => [st, ...xs]);
      persist(source.createStockTake(st), st.title, () => setStockTakes((xs) => xs.filter((x) => x.id !== st.id)));
      log("Stock Takes", st.id, `Created; ${st.type}; ${st.sites.length} warehouses`);
      flash(`${st.title} created. Counters can start.`);
    },
    closeStockTake(id: string, comment: string) {
      const before = stockTakes.find((s) => s.id === id);
      setStockTakes((xs) => xs.map((s) => (s.id === id ? { ...s, status: "Completed" } : s)));
      persist(source.closeStockTake(id, comment), id, () => before && setStockTakes((xs) => xs.map((s) => (s.id === id ? before : s))));
      log("Stock Takes", id, `Closed${comment ? `: ${comment}` : ""}`);
      flash(`${id} closed.`);
    },

    decideSheet(id: string, status: SheetStatus, comment: string) {
      const before = sheets.find((s) => s.id === id);
      setSheets((xs) => xs.map((s) => (s.id === id ? { ...s, status, comment: comment || s.comment } : s)));
      persist(source.decideSheet(id, status, comment), id, () => before && setSheets((xs) => xs.map((s) => (s.id === id ? before : s))));
      log("Count Sheets", id, `${status}${comment ? `: ${comment}` : ""}`);
      flash(
        status === "Approved" ? `${id} approved.` : status === "Submitted" ? `${id} recount received. Ready to approve.` : `${id} sent back to the counter.`,
      );
    },

    /** The open recount for a line: from Dataverse, or asked a moment ago. */
    /** Creates or updates a counter profile (shown at once, saved in the background). */
    saveCounterProfile(p: CounterProfile) {
      const before = allocation.profiles;
      const key = p.id ?? `new:${p.userId}`;
      setAllocation((a) => ({ ...a, profiles: [...a.profiles.filter((x) => (x.id ?? `new:${x.userId}`) !== key && x.userId !== p.userId), p] }));
      source.saveCounterProfile(p).then(
        (id) => {
          setAllocation((a) => ({ ...a, profiles: a.profiles.map((x) => (x.userId === p.userId ? { ...x, id } : x)) }));
          log("Counter profiles", p.name, `${p.active ? "Active" : "Inactive"}; home ${p.homeSite ?? "-"} ${p.homeRows.join(",")}; third parties ${p.thirdPartyOk ? "yes" : "no"}`);
          flash(`${p.name}'s profile saved.`);
        },
        (e: unknown) => {
          setAllocation((a) => ({ ...a, profiles: before }));
          flash(`Couldn't save ${p.name}'s profile. ${e instanceof Error ? e.message : ""}`.trim());
        },
      );
    },
    /** Publishes a counter allocation; returns its name, or nothing if it couldn't be saved. */
    async publishAllocation(input: { plan: Plan; present: string[]; changes: AllocationChange[] }) {
      try {
        const name = await source.publishAllocation(input);
        const run: AllocationRun = {
          id: name,
          name,
          status: "Published",
          seed: input.plan.seed,
          spreadPct: input.plan.spreadPct,
          present: input.present,
          plan: input.plan,
          changes: input.changes,
          by: me,
          at: stamp(),
        };
        setAllocation((a) => ({ ...a, runs: [run, ...a.runs.map((x) => (x.status === "Published" ? { ...x, status: "Superseded" as const } : x))] }));
        log("Allocation", name, `Published: ${input.plan.rows.length} counters, seed ${input.plan.seed}, spread ${input.plan.spreadPct}%`);
        flash(`${name} published. Each counter now sees their area in the Stock Take app.`);
        return name;
      } catch (e) {
        flash(`Couldn't publish the allocation. ${e instanceof Error ? e.message : ""}`.trim());
        return undefined;
      }
    },

    lineRecount(line: CountRow) {
      return lineRecounts[lineKeyOf(line)] ?? line.recountOpen;
    },
    /** Who a recount sent this session went to. */
    recountTo(name: string) {
      return recountTo[name];
    },
    /** Blind recount of one outturn on one stack, without sending the whole sheet back. */
    recountLine(line: CountRow, note: string) {
      const k = lineKeyOf(line);
      setLineRecounts((m) => ({ ...m, [k]: "sending" }));
      const to = recounterFor(line.site, line.stack, { id: line.byId, name: line.by });
      const who = to?.name ?? line.by;
      source.recountLine(line, note, to).then(
        (name) => {
          setLineRecounts((m) => ({ ...m, [k]: name }));
          setRecountTo((m) => ({ ...m, [name]: who }));
          log("Recounts", name, `${line.outturn} at ${line.stack}, counted by ${line.by}, recount by ${who}${to ? "" : " (no other counter fits)"}${note.trim() ? `: ${note.trim()}` : ""}`);
          flash(`${name} sent to ${who}${to ? "" : ` (no other counter fits, so back to ${line.by})`}: recount ${line.outturn} at ${line.stack}.`);
        },
        (e: unknown) => {
          setLineRecounts((m) => {
            const { [k]: _gone, ...rest } = m;
            return rest;
          });
          flash(`Couldn't send the recount. ${e instanceof Error ? e.message : ""}`.trim());
        },
      );
    },

    setCause(id: string, c: RootCause) {
      setCauses((m) => ({ ...m, [id]: c }));
    },
    decideVariance(id: string, state: Variance["state"]) {
      const v = variances.find((x) => x.id === id)!;
      setVariances((xs) => xs.map((x) => (x.id === id ? { ...x, state } : x)));
      const to = state === "recount" ? recounterFor(v.site, v.zone, { id: v.counterId, name: v.counter }) : undefined;
      persist(source.decideVariance(id, state, causes[id] ?? v.cause, to), id, () => setVariances((xs) => xs.map((x) => (x.id === id ? v : x))));
      if (state === "recount") log("Recounts", id, `Blind recount of ${v.outturn} at ${v.zone}, counted by ${v.counter}, recount by ${to?.name ?? v.counter}`);
      if (state === "exception") {
        const ex: Exception = {
            id: nextExceptionId(),
            title: `${v.outturn} at ${v.zone}: ${v.counted - v.expected > 0 ? "+" : ""}${v.counted - v.expected} units`,
            kind: causes[id] ?? v.cause,
            ref: id,
            dept: "Operations",
            owner: PEOPLE["Operations Admin"],
            raised: "Today",
            dueDays: 5,
            ageDays: 0,
            status: "Open",
            escalation: 0,
            bags: Math.abs(v.counted - v.expected),
            source: "Count",
        };
        setExceptions((xs) => [ex, ...xs]);
        persist(source.addException(ex), "the exception", () => setExceptions((xs) => xs.filter((x) => x.id !== ex.id)));
      }
      flash(
        state === "recount"
          ? to
            ? `Blind recount sent to ${to.name} (a different counter from ${v.counter}).`
            : `No other counter fits, so the blind recount went back to ${v.counter}.`
          : state === "accepted" ? "Count accepted." : "Exception raised and assigned.",
      );
    },

    /** Raises an exception from a pre-count check or elsewhere; owner is the current user until reassigned. */
    raiseException(e: Pick<Exception, "title" | "kind" | "ref" | "dept" | "bags" | "source">) {
      const ex: Exception = { ...e, id: nextExceptionId(), owner: me, raised: "Today", dueDays: 5, ageDays: 0, status: "Open", escalation: 0 };
      setExceptions((xs) => [ex, ...xs]);
      persist(source.addException(ex), "the exception", () => setExceptions((xs) => xs.filter((x) => x.id !== ex.id)));
      log("Exceptions", ex.id, `Raised: ${ex.title}`);
      flash(`${ex.id} raised for ${e.dept}.`);
    },

    updateException(id: string, patch: Partial<Exception>) {
      const before = exceptions.find((e) => e.id === id);
      setExceptions((xs) => xs.map((e) => (e.id === id ? { ...e, ...patch } : e)));
      persist(source.updateException(id, patch), id, () => before && setExceptions((xs) => xs.map((e) => (e.id === id ? before : e))));
      log("Exceptions", id, Object.entries(patch).map(([k, v]) => `${k}: ${v}`).join(", "));
    },

    requestMapping(c: Omit<MappingChange, "id" | "by" | "at" | "state">) {
      const full: MappingChange = { ...c, id: `MC-0${16 + changes.length}`, by: `${me} (${role})`, at: stamp(), state: "Pending" };
      setChanges((xs) => [full, ...xs]);
      persist(source.requestMapping(full), "the change request", () => setChanges((xs) => xs.filter((x) => x.id !== full.id)));
      flash("Change requested. It takes effect when Finance approves it.");
    },
    decideMapping(id: string, approve: boolean) {
      const c = changes.find((x) => x.id === id)!;
      setChanges((xs) => xs.map((x) => (x.id === id ? { ...x, state: approve ? "Approved" : "Rejected" } : x)));
      persist(source.decideMapping(id, approve), id, () => setChanges((xs) => xs.map((x) => (x.id === id ? c : x))));
      if (approve) {
        const code = c.what.match(/^Basket (\d+)/)?.[1];
        if (code) setBaskets((bs) => bs.map((b) => (b.code === code ? { ...b, primary: c.to as PrimaryBasket } : b)));
      }
      log("Basket mapping", c.what, `${c.from} → ${c.to} ${approve ? "approved" : "rejected"} (${id})`);
      flash(approve ? `${id} approved. Reconciliation updated.` : `${id} rejected.`);
    },

    setManualEntry(code: SiteCode, on: boolean) {
      setSites((xs) => xs.map((s) => (s.code === code ? { ...s, manualEntry: on } : s)));
      persist(source.setManualEntry(code, on), `the ${code} setting`, () =>
        setSites((xs) => xs.map((s) => (s.code === code ? { ...s, manualEntry: !on } : s))),
      );
      log("NKG_config", code, `Manual outturn entry: ${on ? "Off → On" : "On → Off"}`);
      flash(`Manual entry ${on ? "switched on" : "switched off"} at ${code}. Recorded in the audit log.`);
    },

    updateIssue(id: string, patch: Partial<Issue>) {
      const before = issues.find((i) => i.id === id);
      setIssues((xs) => xs.map((i) => (i.id === id ? { ...i, ...patch } : i)));
      persist(source.updateIssue(id, patch), id, () => before && setIssues((xs) => xs.map((i) => (i.id === id ? before : i))));
    },

    addDirectPurchase(d: DirectPurchase) {
      setDirectPurchases((xs) => [d, ...xs]);
      persist(source.addDirectPurchase(d), d.contract, () => setDirectPurchases((xs) => xs.filter((x) => x.contract !== d.contract)));
      flash(`${d.contract} added.`);
    },

    /** Resolves true once the import is saved, so the screen only shows "Imported" after it really is. */
    importXbs(upload: XbsUploadToSave, onProgress?: (done: number, total: number) => void) {
      return source
        .importXbs(upload, onProgress)
        .then((name) => {
          addImport({
            id: name,
            at: upload.snapshotAt ? new Date(upload.snapshotAt).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "Now",
            by: me,
            files: upload.files,
            rows: upload.lines.length,
            status: "Imported",
            issues: upload.warnings + upload.fails,
          });
          log("XBS imports", name, `Imported ${upload.lines.length} rows from ${upload.files.length} files`);
          flash(`${name} imported: ${upload.lines.length.toLocaleString("en-GB")} rows. ${upload.warnings ? `${upload.warnings} warnings are being raised as exceptions.` : "No warnings."}`);
          return true;
        })
        .catch((e: unknown) => {
          console.error(e);
          flash(`Couldn't import. ${e instanceof Error ? e.message : ""}`.trim());
          return false;
        });
    },

    sign(r: Role, comment: string) {
      setSignatures((s) => ({ ...s, [r]: { by: PEOPLE[r], at: stamp(), comment: comment || undefined } }));
      persist(source.addSignoff(r, "signed", comment), "your signature", () =>
        setSignatures((s) => {
          const next = { ...s };
          delete next[r];
          return next;
        }),
      );
      const i = CHAIN.findIndex((c) => c.role === r);
      const next = CHAIN[i + 1];
      log("Sign-off", "ST-2026-03", `${CHAIN[i].title} signed`);
      flash(next ? `Signed. ${next.title} has been notified in Teams.` : "Signed. The stock position is certified and the pack has been sent.");
    },
    sendBack(r: Role, comment: string) {
      const before = signatures;
      setSignatures({});
      persist(source.addSignoff(r, "sent back", comment), "the send-back", () => setSignatures(before));
      log("Sign-off", "ST-2026-03", `Sent back by ${CHAIN.find((c) => c.role === r)?.title}: ${comment}`);
      flash("Sent back to Operations. Earlier signatures are cleared.");
    },
  };
}

export type Store = ReturnType<typeof useStoreState>;
const Ctx = createContext<Store | null>(null);
export const useStore = () => useContext(Ctx)!;

type Phase = { s: "loading" } | { s: "error"; message: string } | { s: "ready"; source: DataSource; data: MgmtData };

/** Loads the data source, then provides the store. Shows a splash while loading and a retry screen on failure. */
export function StoreProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>({ s: "loading" });
  const load = useCallback(async () => {
    setPhase({ s: "loading" });
    try {
      const source = await getSource();
      const data = await source.load();
      setReference(data.reference);
      setPhase({ s: "ready", source, data });
    } catch (e) {
      console.error(e);
      setPhase({ s: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  if (phase.s === "loading") return <Splash />;
  if (phase.s === "error") return <LoadError message={phase.message} onRetry={load} />;
  return (
    <Ready source={phase.source} data={phase.data}>
      {children}
    </Ready>
  );
}

function Ready({ source, data, children }: { source: DataSource; data: MgmtData; children: ReactNode }) {
  const s = useStoreState(source, data);
  return <Ctx.Provider value={s}>{children}</Ctx.Provider>;
}
