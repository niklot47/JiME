// Order-preserving JSON parse.
// JS objects enumerate integer-like keys in ascending order, while Python dicts (and FFG scene order) keep
// file order. For objects with integer-like keys the original order is stored under ORDER; use keysOf().

export const ORDER: unique symbol = Symbol.for("jime.keyOrder");

const INDEX_KEY = /^(0|[1-9]\d{0,8})$/;
const NUM = /-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/y;

export function parseOrdered(text: string): unknown {
  let i = 0;
  const ws = (): void => {
    for (;;) {
      const c = text.charCodeAt(i);
      if (c === 32 || c === 10 || c === 13 || c === 9) i++;
      else return;
    }
  };
  const str = (): string => {
    const start = i;
    let escaped = false;
    i++;
    for (;;) {
      const c = text.charCodeAt(i);
      if (c === 92) { i += 2; escaped = true; continue; }
      if (c === 34) break;
      if (Number.isNaN(c)) throw new SyntaxError("unterminated string");
      i++;
    }
    i++;
    return escaped ? (JSON.parse(text.slice(start, i)) as string) : text.slice(start + 1, i - 1);
  };
  const val = (): unknown => {
    ws();
    const c = text[i];
    if (c === "{") {
      i++;
      const o: Record<string, unknown> = {};
      const keys: string[] = [];
      let ordered = false;
      ws();
      if (text[i] === "}") { i++; return o; }
      for (;;) {
        ws();
        const k = str();
        ws();
        if (text[i++] !== ":") throw new SyntaxError(`expected ':' at ${i}`);
        const v = val();
        if (!Object.hasOwn(o, k)) keys.push(k);
        o[k] = v;
        if (!ordered && INDEX_KEY.test(k)) ordered = true;
        ws();
        const d = text[i++];
        if (d === ",") continue;
        if (d === "}") break;
        throw new SyntaxError(`expected ',' or '}' at ${i}`);
      }
      if (ordered) Object.defineProperty(o, ORDER, { value: keys });
      return o;
    }
    if (c === "[") {
      i++;
      const a: unknown[] = [];
      ws();
      if (text[i] === "]") { i++; return a; }
      for (;;) {
        a.push(val());
        ws();
        const d = text[i++];
        if (d === ",") continue;
        if (d === "]") break;
        throw new SyntaxError(`expected ',' or ']' at ${i}`);
      }
      return a;
    }
    if (c === '"') return str();
    if (text.startsWith("true", i)) { i += 4; return true; }
    if (text.startsWith("false", i)) { i += 5; return false; }
    if (text.startsWith("null", i)) { i += 4; return null; }
    NUM.lastIndex = i;
    const m = NUM.exec(text);
    if (!m) throw new SyntaxError(`unexpected '${c}' at ${i}`);
    i = NUM.lastIndex;
    return Number(m[0]);
  };
  if (text.charCodeAt(0) === 0xfeff) i = 1;
  const v = val();
  ws();
  if (i < text.length) throw new SyntaxError(`trailing data at ${i}`);
  return v;
}

/** Keys in original (file / insertion) order */
export function keysOf(o: object): string[] {
  return ((o as { [ORDER]?: string[] })[ORDER] ?? Object.keys(o)).slice();
}

export function valuesOf<T = any>(o: object): T[] {
  return keysOf(o).map((k) => (o as Record<string, T>)[k]!);
}

/**
 * JSON text with the keys in their original order (the inverse of parseOrdered: integer-like keys stay where the
 * file had them). Keys added after parsing (missing from ORDER) follow the ordered ones; deleted ones are skipped.
 */
export function stringifyOrdered(v: unknown, indent = 0): string {
  const pad = (d: number) => (indent ? "\n" + " ".repeat(indent * d) : "");
  const go = (x: unknown, d: number): string => {
    if (x === null || typeof x !== "object") return JSON.stringify(x === undefined ? null : x);
    if (Array.isArray(x)) {
      if (!x.length) return "[]";
      return "[" + x.map((e) => pad(d + 1) + go(e, d + 1)).join(",") + pad(d) + "]";
    }
    const o = x as Record<string, unknown>;
    const order = (o as { [ORDER]?: string[] })[ORDER];
    const keys = order ? [...order.filter((k) => k in o), ...Object.keys(o).filter((k) => !order.includes(k))] : Object.keys(o);
    const parts = keys.filter((k) => o[k] !== undefined).map((k) => pad(d + 1) + JSON.stringify(k) + (indent ? ": " : ":") + go(o[k], d + 1));
    return parts.length ? "{" + parts.join(",") + pad(d) + "}" : "{}";
  };
  return go(v, 0);
}

/** A deep copy that keeps the key order (structuredClone drops it) */
export const cloneOrdered = <T>(v: T): T => parseOrdered(stringifyOrdered(v)) as T;
