// .NET System.Random (Knuth subtractive generator, referencesource / Mono), used by FFG's MapBuilder.
// Same seed -> same sequence as the original app, so maps can be reproduced exactly.

const MBIG = 2147483647;
const MSEED = 161803398;

export class NetRandom {
  private readonly sa = new Int32Array(56);
  private inext = 0;
  private inextp = 21;

  constructor(seed: number) {
    const sa = this.sa;
    seed |= 0;
    const subtraction = seed === -2147483648 ? MBIG : Math.abs(seed);
    let mj = MSEED - subtraction;
    sa[55] = mj;
    let mk = 1;
    for (let i = 1; i < 55; i++) {
      const ii = (21 * i) % 55;
      sa[ii] = mk;
      mk = mj - mk;
      if (mk < 0) mk += MBIG;
      mj = sa[ii]!;
    }
    for (let k = 1; k < 5; k++) {
      for (let i = 1; i < 56; i++) {
        sa[i] = sa[i]! - sa[1 + ((i + 30) % 55)]!; // Int32Array wraps like unchecked C# int
        if (sa[i]! < 0) sa[i] = sa[i]! + MBIG;
      }
    }
  }

  private internalSample(): number {
    let a = this.inext + 1;
    if (a >= 56) a = 1;
    let b = this.inextp + 1;
    if (b >= 56) b = 1;
    let r = this.sa[a]! - this.sa[b]!;
    if (r === MBIG) r--;
    if (r < 0) r += MBIG;
    this.sa[a] = r;
    this.inext = a;
    this.inextp = b;
    return r;
  }

  private sample(): number {
    return this.internalSample() * (1.0 / MBIG);
  }

  nextDouble(): number {
    return this.sample();
  }

  /** Next(minValue, maxValue): [min, max) */
  next(min: number, max: number): number {
    const range = max - min;
    if (range > MBIG) throw new RangeError("large ranges not needed by MapBuilder");
    return Math.trunc(this.sample() * range) + min;
  }

  /** FFGRandom.Next(this Random, float, float) */
  nextFloat(min: number, max: number): number {
    const f = Math.fround;
    return f(f(min) + f(f(this.nextDouble()) * f(f(max) - f(min))));
  }
}

/** FFGTools.Randomize(IList, System.Random): swap each index with a random one */
export function randomize<T>(list: T[], rng: NetRandom): void {
  for (let i = 0; i < list.length; i++) {
    const j = rng.next(0, list.length);
    const a = list[i]!;
    list[i] = list[j]!;
    list[j] = a;
  }
}
