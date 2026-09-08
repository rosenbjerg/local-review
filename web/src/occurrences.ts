export type Span = [start: number, end: number];

export interface NodeOffset {
  node: number;
  offset: number;
}

export interface NodeSpan {
  start: NodeOffset;
  end: NodeOffset;
}

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
const WORD_CHAR = /[\w$]/;

const MIN_TERM_LENGTH = 2;

export function normalizeTerm(raw: string): string | null {
  const term = raw.trim();
  if (term.length < MIN_TERM_LENGTH || /[\n\r]/.test(term)) return null;
  return term;
}

// Whole-word only for an identifier-shaped term (`id` must not light up `width`); anything else is a substring.
export function matchSpans(line: string, term: string): Span[] {
  const wholeWord = IDENTIFIER.test(term);
  const out: Span[] = [];
  let i = line.indexOf(term);
  while (i !== -1) {
    const end = i + term.length;
    if (!wholeWord || (!isWordChar(line[i - 1]) && !isWordChar(line[end]))) out.push([i, end]);
    i = line.indexOf(term, end);
  }
  return out;
}

function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && WORD_CHAR.test(ch);
}

// Spans over the line's concatenated text → its text nodes, since highlighting splits one line across many.
export function mapSpansToNodes(lengths: number[], spans: Span[]): NodeSpan[] {
  const out: NodeSpan[] = [];
  for (const [start, end] of spans) {
    const s = locate(lengths, start, false);
    const e = locate(lengths, end, true);
    if (s && e) out.push({ start: s, end: e });
  }
  return out;
}

function locate(lengths: number[], pos: number, isEnd: boolean): NodeOffset | null {
  let base = 0;
  for (let node = 0; node < lengths.length; node++) {
    const len = lengths[node];
    if (len === 0) continue;
    const next = base + len;
    if (isEnd ? pos <= next : pos < next) return { node, offset: pos - base };
    base = next;
  }
  return null;
}
