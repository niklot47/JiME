import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";

// Dev-time access to locally imported packs (FFG content never goes into the build):
// GET /packs/<pack-id>/<path> -> $JIME_PACKS | $JIME_WORK/packs | <repo>/data/packs
// GET /packs/__list.json, /packs/<dir>/__index.json -> listings for the pack manager (same as the Tauri scheme)
const packsDir = process.env.JIME_PACKS ?? join(process.env.JIME_WORK ?? resolve(__dirname, "../../data"), "packs");
const TYPES: Record<string, string> = { ".ogg": "audio/ogg", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".json": "application/json", ".jpg": "image/jpeg", ".png": "image/png", ".csv": "text/csv; charset=utf-8", ".ttf": "font/ttf" };

function servePacks(): Plugin {
  return {
    name: "jime-packs",
    configureServer(server) {
      server.middlewares.use("/packs", (req, res, next) => {
        const rel = normalize(decodeURIComponent((req.url ?? "/").split("?")[0]!)).replace(/^([/\\])+/, "");
        const json = (data: unknown) => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(data)); };
        if (rel === "__list.json") {
          const dirs = existsSync(packsDir) ? readdirSync(packsDir).filter((d) => !d.startsWith(".") && statSync(join(packsDir, d)).isDirectory()).sort() : [];
          return json(dirs.map((dir) => {
            let manifest = null;
            try { manifest = JSON.parse(readFileSync(join(packsDir, dir, "pack.json"), "utf8")); } catch { /* no or bad pack.json */ }
            return { dir, manifest };
          }));
        }
        const idx = /^([^/\\]+)[/\\]__index\.json$/.exec(rel);
        if (idx) {
          const base = join(packsDir, idx[1]!);
          if (!existsSync(base)) return next();
          const out: string[] = [];
          const walk = (d: string, pre: string) => {
            for (const n of readdirSync(d)) statSync(join(d, n)).isDirectory() ? walk(join(d, n), `${pre}${n}/`) : out.push(pre + n);
          };
          walk(base, "");
          return json(out.sort());
        }
        const file = join(packsDir, rel);
        if (!file.startsWith(packsDir) || !existsSync(file) || !statSync(file).isFile()) return next();
        res.setHeader("Content-Type", TYPES[extname(file)] ?? "application/octet-stream");
        createReadStream(file).pipe(res);
      });
    },
  };
}

// Tauri expects a fixed port and no screen clearing
// app version for the title screen (package.json, kept equal to tauri.conf.json)
const APP_VERSION = JSON.parse(readFileSync(resolve(__dirname, "package.json"), "utf8")).version as string;

export default defineConfig({
  plugins: [react(), servePacks()],
  define: { __APP_VERSION__: JSON.stringify(APP_VERSION) },
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  envPrefix: ["VITE_", "TAURI_ENV_"],
  build: { target: "es2022", outDir: "dist" },
  // the game worker imports the engine as ES modules
  worker: { format: "es" },
});
