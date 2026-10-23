import { useMemo, useState } from "react";
import { ArrowLeftRight, RotateCcw, Send, Shuffle, TriangleAlert } from "lucide-react";
import { allocate, buildAreas, ruleBreaks, type AllocCounter, type Area, type Plan } from "../data/allocate";
import { SITES, allLines, can } from "../data/repository";
import { useStore } from "../data/store";
import type { AllocationChange, CounterProfile, CountRow, SiteCode } from "../data/types";
import { zoneInSection } from "../shared/sections";
import { Chip, PageHead, ReadOnly, Stat, Tabs, n } from "../ui/kit";

const now = () => new Date().toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" });
const siteName = (c: SiteCode) => SITES.find((s) => s.code === c)?.short ?? c;
const RULE_TEXT = { homeArea: "No home rows", rotation: "Rotation", thirdPartyClearance: "Third parties: cleared counters only" } as const;

export default function Allocate() {
  const store = useStore();
  const [tab, setTab] = useState<"allocate" | "profiles">("allocate");
  const { profiles } = store.allocation;
  return (
    <div className="page">
      <PageHead
        title="Allocate counters"
        sub="Counters are given their rows and sites at random, balanced by the bags XBS expects, so nobody knows in advance what they'll count or counts their own stock. Preview, adjust, then publish; every allocation is kept for audit."
      />
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          ["allocate", "Allocate"],
          ["profiles", "Counter profiles", profiles.length],
        ]}
      />
      {tab === "profiles" ? (
        <ProfilesTab />
      ) : store.setup ? (
        <p className="empty">Start the stock take first (Stock takes › New stock take); counters are allocated on it. Counter profiles can be set up now.</p>
      ) : (
        <AllocateTab />
      )}
    </div>
  );
}

/* ---------- allocate ---------- */

function AllocateTab() {
  const store = useStore();
  const allowed = can(store.role, "Allocate counters");
  const { profiles, runs, rules, lastAreas } = store.allocation;
  const st = store.stockTakes.find((s) => s.status !== "Completed");
  const published = runs.find((r) => r.status === "Published");
  const active = profiles.filter((p) => p.active);
  const [present, setPresent] = useState<Set<string>>(() => new Set(published?.present.length ? published.present : active.map((p) => p.userId)));
  const [plan, setPlan] = useState<Plan | null>(null);
  const [mode, setMode] = useState<"new" | "rebalance">("new");
  const [changes, setChanges] = useState<AllocationChange[]>([]);
  const [pick, setPick] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const thirdParty = useMemo(() => new Set(SITES.filter((s) => s.thirdParty).map((s) => s.code)), []);
  const lines = useMemo(() => allLines().map((l) => ({ wh: l.wh, z: l.z, bg: l.bg })), []);
  const counterOf = (p: CounterProfile, closed = false): AllocCounter => ({
    id: p.userId,
    name: p.name,
    homeRows: p.homeRows,
    homeSite: p.homeSite,
    thirdPartyOk: p.thirdPartyOk,
    lastAreas: lastAreas[p.userId],
    closed,
  });

  /**
   * A fresh random plan. If counting has already started, every area with counts
   * stays with whoever counted most of it (at a third-party site, one team place
   * per person who counted there); someone not here today keeps theirs and gets
   * nothing new. Everything else is shared out at random.
   */
  const generate = () => {
    const counters = active.filter((p) => present.has(p.userId)).map((p) => counterOf(p));
    const idOf = (c: CountRow) => c.byId ?? profiles.find((p) => p.name === c.by)?.userId ?? store.allocation.people.find((p) => p.name === c.by)?.id;
    const fixed: { counterId: string; area: Area }[] = [];
    const rest: Area[] = [];
    const placed = new Map<SiteCode, Set<string>>();
    for (const a of buildAreas(lines, counters.length, thirdParty, siteName)) {
      const tally = new Map<string, number>();
      for (const c of store.counts) {
        if (a.site === "IBR" ? c.site !== "IBR" || !zoneInSection(c.stack, a.section) : c.site !== a.site) continue;
        const id = idOf(c);
        if (id) tally.set(id, (tally.get(id) ?? 0) + 1);
      }
      const taken = placed.get(a.site) ?? new Set<string>();
      const who = [...tally.entries()].filter(([id]) => !taken.has(id)).sort((x, y) => y[1] - x[1])[0]?.[0];
      if (!who) {
        rest.push(a);
        continue;
      }
      fixed.push({ counterId: who, area: a });
      if (a.site !== "IBR") placed.set(a.site, taken.add(who));
    }
    const nameOf = (id: string) => profiles.find((p) => p.userId === id)?.name ?? store.allocation.people.find((p) => p.id === id)?.name ?? "Counter";
    const gone = [...new Set(fixed.map((f) => f.counterId))].filter((id) => !present.has(id)).map((id) => ({ id, name: nameOf(id), closed: true }) as AllocCounter);
    const next = fixed.length
      ? allocate({ lines, counters: [...counters, ...gone], rules, thirdParty, siteName, areas: rest, fixed })
      : allocate({ lines, counters, rules, thirdParty, siteName });
    if (fixed.length) next.warnings = [`${fixed.length} area(s) already counted stay with whoever counted them.`, ...next.warnings];
    setPlan(next);
    setMode("new");
    setChanges(fixed.length ? [{ at: now(), by: store.me, what: `Counting has started: ${fixed.length} counted area(s) kept with their counters, ${rest.length} shared out at random` }] : []);
    setPick([]);
  };

  /** Keeps counted areas with whoever has them; shares out the rest among those present. */
  const rebalance = () => {
    if (!published) return;
    const counted = (row: Plan["rows"][number], a: Area) =>
      a.site === "IBR" ? store.counts.some((c) => c.site === "IBR" && zoneInSection(c.stack, a.section)) : store.counts.some((c) => c.site === a.site && c.by === row.name);
    const fixed: { counterId: string; area: Area }[] = [];
    const rest: Area[] = [];
    for (const row of published.plan.rows) for (const a of row.areas) (counted(row, a) ? fixed.push({ counterId: row.counterId, area: a }) : rest.push(a));
    const presentCounters = active.filter((p) => present.has(p.userId)).map((p) => counterOf(p));
    // Counters who left keep what they counted but get nothing new.
    const gone = published.plan.rows
      .filter((r) => !present.has(r.counterId) && fixed.some((f) => f.counterId === r.counterId))
      .map((r) => ({ id: r.counterId, name: r.name, closed: true }) as AllocCounter);
    setPlan(allocate({ lines, counters: [...presentCounters, ...gone], rules, thirdParty, siteName, areas: rest, fixed }));
    setMode("rebalance");
    setChanges([{ at: now(), by: store.me, what: `Rebalanced ${published.name}: ${fixed.length} counted area(s) kept, ${rest.length} shared out again` }]);
    setPick([]);
  };

  const swap = () => {
    if (!plan || pick.length !== 2) return;
    const [a, b] = pick.map((id) => plan.rows.find((r) => r.counterId === id)!);
    const rows = plan.rows.map((r) => (r === a ? { ...r, areas: b.areas, bags: b.bags } : r === b ? { ...r, areas: a.areas, bags: a.bags } : r));
    // A swap is the supervisor's call, so it's allowed - but any rule it breaks is shown and logged.
    const prof = (id: string) => profiles.find((p) => p.userId === id);
    const breaks = [
      ...(prof(a.counterId) ? ruleBreaks(counterOf(prof(a.counterId)!), b.areas, rules, thirdParty) : []),
      ...(prof(b.counterId) ? ruleBreaks(counterOf(prof(b.counterId)!), a.areas, rules, thirdParty) : []),
    ];
    setPlan({ ...plan, rows, warnings: [...plan.warnings, ...breaks.map((x) => `Override: ${x}.`)] });
    setChanges((c) => [...c, { at: now(), by: store.me, what: `Swapped ${a.name} and ${b.name}${breaks.length ? ` (overrides: ${breaks.join("; ")})` : ""}` }]);
    setPick([]);
  };

  const publish = async () => {
    if (!plan) return;
    setBusy(true);
    const name = await store.publishAllocation({ plan, present: [...present], changes });
    setBusy(false);
    if (name) setPlan(null);
  };

  if (!st) return <p className="empty">There's no stock take in progress. Create one under Stock takes first.</p>;
  const shown = plan ?? published?.plan ?? null;
  const max = Math.max(1, ...(shown?.rows.map((r) => r.bags) ?? [1]));
  const presentCount = active.filter((p) => present.has(p.userId)).length;

  return (
    <>
      {!allowed && <ReadOnly who="Operations Admin" />}
      <div className="stats">
        <Stat label="Stock take" value={st.title.replace(/^Monthly Stock Take - /, "")} note={st.type} />
        <Stat label="Counters present" value={`${presentCount} of ${active.length}`} note="Active counter profiles" />
        <Stat label="Expected bags" value={n(lines.reduce((s, l) => s + l.bg, 0))} note="From the stock take's XBS import" />
        <Stat
          label="Current allocation"
          value={published ? published.name : "None yet"}
          note={published ? `Published ${published.at ?? ""}${published.by ? ` by ${published.by}` : ""}` : "Counters keep their old rows until one is published"}
        />
      </div>

      <section className="panel">
        <div className="row-between">
          <h2 className="h3">1. Who's here today</h2>
          <span className="rule-chips">
            {(Object.keys(RULE_TEXT) as (keyof typeof RULE_TEXT)[]).map((k) => (
              <Chip key={k} tone={rules[k] ? "ok" : "neutral"}>
                {RULE_TEXT[k]}: {rules[k] ? "on" : "off"}
              </Chip>
            ))}
          </span>
        </div>
        {!active.length ? (
          <p className="muted">No counter profiles yet. Add the people who count under Counter profiles.</p>
        ) : (
          <ul className="present-list">
            {active.map((p) => (
              <li key={p.userId}>
                <label className="check-line">
                  <input
                    type="checkbox"
                    disabled={!allowed}
                    checked={present.has(p.userId)}
                    onChange={(e) =>
                      setPresent((s) => {
                        const x = new Set(s);
                        if (e.target.checked) x.add(p.userId);
                        else x.delete(p.userId);
                        return x;
                      })
                    }
                  />
                  <span>
                    <strong>{p.name}</strong>
                    <span className="muted small">
                      {" "}
                      · home {p.homeSite ? siteName(p.homeSite) : "—"}
                      {p.homeRows.length ? ` rows ${p.homeRows.join(", ")}` : ""}
                      {p.thirdPartyOk ? " · third parties" : ""}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
        {allowed && (
          <div className="btn-row">
            <button className="btn btn-primary" disabled={!presentCount} onClick={generate}>
              <Shuffle size={18} aria-hidden /> {plan && mode === "new" ? "Reshuffle" : "Generate allocation"}
            </button>
            {published && (
              <button className="btn" disabled={!presentCount} onClick={rebalance}>
                <RotateCcw size={18} aria-hidden /> Rebalance what's not counted yet
              </button>
            )}
          </div>
        )}
      </section>

      {shown && (
        <section className="panel">
          <div className="row-between">
            <h2 className="h3">{plan ? (mode === "rebalance" ? "2. Rebalanced plan (not published yet)" : "2. Preview (not published yet)") : `Published plan · ${published!.name}`}</h2>
            <span>
              <Chip tone={shown.spreadPct <= 35 ? "ok" : "warn"}>Workload spread {shown.spreadPct}%</Chip> <Chip tone="neutral">Seed {shown.seed}</Chip>
            </span>
          </div>
          {shown.warnings.length > 0 && (
            <div className="callout callout-warn">
              <TriangleAlert size={16} aria-hidden />
              <ul className="plain">
                {shown.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  {plan && allowed && <th aria-label="Pick to swap" />}
                  <th>Counter</th>
                  <th>Areas</th>
                  <th className="num">Bags</th>
                  <th>Load</th>
                </tr>
              </thead>
              <tbody>
                {shown.rows.map((r) => (
                  <tr key={r.counterId}>
                    {plan && allowed && (
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`Pick ${r.name} to swap`}
                          checked={pick.includes(r.counterId)}
                          onChange={(e) => setPick((p) => (e.target.checked ? [...p, r.counterId].slice(-2) : p.filter((x) => x !== r.counterId)))}
                        />
                      </td>
                    )}
                    <td>
                      <strong>{r.name}</strong>
                      {plan && !present.has(r.counterId) && <span className="muted small"> · left, keeps what they counted</span>}
                    </td>
                    <td>
                      <span className="area-chips">
                        {r.areas.length ? r.areas.map((a) => <Chip key={a.key} tone={a.site === "IBR" ? "info" : "warn"}>{a.label}</Chip>) : <span className="muted">Nothing</span>}
                      </span>
                    </td>
                    <td className="num">{n(r.bags)}</td>
                    <td>
                      <span className="bar-track load-bar">
                        <span className="bar-fill" style={{ width: `${(r.bags / max) * 100}%` }} />
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {plan && allowed && (
            <>
              {changes.length > 0 && (
                <ul className="plain muted small">
                  {changes.map((c, i) => (
                    <li key={i}>
                      {c.at} · {c.by}: {c.what}
                    </li>
                  ))}
                </ul>
              )}
              <div className="btn-row">
                <button className="btn" disabled={pick.length !== 2} onClick={swap}>
                  <ArrowLeftRight size={18} aria-hidden /> Swap the two ticked counters
                </button>
                <button className="btn btn-primary" disabled={busy || plan.unassigned.length > 0} onClick={publish}>
                  <Send size={18} aria-hidden /> {busy ? "Publishing…" : "Publish to the counters"}
                </button>
                <button className="btn" onClick={() => setPlan(null)}>
                  Discard
                </button>
              </div>
              <p className="hint">
                Publishing replaces {published ? published.name : "the current assignments"}: each counter sees their areas in the Stock Take app straight away. Counted work is never
                moved.
              </p>
            </>
          )}
          {!plan && published && published.changes.length > 0 && (
            <ul className="plain muted small">
              {published.changes.map((c, i) => (
                <li key={i}>
                  {c.at} · {c.by}: {c.what}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {runs.length > 1 && (
        <section className="block">
          <h2 className="h3">Earlier allocations on this stock take</h2>
          <ul className="plain muted small">
            {runs
              .filter((r) => r.status !== "Published")
              .map((r) => (
                <li key={r.id}>
                  {r.name} · {r.status} · {r.at ?? ""} {r.by ? `· ${r.by}` : ""} · {r.plan.rows.length} counters · spread {r.spreadPct}%
                </li>
              ))}
          </ul>
        </section>
      )}
    </>
  );
}

/* ---------- counter profiles ---------- */

const BLANK = (userId = "", name = ""): CounterProfile => ({ userId, name, homeSite: "IBR", homeRows: [], thirdPartyOk: false, active: true });

function ProfilesTab() {
  const store = useStore();
  const allowed = can(store.role, "Counter profiles");
  const { profiles, people } = store.allocation;
  const [edit, setEdit] = useState<CounterProfile | null>(null);
  const [rows, setRows] = useState("");
  const free = people.filter((p) => !profiles.some((x) => x.userId === p.id));
  const open = (p: CounterProfile) => {
    setEdit(p);
    setRows(p.homeRows.join(", "));
  };
  const save = () => {
    if (!edit?.userId) return;
    store.saveCounterProfile({ ...edit, homeRows: rows.toUpperCase().split(/[,\s]+/).filter((r) => /^[A-G]$/.test(r)) });
    setEdit(null);
  };

  return (
    <>
      {!allowed && <ReadOnly who="Operations Admin or IT Admin" />}
      <p className="muted">
        Who counts, and where they normally work. Home rows and home warehouse are never allocated to that person. Only counters cleared for third parties are sent to
        third-party sites.
      </p>
      {allowed && !edit && (
        <div className="btn-row">
          <button className="btn btn-primary" disabled={!free.length} onClick={() => open(BLANK())}>
            Add a counter
          </button>
        </div>
      )}
      {edit && (
        <section className="panel">
          <h2 className="h3">{edit.id ? `Edit ${edit.name}` : "Add a counter"}</h2>
          <div className="form-grid">
            {!edit.id && (
              <label className="field">
                <span className="field-label">Person</span>
                <select
                  className="input"
                  value={edit.userId}
                  onChange={(e) => setEdit({ ...edit, userId: e.target.value, name: people.find((p) => p.id === e.target.value)?.name ?? "" })}
                >
                  <option value="">Choose…</option>
                  {free.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="field">
              <span className="field-label">Home warehouse</span>
              <select className="input" value={edit.homeSite ?? ""} onChange={(e) => setEdit({ ...edit, homeSite: (e.target.value || undefined) as SiteCode | undefined })}>
                <option value="">None</option>
                {SITES.map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.short}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field-label">Home rows (Ibero)</span>
              <input className="input" value={rows} onChange={(e) => setRows(e.target.value)} placeholder="e.g. D, E" />
            </label>
            <label className="check-line">
              <input type="checkbox" checked={edit.thirdPartyOk} onChange={(e) => setEdit({ ...edit, thirdPartyOk: e.target.checked })} /> Cleared for third-party sites
            </label>
            <label className="check-line">
              <input type="checkbox" checked={edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} /> Active counter
            </label>
          </div>
          <div className="btn-row">
            <button className="btn btn-primary" disabled={!edit.userId} onClick={save}>
              Save
            </button>
            <button className="btn" onClick={() => setEdit(null)}>
              Cancel
            </button>
          </div>
        </section>
      )}
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Counter</th>
              <th>Home warehouse</th>
              <th>Home rows</th>
              <th>Third parties</th>
              <th>Status</th>
              {allowed && <th aria-label="Edit" />}
            </tr>
          </thead>
          <tbody>
            {[...profiles]
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((p) => (
                <tr key={p.userId}>
                  <td>{p.name}</td>
                  <td>{p.homeSite ? siteName(p.homeSite) : "—"}</td>
                  <td>{p.homeRows.join(", ") || "—"}</td>
                  <td>{p.thirdPartyOk ? "Cleared" : "No"}</td>
                  <td>{p.active ? <Chip tone="ok">Active</Chip> : <Chip tone="neutral">Inactive</Chip>}</td>
                  {allowed && (
                    <td>
                      <button className="link" onClick={() => open(p)}>
                        Edit
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            {!profiles.length && (
              <tr>
                <td colSpan={6} className="muted">
                  No counter profiles yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
