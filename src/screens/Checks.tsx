import { useState } from "react";
import { ChevronDown, UserRound } from "lucide-react";
import { IMPORTS, SITES, allLines, checks } from "../data/repository";
import { contractStates, partLotChecks } from "../data/part-lots";
import { CALL_OFF_DEFAULT, TP_AGEING_DEFAULT, thirdPartyAgeing } from "../data/third-party-ageing";
import { SUBPRODUCT_AGE_DEFAULT, subProductChecks } from "../data/subproducts";
import { useStore } from "../data/store";
import type { Dept } from "../data/types";
import { Chip, Code, PageHead, n } from "../ui/kit";

/** What kind of exception each pre-count check raises. */
const CHECK_KIND: Record<string, string> = {
  stuffed: "Unposted gate-out",
  cancelled: "Cancelled contract",
  shipped: "Unposted gate-out",
  ceiling: "Third party",
  aged: "Third party",
  split: "Split lot",
  "latest-sale": "Partial delivery: rest still at third party",
  "ds-arriving": "Posting timing / late posting",
  "being-stuffed": "Unposted gate-out",
  nearing: "Third party",
  "franchise-gains": "Sub-products",
  "franchise-bulked": "Sub-products",
  "ex-office": "Sub-products",
};
const DEPTS: Dept[] = ["Operations", "Warehouse", "Trading", "Finance", "Logistics", "Quality"];

const SEV = {
  high: { label: "Fix before counting", tone: "crit" },
  medium: { label: "Plan for it", tone: "warn" },
  low: { label: "Clean up", tone: "neutral" },
} as const;

export default function Checks() {
  const store = useStore();
  // The checks run on the active stock take's XBS import; name it and its snapshot time.
  const st = store.stockTake;
  // With a shipment tracker loaded, the contract checks use it as at the count date; then the part lots.
  const tracker = store.shipments?.lines;
  const cutOff = store.kpiCountDate ?? new Date().toISOString().slice(0, 10);
  const states = tracker?.length ? contractStates(tracker, cutOff, store.xbsStuffing?.rows) : undefined;
  const ageing = thirdPartyAgeing(allLines(), SITES, store.thirdPartyAgeingDays ?? TP_AGEING_DEFAULT, store.thirdPartyCallOffDays ?? CALL_OFF_DEFAULT);
  const order = { high: 0, medium: 1, low: 2 };
  // Sub-product registers: what has waited too long to be bulked or sold (only once they are loaded).
  const subChecks = store.subProducts?.rows.length ? subProductChecks(store.subProducts.rows, cutOff, store.subProductAgeDays ?? SUBPRODUCT_AGE_DEFAULT) : [];
  const list = [...checks(states, ageing.callOff), ...partLotChecks(allLines(), SITES, states?.open), ageing.check, ...subChecks].sort((a, b) => order[a.severity] - order[b.severity]);
  const imp = IMPORTS.find((i) => i.id === st?.importId) ?? IMPORTS.find((i) => i.status === "Imported");
  const [open, setOpen] = useState<string | null>(list[0].id);
  const [assigned, setAssigned] = useState<Record<string, boolean>>({});

  return (
    <div className="page">
      <PageHead
        title="Pre-count checks"
        sub={`Problems found in ${imp ? `the XBS import of ${imp.at} (${imp.id})` : "the latest XBS import"}. Each would otherwise show up as a variance on count day. Run these as soon as the import lands.`}
      />

      <div className="check-summary">
        {(["high", "medium"] as const).map((s) => (
          <div key={s} className={`check-sum sev-${s}`}>
            <span className="num">{list.filter((c) => c.severity === s).length}</span>
            <span>{SEV[s].label}</span>
          </div>
        ))}
      </div>

      {ageing.rows.length > 0 && (
        <section className="panel">
          <div className="row-between">
            <h2 className="h3">Third-party stock by age</h2>
            <span className="muted small">60 kg bags · days in stock on the XBS snapshot</span>
          </div>
          <div className="table-wrap">
            <table className="table table-tight">
              <thead>
                <tr>
                  <th>Warehouse</th>
                  {ageing.labels.map((b) => (
                    <th key={b} className="num">
                      {b}
                    </th>
                  ))}
                  <th className="num">Total</th>
                  <th className="num">Over {ageing.callOff} days</th>
                </tr>
              </thead>
              <tbody>
                {ageing.rows.map((r) => (
                  <tr key={r.site}>
                    <td>{r.name}</td>
                    {r.bags.map((b, i) => (
                      <td key={i} className="num" title={`${r.lots[i]} lot${r.lots[i] === 1 ? "" : "s"}`}>
                        {b ? n(Math.round(b)) : <span className="muted">—</span>}
                      </td>
                    ))}
                    <td className="num">{n(Math.round(r.total))}</td>
                    <td className="num">{r.over ? <strong>{n(Math.round(r.over))}</strong> : <span className="muted">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted small">
            Call-off rule {ageing.callOff} days (setting ThirdPartyAgeDays) and buckets (ThirdPartyAgeingDays) until Trade and Logistics agree them (D6). Lots
            within a week of the rule are listed below to call off in time.
          </p>
        </section>
      )}

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
                        store.raiseException({
                          title: `${c.title}: ${n(c.count)} ${c.count === 1 ? c.unit.replace(/s$/, "") : c.unit}`,
                          kind: CHECK_KIND[c.id] ?? "Not yet known",
                          ref: "Pre-count check",
                          dept: (DEPTS.includes(c.owner as Dept) ? c.owner : "Operations") as Dept,
                          bags: c.bags,
                          source: "Pre-count check",
                        });
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
