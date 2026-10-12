// Localized text lookup and formatting for log entries ("KEY" + inserts -> display text)

export interface TextOptions {
  /** How to render [i]/[b] markup: "keep" (raw), "strip", or a custom replacer */
  markup?: "keep" | "strip" | ((tag: "i" | "b", open: boolean) => string);
}

/** Index "Sheet|KEY" -> text maps by bare KEY as well (first sheet wins) */
export class TextDb {
  private readonly byKey = new Map<string, string>();

  constructor(entries: Iterable<[string, string]>) {
    for (const [k, v] of entries) {
      this.byKey.set(k, v);
      const bar = k.indexOf("|");
      if (bar >= 0 && !this.byKey.has(k.slice(bar + 1))) this.byKey.set(k.slice(bar + 1), v);
    }
  }

  has(key: string): boolean {
    return this.byKey.has(key);
  }

  raw(key: string): string | undefined {
    return this.byKey.get(key);
  }

  /** Text for key with {0}..{n} replaced by inserts (inserts that are keys are translated too) */
  format(key: string, inserts: readonly string[] = [], opts: TextOptions = {}): string {
    const base = this.byKey.get(key);
    if (base === undefined) return inserts.length ? `${key}(${inserts.join(", ")})` : key;
    const ins = inserts.map((i) => (this.byKey.has(i) ? this.format(i, [], opts) : i));
    let s = base.replace(/\{(\d+)\}/g, (m, n) => ins[Number(n)] ?? m).replace(/\\n/g, "\n");
    const mk = opts.markup ?? "keep";
    if (mk === "strip") s = s.replace(/\[\/?[ib]\]/g, "");
    else if (typeof mk === "function") s = s.replace(/\[(\/?)([ib])\]/g, (_m, close, tag) => mk(tag, !close));
    return s.trim();
  }
}
