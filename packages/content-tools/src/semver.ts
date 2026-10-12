// Tiny semver subset: exact "1.2.3", "^1.2.3", "~1.2.3", ">=1.2.3", "*"

type V = [number, number, number];

export function parse(v: string): V {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v);
  if (!m) throw new Error(`bad version: ${v}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

const cmp = (a: V, b: V): number => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

export function satisfies(version: string, range: string): boolean {
  range = range.trim();
  if (range === "*" || range === "") return true;
  const v = parse(version);
  if (range.startsWith(">=")) return cmp(v, parse(range.slice(2))) >= 0;
  if (range.startsWith("^")) {
    const r = parse(range.slice(1));
    return cmp(v, r) >= 0 && (r[0] > 0 ? v[0] === r[0] : v[0] === 0 && v[1] === r[1]);
  }
  if (range.startsWith("~")) {
    const r = parse(range.slice(1));
    return cmp(v, r) >= 0 && v[0] === r[0] && v[1] === r[1];
  }
  return cmp(v, parse(range)) === 0;
}
