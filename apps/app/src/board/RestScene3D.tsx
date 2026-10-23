// The rest scene's camp (the RestLocations scene, tools/importer/export_maproom.py): a campfire in a forest clearing or
// in a dungeon (RestAreaVisuals.SetRestAreaType by AdventureModel.RestAreaType), seen through the scene's camera.
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { applyActive, find, loadGltf, nameOf, smoothCutout } from "./Battleboard3D.tsx";
import { attachEmitters, type Emitter } from "./particles.ts";

/** a soft additive glow around a fire (the original's bloom on the flames) */
let glowTex: THREE.Texture | null = null;
function fireGlow(at: THREE.Object3D, range: number): THREE.Sprite {
  if (!glowTex) {
    const cv = document.createElement("canvas");
    cv.width = cv.height = 128;
    const g = cv.getContext("2d")!;
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, "rgba(255, 190, 90, 1)");
    gr.addColorStop(0.25, "rgba(255, 110, 30, 0.55)");
    gr.addColorStop(0.6, "rgba(200, 40, 10, 0.15)");
    gr.addColorStop(1, "rgba(120, 10, 0, 0)");
    g.fillStyle = gr;
    g.fillRect(0, 0, 128, 128);
    glowTex = new THREE.CanvasTexture(cv);
    glowTex.colorSpace = THREE.SRGBColorSpace;
  }
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.55 }));
  const ws = at.getWorldScale(new THREE.Vector3());
  const size = Math.max(0.2, range * Math.max(ws.x, ws.y, ws.z) * 0.3);
  sp.scale.set(size, size, 1);
  // (in the light's frame, which may be scaled: undo it so the size is in world units)
  sp.scale.divide(new THREE.Vector3(ws.x || 1, ws.y || 1, 1));
  sp.userData.size = size / (ws.x || 1);
  at.add(sp);
  return sp;
}

/** RestAreaTypes: 0 forest, 1 dungeon */
export function RestScene3D({ area = 0 }: { area?: number }) {
  const host = useRef<HTMLDivElement>(null);
  const areaRef = useRef(area);
  areaRef.current = area;
  const apply = useRef<(() => void) | null>(null);

  useEffect(() => {
    const el = host.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    // Camera002: clear to its background colour, a night blue behind the trees; its field of view
    scene.background = new THREE.Color().setRGB(0.032, 0.04, 0.118, THREE.SRGBColorSpace);
    const camera = new THREE.PerspectiveCamera(28.9, 1, 0.01, 100);
    // RenderSettings: flat ambient light 0.77 grey (it lights the moonlit forest behind the camp), the fire's lights on top
    // (a little moonlit blue in it: the trees away from the fire stay readable, blue, as in the original)
    scene.add(new THREE.AmbientLight(new THREE.Color().setRGB(0.62, 0.72, 0.98, THREE.SRGBColorSpace), 0.8));
    let emitters: Emitter[] = [];
    const fires: { light: THREE.PointLight; base: number; at: THREE.Object3D; range: number; glow: THREE.Sprite | null }[] = [];
    let alive = true;
    void loadGltf("maproom/rest.glb").then((g) => {
      if (!alive) return;
      const root = g.scene.clone(true);
      applyActive(root);
      root.updateMatrixWorld(true);
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          smoothCutout(m);
          // the backdrop (Forest-BG / Dungeon-BG: the moonlit trees, the far wall) is a painted, unlit picture
          const mat = m.material as THREE.MeshStandardMaterial;
          if (!Array.isArray(m.material) && /-BG$/.test(mat.name ?? "")) {
            // (a little dimmer than the full picture: the camp should stay a night scene)
            // (the moonlight on it a little bluer, as in the original)
            m.material = new THREE.MeshBasicMaterial({ map: mat.map, color: mat.color.clone().multiply(new THREE.Color(0.8, 0.98, 1.35)), transparent: mat.transparent, alphaTest: mat.alphaTest, side: mat.side });
          }
        }
        const L = o.userData?.light as { type: number; color: number[]; intensity: number; range: number } | undefined;
        if (L) {
          // the fire's light a little redder than its saved colour (the original's camp glows red-orange), flickering
          const c = new THREE.Color(L.color[0] ?? 1, L.color[1] ?? 1, L.color[2] ?? 1);
          const warm = c.r > c.b * 1.3;
          if (warm) { c.g *= 0.72; c.b *= 0.5; }
          const pl = new THREE.PointLight(c, L.intensity * 3, L.range * 3, 1.2);
          o.add(pl);
          if (warm) fires.push({ light: pl, base: pl.intensity, at: o, range: L.range, glow: null });
        }
      });
      // the scene camera (Unity cameras look along their +z; the scene is mirrored on x)
      const cam = find(root, "Camera002");
      if (cam) {
        const p = cam.getWorldPosition(new THREE.Vector3());
        const q = cam.getWorldQuaternion(new THREE.Quaternion());
        camera.position.copy(p);
        camera.up.copy(new THREE.Vector3(0, 1, 0).applyQuaternion(q));
        camera.lookAt(p.clone().add(new THREE.Vector3(0, 0, 1).applyQuaternion(q)));
      }
      // the glow only on the camp fire itself (the strongest warm light of each camp), not on the fill lights
      const byParent = new Map<THREE.Object3D | null, (typeof fires)[number]>();
      for (const f of fires) {
        let top: THREE.Object3D | null = f.at;
        while (top?.parent && top.parent !== root) top = top.parent;
        const cur = byParent.get(top);
        if (!cur || f.base > cur.base) byParent.set(top, f);
      }
      for (const f of byParent.values()) f.glow = fireGlow(f.at, f.range);
      for (const n of ["RestScene_Tutorial", "RestDynamicSoundGroup"]) root.children.find((c) => nameOf(c) === n)?.removeFromParent();
      scene.add(root);
      emitters = attachEmitters(root);
      apply.current = () => {
        const forest = find(root, "Forest"), dungeon = find(root, "Dungeon");
        if (forest) forest.visible = areaRef.current !== 1;
        if (dungeon) dungeon.visible = areaRef.current === 1;
      };
      apply.current();
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
    let raf = 0, last = performance.now();
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const now = performance.now();
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      emitters = emitters.filter((e) => {
        if (!e.parent) return false;
        let shown = true;
        for (let o: THREE.Object3D | null = e; o; o = o.parent) if (!o.visible) { shown = false; break; }
        e.visibleNow = shown;
        if (shown) e.step(dt, camera);
        return !e.done;
      });
      // the fire breathes: its light and its glow
      const t = now / 1000;
      for (const f of fires) {
        const k = 1 + 0.12 * Math.sin(t * 7.1) * Math.sin(t * 2.3) + 0.06 * Math.sin(t * 17.9 + Math.sin(t * 2.7) * 2);
        f.light.intensity = f.base * k;
        if (!f.glow) continue;
        f.glow.material.opacity = 0.4 * k;
        const s = f.glow.userData.size as number;
        f.glow.scale.set(s * (0.96 + 0.04 * k), s * (0.96 + 0.06 * k), 1);
      }
      renderer.render(scene, camera);
    };
    tick();
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.dispose();
      el.removeChild(renderer.domElement);
    };
  }, []);
  useEffect(() => { apply.current?.(); }, [area]);
  return <div ref={host} className="maproom rest-scene" />;
}
