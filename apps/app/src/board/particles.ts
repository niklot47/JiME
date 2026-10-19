// A small player for the original's Shuriken particle systems, exported by tools/importer/particles.py into glTF node
// extras ("ps"): emission (rate, bursts, duration, loop, prewarm), shapes (sphere, hemisphere, cone, cone volume, box,
// circle), start values, colour / size / rotation / velocity / force over lifetime, texture sheets, and the billboard,
// stretched billboard and mesh render modes. The system lives in its node's local frame, which the exporter mirrored
// on x (Unity is left-handed), so local directions are mirrored here the same way.
import * as THREE from "three";

type MinMax = [number, number] | { c: number[]; c2?: number[] };
interface Gradient { c: [number, number, number, number][]; a: [number, number][] }
type MinMaxColor = { k: [number, number, number, number][] } | { g: Gradient; g2?: Gradient };

export interface PS {
  dur: number; loop: boolean; prewarm: boolean; delay: MinMax; speed: number; world: boolean; scaling: number; max: number;
  life: MinMax; size: MinMax; v0: MinMax; rot: MinMax; color: MinMaxColor; grav: MinMax; rate: MinMax;
  bursts?: [number, number, number, number][];
  shape?: { type: number; radius: number; angle: number; arc: number; len: number; thick: number; pos: number[]; rot: number[]; scale: number[]; rnd: number; sph: number };
  col?: MinMaxColor; sol?: MinMax; rol?: MinMax;
  vol?: { x: MinMax; y: MinMax; z: MinMax; world: boolean };
  force?: { x: MinMax; y: MinMax; z: MinMax; world: boolean };
  sheet?: { x: number; y: number; frame: MinMax; start: MinMax; cycles: number; anim: number; row: number };
  render?: { mode: number; len: number; vel: number; maxSize: number; minSize: number; align: number };
  rot3?: [MinMax, MinMax, MinMax];
}

// ---------------------------------------------------------------- curves
function sample(c: number[], t: number): number {
  const x = Math.min(1, Math.max(0, t)) * (c.length - 1);
  const i = Math.min(c.length - 2, Math.floor(x));
  return c[i]! + (c[i + 1]! - c[i]!) * (x - i);
}
/** MinMaxCurve at time t (0..1) with the particle's random r (0..1) */
function mm(v: MinMax | undefined, t: number, r: number, dflt = 0): number {
  if (v === undefined) return dflt;
  if (Array.isArray(v)) return v[0] + (v[1] - v[0]) * r;
  const a = sample(v.c, t);
  return v.c2 ? sample(v.c2, t) + (a - sample(v.c2, t)) * r : a;
}
function grad(g: Gradient, t: number, out: number[]): void {
  const lerpKeys = (keys: number[][], n: number, idx: number[]) => {
    if (!keys.length) return idx.map(() => 1);
    if (t <= keys[0]![0]!) return idx.map((i) => keys[0]![i]!);
    for (let k = 1; k < keys.length; k++) {
      if (t <= keys[k]![0]!) {
        const a = keys[k - 1]!, b = keys[k]!;
        const u = (t - a[0]!) / Math.max(1e-6, b[0]! - a[0]!);
        return idx.map((i) => a[i]! + (b[i]! - a[i]!) * u);
      }
    }
    void n;
    return idx.map((i) => keys[keys.length - 1]![i]!);
  };
  const [r, g2, b] = lerpKeys(g.c, 3, [1, 2, 3]);
  const [a] = lerpKeys(g.a, 1, [1]);
  out[0] = r!; out[1] = g2!; out[2] = b!; out[3] = a!;
}
function color(v: MinMaxColor | undefined, t: number, r: number, out: number[]): void {
  if (!v) { out[0] = out[1] = out[2] = out[3] = 1; return; }
  if ("k" in v) {
    const a = v.k[0]!, b = v.k[v.k.length - 1]!;
    for (let i = 0; i < 4; i++) out[i] = a[i]! + (b[i]! - a[i]!) * r;
    return;
  }
  grad(v.g, t, out);
  if (v.g2) {
    const o2 = [0, 0, 0, 0];
    grad(v.g2, t, o2);
    for (let i = 0; i < 4; i++) out[i] = o2[i]! + (out[i]! - o2[i]!) * r;
  }
}

/** Unity's Euler (degrees, applied z, x, y) */
function euler(e: number[]): THREE.Quaternion {
  const d = THREE.MathUtils.degToRad;
  return new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), d(e[1] ?? 0))
    .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), d(e[0] ?? 0)))
    .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), d(e[2] ?? 0)));
}

// ---------------------------------------------------------------- shaders
const VERT = /* glsl */ `
attribute vec3 iPos; attribute vec3 iVel; attribute vec4 iColor; attribute vec3 iMisc; // size, rotation, frame
uniform float uStretch; uniform float uLen; uniform float uVelScale; uniform vec2 uSheet;
varying vec2 vUv; varying vec4 vColor;
void main() {
  vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
  float size = iMisc.x;
  vec2 corner = position.xy;
  vec2 off;
  if (uStretch > 0.5) {
    vec3 v = (modelViewMatrix * vec4(iVel, 0.0)).xyz;
    vec2 d = length(v.xy) > 1e-5 ? normalize(v.xy) : vec2(0.0, 1.0);
    float len = size * uLen + length(v) * uVelScale;
    vec2 n = vec2(-d.y, d.x);
    // the quad's top edge at the particle, trailing behind it
    off = n * corner.x * size + d * (corner.y - 0.5) * len;
  } else {
    float c = cos(iMisc.y), s = sin(iMisc.y);
    off = vec2(c * corner.x - s * corner.y, s * corner.x + c * corner.y) * size;
  }
  mv.xy += off;
  gl_Position = projectionMatrix * mv;
  float f = floor(iMisc.z + 0.5);
  float fx = mod(f, uSheet.x), fy = floor(f / uSheet.x);
  vUv = (vec2(fx, uSheet.y - 1.0 - fy) + uv) / uSheet;
  vColor = iColor;
}`;
const FRAG = /* glsl */ `
uniform sampler2D uMap; uniform float uHasMap; uniform vec4 uTint; uniform float uAdditive;
varying vec2 vUv; varying vec4 vColor;
void main() {
  vec4 t = uHasMap > 0.5 ? texture2D(uMap, vUv) : vec4(1.0);
  vec4 c = t * vColor * uTint;
  if (uAdditive > 0.5) { gl_FragColor = vec4(c.rgb * c.a, 1.0); }
  else { if (c.a < 0.003) discard; gl_FragColor = c; }
  #include <colorspace_fragment>
}`;

// heat haze (the fire's "Distortion" system, a grab-pass shader in the game): the frame rendered so far, shifted by
// a moving noise inside each particle; drawn on its own layer after a copy of the frame
const FRAG_DISTORT = /* glsl */ `
uniform sampler2D uScene; uniform vec2 uRes; uniform float uTime; uniform float uStrength;
varying vec2 vUv; varying vec4 vColor;
float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
void main() {
  vec2 c = vUv - 0.5;
  float fall = smoothstep(0.5, 0.15, length(c)) * vColor.a;
  vec2 q = vUv * 5.0 + vec2(0.0, -uTime * 1.6);
  vec2 off = vec2(n(q) - 0.5, n(q + 17.3) - 0.5) * uStrength * fall;
  gl_FragColor = texture2D(uScene, gl_FragCoord.xy / uRes + off);
  if (fall < 0.01) discard;
}`;
export const DISTORT_LAYER = 3;
/** the frame copy the heat haze samples (filled by the view each frame) */
export const distortion = { scene: null as THREE.Texture | null, res: new THREE.Vector2(1, 1), time: 0 };

interface Particle { pos: THREE.Vector3; vel: THREE.Vector3; age: number; life: number; size: number; rot: number; spin: number; r: number[]; frame0: number; q?: THREE.Quaternion }

export class Emitter extends THREE.Object3D {
  readonly ps: PS;
  private parts: Particle[] = [];
  private time = 0;
  private acc = 0;
  private burstDone = new Set<number>();
  private delay: number;
  private stopped = false;
  private mesh: THREE.InstancedMesh;
  private iPos: THREE.InstancedBufferAttribute;
  private iVel: THREE.InstancedBufferAttribute;
  private iColor: THREE.InstancedBufferAttribute;
  private iMisc: THREE.InstancedBufferAttribute;
  private meshMode: boolean;
  private additive: boolean;
  private sizeScale: number;
  /** finished (one-shot systems): the owner may remove it */
  done = false;
  /** shown this frame (all its parents visible), set by the view */
  visibleNow = false;

  /** a heat haze system (drawn on DISTORT_LAYER) */
  readonly distort: boolean;

  constructor(ps: PS, material: THREE.Material | null, geometry: THREE.BufferGeometry | null, nodeScale = 1, distort = false) {
    super();
    this.distort = distort;
    this.ps = ps;
    this.delay = mm(ps.delay, 0, Math.random());
    const src = material as THREE.MeshStandardMaterial | null;
    const shader = String((src?.userData as any)?.shader ?? "");
    this.additive = /Additive|Add\b/.test(shader);
    const legacy = shader.startsWith("Legacy Shaders/Particles");
    const base = src?.color ?? new THREE.Color(1, 1, 1);
    const k = legacy ? 2 : 1;
    const tint = new THREE.Vector4(base.r * k, base.g * k, base.b * k, src?.opacity ?? 1);
    this.sizeScale = ps.scaling === 2 ? 1 : nodeScale;
    const n = Math.min(ps.max || 1000, 1000);
    this.meshMode = ps.render?.mode === 4 && !!geometry;
    if (this.meshMode) {
      const mat = new THREE.MeshBasicMaterial({ map: src?.map ?? null, transparent: true, depthWrite: false,
        blending: this.additive ? THREE.AdditiveBlending : THREE.NormalBlending, side: THREE.DoubleSide, color: new THREE.Color(tint.x, tint.y, tint.z) });
      this.mesh = new THREE.InstancedMesh(geometry!, mat, n);
      this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
      this.iPos = this.iVel = this.iColor = this.iMisc = new THREE.InstancedBufferAttribute(new Float32Array(3), 3);
    } else {
      const g = new THREE.InstancedBufferGeometry();
      const quad = new THREE.PlaneGeometry(1, 1);
      g.index = quad.index;
      g.setAttribute("position", quad.getAttribute("position"));
      g.setAttribute("uv", quad.getAttribute("uv"));
      this.iPos = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
      this.iVel = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
      this.iColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4);
      this.iMisc = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
      for (const a of [this.iPos, this.iVel, this.iColor, this.iMisc]) a.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute("iPos", this.iPos);
      g.setAttribute("iVel", this.iVel);
      g.setAttribute("iColor", this.iColor);
      g.setAttribute("iMisc", this.iMisc);
      g.instanceCount = 0;
      const map = src?.map ?? null;
      const mat = distort ? new THREE.ShaderMaterial({
        vertexShader: VERT, fragmentShader: FRAG_DISTORT, transparent: true, depthWrite: false, side: THREE.DoubleSide,
        uniforms: {
          uScene: { value: null }, uRes: { value: distortion.res }, uTime: { value: 0 }, uStrength: { value: 0.012 },
          uStretch: { value: 0 }, uLen: { value: 2 }, uVelScale: { value: 0 }, uSheet: { value: new THREE.Vector2(1, 1) },
        },
      }) : new THREE.ShaderMaterial({
        vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide,
        blending: this.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
        uniforms: {
          uMap: { value: map }, uHasMap: { value: map ? 1 : 0 }, uTint: { value: tint }, uAdditive: { value: this.additive ? 1 : 0 },
          uStretch: { value: ps.render?.mode === 1 ? 1 : 0 }, uLen: { value: Math.abs(ps.render?.len ?? 2) }, uVelScale: { value: ps.render?.vel ?? 0 },
          uSheet: { value: new THREE.Vector2(ps.sheet?.x ?? 1, ps.sheet?.y ?? 1) },
        },
      });
      this.mesh = new THREE.InstancedMesh(g as unknown as THREE.BufferGeometry, mat, n);
      this.mesh.count = 0;
    }
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
    if (distort) {
      this.mesh.layers.set(DISTORT_LAYER);
      this.mesh.onBeforeRender = () => {
        const u = (this.mesh.material as THREE.ShaderMaterial).uniforms;
        u.uScene!.value = distortion.scene;
        u.uTime!.value = distortion.time;
      };
    }
    this.add(this.mesh);
    if (ps.prewarm && ps.loop) for (let t = 0; t < ps.dur; t += 1 / 20) this.step(1 / 20, null);
  }

  /** spawn position and direction in Unity local space, mirrored to the node frame */
  private emitPoint(): { p: THREE.Vector3; d: THREE.Vector3 } {
    const sh = this.ps.shape;
    const p = new THREE.Vector3(), d = new THREE.Vector3(0, 0, 1);
    if (sh) {
      const rnd = () => Math.random();
      const unit = () => { const z = rnd() * 2 - 1, a = rnd() * Math.PI * 2, s = Math.sqrt(1 - z * z); return new THREE.Vector3(s * Math.cos(a), s * Math.sin(a), z); };
      const r = sh.radius ?? 1;
      const arc = THREE.MathUtils.degToRad(sh.arc ?? 360);
      switch (sh.type) {
        case 0: case 1: case 2: case 3: {
          d.copy(unit());
          if (sh.type >= 2 && d.z < 0) d.z = -d.z;
          p.copy(d).multiplyScalar(r * (sh.type === 1 || sh.type === 3 ? 1 : Math.cbrt(1 - (sh.thick ?? 1) * rnd())));
          break;
        }
        case 4: case 7: case 8: case 9: {
          const phi = rnd() * arc;
          const f = sh.type === 7 || sh.type === 9 ? 1 : Math.sqrt(1 - (sh.thick ?? 1) * rnd());
          const ang = THREE.MathUtils.degToRad(sh.angle ?? 25) * f;
          p.set(Math.cos(phi) * r * f, Math.sin(phi) * r * f, 0);
          d.set(Math.sin(ang) * Math.cos(phi), Math.sin(ang) * Math.sin(phi), Math.cos(ang));
          if (sh.type === 8 || sh.type === 9) p.addScaledVector(d, (sh.len ?? 5) * rnd());
          break;
        }
        case 10: case 11: {
          const phi = rnd() * arc;
          const f = sh.type === 11 ? 1 : Math.sqrt(1 - (sh.thick ?? 1) * rnd());
          p.set(Math.cos(phi) * r * f, Math.sin(phi) * r * f, 0);
          d.set(Math.cos(phi), Math.sin(phi), 0);
          break;
        }
        default: // box, box shell / edge, rectangle
          p.set(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5);
          d.set(0, 0, 1);
      }
      const isBox = sh.type === 5 || sh.type === 15 || sh.type === 16 || sh.type === 18;
      const sc = sh.scale ?? [1, 1, 1];
      p.multiply(new THREE.Vector3(sc[0], sc[1], sc[2]));
      if (!isBox) d.multiply(new THREE.Vector3(Math.sign(sc[0] || 1), Math.sign(sc[1] || 1), Math.sign(sc[2] || 1)));
      const q = euler(sh.rot ?? [0, 0, 0]);
      p.applyQuaternion(q);
      d.applyQuaternion(q);
      p.add(new THREE.Vector3(...(sh.pos as [number, number, number] ?? [0, 0, 0])));
      if (sh.rnd) d.lerp(unit(), sh.rnd).normalize();
      if (sh.sph) d.lerp(p.clone().normalize(), sh.sph).normalize();
    }
    p.x = -p.x;
    d.x = -d.x;
    return { p, d };
  }

  private spawn(t: number): void {
    if (this.parts.length >= this.mesh.instanceMatrix.count) return;
    const ps = this.ps;
    const r = [Math.random(), Math.random(), Math.random(), Math.random(), Math.random(), Math.random()];
    const { p, d } = this.emitPoint();
    const life = Math.max(0.05, mm(ps.life, t, r[0]!, 5));
    const part: Particle = { pos: p, vel: d.multiplyScalar(mm(ps.v0, t, r[1]!, 5)), age: 0, life, size: mm(ps.size, t, r[2]!, 1) * this.sizeScale,
      rot: mm(ps.rot, t, r[3]!), spin: 0, r, frame0: mm(ps.sheet?.start, t, r[4]!) };
    if (this.meshMode && ps.rot3) part.q = euler(ps.rot3.map((v, i) => (mm(v, t, r[(i + 3) % 6]!) * 180) / Math.PI));
    this.parts.push(part);
  }

  /** advance; camera (when given) orients view-aligned mesh particles */
  step(dt: number, camera: THREE.Camera | null): void {
    const ps = this.ps;
    dt *= ps.speed || 1;
    if (this.delay > 0) { this.delay -= dt; return; }
    // emission over the system's cycle
    if (!this.stopped) {
      const t = (this.time % ps.dur) / ps.dur;
      this.acc += mm(ps.rate, t, Math.random()) * dt;
      while (this.acc >= 1) { this.spawn(t); this.acc -= 1; }
      for (let i = 0; i < (ps.bursts?.length ?? 0); i++) {
        const [bt, cnt] = ps.bursts![i]!;
        const cyc = Math.floor(this.time / ps.dur);
        const key = cyc * 100 + i;
        if (this.time % ps.dur >= bt && !this.burstDone.has(key)) { this.burstDone.add(key); for (let k = 0; k < cnt; k++) this.spawn(t); }
      }
      this.time += dt;
      if (!ps.loop && this.time >= ps.dur) this.stopped = true;
    }
    const col = [0, 0, 0, 0], c0 = [0, 0, 0, 0];
    const alive: Particle[] = [];
    for (const p of this.parts) {
      p.age += dt;
      if (p.age >= p.life) continue;
      const u = p.age / p.life;
      if (ps.force) {
        p.vel.x -= mm(ps.force.x, u, p.r[5]!) * dt;
        p.vel.y += mm(ps.force.y, u, p.r[5]!) * dt;
        p.vel.z += mm(ps.force.z, u, p.r[5]!) * dt;
      }
      p.pos.addScaledVector(p.vel, dt);
      if (ps.vol) p.pos.add(new THREE.Vector3(-mm(ps.vol.x, u, p.r[4]!), mm(ps.vol.y, u, p.r[4]!), mm(ps.vol.z, u, p.r[4]!)).multiplyScalar(dt));
      if (ps.rol) p.rot += mm(ps.rol, u, p.r[5]!) * dt;
      alive.push(p);
    }
    this.parts = alive;
    if (this.stopped && !alive.length) this.done = true;
    // instance data
    if (this.meshMode) {
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3();
      const view = camera ? this.viewQuat(camera) : null;
      alive.forEach((p, i) => {
        const u = p.age / p.life;
        color(ps.color, 0, p.r[2]!, c0);
        color(ps.col, u, p.r[3]!, col);
        const a = c0[3]! * col[3]!;
        const k = this.additive ? a : 1;
        this.mesh.instanceColor!.setXYZ(i, c0[0]! * col[0]! * k, c0[1]! * col[1]! * k, c0[2]! * col[2]! * k);
        const sz = p.size * mm(ps.sol, u, p.r[2]!, 1);
        q.copy(ps.render?.align === 0 && view ? view : new THREE.Quaternion()).multiply(p.q ?? new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -p.rot));
        m.compose(p.pos, q, s.setScalar(sz));
        this.mesh.setMatrixAt(i, m);
      });
      this.mesh.count = alive.length;
      this.mesh.instanceMatrix.needsUpdate = true;
      if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
      return;
    }
    const frames = (ps.sheet?.x ?? 1) * (ps.sheet?.y ?? 1);
    alive.forEach((p, i) => {
      const u = p.age / p.life;
      color(ps.color, 0, p.r[2]!, c0);
      color(ps.col, u, p.r[3]!, col);
      this.iPos.setXYZ(i, p.pos.x, p.pos.y, p.pos.z);
      this.iVel.setXYZ(i, p.vel.x, p.vel.y, p.vel.z);
      this.iColor.setXYZW(i, c0[0]! * col[0]!, c0[1]! * col[1]!, c0[2]! * col[2]!, c0[3]! * col[3]!);
      const frame = ps.sheet ? Math.floor((p.frame0 + mm(ps.sheet.frame, (u * (ps.sheet.cycles || 1)) % 1, p.r[4]!)) % frames) : 0;
      this.iMisc.setXYZ(i, p.size * mm(ps.sol, u, p.r[2]!, 1), -p.rot, frame);
    });
    const g = this.mesh.geometry as unknown as THREE.InstancedBufferGeometry;
    g.instanceCount = alive.length;
    this.mesh.count = alive.length;
    for (const a of [this.iPos, this.iVel, this.iColor, this.iMisc]) a.needsUpdate = true;
  }

  /** the camera's rotation in this system's frame (view-aligned mesh particles) */
  private viewQuat(camera: THREE.Camera): THREE.Quaternion {
    const w = new THREE.Quaternion();
    this.getWorldQuaternion(w);
    return w.invert().multiply(camera.quaternion);
  }
}

/** Emitters for every node carrying "ps" extras under root; material / mesh from its ":psmat" / ":psmesh" children */
export function attachEmitters(root: THREE.Object3D, filter: (name: string, ps: PS) => boolean = () => true): Emitter[] {
  const out: Emitter[] = [];
  const nodes: THREE.Object3D[] = [];
  root.traverse((o) => { if (o.userData?.ps) nodes.push(o); });
  for (const o of nodes) {
    const ps = o.userData.ps as PS;
    const name = (o.userData.name as string) ?? o.name;
    if (!filter(name, ps)) continue;
    let mat: THREE.Material | null = null, geo: THREE.BufferGeometry | null = null;
    for (const c of o.children) {
      const cn = (c.userData.name as string) ?? c.name;
      const m = c as THREE.Mesh;
      if (cn.endsWith(":psmat") && m.isMesh) { mat = m.material as THREE.Material; (mat as any).userData = { ...(mat as any).userData, ...(m.material as any).userData }; c.visible = false; }
      if (cn.endsWith(":psmesh")) {
        c.visible = false;
        c.traverse((x) => { if ((x as THREE.Mesh).isMesh && !geo) geo = (x as THREE.Mesh).geometry; });
      }
    }
    const distort = /Distortion/i.test(name) || /Distortion/i.test(String((mat?.userData as any)?.shader ?? ""));
    const s = new THREE.Vector3();
    o.getWorldScale(s);
    const e = new Emitter(ps, distort ? null : mat, geo, ps.scaling === 0 ? (s.x + s.y + s.z) / 3 : (o.scale.x + o.scale.y + o.scale.z) / 3, distort);
    o.add(e);
    out.push(e);
  }
  return out;
}
