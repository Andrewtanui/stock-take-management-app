import { useState } from "react";
import { MessageSquare } from "lucide-react";
import { useStore } from "../data/store";
import type { Dept, Role, ThreadComment } from "../data/types";

const DEPTS: Dept[] = ["Operations", "Warehouse", "Trading", "Finance", "Logistics", "Quality"];
const DEPT_OF: Partial<Record<Role, Dept>> = { "Operations Admin": "Operations", "Warehouse Manager": "Warehouse", Trading: "Trading", Finance: "Finance" };

/**
 * The comment thread on an exception or a variance: each department's explanation, with who said it
 * and when. Comments are added, never edited or deleted, so the thread is the record (pain point L2).
 */
export function Thread({ on, target }: { on: ThreadComment["on"]; target: string }) {
  const store = useStore();
  const own = DEPT_OF[store.role];
  const [text, setText] = useState("");
  const [dept, setDept] = useState<Dept>(own ?? "Operations");
  const list = store.comments.filter((c) => c.on === on && c.target === target);

  return (
    <section className="thread">
      <h3 className="field-label">
        <MessageSquare size={14} aria-hidden /> Comments{list.length ? ` (${list.length})` : ""}
      </h3>
      {list.length ? (
        <ol className="thread-list">
          {list.map((c) => (
            <li key={c.id}>
              <div className="thread-meta">
                <strong>{c.by || "Someone"}</strong> <span className="muted small">· {c.dept} · {c.at}</span>
              </div>
              <p className="thread-text">{c.text}</p>
            </li>
          ))}
        </ol>
      ) : (
        <p className="muted small">No comments yet. Explain what happened, or ask another department.</p>
      )}
      {own && (
        <div className="thread-add">
          <textarea
            className="input"
            rows={2}
            maxLength={2000}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={on === "Exception" ? "e.g. Logistics: AGL confirms the 6 bags left on DS10284 on 2 Sep" : "e.g. Bags moved to row C on count day, transfer not posted yet"}
            aria-label="Comment"
          />
          <div className="btn-row">
            <label className="thread-dept">
              <span className="muted small">For</span>{" "}
              <select className="input thread-select" value={dept} onChange={(e) => setDept(e.target.value as Dept)} aria-label="Department">
                {DEPTS.map((d) => (
                  <option key={d}>{d}</option>
                ))}
              </select>
            </label>
            <button
              className="btn btn-sm"
              disabled={!text.trim()}
              onClick={() => {
                store.addComment({ on, target, text: text.trim(), dept });
                setText("");
              }}
            >
              Add comment
            </button>
          </div>
          <p className="muted small">Comments can't be changed or deleted once added.</p>
        </div>
      )}
    </section>
  );
}
