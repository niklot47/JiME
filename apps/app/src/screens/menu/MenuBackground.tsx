// The menus' background: picture layers that shift with the pointer (parallax). A pack (a theme) describes them in
// images/menu/menu.json: { "layers": [{ "src": "images/menu/sky.png", "depth": 0.1 }, ...] } (back to front; depth 0 =
// still, 1 = moves most; optional "x", "y" offsets in % and "drift" seconds for a slow sideways sway). Without it a
// drawn dusk sky with mist stands in.
import { useEffect, useRef, useState } from "react";
import { assetUrl, packJsonMerged } from "../../data/pack.ts";

interface Layer { src: string; depth?: number; x?: number; y?: number; drift?: number }

export function MenuBackground({ dim = false }: { dim?: boolean }) {
  const [layers, setLayers] = useState<Layer[] | null>(null);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    packJsonMerged<{ layers?: Layer[] }>("images/menu/menu.json").then((m) => setLayers(m.layers ?? [])).catch(() => setLayers([]));
  }, []);
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    let raf = 0, tx = 0, ty = 0, x = 0, y = 0;
    const move = (e: PointerEvent) => { tx = (e.clientX / window.innerWidth - 0.5) * 2; ty = (e.clientY / window.innerHeight - 0.5) * 2; };
    // eased follow, so a jump of the pointer glides
    const tick = () => {
      x += (tx - x) * 0.06; y += (ty - y) * 0.06;
      el.style.setProperty("--px", x.toFixed(4)); el.style.setProperty("--py", y.toFixed(4));
      raf = requestAnimationFrame(tick);
    };
    window.addEventListener("pointermove", move);
    raf = requestAnimationFrame(tick);
    return () => { window.removeEventListener("pointermove", move); cancelAnimationFrame(raf); };
  }, []);
  return (
    <div ref={root} className={`pm-bg${dim ? " dim" : ""}`}>
      {layers && layers.length > 0 ? layers.map((l, i) => (
        <div key={i} className={`pm-layer${l.drift ? " drift" : ""}`}
          style={{ backgroundImage: `url("${assetUrl(l.src)}")`, ["--d" as string]: String(l.depth ?? 0), ["--ox" as string]: `${l.x ?? 0}%`,
            ["--oy" as string]: `${l.y ?? 0}%`, ...(l.drift ? { animationDuration: `${l.drift}s` } : {}) }} />
      )) : layers && (
        <>
          <div className="pm-layer pm-sky" style={{ ["--d" as string]: "0.05" }} />
          <div className="pm-layer pm-hills far" style={{ ["--d" as string]: "0.25" }} />
          <div className="pm-layer pm-hills near" style={{ ["--d" as string]: "0.6" }} />
          <div className="pm-layer pm-mist drift" style={{ ["--d" as string]: "0.9", animationDuration: "60s" }} />
        </>
      )}
      <div className="pm-vignette" />
    </div>
  );
}
