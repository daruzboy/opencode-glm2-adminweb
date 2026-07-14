// Evaluator ekspresi untuk binding blok Mobirise: {{expr}}, mbr-if, condition=, mbr-class.
// Ekspresi = subset JS aman: literal, akses properti bertitik (bg.type), operator
// perbandingan/logika, negasi. TIDAK memakai `eval`/`Function` (keamanan multi-tenant):
// diparse jadi AST kecil lalu dievaluasi terhadap konteks param.

export type ParamContext = Record<string, unknown>;

type Token =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'ident'; v: string }
  | { t: 'op'; v: string }
  | { t: 'punc'; v: string };

const OPS = ['===', '!==', '==', '!=', '<=', '>=', '&&', '||', '<', '>', '!', '+', '-', '*', '/'];

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      i++;
      continue;
    }
    if (c === "'" || c === '"') {
      let j = i + 1;
      let s = '';
      while (j < src.length && src[j] !== c) {
        if (src[j] === '\\') {
          s += src[j + 1] ?? '';
          j += 2;
        } else {
          s += src[j];
          j++;
        }
      }
      out.push({ t: 'str', v: s });
      i = j + 1;
      continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j]!)) j++;
      out.push({ t: 'num', v: Number(src.slice(i, j)) });
      i = j;
      continue;
    }
    if (/[a-zA-Z_$]/.test(c)) {
      let j = i;
      while (j < src.length && /[a-zA-Z0-9_$.]/.test(src[j]!)) j++;
      out.push({ t: 'ident', v: src.slice(i, j) });
      i = j;
      continue;
    }
    if (c === '(' || c === ')') {
      out.push({ t: 'punc', v: c });
      i++;
      continue;
    }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (op) {
      out.push({ t: 'op', v: op });
      i += op.length;
      continue;
    }
    // Karakter tak dikenal: lewati agar evaluasi tetap toleran.
    i++;
  }
  return out;
}

// Pratt parser ringkas. Presedensi: || < && < perbandingan < aditif < multiplikatif < unary.
const PREC: Record<string, number> = {
  '||': 1,
  '&&': 2,
  '==': 3,
  '!=': 3,
  '===': 3,
  '!==': 3,
  '<': 3,
  '>': 3,
  '<=': 3,
  '>=': 3,
  '+': 4,
  '-': 4,
  '*': 5,
  '/': 5,
};

type Node =
  | { k: 'lit'; v: unknown }
  | { k: 'ref'; path: string }
  | { k: 'un'; op: string; e: Node }
  | { k: 'bin'; op: string; l: Node; r: Node };

class Parser {
  private pos = 0;
  constructor(private readonly toks: Token[]) {}

  parse(): Node {
    if (this.toks.length === 0) return { k: 'lit', v: undefined };
    return this.expr(0);
  }

  private peek(): Token | undefined {
    return this.toks[this.pos];
  }

  private expr(minPrec: number): Node {
    let left = this.unary();
    for (;;) {
      const t = this.peek();
      if (!t || t.t !== 'op' || !(t.v in PREC)) break;
      const prec = PREC[t.v]!;
      if (prec < minPrec) break;
      this.pos++;
      const right = this.expr(prec + 1);
      left = { k: 'bin', op: t.v, l: left, r: right };
    }
    return left;
  }

  private unary(): Node {
    const t = this.peek();
    if (t && t.t === 'op' && (t.v === '!' || t.v === '-')) {
      this.pos++;
      return { k: 'un', op: t.v, e: this.unary() };
    }
    return this.primary();
  }

  private primary(): Node {
    const t = this.peek();
    if (!t) return { k: 'lit', v: undefined };
    if (t.t === 'punc' && t.v === '(') {
      this.pos++;
      const e = this.expr(0);
      if (this.peek()?.v === ')') this.pos++;
      return e;
    }
    if (t.t === 'num') {
      this.pos++;
      return { k: 'lit', v: t.v };
    }
    if (t.t === 'str') {
      this.pos++;
      return { k: 'lit', v: t.v };
    }
    if (t.t === 'ident') {
      this.pos++;
      if (t.v === 'true') return { k: 'lit', v: true };
      if (t.v === 'false') return { k: 'lit', v: false };
      if (t.v === 'null') return { k: 'lit', v: null };
      if (t.v === 'undefined') return { k: 'lit', v: undefined };
      return { k: 'ref', path: t.v };
    }
    this.pos++;
    return { k: 'lit', v: undefined };
  }
}

function resolvePath(ctx: ParamContext, path: string): unknown {
  const parts = path.split('.');
  let cur: unknown = ctx;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

function evalNode(n: Node, ctx: ParamContext): unknown {
  switch (n.k) {
    case 'lit':
      return n.v;
    case 'ref':
      return resolvePath(ctx, n.path);
    case 'un': {
      const v = evalNode(n.e, ctx);
      return n.op === '!' ? !v : -Number(v);
    }
    case 'bin': {
      const l = evalNode(n.l, ctx);
      // Hubung-singkat untuk operator logika.
      if (n.op === '&&') return l ? evalNode(n.r, ctx) : l;
      if (n.op === '||') return l ? l : evalNode(n.r, ctx);
      const r = evalNode(n.r, ctx);
      switch (n.op) {
        case '==':
          // Mobirise memakai perbandingan longgar (mis. '5' == 5).
          // eslint-disable-next-line eqeqeq
          return l == r;
        case '!=':
          // eslint-disable-next-line eqeqeq
          return l != r;
        case '===':
          return l === r;
        case '!==':
          return l !== r;
        case '<':
          return Number(l) < Number(r);
        case '>':
          return Number(l) > Number(r);
        case '<=':
          return Number(l) <= Number(r);
        case '>=':
          return Number(l) >= Number(r);
        case '+':
          return (l as number) + (r as number);
        case '-':
          return Number(l) - Number(r);
        case '*':
          return Number(l) * Number(r);
        case '/':
          return Number(l) / Number(r);
        default:
          return undefined;
      }
    }
  }
}

const cache = new Map<string, Node>();

export function evalExpr(src: string, ctx: ParamContext): unknown {
  const trimmed = src.trim();
  let ast = cache.get(trimmed);
  if (!ast) {
    ast = new Parser(tokenize(trimmed)).parse();
    cache.set(trimmed, ast);
  }
  return evalNode(ast, ctx);
}

export function evalBool(src: string, ctx: ParamContext): boolean {
  return Boolean(evalExpr(src, ctx));
}
