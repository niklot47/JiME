// Run a Python script with whatever interpreter is available (python3 on Linux, python/py on Windows)
import { spawnSync } from "node:child_process";
const args = process.argv.slice(2);
// On Windows "python3" may be the Store stub, so try "python" first there
for (const exe of process.platform === "win32" ? ["python", "py", "python3"] : ["python3", "python", "py"]) {
  const r = spawnSync(exe, args, { stdio: "inherit" });
  if (r.error && r.error.code === "ENOENT") continue;
  process.exit(r.status ?? 1);
}
console.error("Python not found (tried python3, python, py)");
process.exit(1);
