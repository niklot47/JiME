// Board3D performance check: starts a game in 3D, counts renders per frame while orbiting, frame times, CPU profile.
// Usage: node tools/dev/cdp.mjs tools/dev/cdp-perf.js data/out/perf
const click = (text) => ev(`(() => { const b = [...document.querySelectorAll("button")].find((x) => x.innerText.includes(${JSON.stringify(text)}) && !x.disabled); if (!b) return "no"; b.click(); return "ok"; })()`);
await ev("localStorage.setItem(\"jime.board.view\", \"3d\"), location.reload()"); await sleep(4000);
await click("Игра"); await sleep(2500);
await ev(`(() => { const i = document.querySelector('input[type=number]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, '1870785907'); i.dispatchEvent(new Event('input', { bubbles: true })); return 1; })()`);
await click("Начать"); await sleep(6000);
console.log("dbg:", await ev("JSON.stringify({ canvas: document.querySelectorAll('canvas').length, b: typeof window.__board3d, view: localStorage.getItem('jime.board.view'), dec: !!document.querySelector('.decision') })"));
await shot("start");
console.log("gpu:", await ev(`(() => { const gl = window.__board3d.renderer.getContext(); const e = gl.getExtension('WEBGL_debug_renderer_info'); return (e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : '?') + ' | dpr ' + devicePixelRatio + ' | ' + innerWidth + 'x' + innerHeight; })()`));

const orbit = (label, setup) => ev(`new Promise((res) => { ${setup};
  const s = window.__board3d; const c = s.controls; const t0 = performance.now(); let n = 0, worst = 0, prev = t0, slow = 0;
  const step = (t) => { n++; const d = t - prev; worst = Math.max(worst, d); if (d > 20) slow++; prev = t;
    c.object.position.applyAxisAngle(c.object.up, 0.01); c.object.lookAt(c.target); c.dispatchEvent({ type: 'change' });
    if (t - t0 < 3000) requestAnimationFrame(step); else res(${JSON.stringify(label)} + ': fps ' + (n / 3).toFixed(0) + ', worst ' + worst.toFixed(0) + ' ms, slow frames ' + slow); };
  requestAnimationFrame(step); })`);

console.log("renders/s idle:", await ev(`new Promise((res) => { const r = window.__board3d.renderer; const orig = r.render; let n = 0, f = 0; r.render = function (...a) { n++; return orig.apply(this, a); };
  const loop = () => { f++; if (f < 60) requestAnimationFrame(loop); else { r.render = orig; res(n + ' renders in ' + f + ' frames'); } }; requestAnimationFrame(loop); })`));
console.log("renders orbit:", await ev(`new Promise((res) => { const s = window.__board3d; const r = s.renderer; const orig = r.render; let n = 0, f = 0; r.render = function (...a) { n++; return orig.apply(this, a); };
  const c = s.controls; const loop = () => { f++; c.object.position.applyAxisAngle(c.object.up, 0.01); c.object.lookAt(c.target); c.dispatchEvent({ type: 'change' }); if (f < 60) requestAnimationFrame(loop); else { r.render = orig; res(n + ' renders in ' + f + ' frames'); } }; requestAnimationFrame(loop); })`));

await send("Profiler.enable"); await send("Profiler.setSamplingInterval", { interval: 200 }); await send("Profiler.start");
console.log(await orbit("profiled", ""));
const pr = (await send("Profiler.stop")).result.profile;
const self = new Map(); const dt = pr.timeDeltas; const byId = new Map(pr.nodes.map((n) => [n.id, n]));
pr.samples.forEach((sid, k) => { const n = byId.get(sid); const f = n.callFrame; const key = (f.functionName || "(anon)") + " " + f.url.split("/").pop() + ":" + f.lineNumber; self.set(key, (self.get(key) ?? 0) + (dt[k] ?? 0)); });
const total = [...self.values()].reduce((a, b) => a + b, 0);
console.log("total ms", (total / 1000).toFixed(0));
for (const [k, v] of [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 22)) console.log((v / 1000).toFixed(0).padStart(6), k);

/*console.log("state:", await ev("(() => { const s = window.__board3d; let n = 0; s.scene.traverse(() => n++); return JSON.stringify({ effects: s.effects.length, objs: n, board: s.board.children.length, geo: s.renderer.info.memory.geometries, tex: s.renderer.info.memory.textures, pulses: s.pulses.length }); })()"));
console.log(await orbit("all", ""));
console.log("state:", await ev("(() => { const s = window.__board3d; let n = 0; s.scene.traverse(() => n++); return JSON.stringify({ effects: s.effects.length, objs: n, board: s.board.children.length, geo: s.renderer.info.memory.geometries, tex: s.renderer.info.memory.textures, pulses: s.pulses.length }); })()"));

console.log(await orbit("again", ""));
console.log("state:", await ev("(() => { const s = window.__board3d; let n = 0; s.scene.traverse(() => n++); return JSON.stringify({ effects: s.effects.length, objs: n, board: s.board.children.length, geo: s.renderer.info.memory.geometries, tex: s.renderer.info.memory.textures, pulses: s.pulses.length }); })()"));
console.log(await orbit("no threat bar", "document.querySelector('.threatbar').style.display = 'none'"));
console.log(await orbit("no bar, no log", "document.querySelector('.game-panel').style.display = 'none'"));
console.log(await orbit("bar back", "document.querySelector('.threatbar').style.display = ''"));
console.log(await orbit("bar w/o blend", "document.querySelectorAll('.threatbar .liquid, .threatbar .flame').forEach(e => e.style.display = 'none')"));

const bench = (label, setup) => ev(`(() => { const s = window.__board3d; const r = s.renderer; const gl = r.getContext(); ${setup};
  const px = new Uint8Array(4); for (let i = 0; i < 5; i++) r.render(s.scene, s.camera); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const t0 = performance.now(); const N = 40; let cpu = 0;
  for (let i = 0; i < N; i++) { s.camera.position.x += 0.01; s.camera.lookAt(s.controls.target); const a = performance.now(); r.render(s.scene, s.camera); cpu += performance.now() - a; }
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const ms = (performance.now() - t0) / N;
  return ${JSON.stringify(label)} + ': ' + ms.toFixed(2) + ' ms/frame (cpu submit ' + (cpu / N).toFixed(2) + '), calls ' + r.info.render.calls + ', textures ' + r.info.memory.textures + ', programs ' + r.info.programs.length; })()`);
console.log(await bench("default", ""));
console.log(await bench("no fog", "s.fog.visible = false"));
console.log(await bench("no fog, no sun shadow", "s.sun.castShadow = false"));
console.log(await bench("fog back, no sun shadow", "s.fog.visible = true"));
console.log(await bench("shadow on, table hidden", "s.sun.castShadow = true; s.table.visible = false"));
console.log(await bench("table back", "s.table.visible = true"));
console.log(await ev("JSON.stringify({ shadowMap: window.__board3d.sun.shadow.mapSize.x, size: [window.__board3d.renderer.domElement.width, window.__board3d.renderer.domElement.height], aa: window.__board3d.renderer.getContext().getContextAttributes().antialias })"));
*/
