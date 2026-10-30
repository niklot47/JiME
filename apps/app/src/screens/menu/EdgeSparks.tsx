// Sparks flying off the edges of the element it is put in (like the original's Sprite_Highlight_Interior particles
// around the chosen campaign): a canvas a margin bigger than its parent, golden embers born on the parent's border,
// drifting outwards and up, fading out. The parent needs position: relative and must not clip (overflow: visible).
import { useEffect, useRef } from "react";

type Spark = { x: number; y: number; vx: number; vy: number; life: number; age: number; size: number };

export function EdgeSparks({ margin = 0.25, rate = 90, color = "255, 196, 110" }: {
  /** how far the sparks may fly, a share of the parent's height */
  margin?: number;
  /** sparks born per second (for a 300 px wide parent; scales with the perimeter) */
  rate?: number;
  /** the sparks' color, "r, g, b" */
  color?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    const box = cv?.parentElement;
    if (!cv || !box) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const sparks: Spark[] = [];
    let w = 0, h = 0, m = 0, dpr = 1, raf = 0, last = performance.now(), due = 0;
    const fit = () => {
      w = box.clientWidth; h = box.clientHeight; m = Math.round(h * margin);
      dpr = Math.min(2, window.devicePixelRatio || 1);
      cv.style.left = cv.style.top = `${-m}px`;
      cv.style.width = `${w + 2 * m}px`; cv.style.height = `${h + 2 * m}px`;
      cv.width = Math.round((w + 2 * m) * dpr); cv.height = Math.round((h + 2 * m) * dpr);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(box);
    const spawn = () => {
      // a point on the border, the push outwards from that side
      const per = 2 * (w + h);
      let p = Math.random() * per, x: number, y: number, nx: number, ny: number;
      if (p < w) { x = p; y = 0; nx = 0; ny = -1; }
      else if ((p -= w) < h) { x = w; y = p; nx = 1; ny = 0; }
      else if ((p -= h) < w) { x = w - p; y = h; nx = 0; ny = 1; }
      else { p -= w; x = 0; y = h - p; nx = -1; ny = 0; }
      const speed = (0.08 + Math.random() * 0.22) * h; // px per second
      sparks.push({ x: x + m, y: y + m, vx: nx * speed + (Math.random() - 0.5) * 0.15 * h, vy: ny * speed - 0.1 * h + (Math.random() - 0.5) * 0.1 * h,
        life: 0.5 + Math.random() * 0.9, age: 0, size: (0.01 + Math.random() * 0.016) * h });
    };
    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      due += dt * rate * (2 * (w + h)) / 900;
      while (due >= 1) { spawn(); due -= 1; }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w + 2 * m, h + 2 * m);
      ctx.globalCompositeOperation = "lighter";
      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i]!;
        s.age += dt;
        if (s.age >= s.life) { sparks.splice(i, 1); continue; }
        s.vx *= 1 - dt * 1.2; s.vy = s.vy * (1 - dt * 1.2) - h * 0.15 * dt; // slows down, rises like an ember
        s.x += s.vx * dt; s.y += s.vy * dt;
        const k = 1 - s.age / s.life;
        const a = Math.min(1, s.age * 10) * k; // a quick flash in, a slow fade out
        const r = s.size * (0.6 + 0.4 * k);
        const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, r * 3);
        g.addColorStop(0, `rgba(255, 245, 210, ${a})`);
        g.addColorStop(0.3, `rgba(${color}, ${a * 0.8})`);
        g.addColorStop(1, `rgba(${color}, 0)`);
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(s.x, s.y, r * 3, 0, Math.PI * 2); ctx.fill();
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [margin, rate, color]);
  return <canvas ref={ref} className="edge-sparks" aria-hidden="true" />;
}
