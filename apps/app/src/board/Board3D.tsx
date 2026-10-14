// 3D board (perspective): cardboard tiles with thickness, game tokens as discs, light and shadows.
// Unexplored tiles are shown in sepia like the original app (SetTileSepiaValue) and fade to colour when explored.
// Controls: drag = pan, right drag / two fingers = rotate and tilt, wheel / pinch = zoom, tap = pick.
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { MapControls } from "three/examples/jsm/controls/MapControls.js";
import type { TileMesh } from "@jime/engine/map";
import { assetUrl } from "../data/pack.ts";
import type { Pick, Token } from "./BoardView.tsx";

interface Props {
  tiles: TileMesh[];
  tokens: Token[];
  showLabels: boolean;
  /** Initial view rotation in degrees (the original app's camera shows the board rotated) */
  rotation: number;
  /** Tiles drawn (hash ids); null = all */
  shownTiles?: Set<number> | null;
  /** Tiles shown in sepia (unexplored) */
  sepia?: Set<number> | null;
  onPick?: (p: Pick) => void;
  /** The camera is re-framed only when this changes */
  fitKey?: string;
  /** Effect textures by role (cloud, smoke, dust, ember: images/fx/fx.json); missing = no effect */
  fx?: Record<string, string>;
  /** Table texture (pack path, tiled), e.g. the theme's leather; default: procedural cloth */
  table?: string;
  /** Map drawn under the leather (the original's table: Middle-earth showing through the semi-transparent leather) */
  tableMap?: string;
  /** Location highlight (board coordinates): the turning yellow arrows where enemies are to be placed */
  marker?: [number, number] | null;
  /** a new game: even the first tiles drop in one by one (the view opens on the fog) */
  intro?: boolean;
}

/** Animation step; returns false when finished */
type Effect = (dt: number, time: number) => boolean;

const TILE_H = 0.12;
const TILE_LIFT = 0.07;
// sizes of the game's token meshes (Unity units): "Round" Ø 0.864, "Explore" 0.918 square
const TOKEN_R = 0.40;
const SQUARE = 0.86;
const TOKEN_H = 0.07;

const loader = new THREE.TextureLoader();
const texCache = new Map<string, THREE.Texture>();
function texture(path: string): THREE.Texture {
  let t = texCache.get(path);
  if (!t) {
    t = loader.load(assetUrl(path));
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    texCache.set(path, t);
  }
  return t;
}

/** Tile top material with a sepia mix uniform (0 = colour, 1 = sepia) */
function sepiaMaterial(map: THREE.Texture | null): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ map, roughness: 0.92, metalness: 0, side: THREE.DoubleSide });
  const u = { value: 0 };
  mat.userData.sepia = u;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uSepia = u;
    sh.fragmentShader = "uniform float uSepia;\n" + sh.fragmentShader.replace(
      "#include <map_fragment>",
      `#include <map_fragment>
       float lum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
       vec3 sep = vec3(lum * 1.08, lum * 0.93, lum * 0.72);
       diffuseColor.rgb = mix(diffuseColor.rgb, sep * 0.78, uSepia);`);
  };
  return mat;
}

/** Board plane (x, y) -> three.js (x, 0, -y): the board lies in XZ with Y up */
const v3 = (x: number, y: number, h = 0) => new THREE.Vector3(x, h, -y);

function tileGroup(t: TileMesh): { group: THREE.Group; top: THREE.Mesh } {
  const pos: number[] = [];
  for (let i = 0; i < t.positions.length / 2; i++) pos.push(t.positions[2 * i]!, TILE_H, -t.positions[2 * i + 1]!);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(t.uvs, 2));
  // flat top: normals straight up, both sides drawn (the 2D mesh winding is not guaranteed)
  g.setIndex([...t.indices]);
  g.setAttribute("normal", new THREE.Float32BufferAttribute(new Array(pos.length / 3).fill([0, 1, 0]).flat(), 3));
  const top = new THREE.Mesh(g, sepiaMaterial(t.texture ? texture(t.texture) : null));
  top.receiveShadow = true;
  top.castShadow = true;
  // side walls along the outline: triangle edges used once (vertices are per hex, so match by position)
  const key = (i: number) => `${t.positions[2 * i]!.toFixed(3)},${t.positions[2 * i + 1]!.toFixed(3)}`;
  const edges = new Map<string, [number, number, number]>();
  for (let i = 0; i < t.indices.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const a = t.indices[i + k]!, b = t.indices[i + ((k + 1) % 3)]!;
      const ka = key(a), kb = key(b);
      const e = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      const cur = edges.get(e);
      edges.set(e, cur ? [cur[0], cur[1], cur[2] + 1] : [a, b, 1]);
    }
  }
  const side: number[] = [];
  for (const [a, b, n] of edges.values()) {
    if (n !== 1) continue;
    const A = [t.positions[2 * a]!, -t.positions[2 * a + 1]!], B = [t.positions[2 * b]!, -t.positions[2 * b + 1]!];
    side.push(A[0]!, TILE_H, A[1]!, B[0]!, TILE_H, B[1]!, B[0]!, 0, B[1]!, A[0]!, TILE_H, A[1]!, B[0]!, 0, B[1]!, A[0]!, 0, A[1]!);
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute("position", new THREE.Float32BufferAttribute(side, 3));
  sg.computeVertexNormals();
  const sides = new THREE.Mesh(sg, new THREE.MeshStandardMaterial({ color: 0x2b241c, roughness: 1, side: THREE.DoubleSide }));
  sides.castShadow = true;
  const group = new THREE.Group();
  group.add(top, sides);
  // lifted a touch above the table so they cast a visible shadow on it
  group.position.y = TILE_LIFT;
  return { group, top };
}

/** Procedural table cloth: dark warm noise (no game asset needed) */
function tableTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(256, 256);
  for (let i = 0; i < 256 * 256; i++) {
    const n = 40 + Math.random() * 18;
    img.data[4 * i] = n * 1.15; img.data[4 * i + 1] = n * 0.95; img.data[4 * i + 2] = n * 0.72; img.data[4 * i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(30, 30);
  return t;
}

const glyphCache = new Map<string, THREE.Texture>();
function glyphTexture(text: string, color: string): THREE.Texture {
  const k = `${text}|${color}`;
  let t = glyphCache.get(k);
  if (!t) {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(64, 64, 62, 0, Math.PI * 2); ctx.fill();
    ctx.font = "700 72px system-ui, sans-serif"; ctx.fillStyle = "#1a140c"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(text, 64, 70);
    t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    glyphCache.set(k, t);
  }
  return t;
}

function labelSprite(text: string): THREE.Sprite {
  const c = document.createElement("canvas");
  const ctx = c.getContext("2d")!;
  ctx.font = "600 40px system-ui, sans-serif";
  const w = Math.ceil(ctx.measureText(text).width) + 24;
  c.width = w; c.height = 56;
  ctx.font = "600 40px system-ui, sans-serif";
  ctx.fillStyle = "rgba(20,16,10,0.78)";
  ctx.beginPath(); ctx.roundRect(0, 0, w, 56, 12); ctx.fill();
  ctx.fillStyle = "#f3e6c8"; ctx.textBaseline = "middle"; ctx.fillText(text, 12, 30);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
  s.scale.set((0.42 * w) / 56, 0.42, 1);
  s.renderOrder = 3;
  return s;
}

/** Flat square frame between half-sizes a (inner) and b (outer) */
function squareFrame(a: number, b: number): THREE.ShapeGeometry {
  const s = new THREE.Shape([new THREE.Vector2(-b, -b), new THREE.Vector2(b, -b), new THREE.Vector2(b, b), new THREE.Vector2(-b, b)]);
  s.holes.push(new THREE.Path([new THREE.Vector2(-a, -a), new THREE.Vector2(-a, a), new THREE.Vector2(a, a), new THREE.Vector2(a, -a)]));
  return new THREE.ShapeGeometry(s);
}

const sideMat = new THREE.MeshStandardMaterial({ color: 0x3a3127, roughness: 0.8 });

const skinGeometry = new Map<string, THREE.BufferGeometry>();

/** Geometry of a game token mesh (z up in the export -> y up here); cached by mesh name */
function skinGeo(name: string, d: NonNullable<Token["skin"]>["data"]): THREE.BufferGeometry {
  let g = skinGeometry.get(name);
  if (!g) {
    g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(d.pos.flatMap(([x, y, z]) => [x, z, -y]), 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(d.uv.flat(), 2));
    g.setIndex(d.faces.flat());
    g.computeVertexNormals();
    skinGeometry.set(name, g);
  }
  return g;
}

/** Token mesh with its base at y = 0 */
function tokenMesh(tk: Token): THREE.Mesh {
  if (tk.skin) {
    const map = texture(tk.skin.texture);
    const mat = new THREE.MeshStandardMaterial({ map, emissiveMap: map, emissive: 0x3a3a3a, roughness: 0.6, metalness: 0.05, side: THREE.DoubleSide });
    return withShadows(new THREE.Mesh(skinGeo(tk.skin.mesh, tk.skin.data), mat));
  }
  return fallbackToken(tk);
}

function fallbackToken(tk: Token): THREE.Mesh {
  const map = tk.image ? texture(tk.image) : glyphTexture(tk.glyph ?? "", tk.color);
  // a little self-light so the art stays readable on the tilted, shadowed board
  const top = new THREE.MeshStandardMaterial({ map, emissiveMap: map, emissive: 0x3a3a3a, roughness: 0.6, metalness: 0.05, transparent: !!tk.image, alphaTest: 0.3 });
  if (tk.shape === "square") {
    // box groups: +x, -x, +y (top), -y, +z, -z
    return withShadows(new THREE.Mesh(new THREE.BoxGeometry(SQUARE, TOKEN_H, SQUARE).translate(0, TOKEN_H / 2, 0), [sideMat, sideMat, top, sideMat, sideMat, sideMat]));
  }
  const hexagon = tk.shape === "hex";
  // cylinder groups: 0 = side, 1 = top, 2 = bottom
  const m = new THREE.Mesh(new THREE.CylinderGeometry(TOKEN_R, TOKEN_R, TOKEN_H, hexagon ? 6 : 40).translate(0, TOKEN_H / 2, 0), [sideMat, top, sideMat]);
  if (hexagon) m.rotation.y = Math.PI / 6;
  return withShadows(m);
}

function withShadows(m: THREE.Mesh): THREE.Mesh {
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

// ---------------------------------------------------------------- effects

/**
 * Soft clouds over the hexes of the tiles still to come (generated but not placed yet): like the original, the fog shows
 * roughly the size and shape of the whole map, and lifts tile by tile as they are placed
 */
function buildFog(hidden: TileMesh[], fx: Record<string, string>): THREE.Group {
  const g = new THREE.Group();
  const tex = [fx.cloud, fx.smoke].filter(Boolean).map((p) => texture(p!));
  // flat cloud layers floating above the table (billboards would cut into the table at this camera tilt)
  const geo = new THREE.PlaneGeometry(1, 1);
  // many large, faint layers (the original's fog is an even haze, no single clouds stand out), slowly drifting
  const add = (x: number, y: number, opacity: number, sc: number) => {
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex[Math.floor(Math.random() * tex.length)]!, color: 0xa8a096, transparent: true, opacity, depthWrite: false }));
    m.scale.set(sc, sc, 1);
    m.rotation.set(-Math.PI / 2, 0, Math.random() * Math.PI * 2);
    m.position.copy(v3(x + (Math.random() - 0.5) * 0.8, y + (Math.random() - 0.5) * 0.8, 0.2 + Math.random() * 0.35));
    m.userData = { spin: (Math.random() - 0.5) * 0.1, bob: Math.random() * 6, y: m.position.y, x: m.position.x, z: m.position.z,
      drift: 0.25 + Math.random() * 0.35, speed: 0.15 + Math.random() * 0.2 };
    m.renderOrder = 4;
    g.add(m);
  };
  for (const t of hidden) {
    for (const [x, y] of t.hexCenters) {
      add(x, y, 0.16 + Math.random() * 0.06, 4.2 + Math.random() * 1.6);
      add(x, y, 0.12 + Math.random() * 0.05, 5.5 + Math.random() * 2.0);
    }
  }
  return g;
}

/** Dust puffs over the hexes of a tile that was just explored */
function dustBurst(s: State, t: TileMesh, fx: Record<string, string>): void {
  const group = new THREE.Group();
  const map = texture(fx.dust!);
  const smoke = fx.smoke ? texture(fx.smoke) : map;
  const parts: { sp: THREE.Sprite; v: THREE.Vector3; grow: number }[] = [];
  for (const [x, y] of t.hexCenters) {
    for (let i = 0; i < 3; i++) {
      // the game's dust sprite is very faint: mostly smoke puffs, one dust layer for grain
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: i === 2 ? map : smoke, color: 0xe8dcc0, transparent: true, opacity: 0.9, depthWrite: false, depthTest: false }));
      sp.position.copy(v3(x + (Math.random() - 0.5) * 0.8, y + (Math.random() - 0.5) * 0.8, TILE_LIFT + TILE_H + 0.15));
      sp.scale.setScalar(1.2 + Math.random() * 0.6);
      sp.renderOrder = 5;
      group.add(sp);
      parts.push({ sp, v: new THREE.Vector3((Math.random() - 0.5) * 0.5, 0.35 + Math.random() * 0.4, (Math.random() - 0.5) * 0.5), grow: 0.6 + Math.random() * 0.5 });
    }
  }
  s.board.add(group);
  let age = 0;
  const life = 1.8;
  s.effects.push((dt) => {
    age += dt;
    const k = age / life;
    for (const p of parts) {
      p.sp.position.addScaledVector(p.v, dt);
      p.sp.scale.multiplyScalar(1 + p.grow * dt * 0.6);
      // hold, then fade out
      p.sp.material.opacity = 0.9 * Math.min(1, Math.max(0, (1 - k) / 0.6));
    }
    if (k < 1) return true;
    s.board.remove(group);
    return false;
  });
}

/** New tokens fall onto the board with a small bounce */
function dropIn(s: State, g: THREE.Group, delay: number): void {
  const y0 = g.position.y;
  let t = -delay;
  const dur = 0.45;
  g.position.y = y0 + 1.6;
  s.effects.push((dt) => {
    t += dt;
    if (t < 0) return true;
    const k = Math.min(1, t / dur);
    // ease-out with a little bounce at the end
    const e = k < 0.8 ? 1 - Math.pow(1 - k / 0.8, 3) : 1 + Math.sin(((k - 0.8) / 0.2) * Math.PI) * 0.04;
    g.position.y = y0 + 1.6 * (1 - e);
    if (k < 1) return true;
    g.position.y = y0;
    return false;
  });
}

interface State {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: MapControls;
  board: THREE.Group;
  sun: THREE.DirectionalLight;
  /** sepia per tile, animated towards its target */
  tileMats: Map<number, { mat: THREE.MeshStandardMaterial; target: number; hold?: boolean }>;
  pulses: THREE.Mesh[];
  invalidate: () => void;
  effects: Effect[];
  /** Fog sprites around the shown map (rebuilt when the shown tiles change) */
  fog: THREE.Group | null;
  fogKey: string;
  /** Token ids already on the board (new ones drop in) */
  seen: Set<string>;
  table: THREE.Mesh;
  tablePath: string | undefined;
  /** the map under the leather (centred on the board when framed) */
  mapMesh: THREE.Mesh | null;
  mapPath: string | undefined;
  /** the first content is shown at once; later tiles and tokens appear one at a time, the camera flying to each */
  ready: boolean;
  queue: Reveal[];
  busy: boolean;
  /** current token groups by key (rebuilt on every content update) */
  tokenGroups: Map<string, THREE.Group>;
  marker: THREE.Group | null;
  markerKey: string;
}

type Reveal = { kind: "tile"; id: number } | { kind: "token"; key: string } | { kind: "marker"; x: number; y: number };

/** Camera flight: the view target moves to `to` (the camera keeps its offset), smooth in and out */
function flyTo(s: State, to: THREE.Vector3, done: () => void): void {
  const from = s.controls.target.clone();
  const d = from.distanceTo(to);
  if (d < 0.4) { done(); return; }
  const dur = Math.min(0.9, 0.35 + d * 0.03);
  const off = s.camera.position.clone().sub(from);
  let t = 0;
  s.effects.push((dt) => {
    t += dt;
    const k = Math.min(1, t / dur);
    const e = k * k * (3 - 2 * k);
    s.controls.target.lerpVectors(from, to, e);
    s.camera.position.copy(s.controls.target).add(off);
    if (k < 1) return true;
    done();
    return false;
  });
  s.invalidate();
}

/** Show the queued tiles / tokens / marker one by one */
function pump(s: State, tileGroups: Map<number, { group: THREE.Group }>, fx: Record<string, string>, tiles: TileMesh[]): void {
  if (s.busy) return;
  const item = s.queue.shift();
  if (!item) return;
  const target = item.kind === "tile" ? tileGroups.get(item.id)?.group : item.kind === "token" ? s.tokenGroups.get(item.key) : s.marker;
  if (!target) { pump(s, tileGroups, fx, tiles); return; }
  s.board.updateMatrixWorld(true);
  const pos = item.kind === "tile" ? new THREE.Box3().setFromObject(target, true).getCenter(new THREE.Vector3()) : target.getWorldPosition(new THREE.Vector3());
  pos.y = 0;
  // messages sit in the top part of the screen (PopupOptions.PopupCenterOn.Top): look a little past the point so it
  // shows below them
  const fwd = s.controls.target.clone().sub(s.camera.position).setY(0).normalize();
  pos.addScaledVector(fwd, item.kind === "marker" ? 2.6 : 1.2);
  s.busy = true;
  flyTo(s, pos, () => {
    const now = item.kind === "tile" ? tileGroups.get(item.id)?.group : item.kind === "token" ? s.tokenGroups.get(item.key) : s.marker;
    if (now) {
      now.visible = true;
      if (item.kind !== "marker") dropIn(s, now, 0);
      if (item.kind === "token") s.seen.add(item.key);
      if (item.kind === "tile") { const tm = s.tileMats.get(item.id); if (tm) tm.hold = false; }
      if (item.kind === "tile" && fx.dust) { const t = tiles.find((x) => x.tile.hashId === item.id); if (t) dustBurst(s, t, fx); }
    }
    let w = 0;
    s.effects.push((dt) => {
      w += dt;
      if (w < (item.kind === "tile" ? 0.45 : 0.3)) return true;
      s.busy = false;
      pump(s, tileGroups, fx, tiles);
      return false;
    });
    s.invalidate();
  });
}

/** GameViewHighlightManager location highlight: the arrows ring (tinted yellow) turning over a glow */
function markerGroup(fx: Record<string, string>): THREE.Group {
  const g = new THREE.Group();
  const mat = (path: string | undefined, color: number, opacity: number) => new THREE.MeshBasicMaterial({
    map: path ? texture(path) : null, color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending });
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 2.2), mat(fx.highlightGlow, 0xffb030, 0.7));
  glow.rotation.x = -Math.PI / 2;
  const ring = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 1.7), mat(fx.highlight, 0xffc23a, 1));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.005;
  g.add(glow, ring);
  g.userData.ring = ring;
  g.userData.glow = glow;
  return g;
}

export function Board3D({ tiles, tokens, showLabels, rotation, shownTiles = null, sepia = null, onPick, fitKey, fx = {}, table, tableMap, marker = null, intro = false }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const st = useRef<State | null>(null);
  const pickRef = useRef(onPick);
  pickRef.current = onPick;
  const lastFit = useRef<string | undefined>(undefined);
  const tileCache = useRef(new Map<number, { group: THREE.Group; top: THREE.Mesh }>());

  // renderer, scene, controls, render loop (once)
  useEffect(() => {
    const el = host.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x14120f);
    scene.fog = new THREE.Fog(0x14120f, 45, 110);
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 400);
    camera.position.set(0, 18, 14);
    scene.add(new THREE.HemisphereLight(0xf3e6c8, 0x2a2219, 0.9));
    const sun = new THREE.DirectionalLight(0xffefd2, 1.6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0006;
    scene.add(sun, sun.target);
    const tableMesh = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ map: tableTexture(), roughness: 1 }));
    tableMesh.rotation.x = -Math.PI / 2;
    tableMesh.position.y = -0.01;
    tableMesh.receiveShadow = true;
    scene.add(tableMesh);
    const board = new THREE.Group();
    scene.add(board);

    const controls = new MapControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.12;
    controls.maxPolarAngle = Math.PI * 0.42;
    controls.minDistance = 4;
    controls.maxDistance = 90;
    controls.screenSpacePanning = false;

    let raf = 0;
    let frames = 0; // keep rendering a little after the last change (damping, fades)
    const invalidate = () => {
      frames = Math.max(frames, 90);
      if (!raf) raf = requestAnimationFrame(tick);
    };
    let last = 0;
    const tick = (time: number) => {
      raf = 0;
      const s = st.current;
      if (!s) return;
      const dt = last ? Math.min(0.1, (time - last) / 1000) : 1 / 60;
      last = time;
      const moving = controls.update();
      let anim = false;
      // effects may start new ones while they run (a flight ending starts the reveal): keep those too
      const running = s.effects;
      s.effects = [];
      const still = running.filter((f) => f(dt, time / 1000));
      s.effects = still.concat(s.effects);
      if (s.effects.length) anim = true;
      for (const { mat, target, hold } of s.tileMats.values()) {
        if (hold) continue;
        const u = mat.userData.sepia as { value: number };
        // gradual, like the original (a placed tile darkens over about a second)
        if (Math.abs(u.value - target) > 0.005) { u.value += (target - u.value) * Math.min(1, dt * 2.2); anim = true; } else u.value = target;
      }
      for (const p of s.pulses) {
        const k = 1 + 0.06 * Math.sin(time / 260);
        p.scale.set(k, 1, k);
        (p.material as THREE.MeshBasicMaterial).opacity = 0.55 + 0.35 * Math.sin(time / 260);
      }
      renderer.render(scene, camera);
      if (moving || anim) frames = Math.max(frames, 30);
      // active tokens pulse: keep a slow loop while there are any
      // one chain only: controls.update() above may already have scheduled the next frame through invalidate()
      // (scheduling again here doubled the chains on every camera change: dozens of renders per frame)
      if (--frames > 0 || s.pulses.length || s.effects.length) { if (!raf) raf = requestAnimationFrame(tick); }
      else if (!raf) last = 0;
    };
    controls.addEventListener("change", invalidate);
    THREE.DefaultLoadingManager.onLoad = invalidate;

    const resize = () => {
      const w = el.clientWidth, h = el.clientHeight;
      renderer.setSize(w, h);
      camera.aspect = w / Math.max(1, h);
      camera.updateProjectionMatrix();
      invalidate();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);

    // tap = press and release without moving
    let tap: { x: number; y: number } | null = null;
    const raycaster = new THREE.Raycaster();
    const onDown = (e: PointerEvent) => { tap = e.isPrimary ? { x: e.clientX, y: e.clientY } : null; };
    const onMove = (e: PointerEvent) => { if (tap && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > 6) tap = null; };
    const onUp = (e: PointerEvent) => {
      if (!tap || !pickRef.current || e.button !== 0) { tap = null; return; }
      tap = null;
      const r = el.getBoundingClientRect();
      raycaster.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
      for (const hit of raycaster.intersectObjects(board.children, true)) {
        const p = hit.object.userData.pick as Pick | undefined;
        if (p) { pickRef.current(p); return; }
      }
    };
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);

    st.current = { renderer, scene, camera, controls, board, sun, tileMats: new Map(), pulses: [], invalidate,
      effects: [], fog: null, fogKey: "", seen: new Set(), table: tableMesh, tablePath: undefined, mapMesh: null, mapPath: undefined,
      ready: false, queue: [], busy: false, tokenGroups: new Map(), marker: null, markerKey: "" };
    (window as any).__board3d = st.current; // perf checks from devtools / CDP
    resize();
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      renderer.dispose();
      el.removeChild(renderer.domElement);
      st.current = null;
      tileCache.current.clear();
    };
  }, []);

  // board content
  useEffect(() => {
    const s = st.current;
    if (!s) return;
    const rot = (-rotation * Math.PI) / 180;
    s.board.rotation.y = rot;
    if (table !== s.tablePath) {
      s.tablePath = table;
      const mat = s.table.material as THREE.MeshStandardMaterial;
      if (table) {
        const t = texture(table);
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.repeat.set(24, 24);
        mat.map = t;
        // the original's leather is redder
        mat.color.set(0xffd2c0);
        // the leather is a semi-transparent layer over the map (lit a little by itself, like the original's)
        mat.emissive.set(0x40241c);
        mat.emissiveMap = t;
        mat.transparent = !!tableMap;
        mat.opacity = tableMap ? 0.93 : 1;
        mat.depthWrite = !tableMap;
      } else {
        mat.map = tableTexture();
        mat.color.set(0xffffff);
      }
      mat.needsUpdate = true;
    }
    if (tableMap !== s.mapPath) {
      s.mapPath = tableMap;
      if (s.mapMesh) { s.scene.remove(s.mapMesh); s.mapMesh = null; }
      if (tableMap) {
        const t = texture(tableMap);
        const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshStandardMaterial({ map: t, roughness: 1, color: 0xb8a890 }));
        m.rotation.x = -Math.PI / 2;
        m.position.y = -0.02;
        m.receiveShadow = true;
        const W = 110;
        const fit = () => { const im = t.image as { width?: number; height?: number } | undefined; m.scale.set(W, W * ((im?.height ?? 1) / (im?.width ?? 1)), 1); s.invalidate(); };
        fit();
        THREE.DefaultLoadingManager.onLoad = () => { fit(); s.invalidate(); };
        s.scene.add(m);
        s.mapMesh = m;
        s.table.renderOrder = 1;
      }
    }
    // a new view (game, adventure): everything shows at once, no flights
    if (fitKey === undefined || fitKey !== lastFit.current) { s.ready = intro; s.queue = []; s.busy = false; }
    // tiles: built once per tile, reused across updates (keeps the sepia fade going)
    const shown = tiles.filter((t) => !shownTiles || shownTiles.has(t.tile.hashId));
    const keep = new Set(shown.map((t) => t.tile.hashId));
    for (const [id, c] of tileCache.current) if (!keep.has(id)) { s.board.remove(c.group); tileCache.current.delete(id); s.tileMats.delete(id); }
    for (const t of shown) {
      let c = tileCache.current.get(t.tile.hashId);
      const target = sepia?.has(t.tile.hashId) ? 1 : 0;
      if (!c) {
        c = tileGroup(t);
        c.top.userData.pick = { kind: "tile", id: t.tile.hashId } satisfies Pick;
        tileCache.current.set(t.tile.hashId, c);
        s.board.add(c.group);
        if (s.ready) { c.group.visible = false; s.queue.push({ kind: "tile", id: t.tile.hashId }); }
        const mat = c.top.material as THREE.MeshStandardMaterial;
        // the first view appears in its state; a tile placed later comes in colour and darkens
        (mat.userData.sepia as { value: number }).value = s.ready ? 0 : target;
        // a tile waiting for its turn keeps its colour; it darkens from the moment it drops in
        s.tileMats.set(t.tile.hashId, { mat, target, hold: s.ready });
      } else {
        const tm = s.tileMats.get(t.tile.hashId)!;
        if (tm.target === 1 && target === 0 && fx.dust) dustBurst(s, t, fx);
        tm.target = target;
      }
    }
    // tokens and labels: rebuilt on every change (few dozen objects)
    for (const o of [...s.board.children]) if (o.userData.token) {
      s.board.remove(o);
      o.traverse((m) => { if ((m as THREE.Mesh).geometry) (m as THREE.Mesh).geometry.dispose(); });
    }
    s.pulses = [];
    const seenNow = new Set<string>();
    s.tokenGroups = new Map();
    const queued = new Set(s.queue.flatMap((q) => (q.kind === "token" ? [q.key] : [])));
    for (const tk of tokens) {
      const g = new THREE.Group();
      g.userData.token = true;
      const m = tokenMesh(tk);
      m.position.y = TILE_LIFT + TILE_H + 0.002;
      // square tokens lie aligned with their tile; round art faces the viewer's default direction
      m.rotation.y += tk.shape === "square" ? tk.angle ?? 0 : -rot;
      if (tk.id !== undefined) m.userData.pick = { kind: "token", id: tk.id } satisfies Pick;
      g.add(m);
      // no highlight ring (the original has none); a valid target sits a touch higher
      if (tk.active) m.position.y += 0.03;
      if (showLabels && tk.label) {
        const l = labelSprite(tk.label);
        l.position.set(0, TILE_LIFT + TILE_H + 0.75, 0);
        g.add(l);
      }
      g.position.copy(v3(tk.x, tk.y));
      s.board.add(g);
      const key = tk.id ?? `${tk.x.toFixed(2)},${tk.y.toFixed(2)}`;
      s.tokenGroups.set(key, g);
      if (s.seen.has(key)) seenNow.add(key);
      else if (!s.ready) { dropIn(s, g, Math.random() * 0.25); seenNow.add(key); }
      else {
        // waits for its turn (and the camera) to drop in
        g.visible = false;
        if (!queued.has(key)) { s.queue.push({ kind: "token", key }); queued.add(key); }
      }
    }
    s.seen = seenNow;
    // the location highlight, after what appears now
    const mk = marker ? `${marker[0].toFixed(2)},${marker[1].toFixed(2)}` : "";
    if (mk !== s.markerKey) {
      s.markerKey = mk;
      if (s.marker) { s.board.remove(s.marker); s.marker = null; }
      s.queue = s.queue.filter((q) => q.kind !== "marker");
      if (marker) {
        const m = markerGroup(fx);
        m.position.copy(v3(marker[0], marker[1], TILE_LIFT + TILE_H + 0.012));
        m.visible = false;
        s.board.add(m);
        s.marker = m;
        s.queue.push({ kind: "marker", x: marker[0], y: marker[1] });
        s.effects.push((dt, time) => {
          if (s.marker !== m) return false;
          (m.userData.ring as THREE.Mesh).rotation.z -= dt * 1.4;
          const k = 1 + 0.08 * Math.sin(time * 3);
          (m.userData.glow as THREE.Mesh).scale.set(k, k, 1);
          return true;
        });
      }
    }
    // fog over the tiles still to come
    const hidden = shownTiles ? tiles.filter((t) => !shownTiles.has(t.tile.hashId)) : [];
    const fogKey = hidden.map((t) => t.tile.hashId).sort((a, b) => a - b).join(",") + (fx.cloud ? "+" : "");
    if (fogKey !== s.fogKey) {
      s.fogKey = fogKey;
      if (s.fog) s.board.remove(s.fog);
      s.fog = (fx.cloud || fx.smoke) && hidden.length ? buildFog(hidden, fx) : null;
      if (s.fog) {
        s.board.add(s.fog);
        const fog = s.fog;
        s.effects.push((dt, time) => {
          if (st.current?.fog !== fog) return false;
          for (const m of fog.children) {
            const u = m.userData;
            m.rotation.z += u.spin * dt;
            m.position.y = u.y + Math.sin(time * 0.5 + u.bob) * 0.04;
            m.position.x = u.x + Math.sin(time * u.speed + u.bob) * u.drift;
            m.position.z = u.z + Math.cos(time * u.speed * 0.8 + u.bob * 1.7) * u.drift;
          }
          return true;
        });
      }
    }
    // frame the camera on the shown tiles when the view key changes (the first content shows at once)
    const refit = fitKey === undefined || fitKey !== lastFit.current;
    const opening = refit && intro;
    if (refit && tiles.length) {
      lastFit.current = fitKey;
      s.board.updateMatrixWorld(true);
      const box = new THREE.Box3();
      for (const t of shown) box.expandByObject(tileCache.current.get(t.tile.hashId)!.group);
      // nothing placed yet / a new game opening on the fog: frame the whole map's area
      if (!shown.length || opening) {
        box.makeEmpty();
        for (const t of tiles) for (const [x, y] of t.hexCenters) box.expandByPoint(v3(x, y).applyMatrix4(s.board.matrixWorld));
        box.expandByScalar(1);
      }
      const c = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const r = Math.max(size.x, size.z) * 0.5 + 1;
      // fit both the width (with the aspect ratio) and the depth (foreshortened by the tilt)
      const tan = Math.tan((s.camera.fov * Math.PI) / 360);
      const dist = Math.max((size.z * 0.5 + 1) / tan * 0.85, (size.x * 0.5 + 1) / (tan * s.camera.aspect)) * 1.02;
      s.controls.target.copy(c);
      s.camera.position.set(c.x, c.y + dist * 0.82, c.z + dist * 0.58);
      if (s.mapMesh) s.mapMesh.position.set(c.x, -0.02, c.z);
      // shadow camera covers the board
      s.sun.position.set(c.x - 14, 26, c.z + 10);
      s.sun.target.position.copy(c);
      const sc = s.sun.shadow.camera;
      sc.left = sc.bottom = -(r + 4); sc.right = sc.top = r + 4; sc.near = 1; sc.far = 90;
      sc.updateProjectionMatrix();
      s.controls.update();
    }
    if (tiles.length) s.ready = true;
    pump(s, tileCache.current, fx, tiles);
    s.invalidate();
  }, [tiles, tokens, showLabels, rotation, shownTiles, sepia, fitKey, fx, table, tableMap, marker]);

  return <div ref={host} className="board" />;
}
