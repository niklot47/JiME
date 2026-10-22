// Dev screen: any part of the game's NGUI interface drawn from the exported layout, to compare with the original
import { useEffect, useMemo, useState } from "react";
import { installFonts, loadText, loadUiAtlas, loadUiLayout, type AtlasSprite } from "../data/pack.ts";
import { textHtml } from "../text/markup.ts";
import type { TextDb } from "@jime/content-tools/text";
import { NguiView } from "../ngui/NguiView.tsx";
import { findNode, type UiLayoutFile, type UiNode } from "../ngui/types.ts";

/** Nodes worth previewing: the children of the big UI groups */
function candidates(root: UiNode): UiNode[] {
  const out: UiNode[] = [];
  const groups = ["UI Root", "UI_SharedGameWorldmap", "UI_Game", "UI_Map", "UI_Rest", "Page_Menu", "Panel_Titlescreen", "GameSetup", "UI_Cutscene", "Panel_Options"];
  for (const g of groups) {
    const n = g === "UI Root" ? root : findNode(root, g);
    if (!n) continue;
    out.push(n);
    for (const c of n.ch ?? []) if (c.w || c.ch?.length) out.push(c);
  }
  return [...new Map(out.map((n) => [n.id, n])).values()];
}

export function UiPreviewScreen({ onBack }: { onBack: () => void }) {
  const [layout, setLayout] = useState<UiLayoutFile | null>(null);
  const [atlas, setAtlas] = useState<Record<string, AtlasSprite>>({});
  const [text, setText] = useState<TextDb | null>(null);
  const [pick, setPick] = useState<number | null>(null);
  const [all, setAll] = useState(false);
  useEffect(() => {
    void installFonts();
    void loadUiLayout().then(setLayout);
    void loadUiAtlas().then(setAtlas);
    void loadText("ru").then(setText);
  }, []);
  const list = useMemo(() => (layout ? candidates(layout.root) : []), [layout]);
  const node = list.find((n) => n.id === pick) ?? null;
  const say = (k: string | null | undefined, ins: readonly string[] = []) => (k && text ? textHtml(text, k, ins, null) || k : k ?? "");
  if (!layout) return <div className="shell"><button className="link" onClick={onBack}>← Меню</button><p className="muted">Нет выгрузки интерфейса (images/ui/layouts/ui.json) — нужен импорт.</p></div>;
  return (
    <div className="ui-preview">
      <div className="ui-preview-bar">
        <button className="link" onClick={onBack}>← Меню</button>
        <select value={pick ?? ""} onChange={(e) => setPick(e.target.value ? Number(e.target.value) : null)}>
          <option value="">— часть интерфейса —</option>
          {list.map((n) => <option key={n.id} value={n.id}>{n.n}{n.on === false ? " (скрыт)" : ""}</option>)}
        </select>
        <label className="check"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> показать скрытые части</label>
      </div>
      <div className="ui-preview-stage">
        {node && <NguiView layout={layout} atlas={atlas} show={[node]} binds={{}} say={say} all={all} />}
      </div>
    </div>
  );
}
