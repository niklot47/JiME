// .NET ArraySortHelper<T>.IntrospectiveSort (List<T>.Sort / Array.Sort with a Comparison).
// The sort is unstable, so FFG's results depend on this exact algorithm.

export function netSort<T>(a: T[], cmp: (x: T, y: T) => number): void {
  if (a.length < 2) return;
  introSort(a, 0, a.length - 1, 2 * floorLog2PlusOne(a.length), cmp);
}

function floorLog2PlusOne(n: number): number {
  let r = 0;
  while (n >= 1) { r++; n = Math.floor(n / 2); }
  return r;
}

function swap<T>(a: T[], i: number, j: number): void {
  if (i !== j) { const t = a[i]!; a[i] = a[j]!; a[j] = t; }
}

function swapIfGreater<T>(a: T[], cmp: (x: T, y: T) => number, i: number, j: number): void {
  if (i !== j && cmp(a[i]!, a[j]!) > 0) { const t = a[i]!; a[i] = a[j]!; a[j] = t; }
}

function introSort<T>(a: T[], lo: number, hi: number, depth: number, cmp: (x: T, y: T) => number): void {
  while (hi > lo) {
    const size = hi - lo + 1;
    if (size <= 16) {
      if (size === 1) return;
      if (size === 2) { swapIfGreater(a, cmp, lo, hi); return; }
      if (size === 3) {
        swapIfGreater(a, cmp, lo, hi - 1);
        swapIfGreater(a, cmp, lo, hi);
        swapIfGreater(a, cmp, hi - 1, hi);
        return;
      }
      insertionSort(a, lo, hi, cmp);
      return;
    }
    if (depth === 0) { heapsort(a, lo, hi, cmp); return; }
    depth--;
    const p = pickPivotAndPartition(a, lo, hi, cmp);
    introSort(a, p + 1, hi, depth, cmp);
    hi = p - 1;
  }
}

function pickPivotAndPartition<T>(a: T[], lo: number, hi: number, cmp: (x: T, y: T) => number): number {
  const mid = lo + ((hi - lo) >> 1);
  swapIfGreater(a, cmp, lo, mid);
  swapIfGreater(a, cmp, lo, hi);
  swapIfGreater(a, cmp, mid, hi);
  const pivot = a[mid]!;
  swap(a, mid, hi - 1);
  let left = lo;
  let right = hi - 1;
  while (left < right) {
    while (cmp(a[++left]!, pivot) < 0);
    while (cmp(pivot, a[--right]!) < 0);
    if (left >= right) break;
    swap(a, left, right);
  }
  swap(a, left, hi - 1);
  return left;
}

function insertionSort<T>(a: T[], lo: number, hi: number, cmp: (x: T, y: T) => number): void {
  for (let i = lo; i < hi; i++) {
    let j = i;
    const t = a[i + 1]!;
    while (j >= lo && cmp(t, a[j]!) < 0) { a[j + 1] = a[j]!; j--; }
    a[j + 1] = t;
  }
}

function heapsort<T>(a: T[], lo: number, hi: number, cmp: (x: T, y: T) => number): void {
  const n = hi - lo + 1;
  for (let i = n >> 1; i >= 1; i--) downHeap(a, i, n, lo, cmp);
  for (let i = n; i > 1; i--) {
    swap(a, lo, lo + i - 1);
    downHeap(a, 1, i - 1, lo, cmp);
  }
}

function downHeap<T>(a: T[], i: number, n: number, lo: number, cmp: (x: T, y: T) => number): void {
  const d = a[lo + i - 1]!;
  while (i <= n >> 1) {
    let child = 2 * i;
    if (child < n && cmp(a[lo + child - 1]!, a[lo + child]!) < 0) child++;
    if (!(cmp(d, a[lo + child - 1]!) < 0)) break;
    a[lo + i - 1] = a[lo + child - 1]!;
    i = child;
  }
  a[lo + i - 1] = d;
}

/** C# x.CompareTo(y) for numbers and booleans */
export const cmpNum = (x: number | boolean, y: number | boolean): number => (Number(x) < Number(y) ? -1 : Number(x) > Number(y) ? 1 : 0);
