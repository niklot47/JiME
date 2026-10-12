// Python-compatible random.Random (MT19937 + CPython's derived methods).
// Same seed -> same sequence as CPython 3.x, so the TS engine can be diffed against engine-py run by run.

const N = 624;
const M = 397;
const UPPER = 0x80000000;
const LOWER = 0x7fffffff;
const MATRIX = 0x9908b0df;

export interface PyRandomState {
  mt: number[];
  mti: number;
}

export class PyRandom {
  private mt = new Uint32Array(N);
  private mti = N + 1;

  constructor(seed: number | PyRandomState = 0) {
    if (typeof seed === "number") this.seed(seed);
    else this.setState(seed);
  }

  /** random.seed(int): key = 32-bit little-endian words of abs(seed) */
  seed(n: number): void {
    let v = Math.abs(Math.trunc(n));
    const key: number[] = [];
    if (v === 0) key.push(0);
    while (v > 0) {
      key.push(v % 0x100000000);
      v = Math.floor(v / 0x100000000);
    }
    this.initByArray(key);
  }

  private initGenrand(s: number): void {
    const mt = this.mt;
    mt[0] = s >>> 0;
    for (let i = 1; i < N; i++) {
      const prev = mt[i - 1]! ^ (mt[i - 1]! >>> 30);
      mt[i] = (Math.imul(1812433253, prev) + i) >>> 0;
    }
    this.mti = N;
  }

  private initByArray(key: number[]): void {
    const mt = this.mt;
    this.initGenrand(19650218);
    let i = 1;
    let j = 0;
    for (let k = Math.max(N, key.length); k > 0; k--) {
      const prev = mt[i - 1]! ^ (mt[i - 1]! >>> 30);
      mt[i] = (((mt[i]! ^ Math.imul(prev, 1664525)) >>> 0) + key[j]! + j) >>> 0;
      i++; j++;
      if (i >= N) { mt[0] = mt[N - 1]!; i = 1; }
      if (j >= key.length) j = 0;
    }
    for (let k = N - 1; k > 0; k--) {
      const prev = mt[i - 1]! ^ (mt[i - 1]! >>> 30);
      mt[i] = (((mt[i]! ^ Math.imul(prev, 1566083941)) >>> 0) - i) >>> 0;
      i++;
      if (i >= N) { mt[0] = mt[N - 1]!; i = 1; }
    }
    mt[0] = 0x80000000;
  }

  private genrand(): number {
    const mt = this.mt;
    if (this.mti >= N) {
      let kk = 0;
      let y: number;
      for (; kk < N - M; kk++) {
        y = (mt[kk]! & UPPER) | (mt[kk + 1]! & LOWER);
        mt[kk] = mt[kk + M]! ^ (y >>> 1) ^ (y & 1 ? MATRIX : 0);
      }
      for (; kk < N - 1; kk++) {
        y = (mt[kk]! & UPPER) | (mt[kk + 1]! & LOWER);
        mt[kk] = mt[kk + (M - N)]! ^ (y >>> 1) ^ (y & 1 ? MATRIX : 0);
      }
      y = (mt[N - 1]! & UPPER) | (mt[0]! & LOWER);
      mt[N - 1] = mt[M - 1]! ^ (y >>> 1) ^ (y & 1 ? MATRIX : 0);
      this.mti = 0;
    }
    let y = mt[this.mti++]!;
    y ^= y >>> 11;
    y ^= (y << 7) & 0x9d2c5680;
    y ^= (y << 15) & 0xefc60000;
    y ^= y >>> 18;
    return y >>> 0;
  }

  /** Float in [0, 1) with 53-bit resolution, identical to CPython */
  random(): number {
    const a = this.genrand() >>> 5;
    const b = this.genrand() >>> 6;
    return (a * 67108864 + b) / 9007199254740992;
  }

  getrandbits(k: number): number {
    if (k === 0) return 0;
    if (k < 0 || k > 32) throw new RangeError(`getrandbits(${k}) not supported`);
    return this.genrand() >>> (32 - k);
  }

  private randbelow(n: number): number {
    if (!Number.isInteger(n) || n <= 0) throw new RangeError(`randbelow(${n})`);
    const k = 32 - Math.clz32(n);
    let r = this.getrandbits(k);
    while (r >= n) r = this.getrandbits(k);
    return r;
  }

  /** randrange(stop) or randrange(start, stop) */
  randrange(start: number, stop?: number): number {
    if (stop === undefined) {
      if (start <= 0) throw new RangeError("empty range for randrange()");
      return this.randbelow(start);
    }
    const width = stop - start;
    if (width <= 0) throw new RangeError(`empty range for randrange(${start}, ${stop})`);
    return start + this.randbelow(width);
  }

  /** Inclusive on both ends, like Python */
  randint(a: number, b: number): number {
    return this.randrange(a, b + 1);
  }

  choice<T>(seq: readonly T[]): T {
    if (!seq.length) throw new RangeError("Cannot choose from an empty sequence");
    return seq[this.randbelow(seq.length)]!;
  }

  shuffle<T>(x: T[]): T[] {
    for (let i = x.length - 1; i > 0; i--) {
      const j = this.randbelow(i + 1);
      [x[i], x[j]] = [x[j]!, x[i]!];
    }
    return x;
  }

  /** random.choices(population, weights)[0] (k = 1) */
  choices<T>(population: readonly T[], weights: readonly number[] | null = null): T {
    const n = population.length;
    if (!n) throw new RangeError("Cannot choose from an empty population");
    if (weights === null) return population[Math.floor(this.random() * n)]!;
    if (weights.length !== n) throw new RangeError("The number of weights does not match the population");
    const cum: number[] = [];
    let acc = 0;
    for (const w of weights) cum.push((acc += w));
    const total = cum[n - 1]!;
    if (!(total > 0)) throw new RangeError("Total of weights must be greater than zero");
    // bisect_right(cum, x, 0, n - 1)
    const x = this.random() * total;
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (x < cum[mid]!) hi = mid;
      else lo = mid + 1;
    }
    return population[lo]!;
  }

  getState(): PyRandomState {
    return { mt: Array.from(this.mt), mti: this.mti };
  }

  setState(s: PyRandomState): void {
    this.mt = Uint32Array.from(s.mt);
    this.mti = s.mti;
  }
}
