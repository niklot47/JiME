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
  type: "fog" | "rays" | "leaves" | "water"; z?: number; src?: string; mask?: string; strength?: number; depth?: number; opacity?: number;
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

const WATER_VS = `attribute vec2 p; varying vec2 v; void main() { v = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`;
// the picture is drawn like CSS background-size: cover; inside the mask its pixels are fetched from a little higher
// and to the side by two octaves of value noise scrolling down (falls fast, river slow), plus faint bright streaks
const WATER_FS = `precision mediump float;
varying vec2 v;
uniform sampler2D img; uniform sampler2D mask; uniform float t; uniform float k; uniform float speed; uniform vec2 scale;
float h(vec2 q) { return fract(sin(dot(q, vec2(127.1, 311.7))) * 43758.5453); }
float n(vec2 q) { vec2 i = floor(q), f = fract(q); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h(i), h(i + vec2(1.0, 0.0)), f.x), mix(h(i + vec2(0.0, 1.0)), h(i + vec2(1.0, 1.0)), f.x), f.y); }
void main() {
  vec2 uv = vec2(0.5) + (vec2(v.x, 1.0 - v.y) - vec2(0.5)) * scale;
  vec4 m = texture2D(mask, uv);
  if (m.r < 0.01) { gl_FragColor = vec4(0.0); return; }
  float s = t * speed * mix(0.25, 1.0, m.g);
  vec2 q = vec2(uv.x * 90.0, uv.y * 30.0 - s * 6.0);
  float a = n(q) + 0.5 * n(q * 2.3 + 7.0);
  float b = n(q + 31.0) + 0.5 * n(q * 2.1 + 3.0);
  vec2 off = (vec2(a, b) - 0.75) * k * vec2(0.6, 1.4);
  vec4 c = texture2D(img, uv + off);
  float streak = smoothstep(0.78, 1.0, n(vec2(uv.x * 220.0, uv.y * 14.0 - s * 9.0))) * 0.18;
  float al = m.r * c.a;
  gl_FragColor = vec4((c.rgb + streak) * al, al);
}`;

/** Flowing water over a layer: its picture again, only where the mask says water, displaced by moving noise */
function Water({ e }: { e: Effect }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = canvas.current;
    if (!cv || !e.src || !e.mask || reduced()) return;
    const gl = cv.getContext("webgl", { premultipliedAlpha: true, alpha: true });
    if (!gl) return;
    const sh = (type: number, src: string) => { const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s); return s; };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, WATER_VS));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, WATER_FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "p");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const u = (n: string) => gl.getUniformLocation(prog, n);
    gl.uniform1i(u("img"), 0); gl.uniform1i(u("mask"), 1);
    gl.uniform1f(u("k"), e.strength ?? 0.004); gl.uniform1f(u("speed"), e.speed ?? 1);
    let aspect = 16 / 9, ready = 0, raf = 0;
    const load = (src: string, unit: number, onSize?: (w: number, h: number) => void) => {
      const im = new Image();
      im.crossOrigin = "anonymous";
      im.onload = () => {
        const tex = gl.createTexture();
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, im);
        for (const [p, val] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]] as const)
          gl.texParameteri(gl.TEXTURE_2D, p, val);
        onSize?.(im.naturalWidth, im.naturalHeight);
        ready++;
      };
      im.src = assetUrl(src);
    };
    load(e.src, 0, (w, h) => { aspect = w / h; });
    load(e.mask, 1);
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5) * (LOW_GFX ? 0.5 : 1);
      cv.width = Math.round(cv.clientWidth * dpr); cv.height = Math.round(cv.clientHeight * dpr);
      gl.viewport(0, 0, cv.width, cv.height);
    };
    resize();
    window.addEventListener("resize", resize);
    const t0 = performance.now();
    const tick = (now: number) => {
      if (ready === 2) {
        // background-size: cover - the part of the picture the box shows
        const box = cv.clientWidth / Math.max(1, cv.clientHeight);
        gl.uniform2f(u("scale"), box > aspect ? 1 : box / aspect, box > aspect ? aspect / box : 1);
        gl.uniform1f(u("t"), (now - t0) / 1000);
        gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    // (no loseContext here: React runs effects twice in development, and a lost context stays lost for the canvas)
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", resize); gl.deleteProgram(prog); gl.deleteBuffer(buf); };
  }, [e]);
  return <canvas ref={canvas} className="pm-water" />;
}

function EffectView({ e }: { e: Effect }) {
  if (e.type === "leaves") return <Leaves e={e} />;
  if (e.type === "water") return <Water e={e} />;
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
