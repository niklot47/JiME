// Progress of a pack zip export / import (events from src-tauri/src/packzip.rs)
import { useEffect, useState } from "react";
import { onPackZip, type PackZipProgress } from "../data/host.ts";

/** Latest progress while `active`; reset when it turns on */
export function usePackZipProgress(active: boolean): PackZipProgress | null {
  const [p, setP] = useState<PackZipProgress | null>(null);
  useEffect(() => {
    if (!active) return;
    setP(null);
    const off = onPackZip(setP);
    return () => { void off.then((f) => f()); };
  }, [active]);
  return active ? p : null;
}

export function PackZipBar({ p, label }: { p: PackZipProgress | null; label: string }) {
  const pct = p && p.total ? (100 * p.done) / p.total : 0;
  return (
    <div className="progress">
      <div className="bar"><div style={{ width: `${pct}%` }} /></div>
      <span>{label}{p ? `: ${p.done} из ${p.total} файлов` : "…"}</span>
    </div>
  );
}
