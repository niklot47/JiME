// The campaign map in a theme's 3D room (a glTF exported from Blender, images/menu/campaign-map.json). The scene's
// naming convention (docs THEMES.md):
//   "Map"      the mesh the map lies on: its UVs place the adventures (x, y of maps.json = the glTF u, v); its texture is
//              replaced by the campaign's map picture when the campaign has one
//   "Camera"   the overview camera (optional: else one is placed above the map); the zoom flies towards the adventure
//   lights     the scene's own (KHR_lights_punctual); none: a soft light is added
//   "Fire*"    (optional) an object copied onto the coming adventure as its campfire; else a light and a flame sprite
// The trail between the completed adventures is drawn on the map; wheel / drag zoom and move the view.
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { loadGltf, nameOf } from "../../board/Battleboard3D.tsx";
import { ANTIALIAS, PIXEL_RATIO } from "../../data/perf.ts";
import type { MapView } from "./CampaignMap2D.tsx";

/** uv (0..1, v up) -> the point of the mesh there, in world space; null when the uv is outside its triangles */
function uvToWorld(mesh: THREE.Mesh, u: number, v: number): THREE.Vector3 | null {
  const g = mesh.geometry as THREE.BufferGeometry;
  const pos = g.attributes.position as THREE.BufferAttribute, uv = g.attributes.uv as THREE.BufferAttribute | undefined;
  if (!uv) return null;
  const idx = g.index;
  const n = idx ? idx.count : pos.count;
  const ia = (k: number) => (idx ? idx.getX(k) : k);
  for (let t = 0; t < n; t += 3) {
    const a = ia(t), b = ia(t + 1), c = ia(t + 2);
    const ax = uv.getX(a), ay = uv.getY(a), bx = uv.getX(b), by = uv.getY(b), cx = uv.getX(c), cy = uv.getY(c);
    const d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(d) < 1e-12) continue;
    const w1 = ((by - cy) * (u - cx) + (cx - bx) * (v - cy)) / d;
    const w2 = ((cy - ay) * (u - cx) + (ax - cx) * (v - cy)) / d;
    const w3 = 1 - w1 - w2;
    if (w1 < -1e-4 || w2 < -1e-4 || w3 < -1e-4) continue;
    const p = new THREE.Vector3().fromBufferAttribute(pos, a).multiplyScalar(w1)
      .add(new THREE.Vector3().fromBufferAttribute(pos, b).multiplyScalar(w2))
      .add(new THREE.Vector3().fromBufferAttribute(pos, c).multiplyScalar(w3));
    return p.applyMatrix4(mesh.matrixWorld);
  }
  return null;
}

function flameTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const r = g.createRadialGradient(64, 80, 4, 64, 70, 60);
  r.addColorStop(0, "rgba(255,250,210,1)");
  r.addColorStop(0.25, "rgba(255,190,80,0.95)");
  r.addColorStop(0.6, "rgba(230,90,20,0.45)");
  r.addColorStop(1, "rgba(120,30,0,0)");
  g.fillStyle = r;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function CampaignMap3D({ scene: scenePath, view, trail, focus, zoomed, panel = 0, onFocusPx, onError }: {
  scene: string; view: MapView; trail: number[]; focus: number | null; zoomed: boolean; panel?: number;
  onFocusPx?: (p: [number, number] | null) => void;
  onError?: (e: unknown) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const state = useRef({ zoomed, focus, panel, dist: 1, pan: new THREE.Vector3() });
  state.current.zoomed = zoomed;
  state.current.focus = focus;
  state.current.panel = panel;
  const props = useRef({ view, trail, onFocusPx });
  props.current = { view, trail, onFocusPx };
  const rebuild = useRef<() => void>(() => {});

  useEffect(() => {
    const el = box.current!;
    let disposed = false;
    const renderer = new THREE.WebGLRenderer({ antialias: ANTIALIAS, alpha: false });
    renderer.setPixelRatio(PIXEL_RATIO);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0c0907);
    let camera = new THREE.PerspectiveCamera(40, 1, 0.01, 1000);
    const marks = new THREE.Group();
    scene.add(marks);
    let map: THREE.Mesh | null = null;
    let fireModel: THREE.Object3D | null = null;
    const fire = new THREE.Group();
    const light = new THREE.PointLight(0xff9a40, 2, 0, 2);
    const flame = new THREE.Sprite(new THREE.SpriteMaterial({ map: flameTexture(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    fire.add(light, flame);
    scene.add(fire);
    // the overview camera's place and target; the current camera eases towards the wanted one
    const home = { pos: new THREE.Vector3(), target: new THREE.Vector3(), size: 1 };
    const curPos = new THREE.Vector3(), curTarget = new THREE.Vector3();
    let first = true;

    const place = (adv: number): THREE.Vector3 | null => {
      if (!map) return null;
      // glTF texture coordinates start at the picture's top left, like maps.json's x, y
      const [x, y] = props.current.view.at(adv);
      return uvToWorld(map, x, y);
    };
    rebuild.current = () => {
      marks.clear();
      const { trail: tr } = props.current;
      const up = new THREE.Vector3(0, home.size * 0.004, 0);
      const pts = tr.map(place).filter((p): p is THREE.Vector3 => !!p).map((p) => p.clone().add(up));
      if (pts.length > 1) {
        const curve = new THREE.CatmullRomCurve3(pts, false, "centripetal");
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getPoints(pts.length * 24)),
          new THREE.LineDashedMaterial({ color: 0x5a1a0c, dashSize: home.size * 0.012, gapSize: home.size * 0.008 }));
        line.computeLineDistances();
        marks.add(line);
      }
      for (const p of pts.slice(0, -1)) {
        const dot = new THREE.Mesh(new THREE.CircleGeometry(home.size * 0.006, 16), new THREE.MeshBasicMaterial({ color: 0x5a1a0c }));
        dot.rotation.x = -Math.PI / 2;
        dot.position.copy(p);
        marks.add(dot);
      }
    };

    void loadGltf(scenePath).then((gltf) => {
      if (disposed) return;
      const root = gltf.scene.clone(true);
      scene.add(root);
      root.updateMatrixWorld(true);
      root.traverse((o) => {
        const n = nameOf(o);
        if (!map && (o as THREE.Mesh).isMesh && /^map$/i.test(n)) map = o as THREE.Mesh;
        if (!fireModel && /^fire/i.test(n)) fireModel = o;
      });
      if (fireModel) { fireModel.removeFromParent(); fire.add(fireModel); flame.visible = false; }
      let lights = 0;
      root.traverse((o) => { if ((o as THREE.Light).isLight) lights++; });
      if (!lights) {
        scene.add(new THREE.HemisphereLight(0xfff0dc, 0x3a2a1a, 1.6));
        const d = new THREE.DirectionalLight(0xffe2b8, 1.4);
        d.position.set(2, 5, 3);
        scene.add(d);
      }
      // the campaign's map picture on the map
      if (map && props.current.view.image) {
        // the picture with the map's names written on it (the 2D map draws them over the picture)
        const img = new Image();
        img.onload = () => {
          if (disposed) return;
          const k = Math.min(1, 4096 / Math.max(img.naturalWidth, img.naturalHeight));
          const c = document.createElement("canvas");
          c.width = Math.round(img.naturalWidth * k);
          c.height = Math.round(img.naturalHeight * k);
          const g = c.getContext("2d")!;
          g.drawImage(img, 0, 0, c.width, c.height);
          g.fillStyle = "rgba(74, 52, 30, 0.88)";
          g.textAlign = "center";
          g.textBaseline = "middle";
          for (const l of props.current.view.labels) {
            g.save();
            g.translate(l.x * c.width, l.y * c.height);
            g.rotate((l.angle * Math.PI) / 180);
            g.font = `${Math.round((l.size / 1000) * c.height)}px "JiME Title", Georgia, serif`;
            g.fillText(l.text, 0, 0);
            g.restore();
          }
          const t = new THREE.CanvasTexture(c);
          t.colorSpace = THREE.SRGBColorSpace;
          t.flipY = false;
          t.anisotropy = 8;
          const m = map!.material as THREE.MeshStandardMaterial;
          map!.material = new THREE.MeshStandardMaterial({ map: t, roughness: m.roughness ?? 0.9, metalness: 0 });
        };
        img.src = props.current.view.image;
      }
      const bb = new THREE.Box3().setFromObject(map ?? root);
      const c = bb.getCenter(new THREE.Vector3()), sz = bb.getSize(new THREE.Vector3());
      home.size = Math.max(sz.x, sz.z, 1e-3);
      const cam = gltf.cameras[0] ? (root.getObjectByName(gltf.cameras[0].name) as THREE.PerspectiveCamera | undefined) : undefined;
      if (cam && (cam as THREE.PerspectiveCamera).isPerspectiveCamera) {
        // its lens and place; our own camera moves (the scene's may sit under transformed parents)
        camera = new THREE.PerspectiveCamera(cam.fov, 1, 0.01, 1000);
        cam.updateMatrixWorld(true);
        home.pos.setFromMatrixPosition(cam.matrixWorld);
        // its target: where it looks at the map's height
        const dir = new THREE.Vector3(0, 0, -1).transformDirection(cam.matrixWorld);
        const t = dir.y < -1e-3 ? (c.y - home.pos.y) / dir.y : home.size;
        home.target.copy(home.pos).addScaledVector(dir, t);
      } else {
        home.target.copy(c);
        home.pos.set(c.x, c.y + home.size * 0.95, c.z + home.size * 0.5);
      }
      camera.near = home.size * 0.01;
      camera.far = home.size * 50;
      light.distance = home.size * 0.6;
      flame.scale.setScalar(home.size * 0.05);
      if (fireModel) fireModel.position.set(0, 0, 0);
      resize();
      first = true;
      rebuild.current();
    }).catch((e) => onError?.(e));

    const resize = () => {
      const w = el.clientWidth || 1, h = el.clientHeight || 1;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    const clock = new THREE.Clock();
    let raf = 0;
    let lastPx = "";
    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (camera.aspect !== (el.clientWidth || 1) / (el.clientHeight || 1)) resize();
      const dt = Math.min(0.05, clock.getDelta());
      const st = state.current;
      const f = st.focus !== null ? place(st.focus) : null;
      fire.visible = !!f;
      if (f) {
        fire.position.copy(f).add(new THREE.Vector3(0, home.size * (fireModel ? 0 : 0.025), 0));
        const tm = clock.elapsedTime;
        light.intensity = (1.6 + 0.5 * Math.sin(tm * 13) + 0.3 * Math.sin(tm * 7.3)) * home.size * home.size * 0.6;
        flame.material.opacity = 0.8 + 0.2 * Math.sin(tm * 11);
      }
      // the wanted view: the overview, or close over the focused adventure (it a little right of the centre)
      const wantT = new THREE.Vector3(), wantP = new THREE.Vector3();
      const back = home.pos.clone().sub(home.target);
      if (st.zoomed && f) {
        const k = 1 / 2.6;
        const right = new THREE.Vector3().crossVectors(back, new THREE.Vector3(0, 1, 0)).normalize();
        wantT.copy(f).addScaledVector(right, st.panel * home.size * 0.35 * k);
        wantP.copy(wantT).addScaledVector(back.clone().normalize(), back.length() * k * st.dist);
        // a lower, more level look when close
        wantP.y = wantT.y + (wantP.y - wantT.y) * 0.75;
      } else {
        wantT.copy(home.target).add(st.pan);
        wantP.copy(wantT).addScaledVector(back, st.dist);
      }
      if (first && home.size > 0) { curPos.copy(wantP); curTarget.copy(wantT); first = false; }
      const a = 1 - Math.exp(-dt * 2.2);
      curPos.lerp(wantP, a);
      curTarget.lerp(wantT, a);
      camera.position.copy(curPos);
      camera.lookAt(curTarget);
      renderer.render(scene, camera);
      if (f) {
        const p = f.clone().project(camera);
        const px: [number, number] = [((p.x + 1) / 2) * el.clientWidth, ((1 - p.y) / 2) * el.clientHeight];
        const key = `${Math.round(px[0])},${Math.round(px[1])}`;
        if (key !== lastPx) { lastPx = key; props.current.onFocusPx?.(px); }
      }
    };
    tick();
    // wheel: nearer / farther; drag: move the overview over the map
    const onWheel = (e: WheelEvent) => { e.preventDefault(); state.current.dist = Math.min(1.6, Math.max(0.35, state.current.dist * Math.exp(e.deltaY * 0.0012))); };
    let dragFrom: [number, number] | null = null;
    const onDown = (e: PointerEvent) => { dragFrom = [e.clientX, e.clientY]; };
    const onMove = (e: PointerEvent) => {
      if (!dragFrom || state.current.zoomed) return;
      const s = home.size / (el.clientHeight || 1) * state.current.dist;
      state.current.pan.x -= (e.clientX - dragFrom[0]) * s;
      state.current.pan.z -= (e.clientY - dragFrom[1]) * s;
      const lim = home.size * 0.4;
      state.current.pan.clamp(new THREE.Vector3(-lim, 0, -lim), new THREE.Vector3(lim, 0, lim));
      dragFrom = [e.clientX, e.clientY];
    };
    const onUp = () => { dragFrom = null; };
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [scenePath]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { rebuild.current(); state.current.dist = 1; state.current.pan.set(0, 0, 0); }, [trail.join(","), zoomed, view]);
  return <div ref={box} className="cm3" />;
}
