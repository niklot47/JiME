// The rest scene's camp (the RestLocations scene, tools/importer/export_maproom.py): a campfire in a forest clearing or
// in a dungeon (RestAreaVisuals.SetRestAreaType by AdventureModel.RestAreaType), seen through the scene's camera.
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { applyActive, find, loadGltf, nameOf, smoothCutout } from "./Battleboard3D.tsx";
import { attachEmitters, type Emitter } from "./particles.ts";

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
    scene.add(new THREE.AmbientLight(new THREE.Color().setRGB(0.772, 0.772, 0.772, THREE.SRGBColorSpace), 1));
    let emitters: Emitter[] = [];
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
            m.material = new THREE.MeshBasicMaterial({ map: mat.map, color: mat.color, transparent: mat.transparent, alphaTest: mat.alphaTest, side: mat.side });
          }
        }
        const L = o.userData?.light as { type: number; color: number[]; intensity: number; range: number } | undefined;
        if (L) o.add(new THREE.PointLight(new THREE.Color(L.color[0] ?? 1, L.color[1] ?? 1, L.color[2] ?? 1), L.intensity * 3, L.range * 3, 1.2));
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
  return <div ref={host} className="maproom" />;
}
