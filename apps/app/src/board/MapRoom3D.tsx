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
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { BokehPass } from "three/examples/jsm/postprocessing/BokehPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
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
/** the zoom (MapZoom animation): the camera lower and more level, the ground under it the same spot as before */
const ZOOM_TILT = THREE.MathUtils.degToRad(42);
/** the whole map on the desk with the candle and the books around it (the travel map, and behind the new-game pages) */
const OVERVIEW = new THREE.Vector3(0, 37, 0.89 - 37 / Math.tan(TILT));
const ZOOM_H = 5.2;
const ZOOM_Z = 0.6 - ZOOM_H / Math.tan(ZOOM_TILT);
const HEMI_DAY = new THREE.Color(0xfff0dc), HEMI_NIGHT = new THREE.Color(0xff9a50);
const KEY_DAY = new THREE.Color(0xffe2b8), KEY_NIGHT = new THREE.Color(0xff8030);
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
    // lighting: the title screen's background keeps a bright, even light; the travel map is the scene as it is - a dark
    // room (RenderSettings: flat ambient 0.06, 0.16, 0.39 x 1.33) lit by its candles and lamps
    const hemi = new THREE.HemisphereLight(0xfff0dc, 0x2a2016, 1.15);
    scene.add(hemi);
    const key = new THREE.DirectionalLight(0xffe2b8, 1.4);
    key.position.set(-6, 20, -8);
    scene.add(key);
    const ambient = new THREE.AmbientLight(new THREE.Color().setRGB(0.06, 0.158, 0.39, THREE.SRGBColorSpace), 0);
    scene.add(ambient);
    const sceneLights: THREE.Light[] = [];
    // MapZoom: depth of field around the location (the rest of the map blurred)
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bokeh = new BokehPass(scene, camera, { focus: 10, aperture: 0.004, maxblur: 0.012 });
    composer.addPass(bokeh);
    composer.addPass(new OutputPass());
    const bokehU = (bokeh as unknown as { uniforms: Record<string, { value: number }> }).uniforms;
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
        if (m.isMesh) {
          smoothCutout(m);
          // the map is four quarters (Map0..3) side by side: no wrap-around at their edges (it showed as seams)
          if (/^(Main)?Map\d?/.test(nameOf(o))) {
            for (const mat of ([] as THREE.Material[]).concat(m.material)) {
              const sm = mat as THREE.MeshStandardMaterial;
              const t = sm.map;
              if (t) { t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.needsUpdate = true; }
              // matte paper: no specular sheen
              if ("roughness" in sm) { sm.roughness = 1; sm.metalness = 0; sm.envMapIntensity = 0; sm.needsUpdate = true; }
            }
          }
        }
        // the scene's lights (candles, the campfire, the fill lights), at their world scale
        const L = ud.light as { type: number; color: number[]; intensity: number; range: number } | undefined;
        if (L && o.visible !== false) {
          const c = new THREE.Color(L.color[0] ?? 1, L.color[1] ?? 1, L.color[2] ?? 1);
          const ws = new THREE.Vector3(); o.getWorldScale(ws);
          if (L.type === 1) {
            const d = new THREE.DirectionalLight(c, L.intensity * 0.8);
            d.position.set(0, 0, 0);
            o.add(d);
            sceneLights.push(d);
          } else if (L.type === 2) {
            const pl = new THREE.PointLight(c, L.intensity * 2.2, L.range * Math.max(ws.x, ws.y, ws.z) * 1.4, 1.2);
            pl.userData.base = pl.intensity;
            o.add(pl);
            sceneLights.push(pl);
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
    let dof = false;
    let hemiMix = 0;
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
        else { rigTo.set(-Math.sin(a) * 0.12, 0, Math.cos(a) * -0.12 + 0.12); localTo.copy(OVERVIEW); tiltTo = TILT; }
      } else if (v === "map") {
        rigTo.set(0, 0, 0);
        localTo.copy(OVERVIEW); tiltTo = TILT;
      } else {
        // ZoomCamera: the rig to the location, the camera down (the MapZoom animation)
        if (lp) rigTo.copy(lp).add(RIG_OFFSET).setY(0);
        localTo.set(0, ZOOM_H, ZOOM_Z); tiltTo = ZOOM_TILT;
      }
      const k = first ? 1 : 1 - Math.exp(-dt * 2.4);
      first = false;
      rig.lerp(rigTo, k);
      local.lerp(localTo, k);
      tilt += (tiltTo - tilt) * k;
      camera.position.copy(rig).add(local);
      camera.lookAt(camera.position.clone().add(new THREE.Vector3(0, -Math.sin(tilt), Math.cos(tilt))));
      // lights by view (eased like the camera): bright for the title pages, the dark room for the travel map
      const dark = v === "title" ? 0 : 1;
      const lk = 1 - Math.exp(-dt * 2);
      // (tuned by eye against the original's travel map: warm orange candlelight, dim edges, bluish shadows)
      // (the original's travel map: high contrast, orange, the light falling off towards the edges - little fill light,
      // the candles and lamps doing the work)
      hemi.intensity += ((1 - dark) * 1.15 + dark * 0.5 - hemi.intensity) * lk;
      key.intensity += ((1 - dark) * 1.4 + dark * 0.7 - key.intensity) * lk;
      ambient.intensity += (dark * 0.12 - ambient.intensity) * lk;
      hemi.color.lerpColors(HEMI_DAY, HEMI_NIGHT, hemiMix += (dark - hemiMix) * lk);
      key.color.lerpColors(KEY_DAY, KEY_NIGHT, hemiMix);
      for (const l of sceneLights) {
        const base = (l.userData.base as number | undefined) ?? l.intensity;
        l.userData.base = base;
        l.intensity = base * (1 + dark * 3);
      }
      // depth of field on the location when zoomed in
      dof = v === "zoom" && !!lp;
      if (dof && lp) bokehU.focus!.value = camera.position.distanceTo(lp);
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
      composer.setSize(w, h);
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
      if (dof) composer.render(dt);
      else renderer.render(scene, camera);
    };
    tick();
    (window as any).__maproom = { scene, camera, state: s };
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      composer.dispose();
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

  // the travel map's darkened edges (the original's camera vignette)
  return (
    <div ref={host} className={`maproom${view !== "title" ? " maproom-dark" : ""}${view === "setup" ? " maproom-blur" : ""} ${className ?? ""}`}>
      <div className={`maproom-vignette${view !== "title" ? " on" : ""}`} />
    </div>
  );
}
