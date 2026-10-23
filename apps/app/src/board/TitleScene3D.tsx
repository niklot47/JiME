// The title screen's background (the Titlescreen scene, tools/importer/export_title.py): a forest battle painted as
// cut-out cards standing in 3D - Aragorn, Legolas and Gimli against orcs, trees, terrain, light shafts and dust. Its
// Animator (TitlescreenVisuals, clip TitleArt, 84 s, looping) flies the camera between the figures, raises them from
// the ground like a pop-up book, flashes them (_ColorAdd) and pulls the focus (FxPro depth of field on FocusObject).
// Unity's scene is mirrored on x by the exporter: positions (-x, y, z), rotations (x, -y, -z, w).
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { BokehPass } from "three/examples/jsm/postprocessing/BokehPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { applyActive, loadGltf, nameOf, smoothCutout } from "./Battleboard3D.tsx";
import { attachEmitters, renderComposedWithParticles, Emitter } from "./particles.ts";
import { packText } from "../data/pack.ts";

interface Track { path: string; prop: string; n: number; v: number[] }
interface Clip { dur: number; fps: number; loop: boolean; tracks: Track[] }
interface TitleInfo { camera: { fov: number; near: number; far: number; clear: number[] }; states: string[]; clips: Record<string, Clip> }

/** the Animator's states: CameraWiggle plays once (the flat "painting", the camera drifting slowly to show the
 *  parallax), its transition (exit time 0, taken when the loop comes round) then hands over to TitleArtSequence, which
 *  loops (the flight between the figures) */
const FIRST = "CameraWiggle", MAIN = "TitleArt";
/** the whole sequence a quarter slower than the clips' own speed */
const RATE = 0.75;
const DEG = Math.PI / 180;
/** the light shafts fade out over this distance in front of the camera (scene units) */
const SHAFT_FADE: [number, number] = [4, 16];
/** the focused figure's lift (_ColorAdd): the shader's own use of it is unknown; at full strength it washes the figure
 *  out, the original shows only a faint brightening */
const ADD_K = 0.3;

/** Unity euler angles (degrees, applied z, x, y) as a mirrored three.js quaternion */
function unityEuler(x: number, y: number, z: number, out: THREE.Quaternion): THREE.Quaternion {
  const qx = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), x * DEG);
  const qy = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), y * DEG);
  const qz = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), z * DEG);
  const q = qy.multiply(qx).multiply(qz);
  return out.set(q.x, -q.y, -q.z, q.w);
}

export function TitleScene3D({ shown = true, className }: { shown?: boolean; className?: string }) {
  const host = useRef<HTMLDivElement>(null);
  const shownRef = useRef(shown);
  shownRef.current = shown;
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const el = host.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, 1, 0.3, 300);
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bokeh = new BokehPass(scene, camera, { focus: 20, aperture: 0, maxblur: 0.008 });
    composer.addPass(bokeh);
    composer.addPass(new OutputPass());
    const bokehU = (bokeh as unknown as { uniforms: Record<string, { value: number }> }).uniforms;
    let emitters: Emitter[] = [];
    let alive = true;
    let play: ((t: number) => void) | null = null;
    let camNode: THREE.Object3D | null = null, focusNode: THREE.Object3D | null = null;
    let fovNow = 60, dofNow = 0;

    void Promise.all([loadGltf("maproom/title.glb"), packText("maproom/title.json").then((t) => JSON.parse(t) as TitleInfo)]).then(([g, info]) => {
      if (!alive) return;
      const root = g.scene.clone(true);
      applyActive(root);
      for (const n of ["PersistentGameObject", "TitlescreenDynamicSoundGroup"]) root.children.find((c) => nameOf(c) === n)?.removeFromParent();
      const c = info.camera.clear;
      scene.background = new THREE.Color().setRGB(c[0] ?? 0, c[1] ?? 0, c[2] ?? 0, THREE.SRGBColorSpace);
      camera.near = info.camera.near;
      camera.far = info.camera.far;
      // (the scene's one system of light shafts: in the close-ups it went out because the depth of field's composer
      // dropped the particles - they are drawn over the composed frame now, renderComposedWithParticles)
      // the particle systems first (they read their shaders - additive light shafts - from the template materials)
      emitters = attachEmitters(root);
      // the light shafts dissolve as the camera comes near them (flying into one they cut off at once): their light fades
      // with the distance in front of the camera, out between SHAFT_FADE[1] and [0]
      for (const e of emitters) {
        let isShaft = false;
        for (let p: THREE.Object3D | null = e; p; p = p.parent) if (/Lightshaft/.test(nameOf(p))) isShaft = true;
        if (!isShaft) continue;
        e.traverse((o) => {
          const mat = (o as THREE.Mesh).material as THREE.Material | undefined;
          if (!mat || (o as THREE.Mesh).isMesh !== true) return;
          mat.onBeforeCompile = (sh) => {
            sh.vertexShader = sh.vertexShader.replace("void main() {", "varying float vShaftDepth;\nvoid main() {")
              .replace("#include <project_vertex>", "#include <project_vertex>\nvShaftDepth = -mvPosition.z;");
            sh.fragmentShader = sh.fragmentShader.replace("void main() {", "varying float vShaftDepth;\nvoid main() {")
              .replace("#include <dithering_fragment>", `gl_FragColor *= smoothstep(${SHAFT_FADE[0].toFixed(1)}, ${SHAFT_FADE[1].toFixed(1)}, vShaftDepth);\n#include <dithering_fragment>`);
            if (!/vShaftDepth/.test(sh.fragmentShader.split("void main")[1] ?? "")) {
              // (a shader without the dithering chunk: fade at its end)
              sh.fragmentShader = sh.fragmentShader.replace(/}\s*$/, `gl_FragColor *= smoothstep(${SHAFT_FADE[0].toFixed(1)}, ${SHAFT_FADE[1].toFixed(1)}, vShaftDepth);\n}`);
            }
          };
          mat.needsUpdate = true;
        });
      }
      for (const e of emitters) {
        let dim = 1;
        for (let p: THREE.Object3D | null = e; p; p = p.parent) if (typeof p.userData.dim === "number") dim = p.userData.dim;
        if (dim === 1) continue;
        e.traverse((o) => {
          const u = ((o as THREE.Mesh).material as THREE.ShaderMaterial | undefined)?.uniforms?.uTint;
          if (u) { u.value = (u.value as THREE.Vector4).clone(); (u.value as THREE.Vector4).multiplyScalar(dim); }
          const mc = ((o as THREE.Mesh).material as THREE.MeshBasicMaterial | undefined);
          if (mc && !(mc as any).uniforms && mc.color) { (o as THREE.Mesh).material = mc.clone(); ((o as THREE.Mesh).material as THREE.MeshBasicMaterial).color.multiplyScalar(dim); }
        });
      }
      // the whole scene is painted and unlit (Unlit-DepthTextureWrite, Shader Forge cutouts): its own colours as they
      // are, each figure with its own material for the flashes (_ColorAdd added to the colour)
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh || /ps(mat|mesh)$/.test(nameOf(m))) return;
        // (the particle systems' own meshes keep their blending: the light shafts are additive)
        for (let p: THREE.Object3D | null = m; p; p = p.parent) if (p instanceof Emitter) return;
        smoothCutout(m);
        const src = m.material as THREE.MeshStandardMaterial;
        if (Array.isArray(m.material) || (m.material as THREE.Material).type === "ShaderMaterial") return;
        const add = { value: new THREE.Vector3() };
        const mat = new THREE.MeshBasicMaterial({ map: src.map, color: src.color, transparent: src.transparent, alphaTest: src.alphaTest, side: src.side, depthWrite: src.depthWrite, opacity: src.opacity });
        mat.userData = { ...src.userData, add };
        mat.onBeforeCompile = (sh) => {
          sh.uniforms.uAdd = add;
          sh.fragmentShader = sh.fragmentShader.replace("void main() {", "uniform vec3 uAdd;\nvoid main() {")
            // (added in the game's gamma space: in linear light the same number would wash the figure out)
            .replace("#include <dithering_fragment>", "gl_FragColor.rgb = pow(pow(max(gl_FragColor.rgb, 0.0), vec3(1.0 / 2.2)) + uAdd * ADD_K, vec3(2.2));\n#include <dithering_fragment>")
            .replace("uniform vec3 uAdd;", `uniform vec3 uAdd;\nconst float ADD_K = ${ADD_K.toFixed(2)};`);
        };
        m.material = mat;
      });
      scene.add(root);
      // the animated nodes by their path under Z_Art
      let z: THREE.Object3D | null = null;
      root.traverse((o) => { if (!z && nameOf(o) === "Z_Art") z = o; });
      const byPath = new Map<string, THREE.Object3D>();
      if (z) {
        const walk = (o: THREE.Object3D, p: string) => {
          byPath.set(p, o);
          for (const ch of o.children) { const n = nameOf(ch); if (n) walk(ch, p ? `${p}/${n}` : n); }
        };
        walk(z, "");
      }
      camNode = byPath.get("Camera/Main Camera") ?? null;
      focusNode = byPath.get("Camera/Main Camera/FocusObject") ?? null;
      const main = info.clips[MAIN] ?? Object.values(info.clips)[0];
      const first = info.clips[FIRST] ?? null;
      if (!main) return;
      const meshOf = (o: THREE.Object3D): THREE.Mesh | null => {
        let m: THREE.Mesh | null = null;
        o.traverse((x) => { if (!m && (x as THREE.Mesh).isMesh) m = x as THREE.Mesh; });
        return m;
      };
      const q = new THREE.Quaternion();
      play = (time: number) => {
        const tt = time * RATE;
        const clip = first && tt < first.dur ? first : main;
        const t = clip === first ? tt : tt - (first ? first.dur : 0);
        const f = (t % clip.dur) * clip.fps;
        const frames = Math.floor(clip.tracks[0] ? clip.tracks[0].v.length / clip.tracks[0].n : 1);
        const i0 = Math.min(frames - 1, Math.floor(f)), i1 = Math.min(frames - 1, i0 + 1), k = f - Math.floor(f);
        const val = (tr: Track, c: number) => tr.v[i0 * tr.n + c]! * (1 - k) + tr.v[i1 * tr.n + c]! * k;
        for (const tr of clip.tracks) {
          const o = byPath.get(tr.path);
          if (!o) continue;
          if (tr.prop === "pos") o.position.set(-val(tr, 0), val(tr, 1), val(tr, 2));
          else if (tr.prop === "euler") o.quaternion.copy(unityEuler(val(tr, 0), val(tr, 1), val(tr, 2), q));
          else if (tr.prop === "scale") o.scale.set(val(tr, 0), val(tr, 1), val(tr, 2));
          else if (tr.prop === "fov") fovNow = val(tr, 0);
          else if (tr.prop === "fx:FocalLengthMultiplier") dofNow = val(tr, 0);
          else if (tr.prop.startsWith("add.")) {
            const m = meshOf(o);
            const u = (m?.material as THREE.Material | undefined)?.userData?.add as { value: THREE.Vector3 } | undefined;
            if (u) {
              const ch = tr.prop.slice(4);
              if (ch === "r") u.value.x = val(tr, 0); else if (ch === "g") u.value.y = val(tr, 0); else if (ch === "b") u.value.z = val(tr, 0);
            }
          }
        }
      };
      setReady(true);
    });

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
    let raf = 0, last = performance.now(), t = 0, hiddenAt = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const now = performance.now();
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      // hidden behind the new-game pages: nothing to draw (once it has faded out, still playing while it fades)
      if (shownRef.current) hiddenAt = 0;
      else if (!hiddenAt) hiddenAt = now;
      if (!play || (hiddenAt && now - hiddenAt > 900)) return;
      t += dt;
      play(t);
      scene.updateMatrixWorld(true);
      if (camNode) {
        // Unity cameras look along their +z
        const p = camNode.getWorldPosition(new THREE.Vector3());
        const wq = camNode.getWorldQuaternion(new THREE.Quaternion());
        camera.position.copy(p);
        camera.up.copy(new THREE.Vector3(0, 1, 0).applyQuaternion(wq));
        camera.lookAt(p.clone().add(new THREE.Vector3(0, 0, 1).applyQuaternion(wq)));
      }
      if (Math.abs(camera.fov - fovNow) > 1e-3) { camera.fov = fovNow; camera.updateProjectionMatrix(); }
      // FxPro's depth of field: sharp on the focus object, the rest softened by the clip's focal length multiplier
      const dof = dofNow > 0.01 && focusNode;
      if (dof) {
        bokehU.focus!.value = camera.position.distanceTo(focusNode!.getWorldPosition(new THREE.Vector3()));
        bokehU.aperture!.value = 0.0025 * dofNow;
      }
      emitters = emitters.filter((e) => {
        if (!e.parent) return false;
        let vis = true;
        for (let o: THREE.Object3D | null = e; o; o = o.parent) if (!o.visible) { vis = false; break; }
        e.visibleNow = vis;
        if (vis) e.step(dt, camera);
        return !e.done;
      });
      if (dof) renderComposedWithParticles(composer, renderer, scene, camera, dt, 0.45);
      else renderer.render(scene, camera);
    };
    tick();
    (window as any).__title = { scene, camera, composer, bokeh };
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      composer.dispose();
      renderer.dispose();
      el.removeChild(renderer.domElement);
    };
  }, []);

  return <div ref={host} className={`maproom title-scene${ready && shown ? " on" : ""} ${className ?? ""}`} />;
}
