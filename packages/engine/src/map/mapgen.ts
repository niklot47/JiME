// Port of FFG's MapBuilder / SectionBuilder (map generation for "Normal" adventures).
// Goal: the same seed and campaign state give the same map as the original app (tiles, rotations,
// positions, encounters). Algorithm reverse-engineered from the decompiled game; no FFG code is copied.
// Time: the original reacts to wall-clock time (a 5 s "local minimum" rule while placing sections and a
// 6 s build time-out, +6 s per retry, after which LevelLoader retries with seed + 1). We replace the clock
// with a deterministic work counter (WORK_PER_SECOND placement checks = 1 s), so fast builds - nearly all -
// are exact, and pathological seeds behave like on a typical device instead of depending on CPU speed.
import { NetRandom, randomize } from "./netrandom.ts";
import { cmpNum, netSort } from "./netsort.ts";
import { type Cube, ZERO, add, eq, flipDirection, neighbor, rotateAround, rotateCoords, rotateDirection, signedIntervalsBetween, sub, toPlane, DIRECTIONS } from "./hex.ts";
import { keysOf } from "../ojson.ts";
import { gd, isDict, or, truthy } from "../py.ts";

const f32 = Math.fround;

/** In-place: c = rotateAround(center, c, intervals) (center passed by value) */
function rotateInPlace(c: Cube, cx: number, cy: number, cz: number, intervals: number): void {
  let x = c.x - cx, y = c.y - cy, z = c.z - cz;
  if (intervals !== 0 && !(x === 0 && y === 0 && z === 0)) {
    if (intervals > 0) for (let i = 0; i < intervals; i++) { const n = -x; x = -z; z = -y; y = n; }
    else for (let i = intervals; i < 0; i++) { const n = -x; x = -y; y = -z; z = n; }
  }
  c.x = x + cx; c.y = y + cy; c.z = z + cz;
}
/** Placement checks the original performs per second of build time (model of wall-clock time) */
export const WORK_PER_SECOND = 100_000;
/** Cheap loop steps (tile pool scans) relative to a placement check */
const SCAN_WEIGHT = 0.1;

export const EdgeTraits = { Standard: 0, Prohibited: 100, Water: 200, ShoreLeft: 300, ShoreRight: 400, Stream: 500, Road: 550, Passage: 600, Blocked: 700 } as const;
const ENC_RANDOM = 0, ENC_CHAIN = 2, ENC_ITEM = 4;
const NODE_THREAT = 2;

// ---------------------------------------------------------------- board objects
export class MEdge {
  readonly hex: MHex;
  readonly dir: number;
  readonly traits: number;
  readonly open: boolean;
  constructor(hex: MHex, dir: number, traits: number, open: boolean) {
    this.hex = hex; this.dir = dir; this.traits = traits; this.open = open;
  }
  get connectable(): boolean {
    return this.traits !== EdgeTraits.Prohibited && this.traits !== EdgeTraits.Water && this.traits !== EdgeTraits.Blocked;
  }
}

function canMatch(l: MEdge | null, r: MEdge | null): boolean {
  if (!l || !r) return false;
  const a = l.traits, b = r.traits;
  if (a === EdgeTraits.Blocked || b === EdgeTraits.Blocked) return true;
  if (a === EdgeTraits.Prohibited || b === EdgeTraits.Prohibited || a === EdgeTraits.Water || b === EdgeTraits.Water) return false;
  if (a === EdgeTraits.ShoreLeft) return b === EdgeTraits.ShoreRight;
  if (a === EdgeTraits.ShoreRight) return b === EdgeTraits.ShoreLeft;
  if (a === EdgeTraits.Passage && b === EdgeTraits.Standard) return l.open;
  if (a === EdgeTraits.Standard && b === EdgeTraits.Passage) return r.open;
  return a === b;
}

function isConnection(l: MEdge | null, r: MEdge | null): boolean {
  if (!l || !r || !l.connectable || !r.connectable) return false;
  const a = l.traits, b = r.traits;
  if (a === EdgeTraits.ShoreLeft) return b === EdgeTraits.ShoreRight;
  if (a === EdgeTraits.ShoreRight) return b === EdgeTraits.ShoreLeft;
  if (a === EdgeTraits.Passage && b === EdgeTraits.Standard) return l.open;
  if (a === EdgeTraits.Standard && b === EdgeTraits.Passage) return r.open;
  return a === b;
}

export class MSpace {
  readonly tile: MTile;
  readonly traits: number;
  encounterId = -1;
  connected: MSpace[] = [];
  constructor(tile: MTile, traits: number) {
    this.tile = tile; this.traits = traits;
  }
  get hasEncounter(): boolean { return this.encounterId >= 0; }
  hasAny(t: number): boolean { return (this.traits & t) !== 0; }
  hasAll(t: number): boolean { return (this.traits & t) === t; }
  get index(): number { return this.tile.spaces.indexOf(this); }
  reset(): void { this.encounterId = -1; this.connected = []; }
}

export class MHex {
  readonly tile: MTile;
  readonly tileCoords: Cube;
  globalCoords: Cube;
  space!: MSpace;
  constructor(tile: MTile, c: Cube) {
    this.tile = tile; this.tileCoords = c; this.globalCoords = { ...c };
  }
}

interface EdgeData { tileId: number; dir: number; coords: Cube }

export class MTile {
  readonly code: string;
  readonly hashId: number;
  readonly otherSideHashId: number;
  readonly set: number;
  readonly custom: boolean;
  readonly hexes: MHex[];
  readonly spaces: MSpace[];
  readonly edges: MEdge[];
  localRotations = 0;
  section: MSection | null = null;
  localOutsideEdges: EdgeData[] | null = null;

  constructor(geo: any, model: any, custom: boolean) {
    this.code = geo.code;
    this.hashId = model.HashId;
    this.otherSideHashId = gd(model, "OtherSideHashId", 0);
    this.set = gd(model, "Set", 0);
    this.custom = custom;
    this.hexes = geo.hexes.map((h: any) => new MHex(this, { x: h.x, y: h.y, z: h.z }));
    this.spaces = geo.spaces.map((s: any) => new MSpace(this, s.traits));
    geo.hexes.forEach((h: any, i: number) => { this.hexes[i]!.space = this.spaces[h.space]!; });
    this.edges = geo.edges.map((e: any) => new MEdge(this.hexes[e.hex]!, e.dir, e.traits, e.open));
  }

  rotationIntervals(local: boolean): number {
    return local ? this.localRotations : this.localRotations + (this.section ? this.section.localRotations : 0);
  }

  getHex(c: Cube, world: boolean): MHex | null {
    for (const h of this.hexes) if (eq(world ? h.globalCoords : h.tileCoords, c)) return h;
    return null;
  }

  getEdge(c: Cube, dir: number, global: boolean): MEdge | null {
    if (global) dir = rotateDirection(dir, -this.rotationIntervals(false));
    for (const e of this.edges) {
      if (e.dir !== dir) continue;
      if (eq(global ? e.hex.globalCoords : e.hex.tileCoords, c)) return e;
    }
    return null;
  }

  spaceCount(traits?: number): number {
    return traits === undefined ? this.spaces.length : this.spaces.filter((s) => s.hasAny(traits)).length;
  }

  encounterCount(): number {
    return this.spaces.filter((s) => s.hasEncounter).length;
  }

  hasEncounter(id: number): boolean {
    return this.spaces.some((s) => s.encounterId === id);
  }

  calculateLocalOutsideEdges(): void {
    if (this.localOutsideEdges) return;
    const out: EdgeData[] = [];
    for (const h of this.hexes) {
      for (let d = 0; d < 6; d++) if (!this.getHex(neighbor(h.tileCoords, d), false)) out.push({ tileId: this.hashId, coords: h.tileCoords, dir: d });
    }
    if (out.length) this.localOutsideEdges = out;
  }

  /** Tile.SnapTo: rotate and move so that ourHex's edge faces targetHex's edge */
  snapTo(ourHex: MHex, ourEdge: number, targetHex: MHex, targetEdge: number): void {
    const r1 = this.rotationIntervals(true);
    const r2 = targetHex.tile.rotationIntervals(true);
    const n = 3 + signedIntervalsBetween(rotateDirection(ourEdge, r1), rotateDirection(targetEdge, r2));
    if (n !== 0) this.rotateAround(ourHex.tileCoords, n);
    let dir = DIRECTIONS[targetEdge]!;
    if (r2 !== 0) dir = rotateAround(ZERO, dir, r2);
    const d = sub(add(targetHex.globalCoords, dir), ourHex.globalCoords);
    for (const h of this.hexes) { h.globalCoords.x += d.x; h.globalCoords.y += d.y; h.globalCoords.z += d.z; }
  }

  rotateAround(localPoint: Cube, intervals: number): void {
    if (intervals === 0) return;
    const hex = this.getHex(localPoint, false);
    if (!hex) return;
    this.localRotations += intervals;
    if (this.localRotations >= 6) this.localRotations -= 6;
    else if (this.localRotations < 0) this.localRotations += 6;
    const { x, y, z } = hex.globalCoords;
    for (const h of this.hexes) rotateInPlace(h.globalCoords, x, y, z, intervals);
  }

  overlapsTile(t: MTile): boolean {
    for (const a of this.hexes) for (const b of t.hexes) if (eq(a.globalCoords, b.globalCoords)) return true;
    return false;
  }

  overlapsSection(s: MSection): boolean {
    return s.tiles.some((t) => this.overlapsTile(t));
  }

  reset(): void {
    for (const h of this.hexes) h.globalCoords = { ...h.tileCoords };
    for (const s of this.spaces) s.reset();
    this.section = null;
    this.localRotations = 0;
  }
}

export class MSection {
  readonly id: number;
  tiles: MTile[] = [];
  localRotations = 0;
  map: MMap | null = null;
  localOutsideEdges: EdgeData[] | null = null;
  outsideEdges: EdgeData[] = [];
  constructor(id: number) {
    this.id = id;
  }

  getHexByTile(tileId: number, c: Cube, world: boolean): MHex | null {
    for (const t of this.tiles) if (t.hashId === tileId) return t.getHex(c, world);
    return null;
  }

  getHex(c: Cube, world: boolean): MHex | null {
    for (const t of this.tiles) {
      const h = t.getHex(c, world);
      if (h) return h;
    }
    return null;
  }

  contains(c: Cube): boolean {
    return this.getHex(c, true) !== null;
  }

  spaceCount(): number {
    return this.tiles.reduce((n, t) => n + t.spaces.length, 0);
  }

  encounterCount(): number {
    return this.tiles.reduce((n, t) => n + t.encounterCount(), 0);
  }

  hasEncounter(id: number): boolean {
    return this.tiles.some((t) => t.hasEncounter(id));
  }

  getTile(tileId: number): MTile | null {
    return this.tiles.find((t) => t.hashId === tileId) ?? null;
  }

  indexOf(tileId: number): number {
    return this.tiles.findIndex((t) => t.hashId === tileId);
  }

  add(t: MTile): void {
    this.tiles.push(t);
    t.section = this;
    this.radius = -1;
  }

  remove(t: MTile): void {
    const i = this.tiles.indexOf(t);
    if (i >= 0) this.tiles.splice(i, 1);
    t.section = null;
    this.radius = -1;
  }

  snapTo(ourHex: MHex, ourEdge: number, targetHex: MHex, targetEdge: number): void {
    const r1 = ourHex.tile.rotationIntervals(false);
    const r2 = targetHex.tile.rotationIntervals(false);
    const n = 3 + signedIntervalsBetween(rotateDirection(ourEdge, r1), rotateDirection(targetEdge, r2));
    if (n !== 0) this.rotateAround(ourHex.globalCoords, n);
    let dir = DIRECTIONS[targetEdge]!;
    if (r2 !== 0) dir = rotateCoords(dir, r2);
    const d = sub(add(targetHex.globalCoords, dir), ourHex.globalCoords);
    for (const t of this.tiles) for (const h of t.hexes) { h.globalCoords.x += d.x; h.globalCoords.y += d.y; h.globalCoords.z += d.z; }
  }

  rotateAround(globalPoint: Cube, intervals: number): void {
    if (intervals === 0) return;
    const hex = this.getHex(globalPoint, true);
    if (!hex) return;
    this.localRotations += intervals;
    if (this.localRotations >= 6) this.localRotations -= 6;
    else if (this.localRotations < 0) this.localRotations += 6;
    const { x, y, z } = hex.globalCoords;
    for (const t of this.tiles) for (const h of t.hexes) rotateInPlace(h.globalCoords, x, y, z, intervals);
  }

  overlaps(s: MSection): boolean {
    return this.tiles.some((t) => t.overlapsSection(s));
  }

  calculateLocalOutsideEdges(): void {
    if (this.localOutsideEdges) return;
    const out: EdgeData[] = [];
    for (const t of this.tiles) {
      const r = t.rotationIntervals(false);
      for (const h of t.hexes) {
        for (let d = 0; d < 6; d++) {
          if (!this.contains(neighbor(h.globalCoords, d))) out.push({ tileId: t.hashId, coords: h.tileCoords, dir: rotateDirection(d, -r) });
        }
      }
    }
    if (out.length) this.localOutsideEdges = out;
  }

  getOutsideEdges(): EdgeData[] {
    const out: EdgeData[] = [];
    for (const t of this.tiles) {
      const r = t.rotationIntervals(false);
      for (const h of t.hexes) {
        for (let d = 0; d < 6; d++) {
          const nb = neighbor(h.globalCoords, d);
          if ((this.map !== null && this.map.getHex(nb, true) === null) || !this.contains(nb)) {
            out.push({ tileId: t.hashId, coords: h.tileCoords, dir: rotateDirection(d, -r) });
          }
        }
      }
    }
    this.outsideEdges = out;
    return out;
  }

  private radius = -1;

  /**
   * Section.BoundingSphere: pivot = centroid of hex centres (set when the section is centred), radius to the
   * farthest hex. Rigid moves keep the radius (FFG caches it too); the centroid is linear in cube coords.
   */
  boundingSphere(): [number, number, number] {
    let sx = 0, sz = 0, n = 0;
    for (const t of this.tiles) for (const h of t.hexes) { sx += h.globalCoords.x; sz += h.globalCoords.z; n++; }
    const [cx, cy] = toPlane({ x: sx / n, y: 0, z: sz / n });
    if (this.radius < 0) {
      let r2 = 0;
      for (const t of this.tiles) for (const h of t.hexes) {
        const [x, y] = toPlane(h.globalCoords);
        r2 = Math.max(r2, (x - cx) ** 2 + (y - cy) ** 2);
      }
      this.radius = Math.sqrt(r2);
    }
    return [cx, cy, this.radius];
  }
}

const hkey = (c: Cube): number => c.x * 65536 + c.z;

export class MMap {
  sections: MSection[] = [];
  /** Global-coords index of hexes on the map; sections on the map do not move, so it only changes on add/remove */
  private index: Map<number, MHex> | null = null;

  private hexIndex(): Map<number, MHex> {
    if (!this.index) {
      this.index = new Map();
      // reverse order so that the first section/tile wins, like the linear search
      for (let i = this.sections.length - 1; i >= 0; i--) {
        const s = this.sections[i]!;
        for (let j = s.tiles.length - 1; j >= 0; j--) for (const h of s.tiles[j]!.hexes) this.index.set(hkey(h.globalCoords), h);
      }
    }
    return this.index;
  }

  /** True if any hex of `s` (not on the map) sits on a hex of the map */
  overlapsAny(s: MSection): boolean {
    const idx = this.hexIndex();
    for (const t of s.tiles) for (const h of t.hexes) if (idx.has(hkey(h.globalCoords))) return true;
    return false;
  }

  getHex(c: Cube, world: boolean): MHex | null {
    if (world) {
      const h = this.hexIndex().get(hkey(c));
      return h && eq(h.globalCoords, c) ? h : null;
    }
    for (const s of this.sections) {
      const h = s.getHex(c, world);
      if (h) return h;
    }
    return null;
  }

  getHexByTile(tileId: number, c: Cube, world: boolean): MHex | null {
    for (const s of this.sections) {
      const h = s.getHexByTile(tileId, c, world);
      if (h) return h;
    }
    return null;
  }

  getTile(tileId: number): MTile | null {
    for (const s of this.sections) {
      const t = s.getTile(tileId);
      if (t) return t;
    }
    return null;
  }

  hasEncounter(id: number): boolean {
    return this.sections.some((s) => s.hasEncounter(id));
  }

  spaceCount(): number {
    return this.sections.reduce((n, s) => n + s.spaceCount(), 0);
  }

  encounterCount(): number {
    return this.sections.reduce((n, s) => n + s.encounterCount(), 0);
  }

  getOutsideEdges(): EdgeData[] {
    return this.sections.flatMap((s) => s.getOutsideEdges());
  }

  add(s: MSection): void {
    this.sections.push(s);
    s.map = this;
    this.index = null;
  }

  remove(s: MSection): void {
    const i = this.sections.indexOf(s);
    if (i >= 0) this.sections.splice(i, 1);
    s.map = null;
    this.index = null;
  }

  contains(s: MSection): boolean {
    return this.sections.includes(s);
  }
}

class Bucket {
  readonly all: MTile[];
  tiles: MTile[];
  private readonly used = new Map<number, boolean>();
  private readonly byHash = new Map<number, MTile>();
  constructor(tiles: MTile[]) {
    this.all = tiles;
    this.tiles = [...tiles];
    for (const t of tiles) { this.byHash.set(t.hashId, t); this.used.set(t.hashId, false); }
  }
  reset(): void {
    for (const t of this.all) { t.reset(); this.used.set(t.hashId, false); }
  }
  shuffle(rng: NetRandom): void {
    this.tiles = [...this.all];
    randomize(this.tiles, rng);
  }
  contains(id: number): boolean { return this.byHash.has(id); }
  remove(id: number): MTile | null {
    if (!this.used.has(id)) throw new Error(`KeyNotFound: tile ${id}`);
    if (this.used.get(id)) return null;
    this.used.set(id, true);
    return this.byHash.get(id)!;
  }
  give(id: number): void { this.used.set(id, false); }
}

/** SequenceTree<int>: sequences of choices that led to dead ends */
class SequenceTree {
  private root: { data: number; children: any[] } = { data: 0, children: [] };
  get count(): number {
    const c = (n: any): number => n.children.reduce((s: number, x: any) => s + 1 + c(x), 0);
    return c(this.root);
  }
  clear(): void { this.root.children = []; }
  private child(n: any, d: number): any { return n.children.find((x: any) => x.data === d) ?? null; }
  wouldExist(path: number[], extra: number): boolean {
    let n = this.root;
    for (const p of path) { n = this.child(n, p); if (!n) return false; }
    return this.child(n, extra) !== null;
  }
  add(path: number[]): void {
    let n = this.root;
    for (const p of path) {
      let c = this.child(n, p);
      if (!c) { c = { data: p, children: [] }; n.children.push(c); }
      n = c;
    }
    n.children = [];
  }
}

// ---------------------------------------------------------------- generator input/output
export interface MapGenOptions {
  seed: number;
  players: number;
  /** Owned product ids (FFG: Core Set = 0) */
  products?: number[];
  /** Game language name or code ("English", "Russian", "ru" ...): some encounters are unsupported in some languages */
  language?: string;
  unlockedChain?: number[];
  usedEncounters?: number[];
  usedGroups?: number[];
  /** Party inventory item ids (GroupItemIds) and each hero's items */
  groupItems?: number[];
  heroItems?: number[][];
  /** Retries with seed + 1 on failure, like LevelLoader */
  maxAttempts?: number;
}

export interface GeneratedTile {
  code: string;
  hashId: number;
  section: number;
  /** Total rotation in 60° steps (tile + section) */
  rotation: number;
  /** Global cube coords of the tile's hexes (same order as the tile geometry) */
  hexes: Cube[];
  /** Encounter id per space (-1 = none) */
  encounters: number[];
  /** Per space: connected spaces on other tiles, as [tileHashId, spaceIndex], in FFG discovery order */
  connected: [number, number][][];
  /** For custom tiles: the adventure GameObject id */
  customPid: number | null;
}

export interface GeneratedMap {
  seed: number;
  attempts: number;
  sections: { id: number; tiles: GeneratedTile[] }[];
  encounterGroup: number | null;
  /** Spaces with encounters in FFG spawn order (_allSpaces order): [tileHashId, spaceIndex, encounterId] */
  spawnOrder: [number, number, number][];
  usedEncounters: number[];
  usedGroups: number[];
}

export class MapGenError extends Error {}

export const LANG: Record<string, string> = {
  en: "English", es: "Spanish", fr: "French", de: "German", it: "Italian", pt: "Portuguese", pl: "Polish",
  hu: "Hungarian", zh: "Chinese", cz: "Czech", cs: "Czech", ru: "Russian", ko: "Korean", uk: "Ukrainian",
};

// ---------------------------------------------------------------- section builder
class SB {
  readonly cfg: any;
  readonly goId: number;
  id = 0;
  section!: MSection;
  availableTiles: MTile[] = [];
  spacesFromAvailable = 0;
  lastAttachedTileId = -1;
  isSeeded = false;
  isFinished = false;
  extraSpaces = 0;
  requiredConnected: number[] = [];
  sectionPlacements: SectionPlacement[] = [];
  readonly gen: MapGenerator;

  constructor(gen: MapGenerator, goId: number, cfg: any) {
    this.gen = gen; this.goId = goId; this.cfg = cfg;
  }

  get allowed(): number { return gd(this.cfg, "AllowedTileSets", 0); }
  get minSpaces(): number { return gd(this.cfg, "MinimumSpaces", 0); }
  get maxSpaces(): number { return gd(this.cfg, "MaximumSpaces", 0); }
  get ignoreScaling(): boolean { return truthy(gd(this.cfg, "IgnorePlayerScaling")); }
  get tileClump(): number { return f32(gd(this.cfg, "TileClumpFactor", 0)); }
  get sectionClump(): number { return f32(gd(this.cfg, "SectionClumpFactor", 0)); }
  get relativeSize(): number { return f32(gd(this.cfg, "RelativeSizeFactor", 0)); }
  get fillPercent(): number { return f32(gd(this.cfg, "RandomFillPercent", 0)); }
  get traitReqs(): { Trait: number; Count: number }[] {
    return or(gd(this.cfg, "SpaceTraitRequirements"), []).map((r: any) => ({ Trait: gd(r, "Trait", 0), Count: gd(r, "Count", 0) }));
  }
  get startTile(): any { return gd(this.cfg, "StartTileInfo"); }
  get specifyStart(): boolean { return this.startTile !== null && truthy(gd(this.startTile, "SpecifyStartTile")); }
  get requiredTiles(): any[] { return or(gd(this.cfg, "RequiredTiles"), []); }
  get tileEncounters(): any[] { return or(gd(this.cfg, "TileEncounters"), []); }
  get sectionEncounters(): any[] | null { return gd(this.cfg, "SectionEncounters", null); }

  initialize(id: number): void {
    this.id = id;
    this.section = new MSection(id);
    this.availableTiles = [];
    this.sectionPlacements = [];
    this.requiredConnected = [];
    for (const pair of this.gen.requiredConnections) {
      if (pair[0] === this.section.id) { if (!this.requiredConnected.includes(pair[1])) this.requiredConnected.push(pair[1]); }
      else if (pair[1] === this.section.id) { if (!this.requiredConnected.includes(pair[0])) this.requiredConnected.push(pair[0]); }
    }
  }

  reset(): void {
    if (this.section) {
      for (const t of this.section.tiles) { t.reset(); this.gen.returnTile(t); }
    }
    this.availableTiles = [];
    this.requiredConnected = [];
    this.spacesFromAvailable = 0;
    this.lastAttachedTileId = -1;
    this.isSeeded = false;
    this.isFinished = false;
    this.extraSpaces = 0;
    this.sectionPlacements = [];
  }

  private addToAvailable(t: MTile): void {
    if (!this.gen.ownedTileCodes.has(t.code)) return;
    this.availableTiles.push(t);
    this.spacesFromAvailable += t.spaces.length;
  }

  seedStartTile(): boolean {
    if (this.specifyStart) {
      const t = this.gen.getTile(this.gen.hashOf(gd(gd(this.startTile, "Tile"), "TileCode")));
      if (!t) return false;
      this.addToAvailable(t);
    }
    return true;
  }

  seedRequiredTiles(): boolean {
    for (const rt of this.requiredTiles) {
      const t = this.gen.getTile(this.gen.hashOf(gd(rt, "TileCode")));
      if (!t) return false;
      this.addToAvailable(t);
    }
    return true;
  }

  private reqCache: Set<number> | null = null;

  requiresTile(id: number): boolean {
    if (!this.reqCache) {
      this.reqCache = new Set(this.requiredTiles.map((rt) => this.gen.hashOf(gd(rt, "TileCode"))));
      if (this.specifyStart) this.reqCache.add(this.gen.hashOf(gd(gd(this.startTile, "Tile"), "TileCode")));
    }
    return this.reqCache.has(id);
  }

  private availableSpaces(trait?: number): number {
    return this.availableTiles.reduce((n, t) => n + t.spaceCount(trait), 0);
  }

  hasMetTraitRequirement(): boolean {
    const reqs = this.traitReqs;
    if (!reqs.length) return true;
    if (!this.availableTiles.length) return false;
    const req: number[] = [];
    for (const r of reqs) for (let i = 0; i < r.Count; i++) req.push(r.Trait);
    const avail: number[] = [];
    for (const t of this.availableTiles) for (const s of t.spaces) if (s.traits !== 0) avail.push(s.traits);
    return meetsTraitRequirement(req, avail);
  }

  hasMetSize(): boolean {
    return this.availableSpaces() >= this.minSpaces + this.extraSpaces;
  }

  hasMetSectionEncounters(): boolean {
    const se = this.sectionEncounters;
    return !se || se.every((e) => this.section.hasEncounter(this.gen.encId(e)));
  }

  private canUse(t: MTile): boolean {
    if (!this.gen.canSectionUse(this.section.id, t.hashId)) return false;
    if ((t.set & ~this.allowed) !== 0) return false;
    if (this.gen.isAlreadySeeded(t.otherSideHashId)) return false;
    if (this.spacesFromAvailable + t.spaces.length > this.maxSpaces + this.extraSpaces) return false;
    if (this.gen.invalidSeq.wouldExist(this.gen.mapSeq, t.hashId)) return false;
    return true;
  }

  trySeedTraitTile(): number {
    const reqs = this.traitReqs;
    for (const st of this.gen.standard.tiles) {
      this.gen.tick(SCAN_WEIGHT);
      const id = st.hashId;
      if (!this.gen.canSectionUse(this.section.id, id) || this.gen.isAlreadySeeded(id)) continue;
      const t = this.gen.getTile(id);
      if (!t) continue;
      if (!this.canUse(t)) { this.gen.returnTile(t); continue; }
      for (const r of reqs) {
        if (t.spaceCount(r.Trait) > 0 && this.availableSpaces(r.Trait) < r.Count) {
          this.addToAvailable(t);
          return t.hashId;
        }
      }
      this.gen.returnTile(t);
    }
    return -1;
  }

  trySeedRandomTile(): number {
    for (const st of this.gen.standard.tiles) {
      this.gen.tick(SCAN_WEIGHT);
      const id = st.hashId;
      if (!this.gen.canSectionUse(this.section.id, id) || this.gen.isAlreadySeeded(id)) continue;
      const t = this.gen.getTile(id);
      if (!t) continue;
      if (this.canUse(t)) { this.addToAvailable(t); return id; }
      this.gen.returnTile(t);
    }
    return -1;
  }

  removeFromAvailable(id: number): void {
    let n = -1;
    this.availableTiles.forEach((t, i) => { if (t.hashId === id) n = i; });
    if (n !== -1) {
      this.spacesFromAvailable -= this.availableTiles[n]!.spaces.length;
      this.gen.returnTile(this.availableTiles[n]!);
      this.availableTiles.splice(n, 1);
    }
  }

  private takeAvailable(id: number): MTile | null {
    const i = this.availableTiles.findIndex((t) => t.hashId === id);
    if (i < 0) return null;
    return this.availableTiles.splice(i, 1)[0]!;
  }

  private placeStartTile(t: MTile, rng: NetRandom): void {
    t.rotateAround(ZERO, rng.next(0, 6));
    this.section.add(t);
    this.lastAttachedTileId = t.hashId;
  }

  /** CoroutineAttachNextTile */
  attachNextTile(rng: NetRandom): void {
    const gen = this.gen;
    if (!this.availableTiles.length) { this.lastAttachedTileId = -1; return; }
    if (!this.section.tiles.length) {
      if (this.specifyStart) {
        const t = this.takeAvailable(gen.hashOf(gd(gd(this.startTile, "Tile"), "TileCode")));
        if (!t) this.lastAttachedTileId = -1;
        else { this.placeStartTile(t, rng); this.lastAttachedTileId = t.hashId; }
      } else {
        const t = this.takeAvailable(this.availableTiles[rng.next(0, this.availableTiles.length)]!.hashId)!;
        this.placeStartTile(t, rng);
        this.lastAttachedTileId = t.hashId;
      }
      return;
    }
    let hashId: number;
    if (gen.invalidSeq.count > 0) {
      const valid = (t: MTile) => !gen.invalidSeq.wouldExist(gen.mapSeq, t.hashId);
      netSort(this.availableTiles, (a, b) => cmpNum(valid(b), valid(a)));
      let num = -1;
      this.availableTiles.forEach((t, i) => { if (valid(t)) num = i; });
      if (num === -1) { this.lastAttachedTileId = -1; return; }
      hashId = this.availableTiles[rng.next(0, num + 1)]!.hashId;
    } else {
      hashId = this.availableTiles[rng.next(0, this.availableTiles.length)]!.hashId;
    }
    const tile = this.takeAvailable(hashId)!;
    const newEdges = tile.localOutsideEdges ?? [];
    const placements: TilePlacement[] = [];
    const outside = this.section.getOutsideEdges();
    for (const target of outside) {
      const targetHex = this.section.getHexByTile(target.tileId, target.coords, false)!;
      const targetEdge = targetHex.tile.getEdge(target.coords, target.dir, false);
      if (!targetEdge || !targetEdge.connectable) continue;
      for (const ours of newEdges) {
        const edge = tile.getEdge(ours.coords, ours.dir, false);
        if (!edge || !edge.connectable || !isConnection(edge, targetEdge)) continue;
        const ourHex = tile.getHex(ours.coords, false)!;
        gen.tick();
        tile.snapTo(ourHex, ours.dir, targetHex, target.dir);
        if (tile.overlapsSection(this.section)) continue;
        let open = outside.length + newEdges.length;
        let violates = false;
        const rot = tile.rotationIntervals(true);
        for (const ne of newEdges) {
          const hex = tile.getHex(ne.coords, false)!;
          const d = rotateDirection(ne.dir, rot);
          const hex2 = this.section.getHex(neighbor(hex.globalCoords, d), true);
          if (hex2) {
            const e2 = hex.tile.getEdge(hex.globalCoords, d, true);
            if (!canMatch(hex2.tile.getEdge(hex2.globalCoords, flipDirection(d), true), e2)) { violates = true; break; }
            open -= 2;
          }
        }
        if (!violates) {
          placements.push({ open, anchor: ourHex.tileCoords, edgeDir: ours.dir, target: targetHex.globalCoords, targetDir: target.dir });
        }
      }
    }
    tile.reset();
    netSort(placements, (a, b) => cmpNum(a.open, b.open));
    const idx = Math.trunc(f32(f32(placements.length - 1) * f32(1 - this.tileClump)));
    const p = placements[idx];
    if (!p) throw new MapGenError(`no placement for tile ${tile.code} in section ${this.id}`); // FFG: coroutine exception -> time-out
    tile.snapTo(tile.getHex(p.anchor, false)!, p.edgeDir, this.section.getHex(p.target, true)!, p.targetDir);
    this.section.add(tile);
    this.lastAttachedTileId = tile.hashId;
  }

  seedTileEncounters(rng: NetRandom): boolean {
    for (const te of this.tileEncounters) {
      const id = this.gen.encId(gd(te, "Encounter"));
      if (this.section.map!.hasEncounter(id)) return false;
      if (!this.gen.anyEncounter(id)) return false;
      const tile = this.section.getTile(this.gen.hashOf(gd(te, "TileCode")));
      if (!tile) return false;
      const index = truthy(gd(te, "SpecifySpaceIndex")) ? gd(te, "SpaceIndex", 0) : rng.next(0, tile.spaces.length);
      const space = tile.spaces[index];
      if (!space || space.encounterId >= 0) return false;
      space.encounterId = id;
    }
    return true;
  }

  trySeedFromCollection(encounters: any[], seq: number[], invalid: SequenceTree, rng: NetRandom): MSpace | null {
    for (const em of encounters) {
      const id = this.gen.encId(em);
      if (this.section.map!.hasEncounter(id) || invalid.wouldExist(seq, id)) continue;
      const enc = this.gen.anyEncounter(id);
      if (!enc) continue;
      const eligible: MSpace[] = [];
      for (const t of this.section.tiles) for (const s of t.spaces) if (s.encounterId < 0 && this.gen.meetsRequirements(s, enc)) eligible.push(s);
      if (!eligible.length) continue;
      let seeded: MSpace;
      if (gd(enc, "NodeType", 0) === NODE_THREAT) {
        const adj = (s: MSpace) => this.gen.adjacentEncounters(s, NODE_THREAT);
        netSort(eligible, (a, b) => cmpNum(adj(a), adj(b)));
        const first = adj(eligible[0]!);
        let num = 0;
        for (let l = 1; l < eligible.length && adj(eligible[l]!) <= first; l++) num = l;
        seeded = eligible[rng.next(0, num + 1)]!;
      } else {
        seeded = eligible[rng.next(0, eligible.length)]!;
      }
      seeded.encounterId = id;
      return seeded;
    }
    return null;
  }
}

interface TilePlacement { open: number; anchor: Cube; edgeDir: number; target: Cube; targetDir: number }

interface SectionPlacement {
  open: number;
  tile1: number; hex1: Cube; edge1: number;
  tile2: number; hex2: Cube; edge2: number;
}

/** SectionBuilder.MeetsSpaceTraitRequirement (backtracking assignment of required traits to spaces) */
function meetsTraitRequirement(req: number[], avail: number[]): boolean {
  const reserved: number[] = [];
  let start = 0;
  let r = 0;
  while (r < req.length) {
    const need = req[r]!;
    let found = false;
    for (let i = start; i < avail.length; i++) {
      if (reserved.includes(i)) continue;
      if ((need & avail[i]!) === need) { reserved.push(i); found = true; break; }
    }
    if (!found) {
      if (!reserved.length) return false;
      start = reserved.pop()! + 1;
      r--;
    } else {
      start = 0;
      r++;
    }
  }
  return true;
}

// ---------------------------------------------------------------- map builder
export class MapGenerator {
  readonly D: any;
  readonly adv: any;
  readonly opts: Required<MapGenOptions>;
  readonly mb: any;
  readonly sections: SB[];
  readonly requiredConnections: [number, number][] = [];
  readonly invalidConnections: [SB, SB][] = [];
  readonly standard: Bucket;
  readonly customBucket: Bucket | null;
  readonly ownedTileCodes: Set<string>;
  readonly encById = new Map<number, any>();
  private readonly ownedEncounters: any[] = [];
  private readonly ownedGroups: any[] = [];
  private readonly maxItemCounts = new Map<number, number>();
  private readonly tileHash = new Map<string, number>();
  map = new MMap();
  mapSeq: number[] = [];
  invalidSeq = new SequenceTree();
  private seedHistory: { sectionId: number; tileId: number }[] = [];
  private allSpaces: MSpace[] = [];
  private randomEncounterPool: any[] = [];
  private randomItemPool: any[] = [];
  private percentNormal = f32(0.4);
  private rollbackSectionId = 0;
  private work = 0;
  private timeout = 6;
  private mostReq: SB | null = null;
  private groupResult: any = null;

  constructor(db: any, adventure: any, opts: MapGenOptions) {
    this.D = db;
    this.adv = adventure;
    this.opts = {
      products: [0], language: "English", unlockedChain: [], usedEncounters: [], usedGroups: [], groupItems: [], heroItems: [],
      maxAttempts: 20, ...opts,
    };
    const objs = adventure.gameObjects;
    let mbGo: string | null = null;
    for (const k of keysOf(objs)) if (objs[k].components?.MapBuilder) mbGo = k;
    if (mbGo === null) throw new MapGenError("adventure has no MapBuilder");
    this.mb = objs[mbGo].components.MapBuilder;
    const sbRefs: any[] = or(gd(this.mb, "Sections"), []);
    this.sections = sbRefs.map((r) => new SB(this, r.go, objs[String(r.go)].components.SectionBuilder));
    const sbIndex = (r: any) => sbRefs.findIndex((x) => x.go === r.go);
    for (const p of or(gd(this.mb, "RequiredConnections"), [])) this.requiredConnections.push([sbIndex(p.Section1), sbIndex(p.Section2)]);
    for (const p of or(gd(this.mb, "InvalidConnections"), [])) this.invalidConnections.push([this.sections[sbIndex(p.Section1)]!, this.sections[sbIndex(p.Section2)]!]);
    // tiles
    const TM = db.models.TileModel;
    for (const code of keysOf(TM)) this.tileHash.set(code, TM[code].HashId);
    if (!db.tiles) throw new MapGenError("pack has no tile geometry (db.tiles); rebuild it with export_tiles.py + make_pack.py");
    this.standard = new Bucket(db.tiles.map((g: any) => new MTile(g, TM[g.code], false)));
    const custom = adventure.ext?.customTiles ?? {};
    const customTiles: MTile[] = [];
    for (const pid of keysOf(custom)) {
      const g = custom[pid];
      const t = new MTile(g, TM[g.code], true);
      (t as any).customPid = Number(pid);
      customTiles.push(t);
    }
    this.customBucket = customTiles.length ? new Bucket(customTiles) : null;
    // owned collection (UserCollectionManager.LoadUserCollection)
    const P = db.models.ProductModel;
    const order: number[] = db.productOrder ?? keysOf(P).map(Number);
    this.ownedTileCodes = new Set();
    const seenEnc = new Set<number>();
    for (const pid of order) {
      if (!this.opts.products.includes(pid)) continue;
      const p = P[String(pid)];
      if (!p) continue;
      for (const t of or(gd(p, "Tiles"), [])) if (t) this.ownedTileCodes.add(t.id);
      for (const iq of or(gd(p, "Items"), [])) {
        const id = gd(gd(iq, "Item"), "id");
        if (id !== null) this.maxItemCounts.set(id, (this.maxItemCounts.get(id) ?? 0) + gd(iq, "Quantity", 0));
      }
      for (const g of or(gd(p, "EncounterGroups"), [])) {
        const gm = db.models.EncounterGroupModel[String(g.id)];
        if (gm && !this.ownedGroups.includes(gm)) this.ownedGroups.push(gm);
      }
      for (const e of or(gd(p, "Encounters"), [])) {
        const em = db.models.EncounterModel[String(e.id)];
        if (em && !seenEnc.has(e.id)) { seenEnc.add(e.id); this.ownedEncounters.push(em); this.encById.set(Number(e.id), em); }
      }
    }
  }

  // ------------------------------------------------------------ helpers
  /** Count one unit of build work; throws like the original's build time-out */
  tick(weight = 1): void {
    this.work += weight;
    if (this.work > this.timeout * WORK_PER_SECOND) throw new MapGenError("build time-out");
  }

  elapsed(): number {
    return this.work / WORK_PER_SECOND;
  }

  hashOf(code: string): number {
    return this.tileHash.get(code) ?? -1;
  }

  /** Encounter id from a model reference ({id}) or a model object ({_id}) */
  encId(ref: any): number {
    return Number(isDict(ref) ? (ref.id ?? ref._id) : ref);
  }

  /** UserCollectionManager.GetEncounter(id, ownedOnly: false) */
  anyEncounter(id: number): any {
    return this.D.models.EncounterModel[String(id)] ?? null;
  }

  private isCustom(id: number): boolean {
    return this.customBucket !== null && this.customBucket.contains(id);
  }

  getTile(id: number): MTile | null {
    return this.isCustom(id) ? this.customBucket!.remove(id) : this.standard.remove(id);
  }

  returnTile(t: MTile): void {
    if (this.isCustom(t.hashId)) this.customBucket!.give(t.hashId);
    else this.standard.give(t.hashId);
  }

  canSectionUse(sectionId: number, tileId: number): boolean {
    for (const sb of this.sections) {
      if (sb.section.id === sectionId) continue;
      if (sb.requiresTile(tileId)) return false;
      if (sb.availableTiles.some((t) => t.hashId === tileId)) return false;
    }
    return true;
  }

  isAlreadySeeded(tileId: number): boolean {
    return this.sections.some((sb) => sb.availableTiles.some((t) => t.hashId === tileId));
  }

  meetsRequirements(space: MSpace, enc: any): boolean {
    const req = gd(enc, "RequiredTraits", 0);
    const exc = gd(enc, "ExcludedTraits", 0);
    const specific = gd(enc, "SpecificTile");
    if (req === 0 && exc === 0 && !specific) return true;
    if (specific) return specific.id === space.tile.code && gd(enc, "SpecificSpaceIndex", 0) === space.index;
    return space.hasAll(req) && !space.hasAny(exc);
  }

  adjacentEncounters(space: MSpace, nodeType: number): number {
    let n = 0;
    for (const s of space.connected) {
      if (s.hasEncounter) {
        const e = this.anyEncounter(s.encounterId);
        if (e && gd(e, "NodeType", 0) === nodeType) n++;
      }
    }
    return n;
  }

  private meetsFilter(enc: any): boolean {
    const flt = or(gd(this.adv.model, "EncounterTraitsFilter"), {});
    const tr = gd(enc, "Traits", 0);
    const ex = gd(flt, "ExcludeIfAny", 0), all = gd(flt, "MustHaveAll", 0), any = gd(flt, "MustHaveAny", 0);
    if (ex !== 0 && (tr & ex) !== 0) return false;
    if (all !== 0 && (tr & all) !== all) return false;
    if (any !== 0 && (tr & any) === 0) return false;
    return true;
  }

  private languageUnsupported(enc: any): boolean {
    const name = LANG[this.opts.language] ?? this.opts.language;
    if (name === "English") return false;
    return truthy(gd(gd(enc, "UnsupportedLanguage"), name));
  }

  private itemAvailable(itemId: number | null): boolean {
    if (itemId === null) return false;
    let n = this.opts.groupItems.filter((i) => i === itemId).length;
    for (let h = 0; h < this.opts.players; h++) if ((this.opts.heroItems[h] ?? []).includes(itemId)) n++;
    return n < (this.maxItemCounts.get(itemId) ?? 0);
  }

  private canUpgradeInto(itemId: number, target: number, depth = 0): boolean {
    const it = this.D.models.ItemModel[String(itemId)];
    const ups: any[] = or(gd(it, "Upgrades"), []);
    if (!ups.length || depth > 20) return false;
    return ups.some((u) => u && (u.id === target || this.canUpgradeInto(u.id, target, depth + 1)));
  }

  // ------------------------------------------------------------ CreateMap + retries (LevelLoader)
  generate(): GeneratedMap {
    let seed = this.opts.seed | 0;
    this.timeout = 6;
    for (let attempt = 1; ; attempt++) {
      try {
        this.work = 0;
        this.createMap(seed);
        return this.result(seed, attempt);
      } catch (e) {
        if (!(e instanceof MapGenError) || attempt >= this.opts.maxAttempts) throw e;
        if (this.timeout < 30) this.timeout += 6; // LevelLoader: longer time-out on each retry
        seed = (seed + 1) | 0;
      }
    }
  }

  private result(seed: number, attempts: number): GeneratedMap {
    const usedEncounters = [...this.opts.usedEncounters];
    for (const s of this.allSpaces) if (s.hasEncounter && !usedEncounters.includes(s.encounterId)) usedEncounters.push(s.encounterId);
    const usedGroups = [...this.opts.usedGroups];
    if (this.groupResult && !usedGroups.includes(this.groupResult._id)) usedGroups.push(this.groupResult._id);
    return {
      seed, attempts,
      sections: this.sections.map((sb) => ({
        id: sb.id,
        tiles: sb.section.tiles.map((t) => ({
          code: t.code, hashId: t.hashId, section: sb.id, rotation: t.rotationIntervals(false),
          hexes: t.hexes.map((h) => ({ ...h.globalCoords })), encounters: t.spaces.map((s) => s.encounterId),
          connected: t.spaces.map((s) => s.connected.map((c): [number, number] => [c.tile.hashId, c.index])),
          customPid: (t as any).customPid ?? null,
        })),
      })),
      encounterGroup: this.groupResult ? this.groupResult._id : null,
      spawnOrder: this.allSpaces.filter((s) => s.hasEncounter).map((s): [number, number, number] => [s.tile.hashId, s.index, s.encounterId]),
      usedEncounters, usedGroups,
    };
  }

  private createMap(seed: number): void {
    // DestroyMap
    for (const sb of this.sections) sb.reset();
    this.map = new MMap();
    this.mapSeq = [];
    this.invalidSeq.clear();
    this.standard.reset();
    this.customBucket?.reset();
    const o = this.opts;
    const list: any[] = [];
    const list2: any[] = [];
    for (const enc of this.ownedEncounters) {
      if (this.languageUnsupported(enc)) continue;
      const type = gd(enc, "Type", 0);
      const id = Number(enc._id);
      if (type === ENC_RANDOM) {
        if ((truthy(gd(enc, "IsRepeatable")) || !o.usedEncounters.includes(id)) && this.meetsFilter(enc)) list.push(enc);
      } else if (type === ENC_CHAIN && o.unlockedChain.includes(id)) {
        if (truthy(gd(enc, "IsRepeatable")) || !o.usedEncounters.includes(id)) list2.push(enc);
      } else if (type === ENC_ITEM) {
        const items: any[] = or(gd(enc, "Items"), []);
        if (items.filter((x) => x).length <= 0) continue;
        let flag = false;
        for (const it of items) {
          const iid = it ? Number(it.id) : null;
          if (!this.itemAvailable(iid)) { flag = true; break; }
          for (const g of o.groupItems) {
            if (iid === g || this.canUpgradeInto(iid!, g)) { flag = true; break; }
          }
          if (flag) break;
        }
        if (!flag) this.randomItemPool.push(enc);
      }
    }
    const removeEnc = (ref: any) => {
      const i = list.findIndex((e) => Number(e._id) === this.encId(ref));
      if (i >= 0) list.splice(i, 1);
    };
    for (const e of or(gd(this.mb, "AdventureEncounters"), [])) removeEnc(e);
    for (const sb of this.sections) {
      for (const te of sb.tileEncounters) removeEnc(gd(te, "Encounter"));
      for (const se of sb.sectionEncounters ?? []) removeEnc(se);
    }
    const rng = new NetRandom(seed);
    this.standard.shuffle(rng);
    let extra = (o.players - 1) * 2;
    if (extra > 0 && this.sections.some((sb) => !sb.ignoreScaling)) {
      const l3 = [...this.sections];
      randomize(l3, rng);
      while (extra > 0) {
        for (const sb of l3) {
          if (!sb.ignoreScaling) { sb.extraSpaces++; extra--; if (extra <= 0) break; }
        }
      }
    }
    randomize(list, rng);
    randomize(list2, rng);
    randomize(this.randomItemPool, rng);
    while (list.length || list2.length) {
      let src: any[];
      if (!list2.length) src = list;
      else if (!list.length) src = list2;
      else if (rng.nextFloat(0, 1) < this.percentNormal) { src = list; this.percentNormal = f32(this.percentNormal / 2); }
      else { src = list2; this.percentNormal = f32(this.percentNormal * 2); }
      this.randomEncounterPool.push(src.shift());
    }
    this.buildMap(rng);
  }

  private fail(msg: string): never {
    throw new MapGenError(msg);
  }

  private nextIndex(i: number): number {
    return i + 1 >= this.sections.length ? 0 : i + 1;
  }

  /** CoroutineBuildMap */
  private buildMap(rng: NetRandom): void {
    const S = this.sections;
    S.forEach((sb, i) => sb.initialize(i));
    for (const sb of S) sb.availableTiles = [];
    for (const sb of S) if (!sb.seedStartTile()) this.fail("StartTile requirement");
    for (const sb of S) if (!sb.seedRequiredTiles()) this.fail("RequiredTiles requirement");
    // space trait requirements
    let idx = 0;
    this.seedHistory = [];
    while (!S.every((sb) => sb.hasMetTraitRequirement())) {
      const sb = S[idx]!;
      if (sb.hasMetTraitRequirement()) { idx = this.nextIndex(idx); continue; }
      const id = sb.trySeedTraitTile();
      if (id >= 0) {
        this.mapSeq.push(id);
        this.seedHistory.push({ sectionId: idx, tileId: id });
        idx = this.nextIndex(idx);
        continue;
      }
      if (!this.mapSeq.length) this.fail("SpaceTraitRequirements");
      this.invalidSeq.add(this.mapSeq);
      const rec = this.seedHistory.pop()!;
      S[rec.sectionId]!.removeFromAvailable(rec.tileId);
      this.mapSeq.pop();
      idx = rec.sectionId;
    }
    this.invalidSeq.clear(); this.mapSeq = []; this.seedHistory = [];
    // size requirements
    idx = 0;
    while (!S.every((sb) => sb.hasMetSize())) {
      const sb = S[idx]!;
      if (sb.hasMetSize()) { idx = this.nextIndex(idx); continue; }
      const id = sb.trySeedRandomTile();
      if (id >= 0) {
        this.mapSeq.push(id);
        this.seedHistory.push({ sectionId: idx, tileId: id });
        idx = this.nextIndex(idx);
      } else {
        if (!this.mapSeq.length) this.fail("Size requirement");
        this.invalidSeq.add(this.mapSeq);
        const rec = this.seedHistory.pop()!;
        S[rec.sectionId]!.removeFromAvailable(rec.tileId);
        this.mapSeq.pop();
        idx = rec.sectionId;
      }
    }
    this.invalidSeq.clear(); this.mapSeq = []; this.seedHistory = [];
    // optional growth (RelativeSizeFactor)
    idx = 0;
    while (!S.every((sb) => sb.isSeeded)) {
      const sb = S[idx]!;
      if (sb.isSeeded) { idx = this.nextIndex(idx); continue; }
      sb.isSeeded = rng.nextFloat(0, 1) > sb.relativeSize;
      if (!sb.isSeeded && sb.trySeedRandomTile() < 0) sb.isSeeded = true;
      idx = this.nextIndex(idx);
    }
    for (const sb of S) for (const t of sb.availableTiles) t.calculateLocalOutsideEdges();
    this.invalidSeq.clear(); this.mapSeq = []; this.seedHistory = [];
    // attach tiles inside each section
    for (let n = 0; n < S.length; n++) {
      const sb = S[n]!;
      while (!S[n]!.isFinished) {
        sb.attachNextTile(rng);
        const last = sb.lastAttachedTileId;
        if (last >= 0) {
          this.mapSeq.push(last);
          this.seedHistory.push({ sectionId: n, tileId: last });
          sb.isFinished = sb.availableTiles.length === 0;
          continue;
        }
        if (!this.seedHistory.length) this.fail("attach tiles");
        this.invalidSeq.add(this.mapSeq);
        const rec = this.seedHistory.pop()!;
        const b = S[rec.sectionId]!;
        const t = b.section.tiles[b.section.indexOf(rec.tileId)]!;
        b.availableTiles.push(t);
        b.section.remove(t);
        this.mapSeq.pop();
        b.isFinished = false;
        n = rec.sectionId;
      }
    }
    for (const sb of S) sb.section.calculateLocalOutsideEdges();
    // place sections on the map
    const sorted = [...S];
    this.mostReq = null;
    netSort(sorted, (a, b) => this.compareSectionReq(a, b));
    this.mostReq = sorted[0]!;
    netSort(sorted, (a, b) => this.compareSectionReq(a, b));
    let localMin = sorted.length;
    let localMinStart = this.elapsed();
    this.map.add(sorted[0]!.section);
    for (let n = 1; n < sorted.length; n++) {
      const sb2 = sorted[n]!;
      if (!sb2.sectionPlacements.length) {
        this.calculateAllPlacements(sb2);
        if (!sb2.sectionPlacements.length) {
          // FFG: after 5 s without a better local minimum, roll back to the second section on the map
          if (this.elapsed() - localMinStart > 5) this.rollbackSectionId = this.map.sections[1]!.id;
          let removed = 0;
          for (;;) {
            const last = S[this.map.sections[this.map.sections.length - 1]!.id]!;
            this.map.remove(last.section);
            if (!this.map.sections.length) this.fail("attach sections");
            removed++;
            if (last.id !== this.rollbackSectionId) { last.sectionPlacements = []; continue; }
            if (last.sectionPlacements.length) break;
            this.rollbackSectionId = this.map.sections[this.map.sections.length - 1]!.id;
          }
          if (n - removed < localMin || localMin === 1) { localMin = n - removed; localMinStart = this.elapsed(); }
          n -= removed + 1;
          if (n < 0) this.fail("attach sections");
          continue;
        }
      }
      const avg = this.averageSectionClump();
      const c = f32(f32(avg + sb2.sectionClump) * f32(0.5));
      const i = Math.trunc(f32(f32(sb2.sectionPlacements.length - 1) * f32(1 - c)));
      const p = sb2.sectionPlacements.splice(i, 1)[0]!;
      sb2.section.snapTo(sb2.section.getHexByTile(p.tile1, p.hex1, false)!, p.edge1, this.map.getHexByTile(p.tile2, p.hex2, false)!, p.edge2);
      this.map.add(sb2.section);
    }
    this.calculateConnectedSpaces();
    // (FFG then checks that every section has at least one connected space)
    for (const sb of S) {
      const connected = sb.section.tiles.some((t) => t.hexes.some((h) => h.space.connected.length > 0));
      if (!connected) this.fail("section not connected");
    }
    // encounters
    this.allSpaces = [];
    for (const sb of S) for (const t of sb.section.tiles) for (const s of t.spaces) this.allSpaces.push(s);
    randomize(this.allSpaces, rng);
    for (const sb of S) if (!sb.seedTileEncounters(rng)) this.fail("TileEncounters requirement");
    const history: { id: number; tileId: number; space: number }[] = [];
    for (const sb of S) {
      if (sb.sectionEncounters === null) continue;
      history.length = 0; this.mapSeq = []; this.invalidSeq.clear();
      while (!sb.hasMetSectionEncounters()) {
        const s = sb.trySeedFromCollection(sb.sectionEncounters, this.mapSeq, this.invalidSeq, rng);
        if (s) {
          history.push({ id: s.encounterId, tileId: s.tile.hashId, space: s.index });
          this.mapSeq.push(s.encounterId);
        } else {
          if (!history.length) this.fail("SectionEncounters requirement");
          this.invalidSeq.add(this.mapSeq);
          this.mapSeq.pop();
          const h = history.pop()!;
          this.map.getTile(h.tileId)!.spaces[h.space]!.encounterId = -1;
        }
      }
    }
    const advEnc: any[] | null = gd(this.mb, "AdventureEncounters", null);
    if (advEnc) {
      history.length = 0; this.invalidSeq.clear(); this.mapSeq = [];
      while (!advEnc.every((e) => this.map.hasEncounter(this.encId(e)))) {
        for (const e of advEnc) {
          const id = this.encId(e);
          if (this.map.hasEncounter(id) || this.invalidSeq.wouldExist(this.mapSeq, id)) continue;
          const s = this.trySeedEncounter(this.anyEncounter(id));
          if (s) {
            history.push({ id: s.encounterId, tileId: s.tile.hashId, space: s.index });
            this.mapSeq.push(s.encounterId);
            break;
          }
          if (!history.length) this.fail("AdventureEncounters requirement");
          this.invalidSeq.add(this.mapSeq);
          this.mapSeq.pop();
          const h = history.pop()!;
          this.map.getTile(h.tileId)!.spaces[h.space]!.encounterId = -1;
          break;
        }
      }
    }
    // encounter group
    const free = this.map.spaceCount() - this.map.encounterCount();
    const reqCount = (g: any) => or(gd(g, "RequiredEncounters"), []).length + gd(g, "RequiredNumberOfOptionalEncounters", 0);
    let eligible: any[];
    const spec = gd(this.mb, "SpecifiedEncounterGroup");
    if (spec) {
      const g = this.D.models.EncounterGroupModel[String(spec.id)];
      if (free < reqCount(g)) this.fail("Specified Encounter Group: not enough spaces");
      eligible = [g];
    } else {
      eligible = [];
      for (const g of this.ownedGroups) {
        if (free < reqCount(g)) continue;
        const encs = [...or(gd(g, "RequiredEncounters"), []), ...or(gd(g, "OptionalEncounters"), [])];
        if (encs.every((e: any) => this.meetsFilter(this.D.models.EncounterModel[String(e.id)] ?? {}))) eligible.push(g);
      }
      randomize(eligible, rng);
      netSort(eligible, (a, b) => {
        const n = cmpNum(this.opts.usedGroups.includes(a._id), this.opts.usedGroups.includes(b._id));
        return n !== 0 ? n : cmpNum(truthy(gd(a, "IsRepeatable")), truthy(gd(b, "IsRepeatable")));
      });
    }
    let group: any = null;
    for (const g of eligible) {
      group = g;
      const req: any[] = or(gd(g, "RequiredEncounters"), []);
      let toSeed: any[] = [];
      if (req.length) { toSeed = req.map((e) => this.D.models.EncounterModel[String(e.id)]); randomize(toSeed, rng); }
      this.seedNumberOfEncounters(toSeed, req.length);
      if (this.mapSeq.length < req.length) { group = null; continue; }
      const nOpt = gd(g, "RequiredNumberOfOptionalEncounters", 0);
      if (nOpt <= 0) break;
      const opt: any[] = or(gd(g, "OptionalEncounters"), []);
      if (opt.length) { toSeed = opt.map((e) => this.D.models.EncounterModel[String(e.id)]); randomize(toSeed, rng); }
      this.seedNumberOfEncounters(toSeed, nOpt);
      if (this.mapSeq.length >= nOpt) break;
      for (const e of req) for (const s of this.allSpaces) if (s.encounterId === Number(e.id)) s.encounterId = -1;
      group = null;
    }
    if (group === null) this.fail("Encounter Group requirement");
    this.groupResult = group;
    // one item encounter
    let placedItem = false;
    for (const enc of this.randomItemPool) {
      for (const s of this.allSpaces) {
        if (!s.hasEncounter && this.meetsRequirements(s, enc)) { s.encounterId = Number(enc._id); placedItem = true; break; }
      }
      if (placedItem) break;
    }
    // random fill
    const pool = [...this.randomEncounterPool];
    history.length = 0; this.mapSeq = []; this.invalidSeq.clear();
    for (const sb of S) {
      const want = f32(sb.fillPercent * f32(sb.section.spaceCount()));
      while (sb.section.encounterCount() < want && sb.trySeedFromCollection(pool, this.mapSeq, this.invalidSeq, rng));
    }
    for (const s of this.allSpaces) {
      if (s.hasEncounter && !this.encById.has(s.encounterId)) this.fail(`encounter ${s.encounterId} is not owned`);
    }
  }

  private seedNumberOfEncounters(encs: any[], count: number): void {
    const history: { tileId: number; space: number }[] = [];
    this.mapSeq = [];
    while (count > 0) {
      const s = this.trySeedEncounterSet(encs);
      if (s) {
        history.push({ tileId: s.tile.hashId, space: s.index });
        this.mapSeq.push(s.encounterId);
        count--;
        continue;
      }
      if (!history.length) break;
      this.invalidSeq.add(this.mapSeq);
      this.mapSeq.pop();
      const h = history.pop()!;
      this.map.getTile(h.tileId)!.spaces[h.space]!.encounterId = -1;
      count++;
    }
  }

  private trySeedEncounterSet(encs: any[]): MSpace | null {
    for (const e of encs) {
      const id = Number(e._id);
      if (!this.map.hasEncounter(id) && !this.invalidSeq.wouldExist(this.mapSeq, id)) return this.trySeedEncounter(e);
    }
    return null;
  }

  private trySeedEncounter(enc: any): MSpace | null {
    for (const s of this.allSpaces) {
      if (!s.hasEncounter && this.meetsRequirements(s, enc)) { s.encounterId = Number(enc._id); return s; }
    }
    return null;
  }

  private averageSectionClump(): number {
    let n = f32(0);
    for (const sb of this.sections) if (this.map.contains(sb.section)) n = f32(n + sb.sectionClump);
    return f32(n / f32(this.map.sections.length));
  }

  private connectionCount(sectionId: number): number {
    return this.requiredConnections.filter(([a, b]) => a === sectionId || b === sectionId).length;
  }

  private compareSectionReq(l: SB, r: SB): number {
    // RequiredConnections is a serialized array, never null in Unity: no early "return 0"
    const n = cmpNum(this.connectionCount(r.section.id), this.connectionCount(l.section.id));
    if (this.mostReq) {
      if (this.mostReq === l) return -1;
      if (this.mostReq === r) return 1;
      if (n === 0) return l.requiredConnected.includes(this.mostReq.section.id) ? -1 : 1;
    }
    return n;
  }

  private canConnect(a: SB | undefined, b: SB | undefined): boolean {
    if (!a || !b) return false;
    return !this.invalidConnections.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
  }

  private calculateAllPlacements(sb: SB): void {
    const section = sb.section;
    let outside = this.map.getOutsideEdges();
    const local = section.localOutsideEdges ?? [];
    const total = outside.length + local.length;
    sb.sectionPlacements = [];
    const count = sb.requiredConnected.length;
    const present: number[] = [];
    const touched: number[] = [];
    if (count > 0) {
      for (const sid of sb.requiredConnected) {
        if (this.map.contains(this.sections[sid]!.section)) {
          if (!present.includes(sid)) present.push(sid);
          if (this.sections[sid]!.section.outsideEdges.length <= outside.length) outside = this.sections[sid]!.section.outsideEdges;
        }
      }
    }
    for (const ed of outside) {
      const hex = this.map.getHexByTile(ed.tileId, ed.coords, false)!;
      const edge = hex.tile.getEdge(ed.coords, ed.dir, false);
      if (!edge || !edge.connectable || !this.canConnect(this.sections[hex.tile.section!.id], this.sections[section.id])) continue;
      for (const ed2 of local) {
        const hex2 = section.getHexByTile(ed2.tileId, ed2.coords, false)!;
        const edge2 = hex2.tile.getEdge(ed2.coords, ed2.dir, false);
        if (!edge2 || !edge2.connectable || !isConnection(edge2, edge)) continue;
        section.snapTo(hex2, ed2.dir, hex, ed.dir);
        this.tick();
        if (count > 0) {
          const a = section.boundingSphere();
          let ok = true;
          for (const sid of present) {
            const b = this.sections[sid]!.section.boundingSphere();
            if (!((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 < (a[2] + b[2]) ** 2)) { ok = false; break; }
          }
          if (!ok) continue;
        }
        if (this.map.overlapsAny(section)) continue;
        touched.length = 0;
        let open = total;
        let bad = false;
        for (const le of local) {
          const hex3 = section.getHexByTile(le.tileId, le.coords, false)!;
          const d = rotateDirection(le.dir, hex3.tile.rotationIntervals(false));
          const hex4 = this.map.getHex(neighbor(hex3.globalCoords, d), true);
          if (hex4) {
            const e3 = hex3.tile.getEdge(hex3.globalCoords, d, true);
            const e4 = hex4.tile.getEdge(hex4.globalCoords, flipDirection(d), true);
            if (!canMatch(e4, e3)) { bad = true; break; }
            if (!this.canConnect(this.sections[hex3.tile.section!.id], this.sections[hex4.tile.section!.id])) { bad = true; break; }
            if (count > 0 && isConnection(e4, e3) && !touched.includes(hex4.tile.section!.id)) touched.push(hex4.tile.section!.id);
            open -= 2;
          }
        }
        if (bad) continue;
        if (count > 0 && !present.every((sid) => touched.includes(sid))) continue;
        sb.sectionPlacements.push({ open, tile1: hex2.tile.hashId, hex1: hex2.tileCoords, edge1: ed2.dir, tile2: hex.tile.hashId, hex2: hex.tileCoords, edge2: ed.dir });
      }
    }
    if (sb.sectionPlacements.length) {
      netSort(sb.sectionPlacements, (a, b) => cmpNum(a.open, b.open));
      return;
    }
    this.rollbackSectionId = this.map.sections[this.map.sections.length - 1]!.id;
    if (count <= 0) return;
    for (let i = this.map.sections.length - 1; i > 0; i--) {
      if (present.includes(this.map.sections[i]!.id)) { this.rollbackSectionId = this.map.sections[i]!.id; break; }
    }
  }

  private calculateConnectedSpaces(): void {
    for (const sb of this.sections) {
      for (const t of sb.section.tiles) {
        for (const h of t.hexes) {
          for (let l = 0; l < 6; l++) {
            const h2 = this.globalHex(neighbor(h.globalCoords, l));
            if (!h2 || h.space === h2.space || (h.space.connected.includes(h2.space) && h2.space.connected.includes(h.space))) continue;
            const e = t.getEdge(h.globalCoords, l, true);
            const e2 = h2.tile.getEdge(h2.globalCoords, flipDirection(l), true);
            if (isConnection(e, e2)) {
              if (!h.space.connected.includes(h2.space)) h.space.connected.push(h2.space);
              if (!h2.space.connected.includes(h.space)) h2.space.connected.push(h.space);
            }
          }
        }
      }
    }
  }

  /** MapBuilder.GetHex: searches all section builders (not only sections on the map) */
  private globalHex(c: Cube): MHex | null {
    for (const sb of this.sections) {
      const h = sb.section.getHex(c, true);
      if (h) return h;
    }
    return null;
  }
}

export function generateMap(db: any, adventure: any, opts: MapGenOptions): GeneratedMap {
  return new MapGenerator(db, adventure, opts).generate();
}
