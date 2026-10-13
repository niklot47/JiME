// Top-down board: textured tile meshes + encounter tokens. Pan with drag, zoom with wheel / pinch.
import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { TileMesh } from "@jime/engine/map";
import { assetUrl } from "../data/pack.ts";

export interface Token {
  x: number;
  y: number;
  label: string;
  color: string;
  section?: number;
}

interface Props {
  tiles: TileMesh[];
  tokens: Token[];
  showLabels: boolean;
  /** View rotation in degrees (the original app's camera may show the board rotated) */
  rotation: number;
  /** Tint tiles by section to make section boundaries visible */
  sectionTint: boolean;
  /** Show tile codes (printed on the physical tiles) */
  showCodes?: boolean;
  /** Only these sections (debug / comparison with the original's revealed area) */
  sections?: number[] | null;
}

const SECTION_COLORS = [0xffffff, 0xffd9a8, 0xb8e0ff, 0xd8ffb8, 0xffc4e1, 0xe0d0ff, 0xfff3a8, 0xc0fff4];
const loader = new THREE.TextureLoader();
const texCache = new Map<string, THREE.Texture>();

function texture(path: string): THREE.Texture {
  let t = texCache.get(path);
  if (!t) {
    t = loader.load(assetUrl(path));
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    texCache.set(path, t);
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
  const h = 0.42;
  s.scale.set((h * w) / 56, h, 1);
  s.renderOrder = 3;
  return s;
}

export function BoardView({ tiles, tokens, showLabels, rotation, sectionTint, showCodes = false, sections = null }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const state = useRef<{ renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.OrthographicCamera; board: THREE.Group; render: () => void; fit: (w: number, h: number) => void } | null>(null);

  // renderer, camera and input (once)
  useEffect(() => {
    const el = host.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1d1812);
    const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, -100, 100);
    const board = new THREE.Group();
    scene.add(board);
    const render = () => renderer.render(scene, camera);
    let zoom = 1;
    const resize = () => {
      const w = el.clientWidth, h = el.clientHeight;
      renderer.setSize(w, h);
      const aspect = w / Math.max(1, h);
      const half = 12 / zoom;
      camera.left = -half * aspect; camera.right = half * aspect; camera.top = half; camera.bottom = -half;
      camera.updateProjectionMatrix();
      render();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    // pointer pan + wheel/pinch zoom
    const pointers = new Map<number, { x: number; y: number }>();
    let pinch = 0;
    const worldPerPixel = () => (camera.top - camera.bottom) / el.clientHeight;
    const onDown = (e: PointerEvent) => { el.setPointerCapture(e.pointerId); pointers.set(e.pointerId, { x: e.clientX, y: e.clientY }); };
    const onMove = (e: PointerEvent) => {
      const p = pointers.get(e.pointerId);
      if (!p) return;
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d0 = Math.hypot(a!.x - b!.x, a!.y - b!.y);
        p.x = e.clientX; p.y = e.clientY;
        const d1 = Math.hypot(a!.x - b!.x, a!.y - b!.y);
        if (pinch) { zoom = Math.min(8, Math.max(0.2, zoom * (d1 / d0))); resize(); }
        pinch = 1;
        return;
      }
      const k = worldPerPixel();
      camera.position.x -= (e.clientX - p.x) * k;
      camera.position.y += (e.clientY - p.y) * k;
      p.x = e.clientX; p.y = e.clientY;
      render();
    };
    const onUp = (e: PointerEvent) => { pointers.delete(e.pointerId); if (pointers.size < 2) pinch = 0; };
    const onWheel = (e: WheelEvent) => { e.preventDefault(); zoom = Math.min(8, Math.max(0.2, zoom * Math.exp(-e.deltaY * 0.0015))); resize(); };
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    el.addEventListener("wheel", onWheel, { passive: false });
    THREE.DefaultLoadingManager.onLoad = render;
    /** Zoom so that a w × h world rectangle fits the view with a margin */
    const fit = (w: number, h: number) => {
      const aspect = el.clientWidth / Math.max(1, el.clientHeight);
      zoom = Math.min(8, Math.max(0.2, Math.min((24 * aspect) / (w * 1.1), 24 / (h * 1.1))));
      resize();
    };
    state.current = { renderer, scene, camera, board, render, fit };
    resize();
    return () => {
      ro.disconnect();
      renderer.dispose();
      el.removeChild(renderer.domElement);
      state.current = null;
    };
  }, []);

  // board content
  useEffect(() => {
    const s = state.current;
    if (!s) return;
    for (const c of [...s.board.children]) {
      s.board.remove(c);
      c.traverse((o) => { if ((o as THREE.Mesh).geometry) (o as THREE.Mesh).geometry.dispose(); });
    }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const shown = sections ? tiles.filter((t) => sections.includes(t.tile.section)) : tiles;
    const rot = (-rotation * Math.PI) / 180;
    for (const t of shown) {
      const g = new THREE.BufferGeometry();
      const pos = new Float32Array((t.positions.length / 2) * 3);
      for (let i = 0; i < t.positions.length / 2; i++) {
        const x = t.positions[2 * i]!, y = t.positions[2 * i + 1]!;
        pos[3 * i] = x; pos[3 * i + 1] = y;
        // bounds in view space (after the view rotation)
        const vx = Math.cos(rot) * x - Math.sin(rot) * y, vy = Math.sin(rot) * x + Math.cos(rot) * y;
        minX = Math.min(minX, vx); maxX = Math.max(maxX, vx); minY = Math.min(minY, vy); maxY = Math.max(maxY, vy);
      }
      g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      g.setAttribute("uv", new THREE.Float32BufferAttribute(t.uvs, 2));
      g.setIndex(t.indices);
      const color = sectionTint ? SECTION_COLORS[t.tile.section % SECTION_COLORS.length]! : 0xffffff;
      const m = new THREE.MeshBasicMaterial({ map: t.texture ? texture(t.texture) : null, color, side: THREE.DoubleSide });
      s.board.add(new THREE.Mesh(g, m));
      if (showCodes) {
        const n = t.hexCenters.length;
        const cx = t.hexCenters.reduce((a, c) => a + c[0], 0) / n, cy = t.hexCenters.reduce((a, c) => a + c[1], 0) / n;
        const l = labelSprite(`${t.tile.code} · S${t.tile.section}`);
        l.position.set(cx, cy + 0.5, 0.03);
        s.board.add(l);
      }
    }
    const visibleTokens = sections ? tokens.filter((tk) => sections.includes(tk.section ?? -1)) : tokens;
    for (const tk of visibleTokens) {
      const disc = new THREE.Mesh(new THREE.CircleGeometry(0.32, 32), new THREE.MeshBasicMaterial({ color: tk.color, depthTest: false }));
      disc.position.set(tk.x, tk.y, 0.01);
      disc.renderOrder = 2;
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.32, 0.38, 32), new THREE.MeshBasicMaterial({ color: 0x1a140c, depthTest: false }));
      ring.position.set(tk.x, tk.y, 0.011);
      ring.renderOrder = 2;
      s.board.add(disc, ring);
      if (showLabels && tk.label) {
        const l = labelSprite(tk.label);
        l.position.set(tk.x, tk.y - 0.62, 0.02);
        s.board.add(l);
      }
    }
    s.board.rotation.z = rot;
    if (shown.length) {
      s.camera.position.set((minX + maxX) / 2, (minY + maxY) / 2, 10);
      s.fit(maxX - minX, maxY - minY);
    }
    s.render();
  }, [tiles, tokens, showLabels, rotation, sectionTint, showCodes, sections]);

  return <div ref={host} className="board" />;
}
