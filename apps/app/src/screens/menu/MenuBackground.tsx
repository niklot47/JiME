// The menus' background (a theme from the packs, images/menu/menu.json): picture layers in depth, effects between them
// and a slowly moving camera.
//   layers:  [{ src, depth, z }]          depth 0 = still ... 1 = moves most (the nearest layer); z = drawing order
//   effects: { type: "fog", texture, z, y, height, opacity, speed, flip?, depth? }   a drifting band of fog
//            { type: "rays", texture?, z, x, y, opacity, depth? }                    sun rays from (x, y) (screen 0..1)
//            { type: "clouds", texture, z, tile, dx, dy, speed, opacity, mask?, fadeFrom?, fadeTo? }   a tiled cloud
//              texture over the whole box (tile: its width, a share of the box's), moving dx, dy tiles per `speed` s
//            { type: "leaves", atlas, frames: [[x, y, w, h]], z, count, size: [min, max], wind }   falling leaves
//   camera:  { rx, ry, angle, period, zoom }   an ellipse (radii in % of the screen) turned by `angle` degrees,
//            one round in `period` s; the pointer adds a little parallax. zoom keeps the edges off screen.
// Without a theme a drawn dusk sky with mist stands in.
import { SceneBackground } from "./SceneBackground.tsx";
import { useEffect, useRef, useState } from "react";
import { assetUrl, packJsonMerged } from "../../data/pack.ts";
import { LOW_GFX } from "../../data/perf.ts";

interface Layer { src: string; depth?: number; z?: number }
export interface Effect {
  type: "fog" | "rays" | "leaves" | "water" | "steam" | "embers" | "distort" | "clouds";
  /** clouds: tile width (share of the box), tiles moved per cycle, a vertical fade when there is no mask */
  tile?: number; dx?: number; dy?: number; fadeFrom?: number; fadeTo?: number;
  /** clouds: where they show, top to bottom (0..1): gone above band[0], full from band[1] to band[2], gone below band[3] */
  band?: [number, number, number, number];
  /** distort: how fast the waver rises (heat haze; 0 = it only sways), the noise's fineness, a brightness flicker */
  rise?: number; scale?: number; flicker?: number;
  /** embers: their colour; hover: shown only while the layered art is hovered / chosen (LayeredArt) */
  color?: string; hover?: boolean; width?: number; aspect?: number; z?: number; src?: string; mask?: string; strength?: number; depth?: number; opacity?: number;
  texture?: string; x?: number; y?: number; height?: number; speed?: number; flip?: boolean;
  atlas?: string; frames?: [number, number, number, number][]; count?: number; size?: [number, number]; wind?: number;
}
interface Camera { rx?: number; ry?: number; angle?: number; period?: number; zoom?: number }
interface Theme { layers?: Layer[]; effects?: Effect[]; camera?: Camera; scene?: string }

/** Which background: the title menus' (images/menu/menu.json) or the camp's (rest-forest.json, rest-cave.json) */
export type BackgroundKind = "menu" | "rest-forest" | "rest-cave";
const FILES: Record<BackgroundKind, string[]> = {
  menu: ["images/menu/menu.json"],
  "rest-forest": ["images/menu/rest-forest.json"],
  // a cave camp without its own picture uses the forest's
  "rest-cave": ["images/menu/rest-cave.json", "images/menu/rest-forest.json"],
};
async function loadTheme(kind: BackgroundKind): Promise<Theme | null> {
  for (const f of FILES[kind]) {
    try { return await packJsonMerged<Theme>(f); } catch { /* not in the packs */ }
  }
  return null;
}

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
        vy: (25 + 45 * near + Math.random() * 15) * (e.speed ?? 1),
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
  vec2 q = vec2(uv.x * 170.0, uv.y * 60.0 - s * 2.2);
  float a = n(q) + 0.5 * n(q * 2.3 + 7.0);
  float b = n(q + 31.0) + 0.5 * n(q * 2.1 + 3.0);
  vec2 off = (vec2(a, b) - 0.75) * k * vec2(0.6, 1.4);
  vec4 c = texture2D(img, uv + off);
  float streak = smoothstep(0.8, 1.0, n(vec2(uv.x * 320.0, uv.y * 26.0 - s * 3.0))) * 0.12;
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

/**
 * Billowing steam (where a fall meets the river): soft puffs that rise, swell and fade, born along a short line at
 * (x, y) of the layer's picture (fractions; the picture lies like background-size: cover, `aspect` = its width / height)
 */
function Steam({ e }: { e: Effect }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = canvas.current;
    if (!cv || reduced()) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    // one soft puff, drawn once
    const puff = document.createElement("canvas");
    puff.width = puff.height = 128;
    const pc = puff.getContext("2d")!;
    const gr = pc.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, "rgba(255,246,236,0.55)"); gr.addColorStop(0.45, "rgba(255,240,226,0.25)"); gr.addColorStop(1, "rgba(255,236,220,0)");
    pc.fillStyle = gr; pc.fillRect(0, 0, 128, 128);
    const aspect = e.aspect ?? 16 / 9;
    const n = Math.max(4, Math.round((e.count ?? 20) * (LOW_GFX ? 0.5 : 1)));
    let W = 0, H = 0, dpr = 1, ox = 0, oy = 0, pw = 0, ph = 0;
    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, LOW_GFX ? 1 : 1.5);
      W = cv.clientWidth; H = cv.clientHeight;
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
      // background-size: cover
      if (W / H > aspect) { pw = W; ph = W / aspect; } else { ph = H; pw = H * aspect; }
      ox = (W - pw) / 2; oy = (H - ph) / 2;
    };
    resize();
    window.addEventListener("resize", resize);
    const born = (age: number) => ({
      u: (e.x ?? 0.5) + ((Math.random() - 0.5) * (e.width ?? 0.1)), age, life: 4 + Math.random() * 4,
      r0: 0.012 + Math.random() * 0.01, grow: 0.025 + Math.random() * 0.03, rise: 0.012 + Math.random() * 0.016,
      drift: (Math.random() - 0.5) * 0.01, spin: Math.random() * 6.3,
    });
    const all = Array.from({ length: n }, () => { const p = born(0); p.age = Math.random() * p.life; return p; });
    let raf = 0, last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      for (let i = 0; i < all.length; i++) {
        const p = all[i]!;
        p.age += dt;
        if (p.age > p.life) { all[i] = born(0); continue; }
        const k = p.age / p.life;
        const x = ox + (p.u + p.drift * p.age) * pw;
        const y = oy + ((e.y ?? 0.7) - p.rise * p.age) * ph;
        const r = (p.r0 + p.grow * k) * pw;
        // in quickly, out slowly
        ctx.globalAlpha = (e.opacity ?? 0.5) * Math.min(1, k * 5) * (1 - k) * (1 - k);
        ctx.drawImage(puff, x - r, y - r * 0.8, r * 2, r * 1.6);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", resize); };
  }, [e]);
  return <canvas ref={canvas} className="pm-water" />;
}

/**
 * Embers / sparks rising from a line at (x, y) of the box (fractions), `width` wide: glowing dots that drift up,
 * sway, flicker and fade; `color` their glow, `speed` how fast they rise
 */
function Embers({ e }: { e: Effect }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = canvas.current;
    if (!cv || reduced()) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const col = e.color ?? "#ff9a40";
    const n = Math.max(4, Math.round((e.count ?? 24) * (LOW_GFX ? 0.5 : 1)));
    let W = 0, H = 0, dpr = 1;
    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, LOW_GFX ? 1 : 1.5);
      W = cv.clientWidth; H = cv.clientHeight;
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(cv);
    const born = () => ({
      x: (e.x ?? 0.5) + (Math.random() - 0.5) * (e.width ?? 0.4), y: e.y ?? 0.9, age: 0, life: 1.5 + Math.random() * 2.5,
      vy: (0.12 + Math.random() * 0.2) * (e.speed ?? 1), sway: 0.01 + Math.random() * 0.03, f: 1 + Math.random() * 3, ph: Math.random() * 6.3,
      r: (e.size?.[0] ?? 1.2) + Math.random() * ((e.size?.[1] ?? 3) - (e.size?.[0] ?? 1.2)),
    });
    const all = Array.from({ length: n }, () => { const p = born(); p.age = Math.random() * p.life; return p; });
    let raf = 0, last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.globalCompositeOperation = "lighter";
      for (let i = 0; i < all.length; i++) {
        const p = all[i]!;
        p.age += dt;
        if (p.age > p.life) { all[i] = born(); continue; }
        const k = p.age / p.life;
        const x = (p.x + Math.sin(p.age * p.f + p.ph) * p.sway) * W, y = (p.y - p.vy * p.age) * H;
        ctx.globalAlpha = (e.opacity ?? 0.9) * Math.min(1, k * 6) * (1 - k) * (0.7 + 0.3 * Math.sin(p.age * 20 + p.ph));
        const g = ctx.createRadialGradient(x, y, 0, x, y, p.r * 3);
        g.addColorStop(0, "#fff4d0"); g.addColorStop(0.3, col); g.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = g;
        ctx.fillRect(x - p.r * 3, y - p.r * 3, p.r * 6, p.r * 6);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [e]);
  return <canvas ref={canvas} className="pm-water" />;
}

const DISTORT_FS = `precision mediump float;
varying vec2 v;
uniform sampler2D img; uniform float t; uniform float k; uniform float speed; uniform float rise; uniform float freq; uniform float flick;
float h(vec2 q) { return fract(sin(dot(q, vec2(127.1, 311.7))) * 43758.5453); }
float n(vec2 q) { vec2 i = floor(q), f = fract(q); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h(i), h(i + vec2(1.0, 0.0)), f.x), mix(h(i + vec2(0.0, 1.0)), h(i + vec2(1.0, 1.0)), f.x), f.y); }
void main() {
  vec2 uv = vec2(v.x, 1.0 - v.y);
  float s = t * speed;
  // the noise drifts up by rise (flames, heat) and turns slowly (fur in the wind)
  vec2 q = uv * freq + vec2(0.35 * sin(s * 0.7), s * rise);
  vec2 off = vec2(n(q) + 0.5 * n(q * 2.1 + 5.0) - 0.75, n(q + 17.0) + 0.5 * n(q * 1.9 + 9.0) - 0.75) * k;
  off.x += sin(uv.y * freq * 0.5 + s * 1.3) * k * 0.35;
  vec4 c = texture2D(img, uv + off);
  float b = 1.0 + flick * (n(vec2(s * 3.0, 0.0)) - 0.5) * 2.0;
  gl_FragColor = vec4(c.rgb * c.a * b, c.a);
}`;

/** A layer drawn again, wavering: its pixels fetched from a little aside by moving noise (heat haze over fire, fur
 *  in the wind); the canvas covers the layer exactly (the layered picture's box) */
function Distort({ e }: { e: Effect }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = canvas.current;
    if (!cv || !e.src) return;
    const gl = cv.getContext("webgl", { premultipliedAlpha: true, alpha: true });
    if (!gl) return;
    const sh = (type: number, src: string) => { const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s); return s; };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, WATER_VS));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, DISTORT_FS));
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
    gl.uniform1i(u("img"), 0);
    gl.uniform1f(u("k"), e.strength ?? 0.004); gl.uniform1f(u("speed"), reduced() ? 0 : e.speed ?? 1);
    gl.uniform1f(u("rise"), e.rise ?? 0); gl.uniform1f(u("freq"), e.scale ?? 40); gl.uniform1f(u("flick"), e.flicker ?? 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    let ready = false, raf = 0;
    const im = new Image();
    im.crossOrigin = "anonymous";
    im.onload = () => {
      const tex = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, im);
      for (const [pp, val] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]] as const)
        gl.texParameteri(gl.TEXTURE_2D, pp, val);
      ready = true;
    };
    im.src = assetUrl(e.src);
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5) * (LOW_GFX ? 0.6 : 1);
      cv.width = Math.max(1, Math.round(cv.clientWidth * dpr)); cv.height = Math.max(1, Math.round(cv.clientHeight * dpr));
      gl.viewport(0, 0, cv.width, cv.height);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(cv);
    const t0 = performance.now();
    const tick = (now: number) => {
      if (ready) {
        gl.uniform1f(u("t"), (now - t0) / 1000);
        gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); gl.deleteProgram(prog); gl.deleteBuffer(buf); };
  }, [e]);
  return <canvas ref={canvas} className="pm-water" />;
}

/**
 * Clouds like the original's ScrollingWithMask (the adventure card): a seamless texture tiled over the box, moving a
 * whole number of tiles per cycle (dx, dy; the original's clouds: 2 left, 1 down in 80 s, tiles 0.6 of the card
 * wide, opacity 0.7), cut by a mask picture (white = clouds) or faded out downwards
 */
function Clouds({ e }: { e: Effect }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let w = el.clientWidth, raf = 0;
    const ro = new ResizeObserver(() => { w = el.clientWidth; });
    ro.observe(el);
    const tile = e.tile ?? 0.6, dur = e.speed ?? 80, dx = e.dx ?? -2, dy = e.dy ?? 1, t0 = performance.now();
    const still = reduced();
    const tick = (now: number) => {
      const u = (((now - t0) / 1000) / dur) % 1, tw = w * tile;
      el.style.backgroundSize = `${tw}px ${tw}px`;
      el.style.backgroundPosition = `${u * dx * tw}px ${u * dy * tw}px`;
      if (!still) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [e]);
  if (!e.texture) return null;
  const b = e.band;
  const mask = e.mask ? `url("${assetUrl(e.mask)}")`
    : b ? `linear-gradient(to bottom, transparent ${b[0] * 100}%, #000 ${b[1] * 100}%, #000 ${b[2] * 100}%, transparent ${b[3] * 100}%)`
    : `linear-gradient(to bottom, #000 ${(e.fadeFrom ?? 1) * 100}%, transparent ${(e.fadeTo ?? 1) * 100}%)`;
  return <div ref={ref} className="pm-clouds" style={{ opacity: e.opacity ?? 0.7, backgroundImage: `url("${assetUrl(e.texture)}")`,
    maskImage: mask, WebkitMaskImage: mask, maskSize: "100% 100%", WebkitMaskSize: "100% 100%", ...(e.mask ? { maskMode: "luminance" } : {}) } as React.CSSProperties} />;
}

export function EffectView({ e }: { e: Effect }) {
  if (e.type === "distort") return <Distort e={e} />;
  if (e.type === "clouds") return <Clouds e={e} />;
  if (e.type === "embers") return <Embers e={e} />;
  if (e.type === "leaves") return <Leaves e={e} />;
  if (e.type === "steam") return <Steam e={e} />;
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

export function MenuBackground({ dim = false, which = "menu" }: { dim?: boolean; which?: BackgroundKind }) {
  const [theme, setTheme] = useState<Theme | null>(null);
  const [sceneFailed, setSceneFailed] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // no camp in the theme: a plain night camp drawn in CSS (the menus' fallback: their plain hills)
    void loadTheme(which).then((th) => setTheme(th ?? (which === "menu" ? {} : { camp: true } as Theme)));
  }, [which]);
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
  const camp = !!(theme as any)?.camp;
  if (theme?.scene && !sceneFailed) {
    return (
      <div ref={root} className={`pm-bg${dim ? " dim" : ""}`}>
        <SceneBackground src={theme.scene} onError={() => setSceneFailed(true)} />
        <div className="pm-vignette" />
        <div className="pm-shade" />
      </div>
    );
  }
  return (
    <div ref={root} className={`pm-bg${dim ? " dim" : ""}`}>
      {camp && (
        <div className="pm-part pm-camp" data-depth="0.3">
          <div className="pm-camp-trees" />
          <div className="pm-camp-glow" />
          <div className="pm-camp-fire"><b /><b /><b /></div>
          {Array.from({ length: 14 }, (_, i) => <i key={i} className="pm-ember" style={{ left: `${46 + ((i * 37) % 9)}%`, animationDelay: `${(i * 0.37) % 4}s`, animationDuration: `${3 + (i % 4) * 0.7}s` }} />)}
        </div>
      )}
      {theme && layers.length > 0 && parts.map((p, i) => {
        if (p.layer) depth = p.depth ?? 0;
        const d = p.effect?.type === "leaves" ? null : p.depth ?? depth;
        const body = p.layer ? <div className="pm-img" style={{ backgroundImage: `url("${assetUrl(p.layer.src)}")` }} /> : <EffectView e={p.effect!} />;
        // the rays are added light: the moving part itself blends (screen) with what is under it
        const cls = `pm-part${p.effect?.type === "rays" ? " pm-part-light" : ""}`;
        return d === null ? <div key={i} className={cls}>{body}</div> : <div key={i} className={cls} data-depth={d}>{body}</div>;
      })}
      {theme && !layers.length && !camp && (
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
