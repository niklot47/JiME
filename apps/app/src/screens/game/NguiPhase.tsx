// The original's phase banner (UI_Game/NewPhase, NewRoundVisual) from the exported layout: the phase title on the
// banner, shown like GameController's round flow: fade + scale in (0.5 s), 2 s on screen, fade out; then the next.
import { NguiView } from "../../ngui/NguiView.tsx";
import { findNode, type UiLayoutFile } from "../../ngui/types.ts";
import type { Atlas, Say } from "./ui.ts";

export function NguiPhase({ layout, atlas, say, phaseKey, short, onDone }: {
  layout: UiLayoutFile; atlas: Atlas; say: Say; phaseKey: string;
  /** more phases queued (ending a round passes several): a quicker banner */
  short: boolean; onDone: () => void;
}) {
  const node = findNode(layout.root, "UI_Game/NewPhase");
  if (!node) return null;
  return (
    <div className={short ? "ng-phase short" : "ng-phase"} onAnimationEnd={(e) => { if (e.target === e.currentTarget) onDone(); }}>
      <NguiView layout={layout} atlas={atlas} show={[node]} say={say} className="ngui-phase"
        binds={{ NewPhase: { show: true }, Label_Phase: { html: say(phaseKey) } }} />
    </div>
  );
}
