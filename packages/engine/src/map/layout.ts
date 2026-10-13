// Board layout for rendering: places each tile's hex meshes (from the game's tile art) at the generated
// global hex coordinates. Unity's hex lattice has y mirrored relative to the cube math in hex.ts, and a
// tile/section rotation of k steps is Euler(0, 0, 360 - 60k) in FFG, i.e. -60° per step.
import type { Cube } from "./hex.ts";
import type { GeneratedMap, GeneratedTile } from "./mapgen.ts";

export interface HexArt {
  /** Hex centre in tile space (Unity units) */
  center: [number, number];
  verts: [number, number][];
  uvs: [number, number][];
  tris: number[][];
}

export interface TileArt {
  /** Pack-relative texture path */
  texture: string | null;
  hexes: HexArt[];
  /** Tile.ExploreNode position in tile space: where the (square) explore token lies, on the printed mark */
  explore?: [number, number] | null;
  /** TileSpace.NodePosition per space (tile geometry order): where encounter tokens lie */
  nodes?: ([number, number] | null)[];
}

/** Distance between neighbouring hex centres / sqrt(3) in Unity units (tiles measure 1.013–1.019) */
export const HEX_SIZE = 1.019;

/** Centre of a hex in board (Unity world) coordinates */
export function cubeToWorld(c: Cube, size = HEX_SIZE): [number, number] {
  return [size * Math.sqrt(3) * (c.x + c.z / 2), -size * 1.5 * c.z];
}

export interface TileMesh {
  tile: GeneratedTile;
  texture: string | null;
  /** x, y per vertex */
  positions: number[];
  /** u, v per vertex */
  uvs: number[];
  indices: number[];
  /** World centre of each hex (same order as the tile geometry) */
  hexCenters: [number, number][];
  /** World position of the explore token (null if the art has none) */
  explore: [number, number] | null;
  /** World position of each space's node (encounter tokens), null where the art has none */
  nodes: ([number, number] | null)[];
  /** Tile rotation in radians (board space), e.g. to align the square explore token with the printed mark */
  angle: number;
}

/**
 * Mesh of one generated tile in board coordinates. The tile is placed rigidly like in Unity (rotation, then
 * translation so that the centroid of its hexes lands on the centroid of the generated hex positions); FFG's
 * art is not perfectly on the lattice (up to ~3% of a hex), the original shows the same tiny seams.
 */
export function layoutTile(t: GeneratedTile, art: TileArt): TileMesh {
  const a = (-60 * t.rotation * Math.PI) / 180;
  const cos = Math.cos(a), sin = Math.sin(a);
  const rot = (x: number, y: number): [number, number] => [cos * x - sin * y, sin * x + cos * y];
  const hexCenters = art.hexes.map((_, i) => cubeToWorld(t.hexes[i]!));
  const n = art.hexes.length;
  let wx = 0, wy = 0, ax = 0, ay = 0;
  hexCenters.forEach(([x, y]) => { wx += x / n; wy += y / n; });
  art.hexes.forEach((h) => { ax += h.center[0] / n; ay += h.center[1] / n; });
  const [rx, ry] = rot(ax, ay);
  const tx = wx - rx, ty = wy - ry;
  const positions: number[] = [], uvs: number[] = [], indices: number[] = [];
  for (const h of art.hexes) {
    const base = positions.length / 2;
    for (const [vx, vy] of h.verts) {
      const [px, py] = rot(vx, vy);
      positions.push(px + tx, py + ty);
    }
    for (const [u, v] of h.uvs) uvs.push(u, v);
    for (const tri of h.tris) for (const k of tri) indices.push(base + k);
  }
  const ex = art.explore ? rot(art.explore[0], art.explore[1]) : null;
  return { tile: t, texture: art.texture, positions, uvs, indices, hexCenters, explore: ex ? [ex[0] + tx, ex[1] + ty] : null, angle: a,
    nodes: (art.nodes ?? []).map((p) => { if (!p) return null; const [x, y] = rot(p[0], p[1]); return [x + tx, y + ty]; }) };
}

/** Largest error between the art's own hex layout (rotated) and the generated positions, in hex sizes */
export function layoutError(t: GeneratedTile, art: TileArt): number {
  if (art.hexes.length < 2) return 0;
  const a = (-60 * t.rotation * Math.PI) / 180;
  const [x0, y0] = cubeToWorld(t.hexes[0]!);
  const c0 = art.hexes[0]!.center;
  // the art's own hex spacing varies slightly per tile (1.013–1.019): compare shapes at the art's scale
  let num = 0, den = 0;
  art.hexes.forEach((h, i) => {
    const [wx, wy] = cubeToWorld(t.hexes[i]!);
    num += Math.hypot(h.center[0] - c0[0], h.center[1] - c0[1]);
    den += Math.hypot(wx - x0, wy - y0);
  });
  const k = den > 0 ? den / num : 1;
  let err = 0;
  art.hexes.forEach((h, i) => {
    const [wx, wy] = cubeToWorld(t.hexes[i]!);
    const dx = k * (h.center[0] - c0[0]), dy = k * (h.center[1] - c0[1]);
    const rx = Math.cos(a) * dx - Math.sin(a) * dy, ry = Math.sin(a) * dx + Math.cos(a) * dy;
    err = Math.max(err, Math.hypot(wx - x0 - rx, wy - y0 - ry) / HEX_SIZE);
  });
  return err;
}

export interface TileArtDb {
  standard: Record<string, TileArt>;
  custom: Record<string, Record<string, TileArt & { code: string }>>;
}

export function artFor(db: TileArtDb, advId: number, t: GeneratedTile): TileArt | null {
  if (t.customPid !== null) return db.custom[String(advId)]?.[String(t.customPid)] ?? null;
  return db.standard[t.code] ?? null;
}

/** All tile meshes of a board */
export function layoutBoard(map: GeneratedMap, advId: number, art: TileArtDb): TileMesh[] {
  const out: TileMesh[] = [];
  for (const s of map.sections) for (const t of s.tiles) {
    const a = artFor(art, advId, t);
    if (a) out.push(layoutTile(t, a));
  }
  return out;
}
