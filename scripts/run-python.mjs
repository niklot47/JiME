// Run a Python script with whatever interpreter is available (python3 on Linux, python/py on Windows)
import { spawnSync } from "node:child_process";
const args = process.argv.slice(2);
for (const exe of ["python3", "python", "py"]) {
  const r = spawnSync(exe, args, { stdio: "inherit" });
  if (r.error && r.error.code === "ENOENT") continue;
  process.exit(r.status ?? 1);
}
console.error("Python not found (tried python3, python, py)");
process.exit(1);
