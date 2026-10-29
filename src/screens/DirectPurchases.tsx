import { useState } from "react";
import { Plus } from "lucide-react";
import { allLines, sum } from "../data/repository";
import type { DirectPurchase } from "../data/types";
import { useStore } from "../data/store";
import { Chip, Code, Dialog, PageHead, Stat, Tabs, n } from "../ui/kit";
import DirectLotsList from "./DirectLotsList";

function flags(d: DirectPurchase) {
  const f: { label: string; tone: "crit" | "warn" | "info" }[] = [];
  if (d.bagsInvoiced > d.bagsDelivered)
    f.push({
      label: `${d.bagsInvoiced - d.bagsDelivered} invoiced, not delivered`,
      tone: "crit",
    });
  if (d.bagsContracted > Math.max(d.bagsInvoiced, d.bagsDelivered))
    f.push({
      label: `Long: ${d.bagsContracted - Math.max(d.bagsInvoiced, d.bagsDelivered)} not delivered`,
      tone: "warn",
    });
  if (d.bagsDelivered > 0 && !d.warrant)
    f.push({ label: "No warrant", tone: "warn" });
  if (
    d.bagsDelivered > 0 &&
    d.outturn &&
    !allLines().some((l) => l.o === d.outturn)
  )
    f.push({ label: "Delivered, not in XBS", tone: "info" });
  return f;
}

export default function DirectPurchases() {
  const store = useStore();
  const rows = store.directPurchases;
  const [tab, setTab] = useState<"flagged" | "all">("flagged");
  // Trading's list loaded on the XBS import page is the main view; contracts typed here are the other.
  const [view, setView] = useState<"list" | "typed">(
    store.directLots ? "list" : "typed",
  );
  const [adding, setAdding] = useState(false);
  const shown = rows.filter((d) => tab === "all" || flags(d).length);
  const notDelivered = sum(rows, (d) =>
    Math.max(0, d.bagsInvoiced - d.bagsDelivered),
  );
  const longs = sum(rows, (d) =>
    Math.max(0, d.bagsContracted - Math.max(d.bagsInvoiced, d.bagsDelivered)),
  );

  return (
    <div className="page">
      <PageHead
        title="Direct purchases"
        sub="Coffee bought direct from co-operatives and agents, alongside auction purchases. Track it from contract to delivery so invoiced-but-not-delivered coffee and longs don't surface only at month end."
        actions={
          view === "typed" && (
            <button className="btn btn-primary" onClick={() => setAdding(true)}>
              <Plus size={18} aria-hidden /> Add a purchase
            </button>
          )
        }
      />

      <Tabs
        value={view}
        onChange={setView}
        items={[
          [
            "list",
            "Trading's list",
            store.directLots
              ? new Set(store.directLots.lots.map((l) => l.contract)).size
              : 0,
          ],
          ["typed", "Added by hand", rows.length],
        ]}
      />

      {view === "list" ? (
        store.directLots ? (
          <DirectLotsList />
        ) : (
          <section className="panel">
            <p className="muted">
              Trading's direct purchase list isn't loaded for this stock take
              yet. Load it on the XBS import page (Direct purchases); its
              contracts and outturns then show here.
            </p>
          </section>
        )
      ) : (
        <>
          <div className="stats">
            <Stat label="Contracts" value={rows.length} />
            <Stat
              label="Invoiced, not delivered"
              value={`${n(notDelivered)} bags`}
              tone={notDelivered ? "crit" : "ok"}
              note="Paid for but not in the warehouse"
            />
            <Stat
              label="Longs not delivered"
              value={`${n(longs)} bags`}
              tone={longs ? "warn" : "ok"}
              note="Contracted, not yet delivered"
            />
            <Stat
              label="Delivered"
              value={`${n(sum(rows, (d) => d.bagsDelivered))} bags`}
            />
          </div>

          <Tabs
            value={tab}
            onChange={setTab}
            items={[
              [
                "flagged",
                "Needs attention",
                rows.filter((d) => flags(d).length).length,
              ],
              ["all", "All", rows.length],
            ]}
          />

          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Contract</th>
                  <th>Supplier</th>
                  <th>Outturn · warrant</th>
                  <th>Grade</th>
                  <th className="num">Contracted</th>
                  <th className="num">Invoiced</th>
                  <th className="num">Delivered</th>
                  <th>Flags</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((d) => (
                  <tr key={d.contract}>
                    <td className="code">{d.contract}</td>
                    <td>
                      {d.supplier}
                      <div className="muted small">{d.kind}</div>
                    </td>
                    <td>
                      {d.outturn ? (
                        <Code>{d.outturn}</Code>
                      ) : (
                        <span className="muted">Not yet</span>
                      )}
                      <div className="muted small">
                        {d.warrant ?? "No warrant"}
                      </div>
                    </td>
                    <td>{d.grade}</td>
                    <td className="num">{n(d.bagsContracted)}</td>
                    <td className="num">
                      {n(d.bagsInvoiced)}
                      <div className="muted small">{d.invoiceDate}</div>
                    </td>
                    <td className="num">{n(d.bagsDelivered)}</td>
                    <td>
                      <div className="chips">
                        {flags(d).map((f) => (
                          <Chip key={f.label} tone={f.tone}>
                            {f.label}
                          </Chip>
                        ))}
                        {!flags(d).length && <Chip tone="ok">Complete</Chip>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {adding && (
        <AddDialog
          onClose={() => setAdding(false)}
          onSave={(d) => {
            store.addDirectPurchase(d);
            setAdding(false);
          }}
        />
      )}
    </div>
  );
}

function AddDialog({
  onClose,
  onSave,
}: {
  onClose: () => void;
  onSave: (d: DirectPurchase) => void;
}) {
  const [d, setD] = useState<DirectPurchase>({
    contract: "",
    supplier: "",
    kind: "Co-operative",
    grade: "AB",
    bagsContracted: 0,
    bagsInvoiced: 0,
    bagsDelivered: 0,
    invoiceDate: "—",
  });
  const set = (p: Partial<DirectPurchase>) => setD((x) => ({ ...x, ...p }));
  const num = (v: string) => Math.max(0, parseInt(v || "0", 10) || 0);
  return (
    <Dialog title="Add a direct purchase" onClose={onClose}>
      <div className="form-grid">
        <label className="field">
          <span className="field-label">Contract no.</span>
          <input
            className="input"
            value={d.contract}
            onChange={(e) => set({ contract: e.target.value.toUpperCase() })}
            placeholder="DP-0240"
          />
        </label>
        <label className="field">
          <span className="field-label">Supplier</span>
          <input
            className="input"
            value={d.supplier}
            onChange={(e) => set({ supplier: e.target.value })}
          />
        </label>
        <label className="field">
          <span className="field-label">Supplier type</span>
          <select
            className="input"
            value={d.kind}
            onChange={(e) =>
              set({ kind: e.target.value as DirectPurchase["kind"] })
            }
          >
            <option>Co-operative</option>
            <option>Agent</option>
          </select>
        </label>
        <label className="field">
          <span className="field-label">Grade</span>
          <input
            className="input"
            value={d.grade}
            onChange={(e) => set({ grade: e.target.value.toUpperCase() })}
          />
        </label>
        <label className="field">
          <span className="field-label">Outturn (when known)</span>
          <input
            className="input"
            value={d.outturn ?? ""}
            onChange={(e) =>
              set({ outturn: e.target.value.toUpperCase() || undefined })
            }
          />
        </label>
        <label className="field">
          <span className="field-label">Warrant (when issued)</span>
          <input
            className="input"
            value={d.warrant ?? ""}
            onChange={(e) =>
              set({ warrant: e.target.value.toUpperCase() || undefined })
            }
          />
        </label>
        <label className="field">
          <span className="field-label">Bags contracted</span>
          <input
            className="input"
            inputMode="numeric"
            value={d.bagsContracted}
            onChange={(e) => set({ bagsContracted: num(e.target.value) })}
          />
        </label>
        <label className="field">
          <span className="field-label">Bags invoiced</span>
          <input
            className="input"
            inputMode="numeric"
            value={d.bagsInvoiced}
            onChange={(e) => set({ bagsInvoiced: num(e.target.value) })}
          />
        </label>
        <label className="field">
          <span className="field-label">Bags delivered</span>
          <input
            className="input"
            inputMode="numeric"
            value={d.bagsDelivered}
            onChange={(e) => set({ bagsDelivered: num(e.target.value) })}
          />
        </label>
      </div>
      <div className="btn-row end">
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
        <button
          className="btn btn-primary"
          disabled={!d.contract || !d.supplier || !d.bagsContracted}
          onClick={() => onSave(d)}
        >
          Save
        </button>
      </div>
    </Dialog>
  );
}
