import { useState } from "react";
import { History, RotateCcw } from "lucide-react";
import { GRADES, PERMISSIONS, ROLES, STOCK_TAKE_GROUPS, USERS, can } from "../data/repository";
import { useStore } from "../data/store";
import { Chip, PageHead, ReadOnly, Tabs } from "../ui/kit";

type T = "warehouses" | "locations" | "groups" | "grades" | "users" | "audit";

export default function Setup() {
  const store = useStore();
  const [tab, setTab] = useState<T>("warehouses");
  const canConfig = can(store.role, "Warehouses, locations, grades, settings");
  const canUsers = can(store.role, "User roles");

  return (
    <div className="page">
      <PageHead title="Set-up & audit" sub="The NKG_config settings both apps read. Every change is recorded with who made it and when, and can be restored." />
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          ["warehouses", "Warehouses"],
          ["locations", "Locations & zones"],
          ["groups", "Stock take groups"],
          ["grades", "Grades"],
          ["users", "Users & roles"],
          ["audit", "Audit log", store.audit.length],
        ]}
      />

      {tab === "warehouses" && (
        <>
          {!canConfig && <ReadOnly who="IT Admin or Operations Admin" />}
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Warehouse</th>
                  <th>Code</th>
                  <th>Type</th>
                  <th>Stack locations</th>
                  <th>Manual outturn entry</th>
                </tr>
              </thead>
              <tbody>
                {store.sites.map((s) => (
                  <tr key={s.code}>
                    <td>{s.name}</td>
                    <td className="code">{s.code}</td>
                    <td>{s.thirdParty ? <Chip>Third party</Chip> : <Chip tone="info">Own</Chip>}</td>
                    <td className="muted">{s.thirdParty ? "Recorded by counters on the day" : "From XBS (rows A–G, bays 1–14)"}</td>
                    <td>
                      <label className="switch">
                        <input type="checkbox" checked={s.manualEntry} disabled={!canConfig} onChange={(e) => store.setManualEntry(s.code, e.target.checked)} />
                        <span>{s.manualEntry ? "On" : "Off"}</span>
                      </label>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="hint">Third-party sites keep manual entry off so counters can only pick NKG lots from the XBS list.</p>
        </>
      )}

      {tab === "locations" && (
        <section className="panel">
          {!canConfig && <ReadOnly who="IT Admin or Operations Admin" />}
          <h2 className="h3">Ibero Export Warehouse</h2>
          <dl className="kv">
            <dt>Rows</dt>
            <dd>A–G</dd>
            <dt>Bays</dt>
            <dd>1–14</dd>
            <dt>Levels</dt>
            <dd>From XBS, e.g. D-05-1 = row D, bay 5, level 1</dd>
          </dl>
          <h3 className="field-label">Location formats</h3>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Used on</th>
                  <th>Format</th>
                  <th>Example for row D, bay 5</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Monthly count sheets</td>
                  <td>Row letter + bay number</td>
                  <td className="code">D-05</td>
                </tr>
                <tr>
                  <td>100% count grid</td>
                  <td>Row letter + 3-digit bay</td>
                  <td className="code">D005</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="hint">The counter app reads either format and translates, so a change of format doesn't hide assigned outturns.</p>
        </section>
      )}

      {tab === "groups" && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Group</th>
                <th>Warehouse</th>
                <th>Locations</th>
                <th className="num">Counters</th>
              </tr>
            </thead>
            <tbody>
              {STOCK_TAKE_GROUPS.map((g) => (
                <tr key={g.name}>
                  <td>{g.name}</td>
                  <td>{g.site}</td>
                  <td className="muted">{g.locations}</td>
                  <td className="num">{g.counters}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "grades" && (
        <section className="panel">
          <p className="muted">Grades found in XBS. Light grades use the 50 kg packing type.</p>
          <div className="chips">
            {GRADES.map((g) => (
              <Chip key={g} tone={/LIGHT/.test(g) ? "warn" : "neutral"}>
                {g}
                {/LIGHT/.test(g) ? " · 50 kg" : ""}
              </Chip>
            ))}
          </div>
        </section>
      )}

      {tab === "users" && (
        <>
          {!canUsers && <ReadOnly who="IT Admin" />}
          <section className="panel">
            <h2 className="h3">Who can change what</h2>
            <div className="table-wrap">
              <table className="table table-tight matrix">
                <thead>
                  <tr>
                    <th>Action</th>
                    {ROLES.map((r) => (
                      <th key={r}>{r}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {PERMISSIONS.map((p) => (
                    <tr key={p.area}>
                      <td>{p.area}</td>
                      {ROLES.map((r) => (
                        <td key={r} className="center">
                          {p.can.includes(r) ? "✓" : ""}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="hint">
              Separation of duties: whoever prepares a reconciliation or requests a mapping change can't approve it. Counters only use the
              Stock Take app.
            </p>
          </section>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Warehouses</th>
                </tr>
              </thead>
              <tbody>
                {USERS.map((u) => (
                  <tr key={u.email}>
                    <td>{u.name}</td>
                    <td className="muted">{u.email}</td>
                    <td>{u.role === "Counter" ? <Chip>Counter</Chip> : <Chip tone="info">{u.role}</Chip>}</td>
                    <td>{u.sites}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === "audit" && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>When</th>
                <th>Who</th>
                <th>List</th>
                <th>Item</th>
                <th>Change</th>
                <th aria-hidden />
              </tr>
            </thead>
            <tbody>
              {store.audit.map((a, i) => (
                <tr key={i}>
                  <td className="nowrap">{a.at}</td>
                  <td>{a.by}</td>
                  <td className="muted">{a.list}</td>
                  <td className="code">{a.item}</td>
                  <td>{a.change}</td>
                  <td>
                    {a.list === "NKG_config" && canConfig && (
                      <button className="link small" onClick={() => store.flash("Restored from version history. The restore is logged too.")}>
                        <RotateCcw size={14} aria-hidden /> Restore
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted small pad">
            <History size={14} aria-hidden /> Kept from SharePoint version history on each list.
          </p>
        </div>
      )}
    </div>
  );
}
