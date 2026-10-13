import { useEffect, type ReactNode } from "react";
import { Lock, X } from "lucide-react";

export const n = (x: number, d = 0) =>
  x.toLocaleString("en-GB", { minimumFractionDigits: d, maximumFractionDigits: d });

/** Signed number with a real minus sign: +12, −3, 0. */
export const signed = (x: number, d = 0) => (x > 0 ? "+" : x < 0 ? "−" : "") + n(Math.abs(x), d);

export function PageHead({ title, sub, actions }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="page-head">
      <div className="page-head-text">
        <h1 className="h1">{title}</h1>
        {sub && <p className="sub">{sub}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

export type Tone = "ok" | "warn" | "crit" | "info" | "neutral";
export function Chip({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`chip chip-${tone}`}>{children}</span>;
}

export function Progress({ value, max, tone = "ok", marker }: { value: number; max: number; tone?: Tone; marker?: number }) {
  const pct = max ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="progress" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <div className={`progress-fill fill-${tone}`} style={{ width: pct + "%" }} />
      {marker !== undefined && max > 0 && <div className="progress-marker" style={{ left: Math.min(100, (marker / max) * 100) + "%" }} />}
    </div>
  );
}

export function Code({ children }: { children: ReactNode }) {
  return <span className="code">{children}</span>;
}

export function Stat({ label, value, note, tone }: { label: string; value: ReactNode; note?: ReactNode; tone?: Tone }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className={"stat-value" + (tone ? ` t-${tone}` : "")}>{value}</div>
      {note && <div className="stat-note">{note}</div>}
    </div>
  );
}

/** Difference cell: red for short, orange for over, plain for zero. */
export function Diff({ value, d = 0 }: { value: number; d?: number }) {
  const v = Math.abs(value) < 0.5 * 10 ** -d ? 0 : value; // rounding noise shows as 0, not −0.0
  return <span className={"diff " + (v < 0 ? "diff-short" : v > 0 ? "diff-over" : "")}>{signed(v, d)}</span>;
}

export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: [T, string, number?][] }) {
  return (
    <div className="tabs" role="tablist">
      {items.map(([k, label, count]) => (
        <button key={k} role="tab" aria-selected={value === k} onClick={() => onChange(k)}>
          {label}
          {count !== undefined && <span className="tab-count">{count}</span>}
        </button>
      ))}
    </div>
  );
}

/** Shown where the current role may look but not change. */
export function ReadOnly({ who }: { who: string }) {
  return (
    <p className="readonly">
      <Lock size={16} aria-hidden /> View only. {who} can change this.
    </p>
  );
}

export function Dialog({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className={"dialog" + (wide ? " dialog-wide" : "")} role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="dialog-head">
          <h2 className="h3">{title}</h2>
          <button className="icon-btn" aria-label="Close" onClick={onClose}>
            <X size={20} aria-hidden />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
