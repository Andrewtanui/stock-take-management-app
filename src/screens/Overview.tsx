import { ArrowRight, Check } from "lucide-react";
import { useNav, type Page } from "../App";
import { CHAIN, TARGET_PCT, TODAY, coverage, reconciliation, sum } from "../data/repository";
import { useStore } from "../data/store";
import { Chip, Progress, Stat, n, signed } from "../ui/kit";
import { Headline } from "../ui/Logo";

const STAGES = ["Set up", "Count", "Approve counts", "Reconcile", "Sign-off", "Completed"];

export default function Overview() {
  const go = useNav();
  const store = useStore();
  const st = store.stockTakes[0];
  const cov = coverage();
  const total = sum(cov, (c) => c.total);
  const done = sum(cov, (c) => c.done);
  const rec = reconciliation(store.baskets).primary;
  const xbs = sum(rec, (r) => r.xbs);
  const phys = sum(rec, (r) => r.physical);
  const net = ((phys - xbs) / xbs) * 100;
  const pendingSheets = store.sheets.filter((s) => s.status === "Submitted").length;
  const rejected = store.sheets.filter((s) => s.status === "Rejected").length;
  const openVar = store.variances.filter((v) => v.state === "open").length;
  const openEx = store.exceptions.filter((e) => e.status !== "Closed");
  const overdue = openEx.filter((e) => e.dueDays < 0).length;
  const signed_ = CHAIN.filter((c) => store.signatures[c.role]).length;
  const stage = signed_ === CHAIN.length ? 5 : st.status === "Reconciliation" ? 3 : 1;

  const items: { text: string; page: Page; n: number }[] = [
    { text: "count sheets waiting for approval", page: "approvals", n: pendingSheets },
    { text: "variances need a decision", page: "variances", n: openVar },
    { text: "exceptions past their due date", page: "exceptions", n: overdue },
    { text: "mapping changes waiting for Finance", page: "mapping", n: store.changes.filter((c) => c.state === "Pending").length },
    { text: "problem reports from counters", page: "issues", n: store.issues.filter((i) => i.status === "Open").length },
  ];
  const todo = items.filter((t) => t.n > 0);

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <Headline black={`${st.type}.`} light={`Counted ${st.countDate}.`} />
          <p className="sub">
            {st.title} · today is {TODAY.date}
          </p>
        </div>
      </header>

      <ol className="stages" aria-label="Stock take stages">
        {STAGES.map((s, i) => (
          <li key={s} className={i < stage ? "stage done" : i === stage ? "stage now" : "stage"}>
            <span className="stage-dot">{i < stage ? <Check size={14} aria-hidden /> : i + 1}</span>
            {s}
          </li>
        ))}
      </ol>

      <div className="stats">
        <Stat label="Bags counted" value={`${Math.round((done / total) * 100)}%`} note={`${n(done)} of ${n(total)}`} />
        <Stat label="Count sheets" value={`${store.sheets.filter((s) => s.status === "Approved").length} / ${store.sheets.length}`} note={`${pendingSheets} waiting · ${rejected} sent back`} />
        <Stat label="Net variance vs XBS" value={`${signed(net, 2)}%`} tone={Math.abs(net) <= TARGET_PCT ? "ok" : "crit"} note={`Target ±${TARGET_PCT}% · ${signed(phys - xbs)} bags`} />
        <Stat label="Sign-off" value={`Day ${TODAY.signOffDay} of ${TODAY.signOffTarget}`} note={`${signed_} of ${CHAIN.length} gates signed`} tone={TODAY.signOffDay <= TODAY.signOffTarget ? undefined : "crit"} />
      </div>

      <div className="grid-2">
        <section className="panel">
          <h2 className="h3">Waiting for someone</h2>
          {todo.length ? (
            <ul className="todo">
              {todo.map((t) => (
                <li key={t.page}>
                  <button className="todo-row" onClick={() => go(t.page)}>
                    <span className="todo-n">{t.n}</span>
                    <span>{t.text}</span>
                    <ArrowRight size={18} aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">Nothing waiting.</p>
          )}
        </section>

        <section className="panel">
          <div className="row-between">
            <h2 className="h3">Approval chain</h2>
            <button className="link" onClick={() => go("signoff")}>
              Open sign-off
            </button>
          </div>
          <ol className="chain">
            {CHAIN.map((c, i) => {
              const s = store.signatures[c.role];
              const isNext = !s && CHAIN.slice(0, i).every((p) => store.signatures[p.role]);
              return (
                <li key={c.role} className={s ? "chain-done" : isNext ? "chain-next" : ""}>
                  <strong>{c.title}</strong>
                  <span className="muted small">{s ? `Signed by ${s.by}, ${s.at}` : isNext ? "Next to sign" : "Waiting"}</span>
                </li>
              );
            })}
          </ol>
        </section>
      </div>

      <section className="panel">
        <div className="row-between">
          <h2 className="h3">Coverage by warehouse</h2>
          <button className="link" onClick={() => go("live")}>
            Count day detail
          </button>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Warehouse</th>
                <th className="num">XBS bags</th>
                <th className="num">Counted</th>
                <th style={{ width: "34%" }}>Progress</th>
                <th>Type</th>
              </tr>
            </thead>
            <tbody>
              {cov.map((c) => (
                <tr key={c.site.code}>
                  <td>{c.site.name}</td>
                  <td className="num">{n(c.total)}</td>
                  <td className="num">{n(c.done)}</td>
                  <td>
                    <Progress value={c.done} max={c.total} tone={c.done >= c.total ? "ok" : "info"} />
                  </td>
                  <td>{c.site.thirdParty ? <Chip>Third party</Chip> : <Chip tone="info">Own</Chip>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
