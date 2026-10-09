import { createContext, useContext, useState } from "react";
import {
  AlertOctagon,
  BarChart3,
  ClipboardCheck,
  FileUp,
  Gauge,
  GitCompareArrows,
  LayoutDashboard,
  ListChecks,
  Menu,
  MessageSquareWarning,
  Network,
  PenLine,
  Scale,
  Settings,
  ShoppingBasket,
} from "lucide-react";
import { ROLES, TODAY } from "./data/repository";
import { PEOPLE, useStore } from "./data/store";
import type { Role } from "./data/types";
import Overview from "./screens/Overview";
import StockTakes from "./screens/StockTakes";
import Import from "./screens/Import";
import Checks from "./screens/Checks";
import LiveBoard from "./screens/LiveBoard";
import Approvals from "./screens/Approvals";
import Variances from "./screens/Variances";
import Reconciliation from "./screens/Reconciliation";
import Exceptions from "./screens/Exceptions";
import SignOff from "./screens/SignOff";
import Mapping from "./screens/Mapping";
import DirectPurchases from "./screens/DirectPurchases";
import Issues from "./screens/Issues";
import Setup from "./screens/Setup";
import Reports from "./screens/Reports";
import { Logo } from "./ui/Logo";

export type Page =
  | "overview"
  | "stocktakes"
  | "import"
  | "checks"
  | "live"
  | "approvals"
  | "variances"
  | "recon"
  | "exceptions"
  | "signoff"
  | "mapping"
  | "direct"
  | "issues"
  | "setup"
  | "reports";

const Nav = createContext<(p: Page) => void>(() => {});
export const useNav = () => useContext(Nav);

export default function App() {
  const store = useStore();
  const [page, setPage] = useState<Page>("overview");
  const [menu, setMenu] = useState(false);
  const go = (p: Page) => {
    setPage(p);
    setMenu(false);
    window.scrollTo({ top: 0 });
  };

  const pendingSheets = store.sheets.filter((s) => s.status === "Submitted").length;
  const openVar = store.variances.filter((v) => v.state === "open").length;
  const overdue = store.exceptions.filter((e) => e.status !== "Closed" && e.dueDays < 0).length;
  const pendingMaps = store.changes.filter((c) => c.state === "Pending").length;
  const openIssues = store.issues.filter((i) => i.status === "Open").length;

  const groups: { label: string; items: { id: Page; label: string; icon: typeof Gauge; badge?: number }[] }[] = [
    { label: "", items: [{ id: "overview", label: "Overview", icon: LayoutDashboard }] },
    {
      label: "Stock take",
      items: [
        { id: "stocktakes", label: "Stock takes", icon: ClipboardCheck },
        { id: "import", label: "XBS import", icon: FileUp },
        { id: "checks", label: "Pre-count checks", icon: ListChecks },
        { id: "live", label: "Count day live", icon: Gauge },
        { id: "approvals", label: "Count approval", icon: ClipboardCheck, badge: pendingSheets },
      ],
    },
    {
      label: "Reconcile",
      items: [
        { id: "variances", label: "Variances", icon: GitCompareArrows, badge: openVar },
        { id: "recon", label: "Reconciliation", icon: Scale },
        { id: "exceptions", label: "Exceptions", icon: AlertOctagon, badge: overdue },
        { id: "signoff", label: "Sign-off", icon: PenLine },
      ],
    },
    {
      label: "Master data",
      items: [
        { id: "mapping", label: "Mapping", icon: Network, badge: pendingMaps },
        { id: "direct", label: "Direct purchases", icon: ShoppingBasket },
      ],
    },
    {
      label: "Support",
      items: [
        { id: "issues", label: "Problem reports", icon: MessageSquareWarning, badge: openIssues },
        { id: "reports", label: "Reports", icon: BarChart3 },
      ],
    },
    { label: "Admin", items: [{ id: "setup", label: "Set-up & audit", icon: Settings }] },
  ];

  const screens: Record<Page, JSX.Element> = {
    overview: <Overview />,
    stocktakes: <StockTakes />,
    import: <Import />,
    checks: <Checks />,
    live: <LiveBoard />,
    approvals: <Approvals />,
    variances: <Variances />,
    recon: <Reconciliation />,
    exceptions: <Exceptions />,
    signoff: <SignOff />,
    mapping: <Mapping />,
    direct: <DirectPurchases />,
    issues: <Issues />,
    setup: <Setup />,
    reports: <Reports />,
  };

  return (
    <Nav.Provider value={go}>
      <div className="shell">
        <header className="topbar">
          <button className="icon-btn menu-btn" aria-label="Menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
            <Menu size={22} aria-hidden />
          </button>
          <Logo sub="Stock Management" />
          <label className="role">
            <span className="avatar" aria-hidden>
              {store.me.split(" ").map((x) => x[0]).join("")}
            </span>
            <span className="role-label">Viewing as</span>
            <select value={store.role} onChange={(e) => store.setRole(e.target.value as Role)}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {PEOPLE[r]} · {r}
                </option>
              ))}
            </select>
          </label>
          <div className="brand-bar topbar-bar" aria-hidden />
        </header>

        <aside className={"rail" + (menu ? " rail-open" : "")} aria-label="Main">
          <button className="rail-st" onClick={() => go("stocktakes")}>
            <span className="rail-st-label">Current stock take</span>
            <span className="rail-st-name">{store.stockTakes[0].type === "Monthly stock take" ? "Monthly" : "100%"} · {store.stockTakes[0].countDate.replace(/^\w+ /, "")}</span>
            <span className="rail-st-row">
              <span>{store.stockTakes[0].status}</span>
              <span className="rail-st-day">
                Day {TODAY.signOffDay}/{TODAY.signOffTarget}
              </span>
            </span>
            <span className="rail-st-track" aria-hidden>
              <span style={{ width: `${(TODAY.signOffDay / TODAY.signOffTarget) * 100}%` }} />
            </span>
          </button>
          <nav>
            {groups.map((g) => (
              <div key={g.label} className="nav-group">
                {g.label && <div className="nav-label">{g.label}</div>}
                {g.items.map((it) => (
                  <button key={it.id} className="nav-item" aria-current={page === it.id ? "page" : undefined} onClick={() => go(it.id)}>
                    <it.icon size={18} strokeWidth={2} aria-hidden />
                    <span>{it.label}</span>
                    {!!it.badge && <span className="badge">{it.badge}</span>}
                  </button>
                ))}
              </div>
            ))}
          </nav>
          <p className="rail-foot">
            Design preview — actions work in this tab but aren't saved. Expected stock is the real XBS snapshot of 2 Mar 2026; other
            figures are samples.
          </p>
        </aside>

        <main className="main">
          {screens[page]}
        </main>

        {store.toast && (
          <div className="toast" role="status">
            {store.toast}
          </div>
        )}
      </div>
    </Nav.Provider>
  );
}
