// Seeded PRNG (sfc32) with serializable state, so saves and replays are reproducible

export interface RngState {
  a: number; b: number; c: number; d: number;
}

export class Rng {
  private s: RngState;

  constructor(seed: number | RngState) {
    if (typeof seed === "number") {
      this.s = { a: 0x9e3779b9, b: 0x243f6a88, c: 0xb7e15162, d: seed >>> 0 };
      for (let i = 0; i < 15; i++) this.next(); // warm-up
    } else this.s = { ...seed };
  }

  /** Uniform float in [0, 1) */
  next(): number {
    let { a, b, c, d } = this.s;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    this.s = { a, b, c, d };
    return (t >>> 0) / 4294967296;
  }

  /** Integer in [min, max] inclusive */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  pick<T>(items: readonly T[]): T {
    if (!items.length) throw new Error("pick from empty list");
    return items[this.int(0, items.length - 1)]!;
  }

  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      [items[i], items[j]] = [items[j]!, items[i]!];
    }
    return items;
  }

  get state(): RngState {
    return { ...this.s };
  }
}
