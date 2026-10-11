import { useMemo, useState } from "react";
import { Download, FileBarChart } from "lucide-react";
import { exportReport } from "../data/excel";
import { REPORTS, type Col, type ReportInput, type ReportOut, type Row } from "../data/reports";
import { useStore } from "../data/store";
import { Dialog, PageHead, n } from "../ui/kit";

export default function Reports() {
  const store = useStore();
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const stockTake = store.stockTakes[0]?.title ?? "Stock take";
  const input: ReportInput = {
    counts: store.counts,
    stacks: store.stacks,
    exceptions: store.exceptions,
    issues: store.issues,
    variances: store.variances,
    signatures: store.signatures,
    stockTake,
  };

  const download = async (id: string) => {
    const r = REPORTS.find((x) => x.id === id)!;
    setBusy(id);
    try {
      await exportReport(r.name, stockTake, r.build(input));
      store.flash(`${r.name} downloaded as Excel.`);
    } catch (e) {
      store.flash(`Couldn't create the Excel file: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="page">
      <PageHead
        title="Reports"
        sub={`Standard reports for ${stockTake}, built from the live counts and XBS. Each opens on screen and downloads as Excel; Power BI runs the full suite on the same data.`}
      />
      <ul className="report-grid">
        {REPORTS.map((r) => (
          <li key={r.id} className="card">
            <FileBarChart size={22} aria-hidden className="ic-brand" />
            <strong>{r.name}</strong>
            <span className="muted small">{r.what}</span>
            <div className="btn-row">
              <button className="btn btn-sm" onClick={() => setOpen(r.id)}>
                Open
              </button>
              <button className="btn btn-sm" disabled={busy === r.id} onClick={() => download(r.id)}>
                <Download size={14} aria-hidden /> {busy === r.id ? "Preparing…" : "Excel"}
              </button>
            </div>
          </li>
        ))}
      </ul>
      {open && <Preview id={open} input={input} onClose={() => setOpen(null)} onDownload={() => download(open)} busy={busy === open} />}
    </div>
  );
}

function Preview({ id, input, onClose, onDownload, busy }: { id: string; input: ReportInput; onClose: () => void; onDownload: () => void; busy: boolean }) {
  const report = REPORTS.find((r) => r.id === id)!;
  const out: ReportOut = useMemo(() => report.build(input), [report]);
  return (
    <Dialog title={report.name} onClose={onClose} wide>
      {out.note && <p className="muted small">{out.note}</p>}
      {out.tables.map((t, i) => (
        <section key={i} className="report-table">
          {t.title && <h3 className="h3">{t.title}</h3>}
          {t.rows.length ? (
            <div className="table-wrap scroll-y">
              <table className="table table-tight">
                <thead>
                  <tr>
                    {t.columns.map((c) => (
                      <th key={c.key} className={c.kind && c.kind !== "text" ? "num" : undefined}>
                        {c.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {t.rows.slice(0, 500).map((r, j) => (
                    <tr key={j}>
                      {t.columns.map((c) => (
                        <Cell key={c.key} col={c} row={r} />
                      ))}
                    </tr>
                  ))}
                  {t.total && (
                    <tr className="total">
                      {t.columns.map((c) => (
                        <Cell key={c.key} col={c} row={t.total!} />
                      ))}
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="empty">Nothing to show yet.</p>
          )}
          {t.rows.length > 500 && <p className="muted small">Showing the first 500 of {n(t.rows.length)} rows; the Excel file has them all.</p>}
        </section>
      ))}
      <div className="btn-row">
        <button className="btn btn-primary btn-sm" disabled={busy} onClick={onDownload}>
          <Download size={14} aria-hidden /> {busy ? "Preparing…" : "Download Excel"}
        </button>
      </div>
    </Dialog>
  );
}

function Cell({ col, row }: { col: Col; row: Row }) {
  const numeric = !!col.kind && col.kind !== "text";
  let v = row[col.key];
  if (v === undefined || v === "") return <td className={numeric ? "num" : undefined}>{numeric ? "—" : ""}</td>;
  if (typeof v !== "number" || !numeric) return <td>{String(v)}</td>;
  if (Math.abs(v) < 0.05 && col.kind !== "pct") v = 0; // rounding noise, not "-0.0"
  const text = col.kind === "pct" ? `${(v * 100).toLocaleString("en-GB", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%` : n(v, col.kind === "num1" ? 1 : 0);
  return <td className={"num" + (col.key === "diff" && v < -0.05 ? " t-crit" : "")}>{text}</td>;
}
