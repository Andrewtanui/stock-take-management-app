// In-memory state for the demo so actions on one screen show on the others
// (approve a sheet, close a variance, sign a gate). In the real app each setter
// is a write to the matching SharePoint list, and Power Automate sends the
// notifications and escalations.

import { createContext, useContext, useState, type ReactNode } from "react";
import {
  AUDIT,
  CHAIN,
  EXCEPTIONS,
  ISSUES,
  MAPPING_CHANGES,
  SHEETS,
  SITES,
  STOCK_TAKES,
  VARIANCES,
  basketMap,
} from "./repository";
import type { AuditEntry, BasketMap, MappingChange, PrimaryBasket, Role, RootCause, SheetStatus, Site, SiteCode, StockTake, Variance } from "./types";

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

export interface Signature {
  by: string;
  at: string;
  comment?: string;
}

function stamp() {
  const d = new Date();
  return `Today, ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function useStoreState() {
  const [role, setRoleState] = useState<Role>("Operations Admin");
  const [toast, setToast] = useState<string | null>(null);
  const [stockTakes, setStockTakes] = useState<StockTake[]>(STOCK_TAKES);
  const [sheets, setSheets] = useState(SHEETS);
  const [variances, setVariances] = useState(VARIANCES);
  const [causes, setCauses] = useState<Record<string, RootCause>>({});
  const [exceptions, setExceptions] = useState(EXCEPTIONS);
  const [changes, setChanges] = useState<MappingChange[]>(MAPPING_CHANGES);
  const [baskets, setBaskets] = useState<BasketMap[]>(basketMap);
  const [sites, setSites] = useState<Site[]>(SITES);
  const [audit, setAudit] = useState<AuditEntry[]>(AUDIT);
  const [issues, setIssues] = useState(ISSUES);
  const [signatures, setSignatures] = useState<Partial<Record<Role, Signature>>>({});

  const me = PEOPLE[role];
  const flash = (m: string) => {
    setToast(m);
    window.setTimeout(() => setToast((t) => (t === m ? null : t)), 2800);
  };
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
    flash,

    setRole(r: Role) {
      setRoleState(r);
      flash(`Viewing as ${PEOPLE[r]}, ${r}.`);
    },

    createStockTake(st: StockTake) {
      setStockTakes((xs) => [st, ...xs]);
      log("Stock Takes", st.id, `Created; ${st.type}; ${st.sites.length} warehouses`);
      flash(`${st.title} created. Counters can start.`);
    },
    closeStockTake(id: string, comment: string) {
      setStockTakes((xs) => xs.map((s) => (s.id === id ? { ...s, status: "Completed" } : s)));
      log("Stock Takes", id, `Closed${comment ? `: ${comment}` : ""}`);
      flash(`${id} closed.`);
    },

    decideSheet(id: string, status: SheetStatus, comment: string) {
      setSheets((xs) => xs.map((s) => (s.id === id ? { ...s, status, comment: comment || s.comment } : s)));
      log("Count Sheets", id, `${status}${comment ? `: ${comment}` : ""}`);
      flash(
        status === "Approved" ? `${id} approved.` : status === "Submitted" ? `${id} recount received. Ready to approve.` : `${id} sent back to the counter.`,
      );
    },

    setCause(id: string, c: RootCause) {
      setCauses((m) => ({ ...m, [id]: c }));
    },
    decideVariance(id: string, state: Variance["state"]) {
      setVariances((xs) => xs.map((v) => (v.id === id ? { ...v, state } : v)));
      if (state === "exception") {
        const v = variances.find((x) => x.id === id)!;
        setExceptions((xs) => [
          {
            id: `EX-${210 + xs.length}`,
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
          },
          ...xs,
        ]);
      }
      flash(
        state === "recount" ? "Blind recount sent to the counter's phone." : state === "accepted" ? "Count accepted." : "Exception raised and assigned.",
      );
    },

    updateException(id: string, patch: Partial<(typeof EXCEPTIONS)[number]>) {
      setExceptions((xs) => xs.map((e) => (e.id === id ? { ...e, ...patch } : e)));
      log("Exceptions", id, Object.entries(patch).map(([k, v]) => `${k}: ${v}`).join(", "));
    },

    requestMapping(c: Omit<MappingChange, "id" | "by" | "at" | "state">) {
      setChanges((xs) => [{ ...c, id: `MC-0${16 + xs.length}`, by: `${me} (${role})`, at: stamp(), state: "Pending" }, ...xs]);
      flash("Change requested. It takes effect when Finance approves it.");
    },
    decideMapping(id: string, approve: boolean) {
      const c = changes.find((x) => x.id === id)!;
      setChanges((xs) => xs.map((x) => (x.id === id ? { ...x, state: approve ? "Approved" : "Rejected" } : x)));
      if (approve) {
        const code = c.what.match(/^Basket (\d+)/)?.[1];
        if (code) setBaskets((bs) => bs.map((b) => (b.code === code ? { ...b, primary: c.to as PrimaryBasket } : b)));
      }
      log("Basket mapping", c.what, `${c.from} → ${c.to} ${approve ? "approved" : "rejected"} (${id})`);
      flash(approve ? `${id} approved. Reconciliation updated.` : `${id} rejected.`);
    },

    setManualEntry(code: SiteCode, on: boolean) {
      setSites((xs) => xs.map((s) => (s.code === code ? { ...s, manualEntry: on } : s)));
      log("NKG_config", code, `Manual outturn entry: ${on ? "Off → On" : "On → Off"}`);
      flash(`Manual entry ${on ? "switched on" : "switched off"} at ${code}. Recorded in the audit log.`);
    },

    updateIssue(id: string, patch: Partial<(typeof ISSUES)[number]>) {
      setIssues((xs) => xs.map((i) => (i.id === id ? { ...i, ...patch } : i)));
    },

    sign(r: Role, comment: string) {
      setSignatures((s) => ({ ...s, [r]: { by: PEOPLE[r], at: stamp(), comment: comment || undefined } }));
      const i = CHAIN.findIndex((c) => c.role === r);
      const next = CHAIN[i + 1];
      log("Sign-off", "ST-2026-03", `${CHAIN[i].title} signed`);
      flash(next ? `Signed. ${next.title} has been notified in Teams.` : "Signed. The stock position is certified and the pack has been sent.");
    },
    sendBack(r: Role, comment: string) {
      setSignatures({});
      log("Sign-off", "ST-2026-03", `Sent back by ${CHAIN.find((c) => c.role === r)?.title}: ${comment}`);
      flash("Sent back to Operations. Earlier signatures are cleared.");
    },
  };
}

export type Store = ReturnType<typeof useStoreState>;
const Ctx = createContext<Store | null>(null);
export const useStore = () => useContext(Ctx)!;
export function StoreProvider({ children }: { children: ReactNode }) {
  const s = useStoreState();
  return <Ctx.Provider value={s}>{children}</Ctx.Provider>;
}
