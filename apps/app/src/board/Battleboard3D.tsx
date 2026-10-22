// 3D battleboard (AdventureModel.Type = Battleboard): the original's environment scenes Battleboard_Forest / _Rock /
// _Town exported as glTF (tools/importer/export_battleboard.py), one or two 3 x 3 boards side by side
// (BBManager.Initialize, LevelLoader.InitializeBattleboardEnvironment), board squares, rivers (BBEdgeGrid), lights.
// Unity's left-handed scenes are mirrored on x by the exporter, so the camera looks along +z like the original.
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MapControls } from "three/examples/jsm/controls/MapControls.js";
import { assetUrl } from "../data/pack.ts";
import { markerGroup } from "./Board3D.tsx";
import { attachEmitters, distortion, DISTORT_LAYER, type Emitter } from "./particles.ts";

/** BattleboardSkins: Grass, Quarry, Town -> the environment scene */
export const SKIN_SCENES = ["forest", "rock", "town"] as const;
export type SkinScene = (typeof SKIN_SCENES)[number];
/** BattleboardSettings: the skin (BattleboardSkins) and river corner flags (16, BBEdgeGrid) of one board */
export interface BoardSetup { skin: number; rivers: boolean[] }

/** Squares are 10 / 3 units, a board is 10 units, the second board sits 10 units east (-x after mirroring) */
export const SQUARE = 10 / 3;
export const BOARD_W = 10;

const gltfCache = new Map<string, Promise<GLTF>>();
function loadGltf(path: string): Promise<GLTF> {
  let p = gltfCache.get(path);
  if (!p) {
    p = new GLTFLoader().loadAsync(assetUrl(path));
    gltfCache.set(path, p);
  }
  return p;
}

/** The GameObject name (GLTFLoader sanitizes object names and keeps the original in userData.name) */
export const nameOf = (o: THREE.Object3D): string => (o.userData?.name as string | undefined) ?? o.name;
function find(root: THREE.Object3D, name: string): THREE.Object3D | null {
  let hit: THREE.Object3D | null = null;
  root.traverse((o) => { if (!hit && nameOf(o) === name) hit = o; });
  return hit;
}

/** Inactive GameObjects (extras.active = false) start hidden */
function applyActive(root: THREE.Object3D): void {
  root.traverse((o) => { if (o.userData?.active === false) o.visible = false; });
}

/** The skin's board group: "Board-Forest" (board 1) or "Board-Forest (1)" (board 2) */
function boardGroup(scene: THREE.Object3D, second: boolean): THREE.Object3D | null {
  const geo = find(scene, "BattleBoardGeometry");
  if (!geo) return null;
  const groups = geo.children.filter((c) => nameOf(c).startsWith("Board-"));
  return groups.find((g) => nameOf(g).endsWith(" (1)") === second) ?? null;
}

// ---------------------------------------------------------------- rivers (BBEdgeGrid.BuildRiverEdges)
const RIVER_POOLS: Record<number, "nub" | "corner" | "t"> = { 1: "nub", 2: "nub", 4: "nub", 5: "nub", 8: "nub", 10: "nub", 3: "corner", 6: "corner", 9: "corner", 12: "corner", 7: "t", 11: "t", 13: "t", 14: "t" };
const riverYaw = (f: number) => ([7, 12].includes(f) ? 180 : [6, 11].includes(f) ? -90 : [1, 4, 5, 9, 14].includes(f) ? 90 : 0);
const cornerOf = (grid: THREE.Object3D, i: number) => grid.children.find((c) => nameOf(c) === `River_Corner${String(i + 1).padStart(2, "0")}`);

/** GetNeighborFlags: N 8, E 4, S 2, W 1 for flagged neighbour corners (across to the next board at its edge) */
function neighborFlags(grid: THREE.Object3D, i: number, flags: boolean[], east: [THREE.Object3D, boolean[]] | null,
  west: [THREE.Object3D, boolean[]] | null, across: boolean): number {
  const c = cornerOf(grid, i)?.userData ?? {};
  let b = 0;
  if (c.EdgeNorth && i - 4 >= 0 && flags[i - 4]) b |= 8;
  if (c.EdgeEast) { if (i + 1 < 16 && flags[i + 1]) b |= 4; }
  else if (across && (i + 1) % 4 === 0 && east && east[1][i - 3]) b |= neighborFlags(east[0], i - 3, east[1], null, null, false);
  if (c.EdgeSouth && i + 4 < 16 && flags[i + 4]) b |= 2;
  if (c.EdgeWest) { if (i - 1 >= 0 && flags[i - 1]) b |= 1; }
  else if (across && i % 4 === 0 && west && west[1][i + 3]) b |= neighborFlags(west[0], i + 3, west[1], null, null, false);
  return b;
}

/** Unity's Euler(x, y, z) (applied z, x, y) as a quaternion in the mirrored (x -> -x) space */
function unityEuler(x: number, y: number, z: number): THREE.Quaternion {
  const r = THREE.MathUtils.degToRad;
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), r(y))
    .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), r(x)))
    .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), r(z)));
  return new THREE.Quaternion(q.x, -q.y, -q.z, q.w);
}

/** River pieces on the corners and straight edges of each board's grid */
function buildRivers(grids: (THREE.Object3D | null)[], boards: BoardSetup[], prefabs: THREE.Object3D | null): void {
  grids.forEach((grid, bi) => {
    if (!grid) return;
    const flags = boards[bi]!.rivers;
    const east = bi === 0 && grids[1] ? [grids[1], boards[1]!.rivers] as [THREE.Object3D, boolean[]] : null;
    const west = bi === 1 && grids[0] ? [grids[0], boards[0]!.rivers] as [THREE.Object3D, boolean[]] : null;
    for (let i = 0; i < 16; i++) {
      const corner = cornerOf(grid, i);
      if (!corner) continue;
      let f = 0;
      corner.visible = !!flags[i];
      if (flags[i]) {
        f = neighborFlags(grid, i, flags, east, west, true);
        const pool = RIVER_POOLS[f];
        const proto = pool && prefabs && find(prefabs, pool);
        if (proto) {
          const piece = proto.clone(true);
          piece.visible = true;
          piece.position.set(0, 0, 0);
          piece.quaternion.copy(unityEuler(-90, riverYaw(f), 0));
          corner.add(piece);
        }
      }
      const ud = corner.userData;
      const edge = (name: string | undefined, on: boolean) => {
        const e = name ? grid.children.find((c) => nameOf(c) === name) : undefined;
        if (e) e.visible = on;
      };
      edge(ud.EdgeNorth, (f & 8) !== 0);
      edge(ud.EdgeEast, (f & 4) !== 0);
      edge(ud.EdgeSouth, (f & 2) !== 0);
      edge(ud.EdgeWest, (f & 1) !== 0);
    }
  });
}

/**
 * The environment for the boards: board 1's scene with its lights and effects; with two boards of different skins
 * board 2's group comes from its own scene (InitializeBattleboardEnvironment); one board shows board 1's right edge
 */
export async function buildEnvironment(boards: BoardSetup[]): Promise<THREE.Group> {
  const skins = boards.map((b) => SKIN_SCENES[b.skin] ?? "forest");
  const [first, second] = await Promise.all(skins.map((s) => loadGltf(`battleboard/${s}.glb`)));
  const root = new THREE.Group();
  const main = first!.scene.clone(true);
  applyActive(main);
  const b1 = boardGroup(main, false);
  const b2 = boardGroup(main, true);
  if (boards.length < 2) {
    if (b2) b2.visible = false;
    const right = b1 && find(b1, "Modular")?.children.find((c) => nameOf(c) === "RightEdge");
    if (right) right.visible = true;
  } else if (skins[1] !== skins[0] && second) {
    const other = second.scene.clone(true);
    applyActive(other);
    const ob2 = boardGroup(other, true);
    if (b2 && ob2) {
      b2.visible = false;
      ob2.parent?.updateMatrixWorld(true);
      const m = ob2.matrixWorld.clone();
      ob2.removeFromParent();
      ob2.matrix.copy(m);
      ob2.matrix.decompose(ob2.position, ob2.quaternion, ob2.scale);
      root.add(ob2);
      // InitializeBattleboardEnvironment: the second scene's effects (BBVisuals.FxParent) come along with its board
      const ofx = other.children[0]?.children.find((c) => nameOf(c) === "FX");
      if (ofx) {
        ofx.parent?.updateMatrixWorld(true);
        const mf = ofx.matrixWorld.clone();
        ofx.removeFromParent();
        mf.decompose(ofx.position, ofx.quaternion, ofx.scale);
        ob2.add(ofx);
        ofx.applyMatrix4(ob2.matrix.clone().invert());
      }
    }
  }
  // BBManager.SetBoardSkin: the skin's material on every square (flat and chasm) of each board
  const mats = find(main, "BoardMaterials");
  const skinMat = (skin: number) => {
    const m = mats && find(mats, ["grass", "quarry", "town"][skin] ?? "grass") as THREE.Mesh | null;
    return m?.material as THREE.Material | undefined;
  };
  boards.forEach((b, i) => {
    const mat = skinMat(b.skin);
    const g = i === 0 ? b1 : (root.children[0] ?? b2);
    const board = g && find(g, i === 0 ? "Board1" : "Board2");
    if (!mat || !board) return;
    for (const sq of board.children) {
      if (!/^(BB|Chasm)_\d+$/.test(nameOf(sq))) continue;
      sq.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).material = mat; });
    }
  });
  const cam = find(main, "Camera");
  if (cam) cam.visible = false;
  const prefabs = find(main, "RiverPrefabs");
  if (prefabs) prefabs.removeFromParent();
  const grids = [b1, root.children[0] ?? b2].slice(0, boards.length).map((g) => (g ? find(g, "RiverPieces-OnGrid") : null));
  buildRivers(grids, boards, prefabs);
  root.userData.rivers = grids;
  root.add(main);
  // the scenes lie in Unity's xy plane with -z up (like the tile map): turn -z to +y, Unity's +y (north) to +z
  root.rotation.x = Math.PI / 2;
  return root;
}

// ---------------------------------------------------------------- tokens and terrain pieces

/** Token3DManager.GetPiecesPool: the full 3D piece (pieces/<name>.glb) of a terrain token type */
export const PIECES: Record<number, string> = {
  50: "Bushes", 51: "Rocks", 100: "Fog", 101: "Pits", 102: "Fire", 103: "Statue", 104: "Rubbles", 105: "Webs",
  106: "Fountains", 107: "Ponds", 150: "Barrel", 151: "Table", 152: "Logs", 153: "Elevations", 154: "Chests",
  155: "Barricades", 201: "Walls", 202: "Trenches", 203: "Fences",
};

export interface BBToken {
  /** pick id */
  id: string;
  /** Unity world position on the boards and rotation about z (deg) */
  pos: [number, number];
  angle: number;
  /** token mesh (images/tokens/meshes.json) and its texture */
  mesh?: TokenMeshData;
  meshName?: string;
  texture?: string;
  /** terrain piece shown instead of the token (SetTerrainTokenMode, full 3D) */
  piece?: string | null;
  /** a valid target right now */
  active?: boolean;
  /** drawn invisible but still pickable (a river token in full 3D: the board's rivers show it) */
  ghost?: boolean;
  /** GameNode.IsUnique: the piece's UniqueFX glow */
  unique?: boolean;
}

interface TokenMeshData { pos: [number, number, number][]; uv: [number, number][]; faces: [number, number, number][]; scale?: [number, number, number] }

const texCache = new Map<string, THREE.Texture>();
function tex(path: string): THREE.Texture {
  let t = texCache.get(path);
  if (!t) {
    t = new THREE.TextureLoader().load(assetUrl(path));
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    texCache.set(path, t);
  }
  return t;
}

const geoCache = new Map<string, THREE.BufferGeometry>();
/** Token mesh in the board frame (mirrored Unity, -z up): turned over so its printed face (z max) looks up */
function tokenGeo(name: string, d: TokenMeshData): THREE.BufferGeometry {
  let g = geoCache.get(name);
  if (!g) {
    const s = d.scale ?? [1, 1, 1];
    g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(d.pos.flatMap(([x, y, z]) => [x * s[0], -y * s[1], -z * s[2]]), 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(d.uv.flat(), 2));
    g.setIndex(d.faces.flat());
    g.computeVertexNormals();
    geoCache.set(name, g);
  }
  return g;
}

/** Board frame -> scene: the same turn as the environment (Unity's -z up becomes +y) */
const toScene = (x: number, y: number, h = 0) => new THREE.Vector3(-x, h, y);

/** One piece on the board: a wrapper in scene space (it drops along +y), the board-frame content inside */
interface Placed { wrap: THREE.Group; frame: THREE.Group; token: THREE.Object3D | null; piece: THREE.Object3D | null; pieceName: string | null; key: string }

type Fx = (dt: number) => boolean;

function makeFrame(angle: number): THREE.Group {
  const f = new THREE.Group();
  f.rotation.x = Math.PI / 2;
  // the node's rotation about Unity z (mirrored: the other way round)
  const inner = new THREE.Group();
  inner.rotation.z = -THREE.MathUtils.degToRad(angle);
  f.add(inner);
  return f;
}

function tokenObject(t: BBToken): THREE.Object3D | null {
  if (!t.mesh || !t.meshName || !t.texture) return null;
  const map = tex(t.texture);
  const mat = new THREE.MeshStandardMaterial({ map, emissiveMap: map, emissive: 0x333333, roughness: 0.6, metalness: 0.05, side: THREE.DoubleSide });
  const m = new THREE.Mesh(tokenGeo(t.meshName, t.mesh), mat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** A terrain piece: the pool prefab with the node's Euler(-90, 0, 0) (GameNode.Spawn3DToken); lights become point lights */
async function pieceObject(name: string): Promise<THREE.Object3D> {
  const g = await loadGltf(`battleboard/pieces/${name}.glb`);
  const root = g.scene.clone(true);
  applyActive(root);
  const lights: THREE.Object3D[] = [];
  root.traverse((o) => {
    const n = nameOf(o);
    // particle-only objects and camera-facing glows are not drawn (yet)
    if (/^Glow/.test(n)) o.visible = false;
    if (/^UniqueFX/.test(n)) { o.visible = false; o.userData.uniqueFx = true; }
    const m = o as THREE.Mesh;
    if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; smoothCutout(m); }
    const L = o.userData?.light;
    if (L && L.type === 2) lights.push(o);
  });
  for (const o of lights) {
    const L = o.userData.light;
    const pl = new THREE.PointLight(new THREE.Color(...(L.color as [number, number, number])), (L.intensity ?? 1) * 6, (L.range ?? 5) * 1.2, 1.6);
    o.add(pl);
  }
  // spawned with Euler(-90, 0, 0) under the node (the prefab root's own rotation and position are replaced)
  root.children.forEach(() => undefined);
  const holder = new THREE.Group();
  holder.userData.emitters = attachEmitters(root);
  const top = root.children.length === 1 ? root.children[0]! : root;
  top.position.set(0, 0, 0);
  top.quaternion.copy(unityEuler(-90, 0, 0));
  holder.add(top);
  return holder;
}

/** Cutout foliage: alpha to coverage softens the clipped edges (with the renderer's multisampling) */
function smoothCutout(m: THREE.Mesh): void {
  for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
    if (mat.alphaTest > 0) { mat.alphaToCoverage = true; mat.alphaTest = 0.35; }
  }
}

/** TokenSwitchDust: a soft puff where a token turns into its piece */
function dustPuff(parent: THREE.Object3D, at: THREE.Vector3, fxs: Fx[], smoke?: string): void {
  const map = smoke ? tex(smoke) : null;
  const parts: { sp: THREE.Sprite; v: THREE.Vector3 }[] = [];
  for (let i = 0; i < 7; i++) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map, color: 0xe6dcc4, transparent: true, opacity: 0.85, depthWrite: false }));
    sp.position.copy(at).add(new THREE.Vector3((Math.random() - 0.5) * 1.2, 0.2 + Math.random() * 0.5, (Math.random() - 0.5) * 1.2));
    sp.scale.setScalar(0.8 + Math.random() * 0.6);
    parent.add(sp);
    parts.push({ sp, v: new THREE.Vector3((Math.random() - 0.5) * 1.2, 0.6 + Math.random() * 0.6, (Math.random() - 0.5) * 1.2) });
  }
  let age = 0;
  fxs.push((dt) => {
    age += dt;
    const k = age / 1.4;
    for (const p of parts) {
      p.sp.position.addScaledVector(p.v, dt);
      p.sp.scale.multiplyScalar(1 + dt * 0.9);
      p.sp.material.opacity = 0.85 * Math.max(0, 1 - k);
    }
    if (k < 1) return true;
    for (const p of parts) parent.remove(p.sp);
    return false;
  });
}

/** Falls from high up, bounces twice (Board3D's token drop) */
function drop(o: THREE.Object3D, fxs: Fx[], delay = 0): void {
  const H = 3.4, fall = 0.5, hops = [{ h: 0.26, d: 0.26 }, { h: 0.08, d: 0.15 }];
  const tilts = hops.map(() => ({ x: (Math.random() - 0.5) * 0.5, z: (Math.random() - 0.5) * 0.5 }));
  let t = -delay;
  o.position.y = H;
  fxs.push((dt) => {
    t += dt;
    if (t < 0) return true;
    let y = 0, rx = 0, rz = 0, k = t;
    if (k < fall) y = H * (1 - (k / fall) ** 2);
    else {
      k -= fall;
      let done = true;
      for (let i = 0; i < hops.length; i++) {
        const hop = hops[i]!;
        if (k < hop.d) {
          const u = k / hop.d;
          y = hop.h * 4 * u * (1 - u);
          rx = tilts[i]!.x * Math.sin(Math.PI * u);
          rz = tilts[i]!.z * Math.sin(Math.PI * u);
          done = false;
          break;
        }
        k -= hop.d;
      }
      if (done) { o.position.y = 0; o.rotation.set(0, 0, 0); return false; }
    }
    o.position.y = y;
    o.rotation.x = rx;
    o.rotation.z = rz;
    return true;
  });
}

/** The piece grows out of the token (ease out with a little overshoot) while the token sinks away */
function grow(piece: THREE.Object3D, token: THREE.Object3D | null, fxs: Fx[]): void {
  const s0 = piece.scale.clone();
  let t = 0;
  piece.scale.setScalar(0.001);
  fxs.push((dt) => {
    t += dt;
    const k = Math.min(1, t / 0.7);
    const e = 1 + 2.2 * (k - 1) ** 3 + 1.2 * (k - 1) ** 2; // back-out
    piece.scale.copy(s0).multiplyScalar(Math.max(0.001, e));
    if (token) {
      const tk = Math.min(1, t / 0.3);
      token.scale.setScalar(Math.max(0.001, 1 - tk));
      if (tk >= 1) token.visible = false;
    }
    return k < 1;
  });
}

// ---------------------------------------------------------------- view

interface Props {
  boards: BoardSetup[];
  /** SetBoardVisibility per board */
  visible?: boolean[];
  /** rivers drawn (they appear with the terrain, SetTerrainTokenMode) */
  rivers?: boolean;
  /** pits shown: board index and square (PitNodeInfo) */
  pits?: [number, number][];
  tokens?: BBToken[];
  /** effect textures (images/fx/fx.json): smoke for the puffs */
  fx?: Record<string, string>;
  onPick?: (id: string) => void;
  /** location highlight (Unity world x, y): where enemies are to be placed */
  marker?: [number, number] | null;
  /** more location highlights at once (the terrain placed by a RevealTerrainNodes message: one on each piece) */
  markers?: [number, number][];
  /** WeatherEffect per board: 0 none, 1 light rain, 2 heavy rain */
  weather?: number[];
}

/** WeatherEffectsController's rain objects (the forest scene has none: its own rain systems by name) */
function rainNodes(main: THREE.Object3D): THREE.Object3D[][] {
  let map: Record<string, string> | null = null;
  main.traverse((o) => { if (!map && o.userData?.weather) map = o.userData.weather; });
  const byPath = (path: string) => {
    let o: THREE.Object3D | null = main;
    for (const part of path.split("/").slice(1)) o = o?.children.find((c) => nameOf(c) === part) ?? null;
    return o;
  };
  const m = map as Record<string, string> | null;
  if (m) return [[byPath(m.LightRain_B1 ?? ""), byPath(m.HeavyRain_B1 ?? "")], [byPath(m.LightRain_B2 ?? ""), byPath(m.HeavyRain_B2 ?? "")]].map((l) => l.filter((x): x is THREE.Object3D => !!x));
  return [[find(main, "LightRain"), find(main, "HeavyRain")], [find(main, "LightRain (1)"), find(main, "HeavyRain")]].map((l) => l.filter((x): x is THREE.Object3D => !!x));
}

export function Battleboard3D({ boards, visible = [true, true], rivers = true, pits = [], tokens = [], fx = {}, onPick, marker = null, markers = [], weather = [0, 0] }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const st = useRef<{ scene: THREE.Scene; env: THREE.Group | null; layer: THREE.Group; placed: Map<string, Placed>; fxs: Fx[]; ready: boolean; marker: THREE.Group | null; markerKey: string; emitters: Emitter[]; flown: boolean; controls: MapControls } | null>(null);
  const pickRef = useRef(onPick);
  pickRef.current = onPick;
  const [, setTick] = useState(0);

  useEffect(() => {
    const el = host.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    // the original's backdrop: dark olive, lighter towards the middle
    const bg = document.createElement("canvas");
    bg.width = bg.height = 512;
    const bx = bg.getContext("2d")!;
    const grad = bx.createRadialGradient(256, 200, 20, 256, 256, 380);
    grad.addColorStop(0, "#3a3d1c");
    grad.addColorStop(0.55, "#1e2410");
    grad.addColorStop(1, "#0b0e07");
    bx.fillStyle = grad;
    bx.fillRect(0, 0, 512, 512);
    const bgTex = new THREE.CanvasTexture(bg);
    bgTex.colorSpace = THREE.SRGBColorSpace;
    scene.background = bgTex;
    const camera = new THREE.PerspectiveCamera(32, 1, 0.5, 400);
    const center = new THREE.Vector3(boards.length > 1 ? -BOARD_W / 2 : 0, 0, 0);
    // SceneCamera of the scenes: south-west of the board (+x after mirroring), ~45 degrees down
    camera.position.set(center.x + 9, 21, -24);
    const controls = new MapControls(camera, renderer.domElement);
    controls.target.copy(center);
    controls.screenSpacePanning = false;
    controls.maxPolarAngle = Math.PI * 0.45;
    controls.minDistance = 8;
    controls.maxDistance = 60;
    controls.update();
    scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x3a3020, 1.1));
    const sun = new THREE.DirectionalLight(0xfff1d8, 2.2);
    sun.position.set(center.x + 8, 25, -14);
    sun.target.position.copy(center);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -22, right: 22, top: 22, bottom: -22, near: 1, far: 80 });
    sun.shadow.bias = -0.0005;
    scene.add(sun, sun.target);
    const layer = new THREE.Group();
    scene.add(layer);
    const s = { scene, env: null as THREE.Group | null, layer, placed: new Map<string, Placed>(), fxs: [] as Fx[], ready: false, marker: null as THREE.Group | null, markerKey: "", emitters: [] as Emitter[], flown: false, controls };
    st.current = s;
    let alive = true;
    void buildEnvironment(boards).then((env) => {
      if (!alive) return;
      env.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.castShadow = true;
        m.receiveShadow = true;
        smoothCutout(m);
      });
      scene.add(env);
      s.env = env;
      // the scene's particle systems (light shafts, pollen, rain, fog), played while their objects are shown
      s.emitters.push(...attachEmitters(env));
      s.ready = true;
      setTick((n) => n + 1);
    });
    const resize = () => {
      const w = el.clientWidth, h = el.clientHeight;
      renderer.setSize(w, h);
      camera.aspect = w / Math.max(1, h);
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    // picking: tap on a token or piece
    const ray = new THREE.Raycaster();
    let down: [number, number] | null = null;
    const onDown = (e: PointerEvent) => { down = [e.clientX, e.clientY]; };
    const onUp = (e: PointerEvent) => {
      if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 6) return;
      const r = renderer.domElement.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
      const hit = ray.intersectObjects(layer.children, true)[0];
      let o: THREE.Object3D | null = hit?.object ?? null;
      while (o && !o.userData.pick) o = o.parent;
      if (o) pickRef.current?.(o.userData.pick as string);
    };
    renderer.domElement.addEventListener("pointerdown", onDown);
    renderer.domElement.addEventListener("pointerup", onUp);
    let raf = 0;
    let last = performance.now();
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const now = performance.now();
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      s.fxs = s.fxs.filter((f) => f(dt));
      s.emitters = s.emitters.filter((e) => {
        if (!e.parent) return false;
        let shown = true;
        for (let o: THREE.Object3D | null = e; o; o = o.parent) if (!o.visible) { shown = false; break; }
        e.visibleNow = shown;
        if (shown) e.step(dt, camera);
        return !e.done;
      });
      const pulse = 0.55 + 0.45 * Math.sin(now / 260);
      for (const m of s.marker?.children ?? []) {
        const ring = m.userData.ring as THREE.Mesh;
        ring.rotation.z -= dt * 1.6;
        ((m.userData.glow as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 0.45 + 0.3 * pulse;
      }
      controls.update();
      // heat haze: the frame without it, copied, then the haze particles sampling the copy
      const haze = s.emitters.some((e) => e.distort && e.visibleNow);
      if (haze) {
        renderer.getDrawingBufferSize(distortion.res);
        if (!grab || grab.image.width !== distortion.res.x || grab.image.height !== distortion.res.y) {
          grab?.dispose();
          grab = new THREE.FramebufferTexture(distortion.res.x, distortion.res.y);
        }
        camera.layers.set(0);
        renderer.render(scene, camera);
        renderer.copyFramebufferToTexture(grab, new THREE.Vector2(0, 0));
        distortion.scene = grab;
        distortion.time = now / 1000;
        camera.layers.set(DISTORT_LAYER);
        const bgSave = scene.background;
        scene.background = null;
        renderer.autoClear = false;
        renderer.render(scene, camera);
        renderer.autoClear = true;
        scene.background = bgSave;
        camera.layers.set(0);
      } else renderer.render(scene, camera);
    };
    let grab: THREE.FramebufferTexture | null = null;
    tick();
    (window as any).__battleboard = { scene, camera, controls, state: s };
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      renderer.domElement.removeEventListener("pointerdown", onDown);
      renderer.domElement.removeEventListener("pointerup", onUp);
      renderer.dispose();
      el.removeChild(renderer.domElement);
      st.current = null;
    };
  }, [JSON.stringify(boards)]); // eslint-disable-line react-hooks/exhaustive-deps

  // boards shown, rivers, pits, the location highlight
  useEffect(() => {
    const s = st.current;
    if (!s?.env) return;
    // GameViewHighlightManager location highlights: where enemies go, or on each terrain piece being placed
    const spots = [...(marker ? [marker] : []), ...markers];
    const mk = spots.map((p) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(";");
    if (mk !== s.markerKey) {
      s.markerKey = mk;
      if (s.marker) { s.scene.remove(s.marker); s.marker = null; }
      if (spots.length) {
        const all = new THREE.Group();
        for (const p of spots) {
          const m = markerGroup(fx);
          m.scale.setScalar(1.7);
          m.position.copy(toScene(p[0], p[1], 0.06));
          all.add(m);
        }
        s.scene.add(all);
        s.marker = all;
      }
    }
    const env = s.env;
    const main = env.children.find((c) => find(c, "BattleBoardGeometry")) ?? env;
    for (let i = 0; i < 2; i++) {
      const own = boardGroup(main, i === 1);
      const g = i === 1 && boards.length > 1 && boards[1]!.skin !== boards[0]!.skin ? env.children.find((c) => nameOf(c).endsWith(" (1)")) ?? own : own;
      if (g && i < boards.length) g.visible = visible[i] !== false;
    }
    for (const grid of (env.userData.rivers ?? []) as (THREE.Object3D | null)[]) if (grid) grid.visible = rivers;
    // SetWeatherEffect: light (1) or heavy (2) rain per board
    const rain = rainNodes(main);
    const on = new Set<THREE.Object3D>();
    rain.forEach((l, b) => { const w = weather[b] ?? 0; if (w > 0 && l[w - 1]) on.add(l[w - 1]!); });
    for (const o of rain.flat()) o.visible = on.has(o);
    // BBBoard.SetPitVisibility: the flat square swapped for the chasm
    boards.forEach((_, bi) => {
      const g = bi === 0 ? boardGroup(main, false) : (env.children.find((c) => nameOf(c).endsWith(" (1)") && c !== main) ?? boardGroup(main, true));
      const board = g && find(g, bi === 0 ? "Board1" : "Board2");
      if (!board) return;
      for (let k = 0; k < 9; k++) {
        const pit = pits.some(([b, p]) => b === bi && p === k);
        const flat = board.children.find((c) => nameOf(c) === `BB_0${k + 1}`);
        const chasm = board.children.find((c) => nameOf(c) === `Chasm_0${k + 1}`);
        if (flat) flat.visible = !pit;
        if (chasm) chasm.visible = pit;
      }
    });
  });

  // tokens: new ones drop in; a token whose piece appears turns into it
  useEffect(() => {
    const s = st.current;
    if (!s?.ready) return;
    const seen = new Set<string>();
    let delay = 0;
    const fresh: THREE.Vector3[] = [];
    for (const t of tokens) {
      seen.add(t.id);
      const key = `${t.meshName}|${t.texture}`;
      let p = s.placed.get(t.id);
      if (p && p.key !== key) { s.layer.remove(p.wrap); s.placed.delete(t.id); p = undefined; }
      if (!p) {
        const wrap = new THREE.Group();
        const frame = makeFrame(t.angle);
        wrap.add(frame);
        const token = tokenObject(t);
        if (token) frame.children[0]!.add(token);
        wrap.userData.pick = t.id;
        s.layer.add(wrap);
        p = { wrap, frame, token, piece: null, pieceName: null, key };
        s.placed.set(t.id, p);
        wrap.position.copy(toScene(t.pos[0], t.pos[1], 0.02));
        if (!t.piece) { drop(wrap, s.fxs, delay + (s.flown ? 0.45 : 0)); delay += 0.25; fresh.push(wrap.position.clone()); }
      }
      // MoveNode: the node moves to its new square
      const to = toScene(t.pos[0], t.pos[1], 0.02);
      if (p.wrap.position.distanceTo(new THREE.Vector3(to.x, p.wrap.position.y, to.z)) > 0.01) {
        const from = p.wrap.position.clone();
        let k = 0;
        const w = p.wrap;
        s.fxs.push((dt) => { k = Math.min(1, k + dt / 0.6); const e = k * k * (3 - 2 * k); w.position.x = from.x + (to.x - from.x) * e; w.position.z = from.z + (to.z - from.z) * e; return k < 1; });
      }
      (p.frame.children[0] as THREE.Group).rotation.z = -THREE.MathUtils.degToRad(t.angle);
      if (p.token) {
        const m = (p.token as THREE.Mesh).material as THREE.MeshStandardMaterial;
        m.transparent = !!t.ghost;
        m.opacity = t.ghost ? 0 : 1;
        m.depthWrite = !t.ghost;
      }
      if (p.piece) p.piece.traverse((o) => { if (o.userData.uniqueFx) o.visible = !!t.unique; });
      // full 3D piece
      const want = t.piece ?? null;
      if (want !== p.pieceName) {
        const pp = p;
        pp.pieceName = want;
        if (pp.piece) { pp.frame.children[0]!.remove(pp.piece); pp.piece = null; }
        if (want) {
          void pieceObject(want).then((obj) => {
            if (pp.pieceName !== want) return;
            pp.piece = obj;
            pp.frame.children[0]!.add(obj);
            const ems = (obj.userData.emitters ?? []) as Emitter[];
            s.emitters.push(...ems);
            // the prefab's own TokenSwitchDust puff, else a soft one of ours
            if (!ems.some((e) => /TokenSwitchDust/.test(String(e.parent?.userData?.name ?? "")))) dustPuff(s.layer, pp.wrap.position.clone(), s.fxs, fx.smoke);
            grow(obj, pp.token, s.fxs);
          });
        } else if (pp.token) { pp.token.visible = true; pp.token.scale.setScalar(1); }
      }
      // target ring
    }
    for (const [id, p] of s.placed) if (!seen.has(id)) { s.layer.remove(p.wrap); s.placed.delete(id); }
    // later tokens: the camera glides to where they fall (the first ones are framed by the opening view)
    if (fresh.length && s.flown && s.controls) {
      const to = fresh.reduce((a, v) => a.add(v), new THREE.Vector3()).multiplyScalar(1 / fresh.length);
      const c = s.controls, cam = c.object;
      const from = c.target.clone(), off = cam.position.clone().sub(from);
      let k = 0;
      s.fxs.push((dt) => {
        k = Math.min(1, k + dt / 0.55);
        const e = k * k * (3 - 2 * k);
        c.target.lerpVectors(from, new THREE.Vector3(to.x, 0, to.z), e);
        cam.position.copy(c.target).add(off);
        return k < 1;
      });
    }
    if (tokens.length) s.flown = true;
  });

  return <div ref={host} style={{ position: "absolute", inset: 0 }} />;
}
