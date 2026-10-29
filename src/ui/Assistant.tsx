import { useEffect, useRef, useState } from "react";
import { MessageSquareText, RotateCcw, Send, X } from "lucide-react";
import { useStore } from "../data/store";
import { Chip, type Tone } from "./kit";

type Message = { from: "you" | "assistant"; text: string; at: string; raw?: string; failed?: boolean };

/** Starting points that match the agent's topics (Jones's Stock Assistant). */
const STARTERS = ["Show the recount queue", "Which third-party sites are at risk?", "Governance KPI scoreboard", "Pre-count risks for this stock take"];

const now = () => new Date().toISOString();
/** "09:51" today, "26 Oct, 09:51" on an earlier day (older saved chats said only the time). */
const when = (at: string) => {
  const d = new Date(at);
  if (isNaN(d.getTime())) return at;
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return d.toDateString() === new Date().toDateString() ? time : `${d.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}, ${time}`;
};

/* The chat is kept in this browser only (each person's own device); it can be unavailable, e.g. in a private window. */
const CHAT_KEY = "ibky-hub-assistant";
const KEEP = 50;
function loadChat(): { messages: Message[]; conversation: string } {
  try {
    const c = JSON.parse(localStorage.getItem(CHAT_KEY) ?? "null") as { messages?: Message[]; conversation?: string } | null;
    return { messages: Array.isArray(c?.messages) ? c.messages : [], conversation: c?.conversation ?? "" };
  } catch {
    return { messages: [], conversation: "" };
  }
}
function saveChat(messages: Message[], conversation: string) {
  try {
    if (!messages.length) localStorage.removeItem(CHAT_KEY);
    else localStorage.setItem(CHAT_KEY, JSON.stringify({ messages: messages.slice(-KEEP), conversation }));
  } catch {
    /* storage blocked: the chat lasts until the Hub is closed */
  }
}

/** Status words the agent writes in capitals, shown as the Hub's status chips. */
const STATUS_TONE: Record<string, Tone> = {
  "ON TARGET": "ok",
  "ON TRACK": "ok",
  "OFF TARGET": "crit",
  BREACHED: "crit",
  OVERDUE: "crit",
  "AT RISK": "crit",
  "DUE SOON": "warn",
  "FOR INFORMATION": "neutral",
  "NOT MEASURABLE YET": "neutral",
  "NOT MEASURABLE": "neutral",
};
const STATUS_RE = /\b(ON TARGET|ON TRACK|OFF TARGET|BREACHED|OVERDUE|AT RISK|DUE SOON|FOR INFORMATION|NOT MEASURABLE YET|NOT MEASURABLE)\b/;

/** **bold** and status words inside a line, as React text (never HTML from the agent). */
function inline(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).flatMap((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) return [<strong key={i}>{part.slice(2, -2)}</strong>];
    return part.split(STATUS_RE).map((bit, j) =>
      STATUS_TONE[bit] ? (
        <Chip key={`${i}-${j}`} tone={STATUS_TONE[bit]}>
          {bit.charAt(0) + bit.slice(1).toLowerCase()}
        </Chip>
      ) : (
        bit
      ),
    );
  });
}

/** The agent answers in light Markdown: paragraphs, **bold** and "- " bullet lists. */
function Formatted({ text }: { text: string }) {
  const blocks: JSX.Element[] = [];
  let bullets: string[] = [];
  const flush = () => {
    if (bullets.length) blocks.push(<ul key={blocks.length}>{bullets.map((b, i) => <li key={i}>{inline(b)}</li>)}</ul>);
    bullets = [];
  };
  for (const line of text.split("\n")) {
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    if (bullet) {
      bullets.push(bullet[1]);
      continue;
    }
    flush();
    if (line.trim()) blocks.push(<p key={blocks.length}>{inline(line)}</p>);
  }
  flush();
  return <>{blocks}</>;
}

/**
 * The Stock Assistant (Copilot Studio agent) as a side panel in the Hub only: never in the counter app,
 * where counting is blind. Questions go through flow F11; follow-ups keep the agent's conversation.
 */
export default function Assistant() {
  const store = useStore();
  const [open, setOpen] = useState(false);
  const saved = useRef(loadChat()).current;
  const [messages, setMessages] = useState<Message[]>(saved.messages);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [conversation, setConversation] = useState(saved.conversation);
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  // Kept in this browser so a refresh doesn't lose the chat (and follow-ups keep their context).
  useEffect(() => saveChat(messages, conversation), [messages, conversation]);
  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);
  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

  if (!store.assistantReady) return null;

  const ask = async (question: string) => {
    const q = question.trim();
    if (!q || busy) return;
    setDraft("");
    setMessages((m) => [...m, { from: "you", text: q, at: now() }]);
    setBusy(true);
    try {
      // A saved conversation may have expired on the agent's side: then start a new one.
      const r = await store.askAssistant(q, conversation || undefined).catch((e: unknown) => {
        if (!conversation) throw e;
        setConversation("");
        return store.askAssistant(q);
      });
      if (r.conversation) setConversation(r.conversation);
      setMessages((m) => [
        ...m,
        {
          from: "assistant",
          text: r.answer || "The assistant replied without text. Its full reply is below.",
          raw: r.answer ? undefined : r.raw,
          at: now(),
        },
      ]);
    } catch (e) {
      setMessages((m) => [...m, { from: "assistant", text: e instanceof Error && !/^Couldn't /.test(e.message) ? e.message : `Couldn't reach the Stock Assistant. ${e instanceof Error ? e.message : ""}`.trim(), at: now(), failed: true }]);
    } finally {
      setBusy(false);
    }
  };
  const restart = () => {
    setMessages([]);
    setConversation("");
  };

  return (
    <>
      {!open && (
        <button className="assistant-fab" onClick={() => setOpen(true)} aria-label="Open the Stock Assistant">
          <MessageSquareText size={20} aria-hidden />
          <span>Stock Assistant</span>
        </button>
      )}
      {open && (
        <aside className="assistant" aria-label="Stock Assistant">
          <header className="assistant-head">
            <div>
              <strong>Stock Assistant</strong>
              <div className="muted small">Answers from the IBKY engine's latest refresh</div>
            </div>
            <div className="btn-row">
              {messages.length > 0 && (
                <button className="icon-btn" onClick={restart} aria-label="Start a new conversation" title="New conversation">
                  <RotateCcw size={16} aria-hidden />
                </button>
              )}
              <button className="icon-btn" onClick={() => setOpen(false)} aria-label="Close the Stock Assistant">
                <X size={18} aria-hidden />
              </button>
            </div>
          </header>

          <div className="assistant-list" ref={list} aria-live="polite">
            {!messages.length && (
              <div className="assistant-empty">
                <p className="muted small">
                  Ask about outturns, recounts, exceptions, third-party sites or the reconciliation. Answers take a few seconds. Decisions and sign-off stay in
                  the Hub's own pages.
                </p>
                <div className="assistant-starters">
                  {STARTERS.map((s) => (
                    <button key={s} className="chip" onClick={() => ask(s)}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`assistant-msg ${m.from === "you" ? "from-you" : "from-assistant"}${m.failed ? " failed" : ""}`}>
                <div className="assistant-bubble">{m.from === "assistant" && !m.failed ? <Formatted text={m.text} /> : m.text}</div>
                {m.raw && (
                  <details className="assistant-raw">
                    <summary className="muted small">Full reply</summary>
                    <pre>{m.raw}</pre>
                  </details>
                )}
                <span className="muted small">{when(m.at)}</span>
              </div>
            ))}
            {busy && (
              <div className="assistant-msg from-assistant">
                <div className="assistant-bubble muted">Thinking…</div>
              </div>
            )}
          </div>

          <form
            className="assistant-input"
            onSubmit={(e) => {
              e.preventDefault();
              void ask(draft);
            }}
          >
            <textarea
              ref={input}
              className="input"
              rows={2}
              value={draft}
              placeholder="Ask the Stock Assistant"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void ask(draft);
                }
              }}
            />
            <button className="btn btn-primary" type="submit" disabled={busy || !draft.trim()} aria-label="Send">
              <Send size={16} aria-hidden />
            </button>
          </form>
        </aside>
      )}
    </>
  );
}
