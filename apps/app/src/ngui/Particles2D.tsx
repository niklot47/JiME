// The original's particle systems inside the NGUI interface (export_ui_layouts.py: a node's "ps", particles.py's
// parameters plus the material's picture, blending and tint) played flat on a canvas: the sparks around a chosen
// campaign, the falling sparks of a chosen difficulty, the Balrog's burst of embers.
// UI particle systems are simulated in Unity world units; the UI root scales 2 / 720, so one unit is 360 UI units.
import { useEffect, useRef } from "react";
import { color, mm, type PS } from "../board/particles.ts";
import { assetUrl } from "../data/pack.ts";

export interface UiPS extends PS {
  tex?: string;
  blend?: "add" | "alpha";
  tint?: number[];
}

/** UI units per Unity world unit (UIRoot scale 2 / 720) */
export const WORLD_UI = 360;

interface P { x: number; y: number; vx: number; vy: number; age: number; life: number; size: number; rot: number; spin: number; r: number[] }

const images = new Map<string, Promise<HTMLImageElement>>();
const load = (src: string) => {
  let p = images.get(src);
  if (!p) {
    p = new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
    images.set(src, p);
  }
  return p;
};

/** How far from the emitter (UI units) its particles can go: the canvas is that big around it */
export function psExtent(ps: UiPS, k: number): number {
  const sh = ps.shape;
  const shape = sh ? Math.max(Math.abs(sh.scale[0]! * (sh.type === 15 || sh.type === 5 || sh.type === 16 ? 0.5 : sh.radius)),
    Math.abs(sh.scale[1]! * (sh.type === 15 || sh.type === 5 || sh.type === 16 ? 0.5 : sh.radius)), sh.radius * Math.max(sh.scale[0]!, sh.scale[1]!)) : 0;
  const v = Array.isArray(ps.v0) ? Math.max(Math.abs(ps.v0[0]), Math.abs(ps.v0[1])) : 0.5;
  const life = Array.isArray(ps.life) ? Math.max(ps.life[0], ps.life[1]) : 2;
  const size = Array.isArray(ps.size) ? Math.max(ps.size[0], ps.size[1]) : 0.1;
  const g = Array.isArray(ps.grav) ? Math.abs(ps.grav[1]) * 9.81 * life * life * 0.5 : 0;
  return Math.min(900, Math.min(shape * k, 240) + (v * life + size + g) * k + 8);
}

/**
 * One particle system drawn around (x, y) (UI units of the view); k: UI units per particle unit (WORLD_UI times the
 * node's own scale for local scaling); mirror: the node is flipped on x.
 */
export function Particles2D({ ps, x, y, k, z, mirror = false, rate = 1, speed = 1 }: {
  ps: UiPS; x: number; y: number; k: number; z: number; mirror?: boolean;
  /** emission and speed multipliers (Bind.particles) */
  rate?: number; speed?: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const R = psExtent(ps, k);
  useEffect(() => {
    const cv = ref.current!;
    const ctx = cv.getContext("2d")!;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.ceil(2 * R * dpr); cv.height = Math.ceil(2 * R * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    let sprite: HTMLCanvasElement | null = null;
    let alive = true;
    // the picture tinted once: its material tint (legacy particle shaders double it) times the start colour
    if (ps.tex) {
      void load(assetUrl(ps.tex)).then((img) => {
        if (!alive) return;
        const c = document.createElement("canvas");
        c.width = img.naturalWidth || 64; c.height = img.naturalHeight || 64;
        const g = c.getContext("2d")!;
        g.drawImage(img, 0, 0, c.width, c.height);
        const t = ps.tint ?? [0.5, 0.5, 0.5, 0.5];
        const s = [1, 1, 1, 1]; color(ps.color, 0.5, 0.5, s);
        const f = (i: number) => Math.round(255 * Math.min(1, t[i]! * 2 * s[i]!));
        g.globalCompositeOperation = "multiply";
        g.fillStyle = `rgb(${f(0)}, ${f(1)}, ${f(2)})`;
        g.fillRect(0, 0, c.width, c.height);
        g.globalCompositeOperation = "destination-in";
        g.drawImage(img, 0, 0, c.width, c.height);
        sprite = c;
      });
    }
    const parts: P[] = [];
    const sh = ps.shape;
    const sx = mirror ? -1 : 1;
    let t = 0, acc = 0, burstDone = new Set<number>();
    const life0 = () => mm(ps.life, 0, Math.random(), 1);
    const emit = () => {
      if (parts.length >= (ps.max || 1000)) return;
      let px = 0, py = 0, dx = 0, dy = 1;
      if (sh) {
        const scx = sh.scale[0] ?? 1, scy = sh.scale[1] ?? 1;
        if (sh.type === 15 || sh.type === 16) {
          // box shell / edges: a point on the rectangle's outline
          const w = scx, h = scy, per = 2 * (w + h);
          let u = Math.random() * per;
          if (u < w) { px = -w / 2 + u; py = h / 2; } else if ((u -= w) < h) { px = w / 2; py = h / 2 - u; }
          else if ((u -= h) < w) { px = w / 2 - u; py = -h / 2; } else { u -= w; px = -w / 2; py = -h / 2 + u; }
          dx = 0; dy = 0;
        } else if (sh.type === 5) {
          px = (Math.random() - 0.5) * scx; py = (Math.random() - 0.5) * scy; dx = 0; dy = 0;
        } else if (sh.type === 12) {
          px = (Math.random() - 0.5) * 2 * sh.radius * scx; py = 0; dx = 0; dy = 1;
        } else {
          // sphere / hemisphere / circle (cones flat on screen): a point in the circle (its rim for edge or thickness 0)
          const a = ((sh.arc ?? 360) / 360) * Math.PI * 2 * Math.random();
          // (radius at most 220 UI units: a scaled-up system in the UI would spread off the screen)
          const rr = Math.min(sh.radius, 220 / k) * (sh.type === 11 || sh.thick === 0 ? 1 : Math.sqrt(1 - Math.random() * (sh.thick ?? 1)));
          px = Math.cos(a) * rr * scx; py = Math.sin(a) * rr * scy;
          dx = Math.cos(a); dy = Math.sin(a);
          if (sh.type === 4 || sh.type === 8) { dx = 0; dy = 0; }
        }
        px += sh.pos[0] ?? 0; py += sh.pos[1] ?? 0;
        if (sh.sph) { const l = Math.hypot(px, py) || 1; dx = px / l; dy = py / l; }
        if (sh.rnd) { const a = Math.random() * Math.PI * 2; dx = dx * (1 - sh.rnd) + Math.cos(a) * sh.rnd; dy = dy * (1 - sh.rnd) + Math.sin(a) * sh.rnd; }
      }
      const v = mm(ps.v0, 0, Math.random(), 0) * speed;
      const r = [Math.random(), Math.random(), Math.random(), Math.random(), Math.random()];
      parts.push({ x: px * sx, y: py, vx: dx * v * sx, vy: dy * v, age: 0, life: life0(), size: mm(ps.size, 0, r[0]!, 0.1),
        rot: (mm(ps.rot, 0, r[1]!, 0) * 180) / Math.PI, spin: mm(ps.rol, 0, r[2]!, 0), r });
    };
    const step = (dt: number) => {
      const dur = ps.dur || 5;
      if (ps.loop || t < dur) {
        acc += mm(ps.rate, (t % dur) / dur, 0.5, 0) * rate * dt;
        while (acc >= 1) { emit(); acc -= 1; }
        for (const [bt, n, cycles, rep] of ps.bursts ?? []) {
          for (let c = 0; c < Math.max(1, cycles); c++) {
            const at = bt + c * (rep || 0.01), key = Math.floor(t / dur) * 1000 + Math.round(at * 100);
            if ((t % dur) >= at && !burstDone.has(key)) { burstDone.add(key); for (let i = 0; i < n; i++) emit(); }
          }
        }
      }
      t += dt;
      const g = mm(ps.grav, 0, 0.5, 0) * 9.81;
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i]!;
        p.age += dt;
        if (p.age >= p.life) { parts.splice(i, 1); continue; }
        const u = p.age / p.life;
        p.vy -= g * dt;
        let vx = p.vx, vy = p.vy;
        if (ps.vol) { vx += mm(ps.vol.x, u, p.r[3]!, 0) * sx; vy += mm(ps.vol.y, u, p.r[4]!, 0); }
        if (ps.force) { p.vx += mm(ps.force.x, u, p.r[3]!, 0) * sx * dt; p.vy += mm(ps.force.y, u, p.r[4]!, 0) * dt; }
        p.x += vx * dt; p.y += vy * dt;
        p.rot += ((p.spin * 180) / Math.PI) * dt;
      }
    };
    const draw = () => {
      ctx.clearRect(0, 0, 2 * R, 2 * R);
      if (!sprite) return;
      ctx.globalCompositeOperation = ps.blend === "add" ? "lighter" : "source-over";
      const c = [1, 1, 1, 1], s = [1, 1, 1, 1];
      for (const p of parts) {
        const u = p.age / p.life;
        color(ps.color, 0, p.r[0]!, s);
        if (ps.col) color(ps.col, u, p.r[1]!, c); else c[3] = 1;
        const a = (s[3] ?? 1) * (c[3] ?? 1) * Math.min(1, (ps.tint?.[3] ?? 0.5) * 2);
        if (a <= 0.003) continue;
        const size = p.size * (ps.sol ? mm(ps.sol, u, p.r[2]!, 1) : 1) * k;
        ctx.globalAlpha = Math.min(1, a);
        ctx.save();
        ctx.translate(R + p.x * k, R - p.y * k);
        if (p.rot) ctx.rotate((p.rot * Math.PI) / 180);
        ctx.drawImage(sprite, -size / 2, -size / 2, size, size);
        ctx.restore();
      }
    };
    // prewarm: a looping system starts as if it had been running a while
    if (ps.prewarm && ps.loop) for (let i = 0; i < 60; i++) step((ps.dur || 5) / 60);
    let raf = 0, last = performance.now();
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min(0.05, (now - last) / 1000) * (ps.speed || 1);
      last = now;
      step(dt);
      draw();
    };
    raf = requestAnimationFrame(tick);
    return () => { alive = false; cancelAnimationFrame(raf); burstDone = new Set(); };
  }, [ps, k, R, mirror, rate, speed]);
  return <canvas ref={ref} className="ng-ps" style={{ left: x - R, top: y - R, width: 2 * R, height: 2 * R, zIndex: z }} />;
}
