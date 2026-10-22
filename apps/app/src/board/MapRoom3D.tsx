// The campaign map room (the MapRoom scene, tools/importer/export_maproom.py): the map of Middle-earth on a desk with
// books, candles and an inkwell; location markers (CampaignMapLocation), the trail of footprints between completed
// adventures (CampaignMapPath), the campfire on the coming adventure. MapRoomVisuals moves its camera rig:
//   title  - CoroutineCameraCircleLoop (the title screen's slow drift)
//   setup  - SetCameraForGameSetup (the new-game pages)
//   map    - ResetCamera (the travel map overview)
//   zoom   - ZoomCamera to the chosen adventure (its details and location name)
// Unity's scene is mirrored on x by the exporter (like the battleboards).
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { applyActive, loadGltf, nameOf, smoothCutout } from "./Battleboard3D.tsx";
import { attachEmitters, type Emitter } from "./particles.ts";
import { packText } from "../data/pack.ts";

export type MapRoomView = "title" | "setup" | "map" | "zoom";

export interface MapRoomInfo {
  locations: { node: number; name: string; ids: number[]; pos: number[] }[];
  paths: { node: number; from: number; to: number }[];
  campfire?: number;
  camera?: number;
  map?: number;
}

let infoP: Promise<MapRoomInfo> | null = null;
const loadInfo = () => (infoP ??= packText("maproom/maproom.json").then((t) => JSON.parse(t) as MapRoomInfo));

interface Props {
  view: MapRoomView;
  /** the adventure the camera and the campfire are on */
  focus?: number | null;
  /** CompletedAdventureIds: the trail drawn between them, and from the last one to `focus` (grown in) */
  completed?: number[];
  /** the trail to `focus` (MapRoomVisuals.ShowMostRecentlyCompletedPath) */
  showRecent?: boolean;
  /** where the focused location is on screen (CSS px of the view), for the location name label */
  onFocusPx?: (p: [number, number] | null) => void;
  className?: string;
}

const TILT = THREE.MathUtils.degToRad(75);
/** MapRoomVisuals.ZoomCamera / MoveCameraTo: the rig stops this far from the location (Unity x mirrored) */
const RIG_OFFSET = new THREE.Vector3(2.25, 0, -3);

export function MapRoom3D({ view, focus = null, completed = [], showRecent = false, onFocusPx, className }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const st = useRef<{ root: THREE.Object3D | null; info: MapRoomInfo | null; byGoid: Map<number, THREE.Object3D>; grow: { o: THREE.Object3D; t: number; delay: number }[] } | null>(null);
  const [ready, setReady] = useState(false);
  const props = useRef({ view, focus, onFocusPx });
  props.current = { view, focus, onFocusPx };

  useEffect(() => {
    const el = host.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0d0a07);
    const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 400);
    scene.add(new THREE.HemisphereLight(0xfff0dc, 0x2a2016, 1.15));
    const key = new THREE.DirectionalLight(0xffe2b8, 1.4);
    key.position.set(-6, 20, -8);
    scene.add(key);
    const s = { root: null as THREE.Object3D | null, info: null as MapRoomInfo | null, byGoid: new Map<number, THREE.Object3D>(), grow: [] as { o: THREE.Object3D; t: number; delay: number }[] };
    st.current = s;
    let emitters: Emitter[] = [];
    let alive = true;
    void Promise.all([loadGltf("maproom/maproom.glb"), loadInfo()]).then(([g, info]) => {
      if (!alive) return;
      const root = g.scene.clone(true);
      applyActive(root);
      root.updateMatrixWorld(true);
      root.traverse((o) => {
        const ud = o.userData ?? {};
        if (typeof ud.goid === "number") s.byGoid.set(ud.goid, o);
        const m = o as THREE.Mesh;
        if (m.isMesh) smoothCutout(m);
        // the scene's lights (candles, the campfire, the fill lights), at their world scale
        const L = ud.light as { type: number; color: number[]; intensity: number; range: number } | undefined;
        if (L && o.visible !== false) {
          const c = new THREE.Color(L.color[0] ?? 1, L.color[1] ?? 1, L.color[2] ?? 1);
          const ws = new THREE.Vector3(); o.getWorldScale(ws);
          if (L.type === 1) {
            const d = new THREE.DirectionalLight(c, L.intensity * 0.8);
            d.position.set(0, 0, 0);
            o.add(d);
          } else if (L.type === 2) {
            o.add(new THREE.PointLight(c, L.intensity * 2.2, L.range * Math.max(ws.x, ws.y, ws.z) * 1.4, 1.2));
          }
        }
      });
      // the camera rig of the scene is ours
      for (const n of ["CameraParent", "PlayMakerGUI"]) root.children.find((c) => nameOf(c) === n)?.removeFromParent();
      // MapRoomVisuals.HideAllPaths
      for (const p of info.paths) { const o = s.byGoid.get(p.node); if (o) o.visible = false; }
      scene.add(root);
      emitters = attachEmitters(root);
      s.root = root;
      s.info = info;
      setReady(true);
    });

    // ---- camera rig (Unity values; x mirrored)
    const rig = new THREE.Vector3();
    const rigTo = new THREE.Vector3();
    const local = new THREE.Vector3(0, 21.6, -4.9);
    const localTo = new THREE.Vector3(0, 21.6, -4.9);
    let tilt = TILT, tiltTo = TILT;
    let first = true;
    let lastPx: [number, number] | null = null;
    const locationOf = (adv: number | null): THREE.Object3D | null => {
      if (adv === null || !s.info) return null;
      const l = s.info.locations.find((x) => x.ids.includes(adv));
      return l ? s.byGoid.get(l.node) ?? null : null;
    };
    const target = (dt: number, t: number) => {
      const { view: v, focus: f } = props.current;
      const aspect = camera.aspect;
      const loc = locationOf(f ?? null);
      const lp = loc ? loc.getWorldPosition(new THREE.Vector3()) : null;
      if (v === "title" || v === "setup") {
        // CoroutineCameraCircleLoop
        const a = t / 4;
        rigTo.set(-Math.sin(a) * 0.25, -10.125 * aspect + 15.25, Math.cos(a) * -0.25 + 0.25);
        if (v === "title") { localTo.set(0, 21.6, -4.9); tiltTo = TILT; }
        else { localTo.set(0, 11.25 * aspect + 1, -11); tiltTo = THREE.MathUtils.degToRad(60); }
      } else if (v === "map") {
        rigTo.set(0, 0, 0);
        localTo.set(0, 21.6, -4.9); tiltTo = TILT;
      } else {
        // ZoomCamera: the rig to the location, the camera down (the MapZoom animation)
        if (lp) rigTo.copy(lp).add(RIG_OFFSET).setY(0);
        localTo.set(0, 8.2, -1.6); tiltTo = TILT;
      }
      const k = first ? 1 : 1 - Math.exp(-dt * 2.4);
      first = false;
      rig.lerp(rigTo, k);
      local.lerp(localTo, k);
      tilt += (tiltTo - tilt) * k;
      camera.position.copy(rig).add(local);
      camera.lookAt(camera.position.clone().add(new THREE.Vector3(0, -Math.sin(tilt), Math.cos(tilt))));
      // the location name follows the location on screen
      // (reported when it moved: the page re-renders on it)
      const cb = props.current.onFocusPx;
      if (cb) {
        let px: [number, number] | null = null;
        if (lp && v === "zoom") {
          const p = lp.clone().project(camera);
          px = [Math.round((p.x * 0.5 + 0.5) * el.clientWidth), Math.round((-p.y * 0.5 + 0.5) * el.clientHeight)];
        }
        if ((px === null) !== (lastPx === null) || (px && lastPx && (Math.abs(px[0] - lastPx[0]) > 1 || Math.abs(px[1] - lastPx[1]) > 1))) {
          lastPx = px;
          cb(px);
        }
      }
    };

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
    const t0 = last;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const now = performance.now();
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      target(dt, (now - t0) / 1000);
      // path footprints growing in one by one (TweenScale per CampaignPathMarker)
      s.grow = s.grow.filter((g) => {
        g.t += dt;
        const k = Math.min(1, Math.max(0, (g.t - g.delay) / 0.3));
        const base = g.o.userData.baseScale as THREE.Vector3;
        g.o.scale.copy(base).multiplyScalar(k < 1 ? 1 - Math.pow(1 - k, 3) : 1);
        return k < 1;
      });
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
    (window as any).__maproom = { scene, camera, state: s };
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.dispose();
      el.removeChild(renderer.domElement);
      st.current = null;
    };
  }, []);

  // trails and the campfire (MapRoomVisuals.LoadPaths / UpdateCampfirePosition / ShowMostRecentlyCompletedPath)
  const refresh = () => {
    const s = st.current;
    if (!s?.info || !s.root) return;
    const locNode = (adv: number) => s.info!.locations.find((l) => l.ids.includes(adv))?.node ?? null;
    const pathOf = (a: number, b: number) => {
      const la = locNode(a), lb = locNode(b);
      const p = s.info!.paths.find((x) => x.from === la && x.to === lb);
      return p ? s.byGoid.get(p.node) ?? null : null;
    };
    for (const p of s.info.paths) { const o = s.byGoid.get(p.node); if (o) o.visible = false; }
    for (let i = 1; i < completed.length; i++) { const o = pathOf(completed[i - 1]!, completed[i]!); if (o) o.visible = true; }
    const last = completed.at(-1);
    const recent = last !== undefined && focus !== null ? pathOf(last, focus) : null;
    if (recent && showRecent && !recent.visible) {
      recent.visible = true;
      recent.children.forEach((c, i) => {
        c.userData.baseScale ??= c.scale.clone();
        c.scale.setScalar(0);
        s.grow.push({ o: c, t: 0, delay: 0.6 + i * 0.1 });
      });
    }
    const fire = s.info.campfire !== undefined ? s.byGoid.get(s.info.campfire) : null;
    const loc = focus !== null ? locNode(focus) : null;
    const lo = loc !== null ? s.byGoid.get(loc) : null;
    if (fire && lo && fire.parent) {
      const wp = lo.getWorldPosition(new THREE.Vector3());
      fire.position.copy(fire.parent.worldToLocal(wp));
      fire.visible = true;
    } else if (fire) fire.visible = props.current.view !== "title" && props.current.view !== "setup" && !!lo;
  };
  useEffect(refresh, [ready, focus, completed.join(","), showRecent, view]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={host} className={`maproom ${className ?? ""}`} />;
}
