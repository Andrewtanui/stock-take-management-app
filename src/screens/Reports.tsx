import { useState } from "react";
import { Download, FileBarChart } from "lucide-react";
import { REPORTS, allLines, sum } from "../data/repository";
import { useStore } from "../data/store";
import { Dialog, PageHead, n } from "../ui/kit";

export default function Reports() {
  const store = useStore();
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="page">
      <PageHead
        title="Reports"
        sub="Standard reports for the selected stock take. Each opens on screen and exports to Excel or PDF; the full suite runs in Power BI on the same data."
      />
      <ul className="report-grid">
        {REPORTS.map((r) => (
          <li key={r.name} className="card">
            <FileBarChart size={22} aria-hidden className="ic-brand" />
            <strong>{r.name}</strong>
            <span className="muted small">{r.what}</span>
            <div className="btn-row">
              <button className="btn btn-sm" onClick={() => setOpen(r.name)}>
                Open
              </button>
              <button className="btn btn-sm" onClick={() => store.flash(`${r.name} exported to Excel.`)}>
                <Download size={14} aria-hidden /> Excel
              </button>
            </div>
          </li>
        ))}
      </ul>
      {open && <Preview name={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

/** A real cut of the XBS snapshot so the preview isn't empty. */
function Preview({ name, onClose }: { name: string; onClose: () => void }) {
  const byGrade = /grade/i.test(name);
  const key = (l: ReturnType<typeof allLines>[number]) => (byGrade ? l.i : l.wh);
  const groups = new Map<string, { bags: number; kg: number }>();
  for (const l of allLines()) {
    const g = groups.get(key(l)) ?? { bags: 0, kg: 0 };
    g.bags += l.bg;
    g.kg += l.kg;
    groups.set(key(l), g);
  }
  const rows = [...groups.entries()].sort((a, b) => b[1].bags - a[1].bags);
  return (
    <Dialog title={name} onClose={onClose}>
      <div className="table-wrap scroll-y">
        <table className="table table-tight">
          <thead>
            <tr>
              <th>{byGrade ? "Grade" : "Warehouse"}</th>
              <th className="num">Bags</th>
              <th className="num">Tonnes</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([k, v]) => (
              <tr key={k}>
                <td>{k}</td>
                <td className="num">{n(v.bags)}</td>
                <td className="num">{n(v.kg / 1000, 1)}</td>
              </tr>
            ))}
            <tr className="total">
              <td>Total</td>
              <td className="num">{n(sum(rows, (r) => r[1].bags))}</td>
              <td className="num">{n(sum(rows, (r) => r[1].kg) / 1000, 1)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="muted small">Preview from the XBS snapshot. Physical and variance columns fill in once counts are connected.</p>
    </Dialog>
  );
}
