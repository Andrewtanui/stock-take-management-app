import { Fragment, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { DirectLot } from "../data/direct-parse";
import { allLines } from "../data/repository";
import { useStore } from "../data/store";
import { Chip, Code, Stat, n, type Tone } from "../ui/kit";

const kgOf = (l: DirectLot) => l.receivedKg || l.warrantKg || l.kg;
const day = (iso?: string) =>
  iso
    ? new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      })
    : "-";
const kg = (x: number) => n(Math.round(x * 10) / 10, 1);

interface Contract {
  contract: string;
  date?: string;
  grower: string;
  lots: DirectLot[];
  outturns: string[];
  kgBought: number;
  kgWarrant: number;
  kgReceived: number;
  notInXbs: string[];
  /** First purchase invoice on this contract in the 537 (document type 11). */
  invoiced?: string;
}

/**
 * Trading's direct purchase list as loaded for the stock take: one row per contract, its outturns
 * underneath, with what the warehouse (XBS) and Finance (537) show for it.
 */
export default function DirectLotsList() {
  const store = useStore();
  const loaded = store.directLots!;
  const cutOff = store.kpiCountDate;
  const [open, setOpen] = useState<string | null>(null);
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  const inXbs = new Set(allLines().map((l) => l.o.toUpperCase()));
  const invoiced = new Map<string, string>();
  for (const l of store.contractJournal?.lines ?? [])
    if (
      l.docType === 11 &&
      l.purchaseContract &&
      l.voucherDate &&
      (!invoiced.get(l.purchaseContract) ||
        l.voucherDate < invoiced.get(l.purchaseContract)!)
    )
      invoiced.set(l.purchaseContract, l.voucherDate);

  const byContract = new Map<string, DirectLot[]>();
  for (const l of loaded.lots)
    byContract.set(l.contract || "-", [
      ...(byContract.get(l.contract || "-") ?? []),
      l,
    ]);
  const contracts: Contract[] = [...byContract].map(([contract, lots]) => {
    const outturns = [...new Set(lots.map((l) => l.outturn))];
    const date = lots.find((l) => l.contractDate)?.contractDate;
    const boughtByCount =
      !cutOff || (lots[0].receivedOn ?? date ?? "") <= cutOff;
    return {
      contract,
      date,
      grower: [...new Set(lots.map((l) => l.grower).filter(Boolean))]
        .slice(0, 2)
        .join(", "),
      lots,
      outturns,
      kgBought: lots.reduce((s, l) => s + l.kg, 0),
      kgWarrant: lots.reduce((s, l) => s + l.warrantKg, 0),
      kgReceived: lots.reduce((s, l) => s + l.receivedKg, 0),
      notInXbs: boughtByCount ? outturns.filter((o) => !inXbs.has(o)) : [],
      invoiced: contract
        .split("/")
        .map((c) => invoiced.get(c))
        .filter(Boolean)
        .sort()[0],
    };
  });
  contracts.sort(
    (a, b) =>
      (a.date ?? "").localeCompare(b.date ?? "") ||
      a.contract.localeCompare(b.contract),
  );

  const flags = (c: Contract) => {
    const f: { label: string; tone: Tone }[] = [];
    if (c.notInXbs.length)
      f.push({
        label: `${c.notInXbs.length} outturn${c.notInXbs.length === 1 ? "" : "s"} not in XBS`,
        tone: "warn",
      });
    if (!c.kgWarrant) f.push({ label: "No warrant yet", tone: "info" });
    else if (c.kgReceived && c.kgReceived < c.kgWarrant - 1)
      f.push({
        label: `Received ${kg(c.kgWarrant - c.kgReceived)} kg under warrant`,
        tone: "warn",
      });
    if (
      cutOff &&
      c.date &&
      c.date <= cutOff &&
      !(c.invoiced && c.invoiced <= cutOff)
    )
      f.push({
        label: c.invoiced
          ? `Invoiced after the count (${day(c.invoiced)})`
          : store.contractJournal
            ? "Not invoiced in the 537"
            : "537 not loaded",
        tone: "neutral",
      });
    return f;
  };
  const shown = contracts.filter(
    (c) => !onlyFlagged || flags(c).some((f) => f.tone === "warn"),
  );
  const total = (f: (l: DirectLot) => number) =>
    loaded.lots.reduce((s, l) => s + f(l), 0);

  return (
    <>
      <p className="muted small">
        From {loaded.file}, loaded {loaded.at}
        {loaded.by ? ` by ${loaded.by}` : ""} for this stock take (XBS import
        page). Weights in kg; 60 kg bags are kg ÷ 60.
      </p>
      <div className="stats">
        <Stat
          label="Contracts"
          value={contracts.length}
          note={`${n(new Set(loaded.lots.map((l) => l.outturn)).size)} outturns · ${n(loaded.lots.length)} lots`}
        />
        <Stat
          label="Bought"
          value={`${n(Math.round(total((l) => l.kg) / 60))} bags`}
          note={`${kg(total((l) => l.kg))} kg`}
        />
        <Stat
          label="Received"
          value={`${n(Math.round(total(kgOf) / 60))} bags`}
          note="Received weight, else warrant weight"
        />
        <Stat
          label="Not in XBS"
          value={n(contracts.reduce((s, c) => s + c.notInXbs.length, 0))}
          tone={contracts.some((c) => c.notInXbs.length) ? "warn" : "ok"}
          note={
            cutOff
              ? `Outturns bought by ${day(cutOff)} with no XBS line`
              : "Outturns with no XBS line"
          }
        />
      </div>
      <label className="check-line">
        <input
          type="checkbox"
          checked={onlyFlagged}
          onChange={(e) => setOnlyFlagged(e.target.checked)}
        />{" "}
        Only contracts that need attention
      </label>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Contract</th>
              <th>Grower</th>
              <th className="num">Outturns</th>
              <th className="num">Kg bought</th>
              <th className="num">Warrant kg</th>
              <th className="num">Received kg</th>
              <th>Flags</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((c) => {
              const isOpen = open === c.contract;
              const fs = flags(c);
              return (
                <Fragment key={c.contract}>
                  <tr>
                    <td>
                      <button
                        className="link"
                        aria-expanded={isOpen}
                        onClick={() => setOpen(isOpen ? null : c.contract)}
                      >
                        {isOpen ? (
                          <ChevronDown size={16} aria-hidden />
                        ) : (
                          <ChevronRight size={16} aria-hidden />
                        )}{" "}
                        <span className="code">{c.contract}</span>
                      </button>
                      <div className="muted small">{day(c.date)}</div>
                    </td>
                    <td>{c.grower || "-"}</td>
                    <td className="num">
                      {n(c.outturns.length)}
                      <div className="muted small">{n(c.lots.length)} lots</div>
                    </td>
                    <td className="num">{kg(c.kgBought)}</td>
                    <td className="num">
                      {c.kgWarrant ? kg(c.kgWarrant) : "-"}
                    </td>
                    <td className="num">
                      {c.kgReceived ? kg(c.kgReceived) : "-"}
                    </td>
                    <td>
                      <div className="chips">
                        {fs.map((f) => (
                          <Chip key={f.label} tone={f.tone}>
                            {f.label}
                          </Chip>
                        ))}
                        {!fs.length && <Chip tone="ok">Complete</Chip>}
                      </div>
                    </td>
                  </tr>
                  {isOpen && (
                    <tr>
                      <td colSpan={7}>
                        <div className="table-wrap">
                          <table className="table">
                            <thead>
                              <tr>
                                <th>Outturn</th>
                                <th>Grade</th>
                                <th className="num">Bags + pocket</th>
                                <th className="num">Kg</th>
                                <th>Warrant</th>
                                <th className="num">Warrant kg</th>
                                <th className="num">Received kg</th>
                                <th>Baskets</th>
                                <th>Warehouse</th>
                                <th>XBS</th>
                              </tr>
                            </thead>
                            <tbody>
                              {c.lots.map((l) => (
                                <tr key={l.row}>
                                  <td>
                                    <Code>{l.outturn}</Code>
                                    {l.grower && (
                                      <div className="muted small">
                                        {l.grower}
                                      </div>
                                    )}
                                  </td>
                                  <td>{l.grade}</td>
                                  <td className="num">
                                    {n(l.bags)}
                                    {l.pocketKg
                                      ? ` + ${kg(l.pocketKg)} kg`
                                      : ""}
                                  </td>
                                  <td className="num">{kg(l.kg)}</td>
                                  <td>
                                    {l.warrant || (
                                      <span className="muted">-</span>
                                    )}
                                  </td>
                                  <td className="num">
                                    {l.warrantKg ? kg(l.warrantKg) : "-"}
                                  </td>
                                  <td className="num">
                                    {l.receivedKg ? kg(l.receivedKg) : "-"}
                                  </td>
                                  <td>
                                    {l.primary || "-"}
                                    {l.secondary && (
                                      <div className="muted small">
                                        {l.secondary}
                                      </div>
                                    )}
                                  </td>
                                  <td>
                                    {l.warehouse || (
                                      <span className="muted">Not given</span>
                                    )}
                                  </td>
                                  <td>
                                    {inXbs.has(l.outturn) ? (
                                      <Chip tone="ok">In XBS</Chip>
                                    ) : (
                                      <Chip tone="warn">Not in XBS</Chip>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
