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
}

/** Animation step; returns false when finished */
type Effect = (dt: number, time: number) => boolean;

const TILE_H = 0.12;
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
  const add = (x: number, y: number, opacity: number, sc: number) => {
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex[Math.floor(Math.random() * tex.length)]!, color: 0xa39a8c, transparent: true, opacity, depthWrite: false }));
    m.scale.set(sc, sc, 1);
    m.rotation.set(-Math.PI / 2, 0, Math.random() * Math.PI * 2);
    m.position.copy(v3(x + (Math.random() - 0.5) * 0.5, y + (Math.random() - 0.5) * 0.5, 0.2 + Math.random() * 0.25));
    m.userData = { spin: (Math.random() - 0.5) * 0.06, bob: Math.random() * 6, y: m.position.y };
    m.renderOrder = 4;
    g.add(m);
  };
  for (const t of hidden) for (const [x, y] of t.hexCenters) add(x, y, 0.42 + Math.random() * 0.12, 2.4 + Math.random() * 1.0);
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
      sp.position.copy(v3(x + (Math.random() - 0.5) * 0.8, y + (Math.random() - 0.5) * 0.8, TILE_H + 0.15));
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
  tileMats: Map<number, { mat: THREE.MeshStandardMaterial; target: number }>;
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
}

export function Board3D({ tiles, tokens, showLabels, rotation, shownTiles = null, sepia = null, onPick, fitKey, fx = {}, table }: Props) {
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
      s.effects = s.effects.filter((f) => f(dt, time / 1000));
      if (s.effects.length) anim = true;
      for (const { mat, target } of s.tileMats.values()) {
        const u = mat.userData.sepia as { value: number };
        if (Math.abs(u.value - target) > 0.005) { u.value += (target - u.value) * 0.08; anim = true; } else u.value = target;
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
      effects: [], fog: null, fogKey: "", seen: new Set(), table: tableMesh, tablePath: undefined };
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
        mat.color.set(0xffffff);
      } else {
        mat.map = tableTexture();
        mat.color.set(0xffffff);
      }
      mat.needsUpdate = true;
    }
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
        const mat = c.top.material as THREE.MeshStandardMaterial;
        (mat.userData.sepia as { value: number }).value = target; // new tiles appear in their state
        s.tileMats.set(t.tile.hashId, { mat, target });
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
    for (const tk of tokens) {
      const g = new THREE.Group();
      g.userData.token = true;
      const m = tokenMesh(tk);
      m.position.y = TILE_H + 0.002;
      // square tokens lie aligned with their tile; round art faces the viewer's default direction
      m.rotation.y += tk.shape === "square" ? tk.angle ?? 0 : -rot;
      if (tk.id !== undefined) m.userData.pick = { kind: "token", id: tk.id } satisfies Pick;
      g.add(m);
      // no highlight ring (the original has none); a valid target sits a touch higher
      if (tk.active) m.position.y += 0.03;
      if (showLabels && tk.label) {
        const l = labelSprite(tk.label);
        l.position.set(0, TILE_H + 0.75, 0);
        g.add(l);
      }
      g.position.copy(v3(tk.x, tk.y));
      s.board.add(g);
      const key = tk.id ?? `${tk.x.toFixed(2)},${tk.y.toFixed(2)}`;
      if (!s.seen.has(key)) dropIn(s, g, s.seen.size ? 0 : Math.random() * 0.25);
      seenNow.add(key);
    }
    s.seen = seenNow;
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
            m.rotation.z += m.userData.spin * dt;
            m.position.y = m.userData.y + Math.sin(time * 0.5 + m.userData.bob) * 0.04;
          }
          return true;
        });
      }
    }
    // frame the camera on the shown tiles when the view key changes
    const refit = fitKey === undefined || fitKey !== lastFit.current;
    if (refit && shown.length) {
      lastFit.current = fitKey;
      s.board.updateMatrixWorld(true);
      const box = new THREE.Box3();
      for (const t of shown) box.expandByObject(tileCache.current.get(t.tile.hashId)!.group);
      const c = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const r = Math.max(size.x, size.z) * 0.5 + 1;
      // fit both the width (with the aspect ratio) and the depth (foreshortened by the tilt)
      const tan = Math.tan((s.camera.fov * Math.PI) / 360);
      const dist = Math.max((size.z * 0.5 + 1) / tan * 0.85, (size.x * 0.5 + 1) / (tan * s.camera.aspect)) * 1.02;
      s.controls.target.copy(c);
      s.camera.position.set(c.x, c.y + dist * 0.82, c.z + dist * 0.58);
      // shadow camera covers the board
      s.sun.position.set(c.x - 14, 26, c.z + 10);
      s.sun.target.position.copy(c);
      const sc = s.sun.shadow.camera;
      sc.left = sc.bottom = -(r + 4); sc.right = sc.top = r + 4; sc.near = 1; sc.far = 90;
      sc.updateProjectionMatrix();
      s.controls.update();
    }
    s.invalidate();
  }, [tiles, tokens, showLabels, rotation, shownTiles, sepia, fitKey, fx, table]);

  return <div ref={host} className="board" />;
}
