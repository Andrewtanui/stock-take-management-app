import { useState } from "react";
import { Plus } from "lucide-react";
import { IMPORTS, chainFor, SITES, allLines, can, site } from "../data/repository";
import { lineInScope, scopeWords, shortType, type StockScope } from "../data/scope";
import { IBERO_ROWS, parseSection, sectionList, sectionsWords } from "../shared/sections";
import { useStore } from "../data/store";
import type { SiteCode, StockTakeType } from "../data/types";
import { Chip, Dialog, PageHead, ReadOnly, Tabs, n, type Tone } from "../ui/kit";

const TONE: Record<string, Tone> = { "Count in progress": "info", Reconciliation: "warn", "Sign-off": "warn", Completed: "ok" };

export default function StockTakes() {
  const store = useStore();
  const [filter, setFilter] = useState<"all" | "mine" | "open">("all");
  const [sel, setSel] = useState(store.stockTakes[0]?.id ?? "");
  const [creating, setCreating] = useState(false);
  const [closing, setClosing] = useState(false);
  const allowed = can(store.role, "Create and close stock takes");
  const list = store.stockTakes.filter((s) => (filter === "mine" ? s.createdBy === store.me : filter === "open" ? s.status !== "Completed" : true));
  const st = store.stockTakes.find((s) => s.id === sel) ?? store.stockTakes[0];
  // The selected stock take's own chain (ad hoc and 100% counts take a shorter one).
  const allSigned = !!st && chainFor(st.type).every((g) => store.signatures[g.gate]);

  return (
    <div className="page">
      <PageHead
        title="Stock takes"
        sub="Create a stock take from an XBS import, choose the warehouses, and close it once it's signed off."
        actions={
          allowed && (
            <button className="btn btn-primary" onClick={() => setCreating(true)}>
              <Plus size={18} aria-hidden /> New stock take
            </button>
          )
        }
      />
      {!allowed && <ReadOnly who="Operations Admin" />}

      <Tabs
        value={filter}
        onChange={setFilter}
        items={[
          ["all", "All stock takes", store.stockTakes.length],
          ["open", "Open", store.stockTakes.filter((s) => s.status !== "Completed").length],
          ["mine", "Created by me", store.stockTakes.filter((s) => s.createdBy === store.me).length],
        ]}
      />

      <div className="split">
        <ul className="cards">
          {list.map((s) => (
            <li key={s.id}>
              <button className="card card-btn" aria-pressed={s.id === st?.id} onClick={() => setSel(s.id)}>
                <div className="row-between">
                  <strong>{s.title}</strong>
                  <Chip tone={TONE[s.status]}>{s.status}</Chip>
                </div>
                <span className="muted small">
                  {s.type} · {s.sites.length} warehouses · created by {s.createdBy}
                </span>
                <span className="sheet-counts">
                  <Chip tone="info">{s.sheets.total} sheets</Chip>
                  <Chip tone="ok">{s.sheets.approved} approved</Chip>
                  {s.sheets.pending > 0 && <Chip tone="warn">{s.sheets.pending} waiting</Chip>}
                  {s.sheets.rejected > 0 && <Chip tone="crit">{s.sheets.rejected} sent back</Chip>}
                </span>
              </button>
            </li>
          ))}
          {!list.length && <li className="empty">No stock takes here.</li>}
        </ul>

        {!st ? (
          <section className="panel">
            <p className="empty">No stock take yet. Import the XBS reports, review the pre-count checks, then start one with New stock take.</p>
          </section>
        ) : (
        <section className="panel">
          <h2 className="h3">{st.title}</h2>
          <dl className="kv">
            <dt>Reference</dt>
            <dd className="code">{st.id}</dd>
            <dt>Type</dt>
            <dd>{st.type}</dd>
            <dt>Status</dt>
            <dd>
              <Chip tone={TONE[st.status]}>{st.status}</Chip>
            </dd>
            <dt>Count date</dt>
            <dd>{st.countDate}</dd>
            <dt>XBS import</dt>
            <dd className="code">{st.importId}</dd>
            <dt>{st.scope ? "Counts" : "Warehouses"}</dt>
            <dd>{st.scope ? scopeWords(st.scope, (c) => site(c).short) : st.sites.map((c) => site(c).short).join(", ")}</dd>
            <dt>Created by</dt>
            <dd>{st.createdBy}</dd>
          </dl>
          {st.status !== "Completed" && allowed && (
            <>
              <button className="btn" disabled={!allSigned} onClick={() => setClosing(true)}>
                Close stock take
              </button>
              {!allSigned && <p className="muted small">Closes after {chainFor(st.type).map((g) => g.gate).join(", ")} have signed.</p>}
            </>
          )}
        </section>
        )}
      </div>

      {creating && <NewStockTake onClose={() => setCreating(false)} />}
      {closing && <CloseStockTake id={st.id} onClose={() => setClosing(false)} />}
    </div>
  );
}

function NewStockTake({ onClose }: { onClose: () => void }) {
  const store = useStore();
  const [type, setType] = useState<StockTakeType>("Monthly stock take");
  const [all, setAll] = useState(true);
  const [sites, setSites] = useState<SiteCode[]>(SITES.map((s) => s.code));
  const usable = IMPORTS.filter((i) => i.status === "Imported" || i.status === "Validated");
  const [imp, setImp] = useState(usable[0]?.id ?? "");
  // The count day (month-end), not necessarily today: the stock take is dated by when the bags are counted.
  const [day, setDay] = useState(() => new Date().toISOString().slice(0, 10));
  const date = day ? day.split("-").reverse().join("/") : "";
  const title = `${shortType(type)} Stock Take - ${date}`;
  const chosen = all ? SITES.map((s) => s.code) : sites;
  // Ad hoc: chosen warehouses and, at Ibero, whole rows and/or typed sections ("D1-7, C/D").
  const adhoc = type === "Ad hoc stock take";
  const [rows, setRows] = useState<string[]>([]);
  const [more, setMore] = useState("");
  const typed = more.split(/[,;]/).map((x) => x.trim()).filter(Boolean);
  const badTokens = typed.filter((x) => !parseSection(x));
  const sections = [...new Set([...rows, ...sectionList(more)])];
  const scope: StockScope | undefined = adhoc ? { sites: chosen, sections: chosen.includes("IBR") ? sections : [] } : undefined;
  const lots = adhoc ? allLines().filter((l) => lineInScope(scope, l.wh, l.z)).length : 0;
  // The Hub works on one open stock take at a time: an ad hoc count would hide one still being signed.
  const open = store.stockTakes.find((x) => x.status !== "Completed");
  const blocked = adhoc && !!open;

  return (
    <Dialog title="New stock take" onClose={onClose}>
      <fieldset className="field">
        <legend className="field-label">Type</legend>
        <div className="seg">
          {(["Monthly stock take", "Ad hoc stock take", "100% stock take"] as StockTakeType[]).map((t) => (
            <button key={t} type="button" aria-pressed={type === t} onClick={() => setType(t)}>
              {t}
            </button>
          ))}
        </div>
        {type === "100% stock take" && (
          <p className="hint">
            December and June. Bags move from an issuing team to a receiving team; counters use grid codes (A001–G014).
          </p>
        )}
        {adhoc && (
          <p className="hint">
            Any day, to see where stock stands before month-end. Count chosen rows or warehouses; the Hub shows the differences only: no recounts, no
            exceptions, a short sign-off (Operations Lead, then Warehouse Manager), and it isn't part of the monthly KPIs.
          </p>
        )}
      </fieldset>
      <label className="field">
        <span className="field-label">Count date</span>
        <input className="input" type="date" value={day} onChange={(e) => setDay(e.target.value)} />
        <span className="hint">{adhoc ? "The day the bags are counted. Use an XBS import from the same day." : "The day the bags are counted, usually the last day of the month."}</span>
      </label>
      <label className="field">
        <span className="field-label">Expected stock (XBS import)</span>
        <select className="input" value={imp} onChange={(e) => setImp(e.target.value)}>
          {usable.map((i) => (
            <option key={i.id} value={i.id}>
              {i.id} · {i.at} · {i.rows} rows
            </option>
          ))}
        </select>
        <span className="hint">
          {usable.length ? "Only imports that passed the checks are listed. Upload a newer one in XBS import." : "No XBS import yet. Import the XBS reports first."}
        </span>
      </label>
      <fieldset className="field">
        <legend className="field-label">Warehouses</legend>
        <div className="seg">
          <button type="button" aria-pressed={all} onClick={() => setAll(true)}>
            All
          </button>
          <button type="button" aria-pressed={!all} onClick={() => setAll(false)}>
            Selected
          </button>
        </div>
        {!all && (
          <div className="checks-grid">
            {SITES.map((s) => (
              <label key={s.code} className="check-line">
                <input
                  type="checkbox"
                  checked={sites.includes(s.code)}
                  onChange={(e) => setSites((xs) => (e.target.checked ? [...xs, s.code] : xs.filter((x) => x !== s.code)))}
                />
                {s.name}
              </label>
            ))}
          </div>
        )}
      </fieldset>
      {adhoc && chosen.includes("IBR") && (
        <fieldset className="field">
          <legend className="field-label">Ibero: what to count</legend>
          <div className="checks-grid">
            {[...IBERO_ROWS].map((r) => (
              <label key={r} className="check-line">
                <input type="checkbox" checked={rows.includes(r)} onChange={(e) => setRows((xs) => (e.target.checked ? [...xs, r] : xs.filter((x) => x !== r)))} />
                Row {r}
              </label>
            ))}
          </div>
          <input className="input" value={more} onChange={(e) => setMore(e.target.value)} placeholder="More sections, e.g. D1-7, C/D" aria-label="More sections" />
          <span className="hint">
            {badTokens.length
              ? `Not a section: ${badTokens.join(", ")}. Use a row (D), a row and bays (D1-7), or between two rows (C/D).`
              : sections.length
                ? `Counts ${sectionsWords(sections)}.`
                : "Nothing ticked: the whole of Ibero is counted."}
          </span>
        </fieldset>
      )}
      {adhoc && (
        <p className="hint">
          {n(lots)} XBS lots in this scope (current XBS import). Counters are allocated to these sections only.
        </p>
      )}
      {blocked && (
        <p className="readonly">
          {open!.title} is still open ({open!.status}). Close it first: the Hub works on one open stock take at a time.
        </p>
      )}
      <p className="hint">
        Title: <strong>{title}</strong>
      </p>
      <div className="btn-row end">
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
        <button
          className="btn btn-primary"
          disabled={!chosen.length || !imp || !day || blocked || badTokens.length > 0}
          onClick={() => {
            store.createStockTake({
              id: `ST-${Date.now().toString().slice(-6)}`,
              title,
              type,
              status: "Count in progress",
              countDate: date,
              importId: imp,
              sites: chosen,
              scope,
              createdBy: store.me,
              sheets: { total: 0, approved: 0, pending: 0, rejected: 0 },
            });
            onClose();
          }}
        >
          Start stock take
        </button>
      </div>
    </Dialog>
  );
}

function CloseStockTake({ id, onClose }: { id: string; onClose: () => void }) {
  const store = useStore();
  const [c, setC] = useState("");
  return (
    <Dialog title="Close stock take" onClose={onClose}>
      <p>Counting and approvals stop, and the stock position is locked as the period-end snapshot. This can't be undone.</p>
      <label className="field">
        <span className="field-label">Comment</span>
        <textarea className="input" rows={3} value={c} onChange={(e) => setC(e.target.value)} />
      </label>
      <div className="btn-row end">
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
        <button
          className="btn btn-primary"
          onClick={() => {
            store.closeStockTake(id, c);
            onClose();
          }}
        >
          Close and lock
        </button>
      </div>
    </Dialog>
  );
}
