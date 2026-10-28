// A 3D scene as a menu / camp background (a glTF exported from Blender, theme.json "background": "scene"):
// its camera ("Camera", else the first one; none: one in front of the scene), its lights (none: a soft light), every
// animation of the file playing in a loop (fire, smoke, leaves, swaying trees), objects named "Flicker*" get a
// flickering light of their own colour; the camera drifts a little with the pointer (like the parallax).
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { loadGltf, nameOf } from "../../board/Battleboard3D.tsx";
import { ANTIALIAS, PIXEL_RATIO } from "../../data/perf.ts";

export function SceneBackground({ src, drift = 0.03, onError }: {
  src: string;
  /** how far the camera moves with the pointer (share of its distance to what it looks at) */
  drift?: number;
  onError?: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current!;
    let disposed = false;
    const renderer = new THREE.WebGLRenderer({ antialias: ANTIALIAS });
    renderer.setPixelRatio(PIXEL_RATIO);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0806);
    let camera = new THREE.PerspectiveCamera(45, 1, 0.05, 500);
    const base = new THREE.Vector3(), look = new THREE.Vector3();
    let mixer: THREE.AnimationMixer | null = null;
    const flick: { l: THREE.PointLight; i: number; s: number }[] = [];
    void loadGltf(src).then((g) => {
      if (disposed) return;
      const root = g.scene.clone(true);
      scene.add(root);
      root.updateMatrixWorld(true);
      let lights = 0;
      root.traverse((o) => {
        if ((o as THREE.Light).isLight) lights++;
        if (/^flicker/i.test(nameOf(o))) {
          const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
          const l = new THREE.PointLight(m?.emissive?.getHex?.() || 0xff9040, 2, 0, 2);
          o.add(l);
          flick.push({ l, i: 2, s: Math.random() * 10 });
        }
      });
      if (!lights) {
        scene.add(new THREE.HemisphereLight(0xffe8d0, 0x201810, 1.2));
        const d = new THREE.DirectionalLight(0xffd8a8, 1.2);
        d.position.set(3, 6, 4);
        scene.add(d);
      }
      const bb = new THREE.Box3().setFromObject(root);
      const size = bb.getSize(new THREE.Vector3()).length() || 1;
      for (const f of flick) { f.i = size * size * 0.02; f.l.distance = size * 0.5; }
      const cams: THREE.PerspectiveCamera[] = [];
      root.traverse((o) => { if ((o as THREE.PerspectiveCamera).isPerspectiveCamera) cams.push(o as THREE.PerspectiveCamera); });
      const cam = cams.find((c) => /^camera/i.test(nameOf(c)) || /^camera/i.test(nameOf(c.parent ?? c))) ?? cams[0];
      if (cam) {
        camera = new THREE.PerspectiveCamera(cam.fov, 1, cam.near, cam.far);
        base.setFromMatrixPosition(cam.matrixWorld);
        look.copy(base).add(new THREE.Vector3(0, 0, -1).transformDirection(cam.matrixWorld).multiplyScalar(size * 0.5));
      } else {
        bb.getCenter(look);
        base.copy(look).add(new THREE.Vector3(0, size * 0.15, size * 0.7));
      }
      if (g.animations.length) {
        mixer = new THREE.AnimationMixer(root);
        for (const a of g.animations) mixer.clipAction(a).play();
      }
      resize();
    }).catch(() => onError?.());
    const resize = () => {
      const w = el.clientWidth || 1, h = el.clientHeight || 1;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    let px = 0, py = 0, tx = 0, ty = 0;
    const move = (e: PointerEvent) => { tx = (e.clientX / window.innerWidth - 0.5) * 2; ty = (e.clientY / window.innerHeight - 0.5) * 2; };
    window.addEventListener("pointermove", move);
    const clock = new THREE.Clock();
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min(0.05, clock.getDelta());
      mixer?.update(dt);
      const tm = clock.elapsedTime;
      for (const f of flick) f.l.intensity = f.i * (1 + 0.25 * Math.sin(tm * 13 + f.s) + 0.15 * Math.sin(tm * 7.3 + f.s));
      px += (tx - px) * 0.04; py += (ty - py) * 0.04;
      const d = base.distanceTo(look) * drift;
      const right = new THREE.Vector3().subVectors(look, base).cross(new THREE.Vector3(0, 1, 0)).normalize();
      camera.position.copy(base).addScaledVector(right, -px * d).add(new THREE.Vector3(0, py * d * 0.6, 0))
        .add(new THREE.Vector3(Math.sin(tm * 0.11), Math.sin(tm * 0.07) * 0.5, 0).multiplyScalar(d * 0.4));
      camera.lookAt(look);
      renderer.render(scene, camera);
    };
    tick();
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("pointermove", move);
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [src]); // eslint-disable-line react-hooks/exhaustive-deps
  return <div ref={box} className="pm-scene" />;
}
