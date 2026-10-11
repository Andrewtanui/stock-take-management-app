import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { PACK_TYPES, can, outturnMap } from "../data/repository";
import { useStore } from "../data/store";
import type { BasketMap, PrimaryBasket } from "../data/types";
import { Chip, Code, Dialog, PageHead, ReadOnly, Tabs, n, type Tone } from "../ui/kit";

type T = "basket" | "outturn" | "changes" | "rules";
const PRIMARY: PrimaryBasket[] = ["Plus", "FAQ", "Grinder"];
const STATE_TONE: Record<string, Tone> = { Pending: "warn", Approved: "ok", Rejected: "neutral" };

export default function Mapping() {
  const store = useStore();
  const [tab, setTab] = useState<T>("basket");
  const [edit, setEdit] = useState<BasketMap | null>(null);
  const canRequest = can(store.role, "Request mapping changes");
  const canApprove = can(store.role, "Approve mapping changes");
  const pending = store.changes.filter((c) => c.state === "Pending");

  return (
    <div className="page">
      <PageHead
        title="Mapping"
        sub="The spine that links the three systems: outturn → grade and quality code → secondary basket → primary basket. Changes take effect only after Finance approves them."
      />
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          ["basket", "Basket mapping"],
          ["outturn", "Outturn mapping"],
          ["changes", "Changes", pending.length],
          ["rules", "Packing & unit rules"],
        ]}
      />

      {tab === "basket" && (
        <>
          {!canRequest && <ReadOnly who="Trading, Finance or Operations Admin" />}
          <div className="grid-3">
            {PRIMARY.map((p) => (
              <div key={p} className="stat">
                <div className="stat-label">{p}</div>
                <div className="stat-value">{n(store.baskets.filter((b) => b.primary === p).reduce((a, b) => a + b.bags, 0))}</div>
                <div className="stat-note">{store.baskets.filter((b) => b.primary === p).length} secondary baskets · bags in XBS</div>
              </div>
            ))}
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Secondary basket (quality code)</th>
                  <th>Primary basket</th>
                  <th className="num">Bags in XBS</th>
                  <th aria-hidden />
                </tr>
              </thead>
              <tbody>
                {store.baskets.map((b) => {
                  const p = pending.find((c) => c.what.startsWith(`Basket ${b.code}`));
                  return (
                    <tr key={b.code}>
                      <td className="code">{b.code}</td>
                      <td>{b.name}</td>
                      <td>
                        <Chip tone="info">{b.primary}</Chip> {p && <Chip tone="warn">→ {p.to} pending</Chip>}
                      </td>
                      <td className="num">{n(b.bags)}</td>
                      <td>
                        {canRequest && !p && (
                          <button className="link small" onClick={() => setEdit(b)}>
                            Request change
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === "outturn" && <OutturnTab />}

      {tab === "changes" && (
        <>
          {!canApprove && <ReadOnly who="Finance" />}
          <ul className="cards">
            {store.changes.map((c) => {
              const own = c.by.startsWith(store.me);
              return (
                <li key={c.id} className="card">
                  <div className="row-between">
                    <strong>
                      <span className="code">{c.id}</span> · {c.what}
                    </strong>
                    <Chip tone={STATE_TONE[c.state]}>{c.state}</Chip>
                  </div>
                  <p>
                    <span className="muted">{c.from}</span> → <strong>{c.to}</strong>
                  </p>
                  <p className="muted small">
                    {c.reason} · requested by {c.by}, {c.at}
                  </p>
                  {c.state === "Pending" && canApprove && (
                    <div className="btn-row">
                      <button className="btn btn-primary btn-sm" disabled={own} onClick={() => store.decideMapping(c.id, true)}>
                        Approve
                      </button>
                      <button className="btn btn-sm" disabled={own} onClick={() => store.decideMapping(c.id, false)}>
                        Reject
                      </button>
                      {own && <span className="muted small">You requested this, so someone else must approve it.</span>}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}

      {tab === "rules" && (
        <section className="panel">
          <p>
            One settings table used by the counter app, this app and the XBS upload checks, so all three calculate weight the same
            way.
          </p>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Packing type</th>
                  <th className="num">Full bag</th>
                  <th>Used for</th>
                </tr>
              </thead>
              <tbody>
                {PACK_TYPES.map((p) => (
                  <tr key={p.id}>
                    <td>{p.label}</td>
                    <td className="num">{p.kg} kg</td>
                    <td>{p.grades}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <dl className="kv">
            <dt>Units</dt>
            <dd>Full bags + 1 if there's a pocket</dd>
            <dt>Weight</dt>
            <dd>Full bags × pack kg + pocket kg</dd>
            <dt>60 kg equivalents</dt>
            <dd>Weight ÷ 60</dd>
            <dt>Pocket rule</dt>
            <dd>At most one pocket per outturn at a location (each place of a split lot has its own); any weight above 0 kg</dd>
            <dt>Match tolerance</dt>
            <dd>0 units and ±0.05 kg</dd>
          </dl>
        </section>
      )}

      {edit && (
        <ChangeDialog
          b={edit}
          onClose={() => setEdit(null)}
          onSave={(to, reason) => {
            store.requestMapping({ what: `Basket ${edit.code} ${edit.name}`, from: edit.primary, to, reason });
            setEdit(null);
          }}
        />
      )}
    </div>
  );
}

function OutturnTab() {
  const store = useStore();
  const [q, setQ] = useState("");
  const [unmapped, setUnmapped] = useState(false);
  const base = useMemo(outturnMap, []);
  // Approved outturn changes override what XBS uploaded.
  const fixed = new Map(
    store.changes.filter((c) => c.state === "Approved" && c.what.startsWith("Outturn ")).map((c) => [c.what.slice(8), c.to]),
  );
  const all = base.map((r) => {
    const to = fixed.get(r.outturn);
    return to ? { ...r, basket: to.split(" ")[0], basketName: to.split(" ").slice(1).join(" ") } : r;
  });
  const t = q.trim().toUpperCase();
  const rows = all.filter((r) => (!unmapped || !r.basket) && (!t || r.outturn.includes(t) || r.grade.includes(t)));
  return (
    <>
      <div className="toolbar">
        <label className="search">
          <Search size={18} aria-hidden />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Outturn or grade" aria-label="Search outturns" />
        </label>
        <label className="check-line">
          <input type="checkbox" checked={unmapped} onChange={(e) => setUnmapped(e.target.checked)} /> Only outturns with no basket (
          {all.filter((r) => !r.basket).length})
        </label>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Outturn</th>
              <th>Grade</th>
              <th>Secondary basket</th>
              <th>Warehouses</th>
              <th className="num">Bags</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 60).map((r) => (
              <tr key={r.outturn}>
                <td>
                  <Code>{r.outturn}</Code>
                </td>
                <td>{r.grade}</td>
                <td>{r.basket ? `${r.basket} ${r.basketName}` : <Chip tone="crit">No basket</Chip>}</td>
                <td className="muted">{[...r.sites].join(", ")}</td>
                <td className="num">{n(r.bags)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small">
        {rows.length > 60 ? `Showing 60 of ${n(rows.length)}. ` : ""}Set at purchase from the auction catalogue; fixed here only through
        an approved change.
      </p>
    </>
  );
}

function ChangeDialog({ b, onClose, onSave }: { b: BasketMap; onClose: () => void; onSave: (to: PrimaryBasket, reason: string) => void }) {
  const [to, setTo] = useState<PrimaryBasket>(PRIMARY.find((p) => p !== b.primary)!);
  const [reason, setReason] = useState("");
  return (
    <Dialog title={`Change ${b.code} ${b.name}`} onClose={onClose}>
      <p>
        Now mapped to <strong>{b.primary}</strong>. {n(b.bags)} bags in XBS move with it.
      </p>
      <label className="field">
        <span className="field-label">New primary basket</span>
        <select className="input" value={to} onChange={(e) => setTo(e.target.value as PrimaryBasket)}>
          {PRIMARY.filter((p) => p !== b.primary).map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
      </label>
      <label className="field">
        <span className="field-label">Reason</span>
        <textarea className="input" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      <div className="btn-row end">
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
        <button className="btn btn-primary" disabled={!reason.trim()} onClick={() => onSave(to, reason.trim())}>
          Send for approval
        </button>
      </div>
    </Dialog>
  );
}
