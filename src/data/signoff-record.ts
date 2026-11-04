// A sign-off comment read as a record: what the signer confirms, then the actions it leaves, each
// with an owner. Plain text in Dataverse (stk_signoff.stk_comment), so it reads the same anywhere:
//
//   Counts complete; variances and exceptions explained. All 7 count sheets approved, ...
//   AGL / KPCU: Correct grades in XBS: 43KN0031, 43KN0032, ...
//   Warehouse: Post the 20EM0003 receipt; update the KDI5390 location.
//
// A line "<Owner>: <action>" with a short owner (letters, spaces, / & -) is an action; every other
// line is the statement. The statement's first sentence is its lead (shown bold). Pure, for the
// Sign-off page and the sign-off pack.

export interface SignoffAction {
  owner: string;
  text: string;
}

export interface SignoffRecord {
  lead: string;
  rest: string;
  actions: SignoffAction[];
}

const ACTION = /^([A-Za-z][A-Za-z /&-]{0,23}):\s+(.+)$/;

export function readSignoffComment(comment?: string): SignoffRecord {
  const statement: string[] = [];
  const actions: SignoffAction[] = [];
  for (const raw of (comment ?? "").split(/\r?\n/)) {
    const line = raw.trim().replace(/^[-•*]\s*/, "");
    if (!line) continue;
    const m = ACTION.exec(line);
    // Only once the statement has started: a first line like "Note: ..." stays the statement.
    if (m && statement.length) actions.push({ owner: m[1].trim(), text: m[2].trim() });
    else statement.push(line);
  }
  const text = statement.join(" ");
  // Lead = up to the first full stop or colon followed by a space (not "24,809.5" or "10:05").
  const cut = text.search(/[.:](\s|$)/);
  return cut < 0 ? { lead: text, rest: "", actions } : { lead: text.slice(0, cut + 1), rest: text.slice(cut + 1).trim(), actions };
}
