// Free-form prose props where an id is mentioned by name rather than referenced.
export const FREE_FORM_KEYS: ReadonlySet<string> = new Set(["brief", "note"]);

// A mention is the id wrapped in backticks (`id`) or a template brace ({id}); the
// closing delimiter bounds the match, so `foo.bar` never matches inside `foo.bar.baz`.
const WRAPPERS: readonly [string, string][] = [
  ["`", "`"],
  ["{", "}"],
];

export interface WrappedMention {
  /** Offset of the id within `s`, just inside the opening delimiter. */
  start: number;
  /** Offset just past the id, at the closing delimiter. */
  end: number;
  id: string;
}

/** Backtick- or brace-wrapped tokens in `s`, as `[start, end)` offsets into `s` and the inner id. */
export function wrappedMentions(s: string): WrappedMention[] {
  const out: WrappedMention[] = [];
  for (const [open, close] of WRAPPERS) {
    for (let i = s.indexOf(open); i !== -1; ) {
      const j = s.indexOf(close, i + open.length);
      if (j === -1) break;
      const start = i + open.length;
      out.push({ start, end: j, id: s.slice(start, j) });
      i = s.indexOf(open, j + close.length);
    }
  }
  return out;
}
