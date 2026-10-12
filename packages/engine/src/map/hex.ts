// Cube hex coordinates and direction math (FFG HexMath / HexCube semantics)

export interface Cube {
  x: number;
  y: number;
  z: number;
}

export const cube = (x: number, y: number, z: number): Cube => ({ x, y, z });
export const ZERO: Cube = cube(0, 0, 0);
export const eq = (a: Cube, b: Cube): boolean => a.x === b.x && a.y === b.y && a.z === b.z;
export const add = (a: Cube, b: Cube): Cube => cube(a.x + b.x, a.y + b.y, a.z + b.z);
export const sub = (a: Cube, b: Cube): Cube => cube(a.x - b.x, a.y - b.y, a.z - b.z);

export const DIRECTIONS: readonly Cube[] = [cube(1, -1, 0), cube(0, -1, 1), cube(-1, 0, 1), cube(-1, 1, 0), cube(0, 1, -1), cube(1, 0, -1)];

export const neighbor = (c: Cube, dir: number): Cube => add(c, DIRECTIONS[dir]!);

export function rotateCoords(c: Cube, intervals: number): Cube {
  if (intervals === 0 || (c.x === 0 && c.y === 0 && c.z === 0)) return c;
  let { x, y, z } = c;
  if (intervals > 0) {
    for (let i = 0; i < intervals; i++) { const n = -x; x = -z; z = -y; y = n; }
  } else {
    for (let i = intervals; i < 0; i++) { const n = -x; x = -y; y = -z; z = n; }
  }
  return cube(x, y, z);
}

export const rotateAround = (center: Cube, c: Cube, intervals: number): Cube => add(rotateCoords(sub(c, center), intervals), center);

export function rotateDirection(dir: number, intervals: number): number {
  dir = intervals >= 0 ? dir + (intervals % 6) : dir - (-intervals % 6);
  if (dir >= 6) dir -= 6;
  else if (dir < 0) dir += 6;
  return dir;
}

export const flipDirection = (dir: number): number => rotateDirection(dir, 3);

export function signedIntervalsBetween(a: number, b: number): number {
  let n = b - a;
  if (n > 3) n -= 6;
  return n;
}

/** Centre of a hex on the plane (pointy-top lattice, unit size); only distances are used */
export const toPlane = (c: Cube): [number, number] => [Math.sqrt(3) * (c.x + c.z / 2), 1.5 * c.z];
