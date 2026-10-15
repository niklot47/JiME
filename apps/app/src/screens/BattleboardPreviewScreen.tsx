// Dev screen: the battleboard of any battleboard adventure (AdventureModel.Type = 1) with its BoardSettings
import { useEffect, useState } from "react";
import { loadDb } from "../data/pack.ts";
import { Battleboard3D, type BoardSetup } from "../board/Battleboard3D.tsx";

/** BattleboardSettings.RiverCornerFlags is exported as the repr of a Python bytes value */
function riverFlags(v: unknown): boolean[] {
  if (Array.isArray(v)) return v.map(Boolean);
  const s = String(v ?? "");
  const m = /^b'(.*)'$/s.exec(s);
  const out: boolean[] = [];
  if (m) for (const x of m[1]!.matchAll(/\\x([0-9a-f]{2})|./gs)) out.push(x[1] ? parseInt(x[1], 16) !== 0 : x[0] !== "\0");
  while (out.length < 16) out.push(false);
  return out;
}

export const boardsOf = (model: any): BoardSetup[] =>
  (model?.BoardSettings ?? [{}]).map((b: any) => ({ skin: Number(b?.Skin ?? 0), rivers: riverFlags(b?.RiverCornerFlags) }));

export function BattleboardPreviewScreen({ onBack }: { onBack: () => void }) {
  const [advs, setAdvs] = useState<any[]>([]);
  const [adv, setAdv] = useState<number | null>(null);
  const [rain, setRain] = useState(0);
  useEffect(() => {
    void loadDb().then((db: any) => {
      const list = Object.values(db.models.AdventureModel).filter((a: any) => Number(a.Type) === 1)
        .sort((a: any, b: any) => a._id - b._id);
      setAdvs(list);
      setAdv((list[0] as any)?._id ?? null);
    });
  }, []);
  const model = advs.find((a) => a._id === adv);
  return (
    <div style={{ position: "fixed", inset: 0, background: "#111" }}>
      {model && <Battleboard3D boards={boardsOf(model)} weather={[rain, rain]} />}
      <div style={{ position: "absolute", left: 8, top: 8, display: "flex", gap: 8, zIndex: 2 }}>
        <button onClick={onBack}>← Назад</button>
        <select value={adv ?? ""} onChange={(e) => setAdv(Number(e.target.value))}>
          {advs.map((a) => (
            <option key={a._id} value={a._id}>{a.m_Name} — {boardsOf(a).map((b) => ["лес", "карьер", "город"][b.skin]).join(" + ")}</option>
          ))}
        </select>
        <select value={rain} onChange={(e) => setRain(Number(e.target.value))}>
          <option value={0}>без дождя</option><option value={1}>лёгкий дождь</option><option value={2}>сильный дождь</option>
        </select>
      </div>
    </div>
  );
}
