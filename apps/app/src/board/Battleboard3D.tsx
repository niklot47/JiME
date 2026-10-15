// 3D battleboard (AdventureModel.Type = Battleboard): the original's environment scenes Battleboard_Forest / _Rock /
// _Town exported as glTF (tools/importer/export_battleboard.py), one or two 3 x 3 boards side by side
// (BBManager.Initialize, LevelLoader.InitializeBattleboardEnvironment), board squares, rivers (BBEdgeGrid), lights.
// Unity's left-handed scenes are mirrored on x by the exporter, so the camera looks along +z like the original.
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MapControls } from "three/examples/jsm/controls/MapControls.js";
import { assetUrl } from "../data/pack.ts";

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

export function Battleboard3D({ boards }: { boards: BoardSetup[] }) {
  const host = useRef<HTMLDivElement>(null);
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
    let alive = true;
    void buildEnvironment(boards).then((env) => {
      if (!alive) return;
      env.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.castShadow = true;
        m.receiveShadow = true;
      });
      scene.add(env);
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
    let raf = 0;
    const tick = () => { raf = requestAnimationFrame(tick); controls.update(); renderer.render(scene, camera); };
    tick();
    (window as any).__battleboard = { scene, camera, controls };
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      renderer.dispose();
      el.removeChild(renderer.domElement);
    };
  }, [JSON.stringify(boards)]); // eslint-disable-line react-hooks/exhaustive-deps
  return <div ref={host} style={{ position: "absolute", inset: 0 }} />;
}
