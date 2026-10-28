// The menus' background (a theme from the packs, images/menu/menu.json): picture layers in depth, effects between them
// and a slowly moving camera.
//   layers:  [{ src, depth, z }]          depth 0 = still ... 1 = moves most (the nearest layer); z = drawing order
//   effects: { type: "fog", texture, z, y, height, opacity, speed, flip?, depth? }   a drifting band of fog
//            { type: "rays", texture?, z, x, y, opacity, depth? }                    sun rays from (x, y) (screen 0..1)
//            { type: "leaves", atlas, frames: [[x, y, w, h]], z, count, size: [min, max], wind }   falling leaves
//   camera:  { rx, ry, angle, period, zoom }   an ellipse (radii in % of the screen) turned by `angle` degrees,
//            one round in `period` s; the pointer adds a little parallax. zoom keeps the edges off screen.
// Without a theme a drawn dusk sky with mist stands in.
import { useEffect, useRef, useState } from "react";
import { assetUrl, packJsonMerged } from "../../data/pack.ts";
import { LOW_GFX } from "../../data/perf.ts";

interface Layer { src: string; depth?: number; z?: number }
interface Effect {
  type: "fog" | "rays" | "leaves"; z?: number; depth?: number; opacity?: number;
  texture?: string; x?: number; y?: number; height?: number; speed?: number; flip?: boolean;
  atlas?: string; frames?: [number, number, number, number][]; count?: number; size?: [number, number]; wind?: number;
}
interface Camera { rx?: number; ry?: number; angle?: number; period?: number; zoom?: number }
interface Theme { layers?: Layer[]; effects?: Effect[]; camera?: Camera }

const reduced = () => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Falling leaves on a canvas: each sways, turns and flips (a cosine squash), the nearer ones bigger and faster */
function Leaves({ e }: { e: Effect }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = canvas.current;
    if (!cv || !e.atlas || !e.frames?.length || reduced()) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const img = new Image();
    img.src = assetUrl(e.atlas);
    const frames = e.frames;
    const [smin, smax] = e.size ?? [20, 44];
    const wind = e.wind ?? 0.3;
    const n = Math.max(1, Math.round((e.count ?? 20) * (LOW_GFX ? 0.5 : 1)));
    let W = 0, H = 0, dpr = 1;
    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, LOW_GFX ? 1 : 1.5);
      W = cv.clientWidth; H = cv.clientHeight;
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    };
    resize();
    window.addEventListener("resize", resize);
    const leaf = (start: boolean) => {
      const near = Math.random();
      return {
        f: Math.floor(Math.random() * frames.length),
        size: smin + (smax - smin) * near,
        x: Math.random() * (W + 200) - 150,
        y: start ? Math.random() * H : -60 - Math.random() * H * 0.5,
        vy: 25 + 45 * near + Math.random() * 15,
        sway: 20 + Math.random() * 40, swayF: 0.4 + Math.random() * 0.7, phase: Math.random() * 6.3,
        rot: Math.random() * 6.3, vr: (Math.random() - 0.5) * 1.6,
        flipF: 0.8 + Math.random() * 1.6, alpha: 0.65 + 0.35 * near,
      };
    };
    const all = Array.from({ length: n }, () => leaf(true));
    let raf = 0, last = performance.now(), t = 0;
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now; t += dt;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, cv.width, cv.height);
      if (img.complete && img.naturalWidth) {
        for (let i = 0; i < all.length; i++) {
          const l = all[i]!;
          l.y += l.vy * dt;
          l.x += (wind * 60 + Math.sin(t * l.swayF + l.phase) * l.sway) * dt;
          l.rot += l.vr * dt;
          if (l.y > H + 60 || l.x > W + 120) all[i] = leaf(false);
          const [fx, fy, fw, fh] = frames[l.f]!;
          const k = l.size / Math.max(fw, fh);
          const flip = Math.cos(t * l.flipF + l.phase);
          ctx.globalAlpha = l.alpha;
          const c = Math.cos(l.rot), s = Math.sin(l.rot);
          ctx.setTransform(dpr * c * flip, dpr * s * flip, -dpr * s, dpr * c, dpr * l.x, dpr * l.y);
          ctx.drawImage(img, fx, fy, fw, fh, (-fw * k) / 2, (-fh * k) / 2, fw * k, fh * k);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", resize); };
  }, [e]);
  return <canvas ref={canvas} className="pm-leaves" />;
}

function EffectView({ e }: { e: Effect }) {
  if (e.type === "leaves") return <Leaves e={e} />;
  if (e.type === "fog" && e.texture) {
    return (
      <div className="pm-fog" style={{ top: `${(e.y ?? 0.5) * 100 - (e.height ?? 0.3) * 50}%`, height: `${(e.height ?? 0.3) * 100}%`, opacity: e.opacity ?? 0.5 }}>
        <div className="pm-fog-strip" style={{ backgroundImage: `url("${assetUrl(e.texture)}")`, animationDuration: `${e.speed ?? 90}s`,
          ...(e.flip ? { animationDirection: "reverse" } : {}) }} />
      </div>
    );
  }
  if (e.type === "rays") {
    const x = (e.x ?? 0.2) * 100, y = (e.y ?? 0.2) * 100;
    return (
      <div className="pm-rays" style={{ opacity: e.opacity ?? 0.3, transformOrigin: `${x}% ${y}%`,
        ...(e.texture ? { backgroundImage: `url("${assetUrl(e.texture)}")` }
          : { background: `radial-gradient(circle at ${x}% ${y}%, rgba(255,214,150,0.9), rgba(255,190,120,0.25) 25%, transparent 60%)` }) }} />
    );
  }
  return null;
}

export function MenuBackground({ dim = false }: { dim?: boolean }) {
  const [theme, setTheme] = useState<Theme | null>(null);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    packJsonMerged<Theme>("images/menu/menu.json").then(setTheme).catch(() => setTheme({}));
  }, []);
  useEffect(() => {
    const el = root.current;
    if (!el || !theme) return;
    const cam = theme.camera ?? {};
    const still = reduced();
    const zoom = cam.zoom ?? 1.08;
    const rx = cam.rx ?? 0, ry = cam.ry ?? 0, period = cam.period ?? 60;
    const a = ((cam.angle ?? 0) * Math.PI) / 180;
    const items = [...el.querySelectorAll<HTMLElement>("[data-depth]")].map((n) => ({ n, d: Number(n.dataset.depth) }));
    let raf = 0, tx = 0, ty = 0, px = 0, py = 0;
    const t0 = performance.now();
    const move = (e: PointerEvent) => { tx = (e.clientX / window.innerWidth - 0.5) * 2; ty = (e.clientY / window.innerHeight - 0.5) * 2; };
    const tick = (now: number) => {
      // eased pointer, so a jump glides
      px += (tx - px) * 0.05; py += (ty - py) * 0.05;
      const w = still ? 0 : ((now - t0) / 1000 / period) * Math.PI * 2;
      const ex = rx * Math.cos(w), ey = ry * Math.sin(w);
      const cx = ex * Math.cos(a) - ey * Math.sin(a), cy = ex * Math.sin(a) + ey * Math.cos(a);
      for (const { n, d } of items) {
        const x = (cx - px * 1.5) * d, y = (cy - py * 1.0) * d;
        n.style.transform = `translate3d(${x.toFixed(3)}%, ${y.toFixed(3)}%, 0) scale(${zoom})`;
      }
      raf = requestAnimationFrame(tick);
    };
    window.addEventListener("pointermove", move);
    raf = requestAnimationFrame(tick);
    return () => { window.removeEventListener("pointermove", move); cancelAnimationFrame(raf); };
  }, [theme]);

  const layers = theme?.layers ?? [];
  // layers and effects in one drawing order (z); effects without a depth move with the nearest layer below them
  const parts = [
    ...layers.map((l, i) => ({ z: l.z ?? i * 10, depth: l.depth ?? 0, layer: l as Layer | null, effect: null as Effect | null })),
    ...(theme?.effects ?? []).map((e) => ({ z: e.z ?? 100, depth: e.depth ?? null, layer: null as Layer | null, effect: e as Effect | null })),
  ].sort((p, q) => p.z - q.z);
  let depth = 0;
  return (
    <div ref={root} className={`pm-bg${dim ? " dim" : ""}`}>
      {theme && layers.length > 0 && parts.map((p, i) => {
        if (p.layer) depth = p.depth ?? 0;
        const d = p.effect?.type === "leaves" ? null : p.depth ?? depth;
        const body = p.layer ? <div className="pm-img" style={{ backgroundImage: `url("${assetUrl(p.layer.src)}")` }} /> : <EffectView e={p.effect!} />;
        // the rays are added light: the moving part itself blends (screen) with what is under it
        const cls = `pm-part${p.effect?.type === "rays" ? " pm-part-light" : ""}`;
        return d === null ? <div key={i} className={cls}>{body}</div> : <div key={i} className={cls} data-depth={d}>{body}</div>;
      })}
      {theme && !layers.length && (
        <div className="pm-part" data-depth="0.3">
          <div className="pm-img pm-sky" />
          <div className="pm-img pm-hills far" />
          <div className="pm-img pm-hills near" />
          <div className="pm-img pm-mist" />
        </div>
      )}
      <div className="pm-vignette" />
      <div className="pm-shade" />
    </div>
  );
}
