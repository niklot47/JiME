// Drive the Tauri WebView2 window over the Chrome DevTools Protocol (dev check, no deps).
// Start the app with: $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222"; pnpm tauri dev
// Example: node tools/dev/cdp.mjs tools/dev/cdp-smoke.js data/out/smoke  (screenshots: data/out/smoke_*.png)
// Usage: node cdp.mjs <script.js> <out-prefix>   (script.js: async body with `ev(expr)`, `shot(name)`, `sleep(ms)`, raw `send(method, params)`)
import { readFileSync, writeFileSync } from "node:fs";
const [, , scriptFile, out = "shot"] = process.argv;
const targets = await (await fetch("http://127.0.0.1:9222/json")).json();
const page = targets.find((t) => t.type === "page" && !t.url.startsWith("devtools"));
if (!page) { console.log("no page", targets.map((t) => t.url)); process.exit(1); }
console.log("page:", page.url);
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let id = 0; const wait = new Map();
ws.addEventListener("message", (m) => { const d = JSON.parse(m.data); if (d.id && wait.has(d.id)) { wait.get(d.id)(d); wait.delete(d.id); } });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; wait.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); return r.result?.result?.value ?? r.result?.exceptionDetails?.exception?.description ?? r; };
const shot = async (name) => { const r = await send("Page.captureScreenshot", { format: "png" }); writeFileSync(`${out}_${name}.png`, Buffer.from(r.result.data, "base64")); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const body = readFileSync(scriptFile, "utf8");
await new (Object.getPrototypeOf(async function () {}).constructor)("ev", "shot", "sleep", "send", body)(ev, shot, sleep, send);
ws.close();
