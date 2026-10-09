import { useState } from "react";
import { ChevronDown, UserRound } from "lucide-react";
import { checks } from "../data/repository";
import { useStore } from "../data/store";
import { Chip, Code, PageHead, n } from "../ui/kit";

const SEV = {
  high: { label: "Fix before counting", tone: "crit" },
  medium: { label: "Plan for it", tone: "warn" },
  low: { label: "Clean up", tone: "neutral" },
} as const;

export default function Checks() {
  const store = useStore();
  const list = checks();
  const [open, setOpen] = useState<string | null>(list[0].id);
  const [assigned, setAssigned] = useState<Record<string, boolean>>({});

  return (
    <div className="page">
      <PageHead
        title="Pre-count checks"
        sub="Problems found in the XBS import of 2 Mar 2026, 08:52. Each would otherwise show up as a variance on count day. Run these as soon as the import lands."
      />

      <div className="check-summary">
        {(["high", "medium"] as const).map((s) => (
          <div key={s} className={`check-sum sev-${s}`}>
            <span className="num">{list.filter((c) => c.severity === s).length}</span>
            <span>{SEV[s].label}</span>
          </div>
        ))}
      </div>

      <ul className="checks">
        {list.map((c) => {
          const isOpen = open === c.id;
          return (
            <li key={c.id} className={`check sev-${c.severity}`}>
              <button className="check-head" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : c.id)}>
                <div className="check-title">
                  <span className="h3">{c.title}</span>
                  <span className="muted">{c.detail}</span>
                </div>
                <div className="check-figures">
                  <span>
                    <span className="num big">{n(c.count)}</span> {c.count === 1 ? c.unit.replace(/s$/, "") : c.unit}
                  </span>
                  {c.bags > 0 && <span className="muted">{n(c.bags)} bags</span>}
                </div>
                <ChevronDown className="check-chev" size={20} aria-hidden />
              </button>
              {isOpen && (
                <div className="check-body">
                  <div className="row-between">
                    <span>
                      <Chip tone={SEV[c.severity].tone}>{SEV[c.severity].label}</Chip> <span className="muted small">Owner: {c.owner}</span>
                    </span>
                    <button
                      className="btn btn-sm"
                      disabled={assigned[c.id]}
                      onClick={() => {
                        setAssigned((m) => ({ ...m, [c.id]: true }));
                        store.flash(`Raised in Exceptions and sent to ${c.owner} in Teams.`);
                      }}
                    >
                      <UserRound size={16} aria-hidden /> {assigned[c.id] ? `Sent to ${c.owner}` : `Raise exception for ${c.owner}`}
                    </button>
                  </div>
                  <div className="table-wrap">
                    <table className="table table-tight">
                      <thead>
                        <tr>
                          <th>Lot</th>
                          <th>Where</th>
                          <th>Detail</th>
                          <th className="num">Bags</th>
                        </tr>
                      </thead>
                      <tbody>
                        {c.rows.slice(0, 25).map((r, i) => (
                          <tr key={i}>
                            <td>
                              <Code>{r.ref}</Code>
                            </td>
                            <td>{r.where}</td>
                            <td className="muted">{r.info}</td>
                            <td className="num">{n(r.bags)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {c.rows.length > 25 && <p className="muted small">Showing 25 of {n(c.rows.length)}.</p>}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
