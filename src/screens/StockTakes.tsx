import { useState } from "react";
import { Plus } from "lucide-react";
import { CHAIN, IMPORTS, SITES, can, site } from "../data/repository";
import { useStore } from "../data/store";
import type { SiteCode, StockTakeType } from "../data/types";
import { Chip, Dialog, PageHead, ReadOnly, Tabs, type Tone } from "../ui/kit";

const TONE: Record<string, Tone> = { "Count in progress": "info", Reconciliation: "warn", "Sign-off": "warn", Completed: "ok" };

export default function StockTakes() {
  const store = useStore();
  const [filter, setFilter] = useState<"all" | "mine" | "open">("all");
  const [sel, setSel] = useState(store.stockTakes[0].id);
  const [creating, setCreating] = useState(false);
  const [closing, setClosing] = useState(false);
  const allowed = can(store.role, "Create and close stock takes");
  const list = store.stockTakes.filter((s) => (filter === "mine" ? s.createdBy === store.me : filter === "open" ? s.status !== "Completed" : true));
  const st = store.stockTakes.find((s) => s.id === sel) ?? store.stockTakes[0];
  const allSigned = CHAIN.every((c) => store.signatures[c.role]);

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
              <button className="card card-btn" aria-pressed={s.id === st.id} onClick={() => setSel(s.id)}>
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
            <dt>Warehouses</dt>
            <dd>{st.sites.map((c) => site(c).short).join(", ")}</dd>
            <dt>Created by</dt>
            <dd>{st.createdBy}</dd>
          </dl>
          {st.status !== "Completed" && allowed && (
            <>
              <button className="btn" disabled={!allSigned} onClick={() => setClosing(true)}>
                Close stock take
              </button>
              {!allSigned && <p className="muted small">Closes after all four sign-off gates have signed.</p>}
            </>
          )}
        </section>
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
  const [imp, setImp] = useState(usable[0].id);
  const date = new Date().toLocaleDateString("en-GB");
  const title = `${type === "Monthly stock take" ? "Monthly" : "100%"} Stock Take - ${date}`;
  const chosen = all ? SITES.map((s) => s.code) : sites;

  return (
    <Dialog title="New stock take" onClose={onClose}>
      <fieldset className="field">
        <legend className="field-label">Type</legend>
        <div className="seg">
          {(["Monthly stock take", "100% stock take"] as StockTakeType[]).map((t) => (
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
      </fieldset>
      <label className="field">
        <span className="field-label">Expected stock (XBS import)</span>
        <select className="input" value={imp} onChange={(e) => setImp(e.target.value)}>
          {usable.map((i) => (
            <option key={i.id} value={i.id}>
              {i.id} · {i.at} · {i.rows} rows
            </option>
          ))}
        </select>
        <span className="hint">Only imports that passed the checks are listed. Upload a newer one in XBS import.</span>
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
      <p className="hint">
        Title: <strong>{title}</strong>
      </p>
      <div className="btn-row end">
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
        <button
          className="btn btn-primary"
          disabled={!chosen.length}
          onClick={() => {
            store.createStockTake({
              id: `ST-${Date.now().toString().slice(-6)}`,
              title,
              type,
              status: "Count in progress",
              countDate: date,
              importId: imp,
              sites: chosen,
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
