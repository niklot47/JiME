import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";

// Dev-time access to locally imported packs (FFG content never goes into the build):
// GET /packs/<pack-id>/<path> -> $JIME_PACKS | $JIME_WORK/packs | <repo>/data/packs
const packsDir = process.env.JIME_PACKS ?? join(process.env.JIME_WORK ?? resolve(__dirname, "../../data"), "packs");
const TYPES: Record<string, string> = { ".json": "application/json", ".jpg": "image/jpeg", ".png": "image/png", ".csv": "text/csv; charset=utf-8", ".ttf": "font/ttf" };

function servePacks(): Plugin {
  return {
    name: "jime-packs",
    configureServer(server) {
      server.middlewares.use("/packs", (req, res, next) => {
        const rel = normalize(decodeURIComponent((req.url ?? "/").split("?")[0]!)).replace(/^([/\\])+/, "");
        const file = join(packsDir, rel);
        if (!file.startsWith(packsDir) || !existsSync(file) || !statSync(file).isFile()) return next();
        res.setHeader("Content-Type", TYPES[extname(file)] ?? "application/octet-stream");
        createReadStream(file).pipe(res);
      });
    },
  };
}

// Tauri expects a fixed port and no screen clearing
export default defineConfig({
  plugins: [react(), servePacks()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  envPrefix: ["VITE_", "TAURI_ENV_"],
  build: { target: "es2022", outDir: "dist" },
  // the game worker imports the engine as ES modules
  worker: { format: "es" },
});
