// Minimal Python semantics used by the scenario interpreter (truthiness, str(), int(), dict.get)

export const isDict = (v: unknown): v is Record<string, any> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Python bool(v) */
export function truthy(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") return v.length > 0;
  if (Array.isArray(v)) return v.length > 0;
  if (v instanceof Map || v instanceof Set) return v.size > 0;
  if (isDict(v)) return Object.keys(v).length > 0;
  return true;
}

/** Python `a or b` (b is evaluated eagerly; use explicit code where laziness matters) */
export const or = <A, B>(a: A, b: B): A | B => (truthy(a) ? a : b);

/** Python dict.get(k, default): default only when the key is absent (an explicit null stays null) */
export function gd(o: unknown, k: string, d: any = null): any {
  if (!isDict(o)) return d;
  return Object.hasOwn(o, k) ? (o[k] ?? null) : d;
}

/** Python str(v) for scalars */
export function pyStr(v: unknown): string {
  if (v === null || v === undefined) return "None";
  if (v === true) return "True";
  if (v === false) return "False";
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  return JSON.stringify(v);
}

const INT_RE = /^\s*[+-]?\d+\s*$/;
const FLOAT_RE = /^\s*[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?\s*$/;

/** int(x), falling back to int(float(x)), else default (mirrors Game.num in engine-py) */
export function toInt(x: unknown, d = 0): number {
  if (x === null || x === undefined || x === "") return d;
  if (typeof x === "boolean") return x ? 1 : 0;
  if (typeof x === "number") return Number.isFinite(x) ? Math.trunc(x) : d;
  if (typeof x === "string") {
    if (INT_RE.test(x)) return parseInt(x, 10);
    if (FLOAT_RE.test(x)) return Math.trunc(parseFloat(x));
  }
  return d;
}

export function pyFloat(x: unknown): number {
  if (typeof x === "boolean") return x ? 1 : 0;
  if (typeof x === "number") return x;
  if (typeof x === "string" && FLOAT_RE.test(x)) return parseFloat(x);
  throw new TypeError(`float() argument: ${pyStr(x)}`);
}

/** list.remove(x): first occurrence, raises if missing */
export function removeFirst<T>(list: T[], x: T): void {
  const i = list.indexOf(x);
  if (i < 0) throw new RangeError("list.remove(x): x not in list");
  list.splice(i, 1);
}

export class Counter<K = string> extends Map<K, number> {
  inc(k: K, n = 1): void {
    this.set(k, (this.get(k) ?? 0) + n);
  }
  toObject(): Record<string, number> {
    const o: Record<string, number> = {};
    for (const [k, v] of this) o[String(k)] = v;
    return o;
  }
}
