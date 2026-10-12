// 3D prototype of the JiME board: original tile geometry/textures, tokens, clouds, particles, battle map props
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const S = window.SCENE;          // extracted geometry
const TEX = window.TEXDATA;      // name -> data URI

// ---------- renderer / scene ----------
const host = document.getElementById("view");
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
host.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x14120f);
scene.fog = new THREE.Fog(0x14120f, 38, 85);

const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 300);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.42;
controls.minDistance = 6;
controls.maxDistance = 60;

const hemi = new THREE.HemisphereLight(0xf3e6c8, 0x2a2219, 0.85);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffefd2, 1.55);
sun.position.set(-14, 26, 10);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, near: 1, far: 80 });
sun.shadow.bias = -0.0006;
scene.add(sun);

const loader = new THREE.TextureLoader();
const texCache = {};
function tex(name, repeat) {
  const key = name + (repeat || "");
  if (texCache[key]) return texCache[key];
  const t = loader.load(TEX[name]);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat, repeat); }
  texCache[key] = t;
  return t;
}

// ---------- helpers ----------
// Unity map plane (x, y) -> three (x, -z); board lies in XZ with Y up
function boardXZ(x, y) { return new THREE.Vector3(x, 0, -y); }

function meshGeometry(m, upAxis) {
  const pos = [], uv = [], idx = [];
  for (const p of m.pos) {
    if (upAxis === "z") pos.push(p[0], p[2], -p[1]); else pos.push(p[0], p[1], p[2]);
  }
  if (m.uv) for (const u of m.uv) uv.push(u[0], u[1]);
  for (const f of m.faces) for (let i = 1; i + 1 < f.length; i++) idx.push(f[0], f[i], f[i + 1]);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  if (m.uv) g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingBox();
  return g;
}

function sepiaMaterial(map) {
  const mat = new THREE.MeshStandardMaterial({ map, roughness: 0.92, metalness: 0, side: THREE.DoubleSide });
  mat.userData.sepia = { value: 0 };
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uSepia = mat.userData.sepia;
    sh.fragmentShader = "uniform float uSepia;\n" + sh.fragmentShader.replace(
      "#include <map_fragment>",
      `#include <map_fragment>
       float lum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
       vec3 sep = vec3(lum * 1.08, lum * 0.93, lum * 0.72);
       diffuseColor.rgb = mix(diffuseColor.rgb, sep * 0.82, uSepia);`);
  };
  return mat;
}

// ---------- adventure map ----------
const mapGroup = new THREE.Group();
scene.add(mapGroup);

const table = new THREE.Mesh(new THREE.PlaneGeometry(160, 160), new THREE.MeshStandardMaterial({ map: tex("noise_clouds", 6), color: 0x3a3127, roughness: 1 }));
table.rotation.x = -Math.PI / 2; table.position.y = -0.02; table.receiveShadow = true;
mapGroup.add(table);

const TILE_H = 0.16;
const tiles = {};
const pickables = [];
let boardCenter = new THREE.Vector3();
let count = 0;
for (const [code, t] of Object.entries(S.tiles)) {
  const pos = [], uv = [], idx = [], side = [];
  let base = 0;
  for (const h of t.hexes) {
    // top face
    for (let i = 0; i < h.pos.length; i++) {
      const p = h.pos[i];
      const v = boardXZ(p[0] + t.offset[0], p[1] + t.offset[1]);
      pos.push(v.x, TILE_H, v.z);
      uv.push(h.uv[i][0], h.uv[i][1]);
    }
    for (const f of h.faces) for (let i = 1; i + 1 < f.length; i++) idx.push(base + f[0], base + f[i], base + f[i + 1]);
    base += h.pos.length;
    // side walls of the hex (thickness of the cardboard)
    const n = h.pos.length;
    for (let i = 0; i < n; i++) {
      const a = h.pos[i], b = h.pos[(i + 1) % n];
      const A = boardXZ(a[0] + t.offset[0], a[1] + t.offset[1]), B = boardXZ(b[0] + t.offset[0], b[1] + t.offset[1]);
      side.push(A.x, TILE_H, A.z, B.x, TILE_H, B.z, B.x, 0, B.z, A.x, TILE_H, A.z, B.x, 0, B.z, A.x, 0, A.z);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  const top = new THREE.Mesh(g, sepiaMaterial(tex(t.texture.replace("tile_", "TILE:"))));
  top.receiveShadow = true;
  const sg = new THREE.BufferGeometry();
  sg.setAttribute("position", new THREE.Float32BufferAttribute(side, 3)); sg.computeVertexNormals();
  const sides = new THREE.Mesh(sg, new THREE.MeshStandardMaterial({ color: 0x2b241c, roughness: 1, side: THREE.DoubleSide }));
  sides.castShadow = true;
  const grp = new THREE.Group(); grp.add(top, sides);
  mapGroup.add(grp);
  const centers = t.centers.map(c => boardXZ(c[0], c[1]));
  const centroid = centers.reduce((a, c) => a.add(c), new THREE.Vector3()).multiplyScalar(1 / centers.length);
  // choose the hex nearest the centroid for the explore token
  let mid = centers[0], md = 1e9;
  for (const c of centers) { const d = c.distanceTo(centroid); if (d < md) { md = d; mid = c; } }
  tiles[code] = { code, grp, top, centers, centroid, mid, state: "hidden", clouds: null, tokens: [] };
  top.userData.code = code;
  pickables.push(top);
  boardCenter.add(centroid); count++;
}
boardCenter.multiplyScalar(1 / count);

// ---------- tokens ----------
const tokenGeo = meshGeometry(S.tokenMesh, "z");
const terrainGeo = meshGeometry(S.terrainMesh, "z");
function tokenMaterial(name) {
  return new THREE.MeshStandardMaterial({ map: tex(name), roughness: 0.75, metalness: 0.05 });
}
const dropIns = [];
function addToken(tile, kind, at, geo = tokenGeo, scale = 1.25) {
  const m = new THREE.Mesh(geo, tokenMaterial(kind));
  m.scale.setScalar(scale);
  m.position.copy(at).setY(TILE_H + 0.002);
  m.rotation.y = Math.random() * Math.PI * 2;
  m.castShadow = true; m.receiveShadow = true;
  mapGroup.add(m);
  tile.tokens.push(m);
  dropIns.push({ m, t: 0, y0: TILE_H + 0.002 });
  return m;
}

// ---------- clouds over hidden tiles ----------
const cloudMat = (n) => new THREE.SpriteMaterial({ map: tex(n), color: 0xa59c8f, transparent: true, opacity: 0.85, depthWrite: false });
function addClouds(tile) {
  const g = new THREE.Group();
  for (const c of tile.centers) {
    for (let k = 0; k < 1; k++) {
      const s = new THREE.Sprite(cloudMat(Math.random() < 0.5 ? "cloud_type_a" : "smoketex"));
      const sc = 2.4 + Math.random() * 0.9;
      s.scale.set(sc, sc, 1);
      s.position.set(c.x + (Math.random() - 0.5) * 0.5, 0.55 + Math.random() * 0.35, c.z + (Math.random() - 0.5) * 0.5);
      s.material.rotation = Math.random() * Math.PI * 2;
      s.userData = { spin: (Math.random() - 0.5) * 0.08, bob: Math.random() * 6, y: s.position.y };
      g.add(s);
    }
  }
  mapGroup.add(g);
  tile.clouds = g;
}

// ---------- particles ----------
function emberSystem(origin, n = 70, spread = 0.35) {
  const geo = new THREE.BufferGeometry();
  const p = new Float32Array(n * 3), c = new Float32Array(n * 3), life = new Float32Array(n), vel = [];
  for (let i = 0; i < n; i++) { life[i] = Math.random(); vel.push(new THREE.Vector3()); }
  geo.setAttribute("position", new THREE.BufferAttribute(p, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(c, 3));
  const mat = new THREE.PointsMaterial({ size: 0.16, map: tex("ThreatFire"), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const pts = new THREE.Points(geo, mat);
  const sys = { pts, origin: origin.clone(), n, life, vel, spread, update(dt) {
    for (let i = 0; i < n; i++) {
      life[i] += dt * (0.45 + (i % 7) * 0.05);
      if (life[i] >= 1) {
        life[i] = 0;
        p[i * 3] = this.origin.x + (Math.random() - 0.5) * spread;
        p[i * 3 + 1] = this.origin.y;
        p[i * 3 + 2] = this.origin.z + (Math.random() - 0.5) * spread;
        vel[i].set((Math.random() - 0.5) * 0.25, 0.7 + Math.random() * 0.7, (Math.random() - 0.5) * 0.25);
      }
      p[i * 3] += vel[i].x * dt + Math.sin(life[i] * 9 + i) * 0.003;
      p[i * 3 + 1] += vel[i].y * dt;
      p[i * 3 + 2] += vel[i].z * dt;
      const f = (1 - life[i]) * Math.min(1, life[i] * 6);
      c[i * 3] = 1.0 * f; c[i * 3 + 1] = 0.45 * f; c[i * 3 + 2] = 0.12 * f;
    }
    geo.attributes.position.needsUpdate = true; geo.attributes.color.needsUpdate = true;
  } };
  return sys;
}

function dustBurst(origin) {
  const n = 40, geo = new THREE.BufferGeometry(), p = new Float32Array(n * 3), v = [];
  for (let i = 0; i < n; i++) {
    p.set([origin.x, origin.y + 0.1, origin.z], i * 3);
    const a = Math.random() * Math.PI * 2, s = 0.6 + Math.random() * 1.2;
    v.push(new THREE.Vector3(Math.cos(a) * s, 0.4 + Math.random() * 0.8, Math.sin(a) * s));
  }
  geo.setAttribute("position", new THREE.BufferAttribute(p, 3));
  const mat = new THREE.PointsMaterial({ size: 0.55, map: tex("part_dust"), color: 0xd9c9a8, transparent: true, opacity: 0.9, depthWrite: false });
  const pts = new THREE.Points(geo, mat);
  scene.add(pts);
  let t = 0;
  transient.push((dt) => {
    t += dt;
    for (let i = 0; i < n; i++) { p[i * 3] += v[i].x * dt; p[i * 3 + 1] += v[i].y * dt; p[i * 3 + 2] += v[i].z * dt; v[i].multiplyScalar(0.95); }
    geo.attributes.position.needsUpdate = true;
    mat.opacity = Math.max(0, 0.9 - t * 0.9);
    if (t > 1.1) { scene.remove(pts); return false; }
    return true;
  });
}
const transient = [];

// ambient dust motes over the board
function motes(center, radius, n = 180) {
  const geo = new THREE.BufferGeometry(), p = new Float32Array(n * 3), ph = [];
  for (let i = 0; i < n; i++) { p.set([center.x + (Math.random() - 0.5) * radius * 2, 0.3 + Math.random() * 4, center.z + (Math.random() - 0.5) * radius * 2], i * 3); ph.push(Math.random() * 10); }
  geo.setAttribute("position", new THREE.BufferAttribute(p, 3));
  const mat = new THREE.PointsMaterial({ size: 0.09, map: tex("part_dust"), color: 0xf2dfb5, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending });
  const pts = new THREE.Points(geo, mat);
  return { pts, update(dt, time) {
    for (let i = 0; i < n; i++) { p[i * 3] += Math.sin(time * 0.3 + ph[i]) * 0.004; p[i * 3 + 1] += Math.cos(time * 0.5 + ph[i]) * 0.002; }
    geo.attributes.position.needsUpdate = true;
  } };
}

// rain: streaks recycled inside a box around the camera target
const rain = (() => {
  const n = 2200, geo = new THREE.BufferGeometry(), p = new Float32Array(n * 6);
  geo.setAttribute("position", new THREE.BufferAttribute(p, 3));
  const mat = new THREE.LineBasicMaterial({ color: 0xa7b4c2, transparent: true, opacity: 0.35 });
  const lines = new THREE.LineSegments(geo, mat);
  const seed = (i, c) => { const x = c.x + (Math.random() - 0.5) * 50, y = Math.random() * 22, z = c.z + (Math.random() - 0.5) * 50; p.set([x, y, z, x + 0.06, y - 0.55, z], i * 6); };
  let ready = false;
  return { lines, update(dt, c) {
    if (!ready) { for (let i = 0; i < n; i++) seed(i, c); ready = true; }
    for (let i = 0; i < n; i++) {
      p[i * 6 + 1] -= 24 * dt; p[i * 6 + 4] -= 24 * dt; p[i * 6] += 2.4 * dt; p[i * 6 + 3] += 2.4 * dt;
      if (p[i * 6 + 4] < 0) seed(i, c), (p[i * 6 + 1] = 22, p[i * 6 + 4] = 21.45);
    }
    geo.attributes.position.needsUpdate = true;
  } };
})();
rain.lines.visible = false;
scene.add(rain.lines);

const flicker = [];
// ---------- initial state mirrors round 1 of the real Bandit Hunt log ----------
const systems = [];
function setState(tile, state, animate) {
  tile.state = state;
  const mat = tile.top.material;
  if (state === "hidden") {
    tile.grp.visible = false; mat.userData.sepia.value = 1; addClouds(tile);
  } else if (state === "revealed") {
    tile.grp.visible = true;
    mat.userData.sepia.value = 1;
    if (animate) { tile.grp.position.y = -1.2; tile.rise = 0; }
    tile.explore = addToken(tile, "Explore-Token", tile.mid);
  } else if (state === "explored") {
    tile.grp.visible = true;
    if (animate) tile.fade = 1; else mat.userData.sepia.value = 0;
  }
}
const placements = {
  "302A": [["Search-Token", 2], ["9_Fire", 7, "terrain"], ["0_Bushes", 10, "terrain"]],
  "100A": [["Human-Token", 1]],
};
for (const [code, t] of Object.entries(tiles)) {
  if (code === "302A" || code === "100A") setState(t, "explored");
  else if (code === "400A") setState(t, "revealed");
  else setState(t, "hidden");
  for (const [k, hi, kind] of placements[code] || []) {
    const at = t.centers[Math.min(hi, t.centers.length - 1)];
    const m = kind === "terrain" ? addToken(t, k, at, terrainGeo, 1.15) : addToken(t, k, at);
    if (k === "9_Fire") {
      const e = emberSystem(at.clone().setY(TILE_H + 0.12)); mapGroup.add(e.pts); systems.push(e);
      const light = new THREE.PointLight(0xff8a3a, 3.2, 6, 1.6); light.position.copy(at).setY(0.9); mapGroup.add(light);
      flicker.push(light);
    }
  }
}
const mapMotes = motes(boardCenter, 16); mapGroup.add(mapMotes.pts);

// random encounters revealed when a tile is explored (keys from the real log)
const encounterPool = ["Search-Token", "Search-Token", "Threat-Token", "Human-Token"];
function explore(tile) {
  if (tile.state !== "revealed") return;
  if (tile.explore) { dustBurst(tile.explore.position); mapGroup.remove(tile.explore); tile.explore = null; }
  setState(tile, "explored", true);
  const picks = [...tile.centers].sort(() => Math.random() - 0.5).slice(0, 1 + Math.floor(Math.random() * 2));
  picks.forEach((c, i) => setTimeout(() => { addToken(tile, encounterPool[Math.floor(Math.random() * encounterPool.length)], c); dustBurst(c.clone().setY(TILE_H)); }, 350 + i * 250));
  status(`Исследован тайл ${tile.code}`);
}
function reveal(tile) {
  if (tile.state !== "hidden") return;
  const clouds = tile.clouds; tile.clouds = null;
  transient.push(((g) => { let t = 0; return (dt) => {
    t += dt;
    g.children.forEach(s => { s.material.opacity = Math.max(0, 0.92 - t * 1.1); s.scale.multiplyScalar(1 + dt * 0.6); s.position.y += dt * 0.8; });
    if (t > 0.9) { mapGroup.remove(g); return false; } return true; }; })(clouds));
  setState(tile, "revealed", true);
  status(`Открыт тайл ${tile.code}. Нажмите на жетон исследования`);
}

// ---------- battle map ----------
const battleGroup = new THREE.Group();
battleGroup.visible = false;
scene.add(battleGroup);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(30, 20), new THREE.MeshStandardMaterial({ map: tex("JIME_Battleboard_Rocks_BS"), roughness: 1 }));
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
battleGroup.add(ground);
const propDefs = {
  "Statue08_b": { up: "y", tex: "PropAtlas", h: 3.2 },
  "Wall06": { up: "z", tex: "PropAtlas", h: 1.7 },
  "Rocks3_lp:Group20184": { up: "y", tex: "rocks_atlas", h: 2.0 },
  "Small_Tree_01": { up: "y", tex: "Vegetation", h: 2.6, cut: true },
  "Small_Tree_02": { up: "y", tex: "Vegetation", h: 2.1, cut: true },
  "Firelogs": { up: "z", tex: "PropAtlas", h: 0.35 },
  "S_bush_01": { up: "z", tex: "Vegetation", h: 0.6, cut: true },
};
function prop(name, x, z, rot = 0, sMul = 1) {
  const d = propDefs[name], m = S.props[name];
  if (!d || !m) return null;
  const g = meshGeometry(m, d.up);
  const bb = g.boundingBox, size = new THREE.Vector3(); bb.getSize(size);
  const s = (d.h / Math.max(size.y, 1e-3)) * sMul;
  g.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2);
  const mat = new THREE.MeshStandardMaterial({ map: tex(d.tex), roughness: 0.9, side: THREE.DoubleSide, alphaTest: d.cut ? 0.45 : 0, transparent: false });
  const mesh = new THREE.Mesh(g, mat);
  mesh.scale.setScalar(s); mesh.position.set(x, 0, z); mesh.rotation.y = rot;
  mesh.castShadow = true; mesh.receiveShadow = true;
  battleGroup.add(mesh);
  return mesh;
}
prop("Statue08_b", 0, -1.5, 0.3);
prop("Wall06", -6, -5, 0.15); prop("Wall06", 4.5, -6.2, -0.2, 0.9);
prop("Rocks3_lp:Group20184", 8, 2, 0.8); prop("Rocks3_lp:Group20184", 9.6, 4, 2.1, 0.7); prop("Rocks3_lp:Group20184", -9, 4.5, 1.2, 0.85);
for (const [x, z, r, s] of [[-11, -3, 0, 1], [-10, 1, 1, 0.8], [-12.2, 6, 2, 1.1], [11.5, -5, 0.5, 1], [12, -1.5, 1.4, 0.9], [-4, 7.5, 2.5, 1.2], [3.5, 8, 0.9, 1]]) prop(r > 1.5 ? "Small_Tree_02" : "Small_Tree_01", x, z, r, s);
for (const [x, z] of [[-3, 4], [-2, 4.8], [5.5, 3.5], [6.5, 6.5], [-7.5, -1], [2, -4]]) prop("S_bush_01", x, z, Math.random() * 6);
prop("Firelogs", 3.2, 2.2, 0.4);
const campfire = emberSystem(new THREE.Vector3(3.2, 0.2, 2.2), 110, 0.45); battleGroup.add(campfire.pts); systems.push(campfire);
const campLight = new THREE.PointLight(0xff8a3a, 6, 9, 1.5); campLight.position.set(3.2, 1.1, 2.2); battleGroup.add(campLight); flicker.push(campLight);
const bbMotes = motes(new THREE.Vector3(0, 0, 0), 14, 150); battleGroup.add(bbMotes.pts);

// ---------- view switching ----------
let mode = "map";
function frameMap() {
  const open = Object.values(tiles).filter(t => t.state !== "hidden");
  const c = open.reduce((a, t) => a.add(t.centroid), new THREE.Vector3()).multiplyScalar(1 / open.length);
  const tgt = c.clone().lerp(boardCenter, 0.45);
  controls.target.copy(tgt);
  camera.position.set(tgt.x - 3, 21, tgt.z + 12);
}
function frameBattle() {
  controls.target.set(0, 0.8, 0);
  camera.position.set(-2, 13, 17);
}
function setMode(m) {
  mode = m;
  mapGroup.visible = m === "map"; battleGroup.visible = m === "battle";
  if (m === "map") frameMap(); else frameBattle();
  document.querySelectorAll("[data-mode]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.mode === m)));
  status(m === "map" ? "Карта приключения: нажмите на облака, чтобы открыть тайл" : "Боевое поле: 3D-объекты и текстуры из игры");
}

// ---------- input ----------
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
let downAt = null;
renderer.domElement.addEventListener("pointerdown", e => { downAt = [e.clientX, e.clientY]; });
renderer.domElement.addEventListener("pointerup", e => {
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 6 || mode !== "map") return;
  const r = renderer.domElement.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  // clouds first: hidden tiles are picked through their hex footprint
  const hit = ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -TILE_H), new THREE.Vector3());
  if (!hit) return;
  let best = null, bd = 1e9;
  for (const t of Object.values(tiles)) for (const c of t.centers) { const d = Math.hypot(c.x - hit.x, c.z - hit.z); if (d < bd) { bd = d; best = t; } }
  if (!best || bd > S.hexRadius * 1.05) return;
  if (best.state === "hidden") reveal(best); else if (best.state === "revealed") explore(best);
});

const statusEl = document.getElementById("status");
function status(s) { statusEl.textContent = s; }
document.querySelectorAll("[data-mode]").forEach(b => b.addEventListener("click", () => setMode(b.dataset.mode)));
document.getElementById("rain").addEventListener("change", e => { rain.lines.visible = e.target.checked; });
document.getElementById("reset").addEventListener("click", () => location.reload());

// ---------- loop ----------
function resize() {
  const w = host.clientWidth, h = host.clientHeight;
  renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
resize(); setMode("map");

const clock = new THREE.Clock();
const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
function tick() {
  const dt = Math.min(clock.getDelta(), 0.05), time = clock.elapsedTime;
  controls.update();
  for (const s of systems) s.update(dt);
  if (!reduce) { mapMotes.update(dt, time); bbMotes.update(dt, time); }
  if (rain.lines.visible) rain.update(dt, controls.target);
  flicker.forEach((l, i) => { l.intensity = (i ? 6 : 3.2) * (0.8 + 0.25 * Math.sin(time * 13 + i) * Math.sin(time * 7.3)); });
  for (const t of Object.values(tiles)) {
    if (t.clouds) t.clouds.children.forEach(s => { s.material.rotation += s.userData.spin * dt; s.position.y = s.userData.y + Math.sin(time * 0.6 + s.userData.bob) * 0.08; });
    if (t.rise !== undefined) { t.rise = Math.min(1, t.rise + dt * 1.6); const k = 1 - Math.pow(1 - t.rise, 3); t.grp.position.y = -1.2 * (1 - k); if (t.rise >= 1) delete t.rise; }
    if (t.fade !== undefined) { t.fade = Math.max(0, t.fade - dt * 1.2); t.top.material.userData.sepia.value = t.fade; if (t.fade <= 0) delete t.fade; }
  }
  for (let i = dropIns.length - 1; i >= 0; i--) {
    const d = dropIns[i]; d.t = Math.min(1, d.t + dt * 2.4);
    const k = d.t < 1 ? Math.abs(Math.cos(d.t * Math.PI * 1.5)) * (1 - d.t) : 0;
    d.m.position.y = d.y0 + k * 1.4; if (d.t >= 1) dropIns.splice(i, 1);
  }
  for (let i = transient.length - 1; i >= 0; i--) if (!transient[i](dt)) transient.splice(i, 1);
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}
tick();
window.__ready = true;
