// The difficulty page like the original's (CampaignDifficultySelection): the wide adventure card on top, normal and
// hard under it (the two as wide as the top one together with the gap between them). CoroutineShow: the three fly in
// - normal from the left, hard from the right, adventure from above - meet with a knock (a little past their places,
// a short shake) and settle; DifficultyToggle: the chosen one grows above the others and its effects fade in, a
// click on it again unchooses it; Continue waits for a choice. Leaving, they fly out the way they came.
import { useEffect, useState } from "react";
import type { Difficulty } from "@jime/engine";
import { LayeredArt, useLayeredArt } from "./LayeredArt.tsx";
import type { TrKey } from "../../ui/i18n.ts";

/** the entrance (s) before the chosen card's effects may show; the exit */
const ENTER_S = 1.5, LEAVE_S = 0.45;

function Card({ mode, name, cls, on, ready, t, onPick, onGo }: {
  mode: Difficulty; name: TrKey; cls: string; on: boolean; ready: boolean; t: (k: TrKey) => string; onPick: () => void; onGo: () => void;
}) {
  const art = useLayeredArt(`difficulty-${mode}`);
  return (
    <div className={`lo-diff-slot ${cls}`}>
      <button className={`lo-diff${on ? " on" : ""}${art ? " layered" : ""}`} onClick={onPick} onDoubleClick={onGo}>
        {/* the theme's layered picture (ui/art/difficulty-<mode>/), else its flat one (ui/art/difficulty-<mode>.png) */}
        {art ? <LayeredArt art={art} active={on && ready} hoverFx={false} />
          : <span className="lo-diff-art" style={{ backgroundImage: `var(--sk-art-difficulty-${mode}, none)` }} />}
        <b>{t(name)}</b>
      </button>
    </div>
  );
}

export function DifficultyStep({ difficulty, setDifficulty, onBack, onNext, t }: {
  difficulty: Difficulty | null; setDifficulty: (d: Difficulty | null) => void; onBack: () => void; onNext: () => void; t: (k: TrKey) => string;
}) {
  const [ready, setReady] = useState(false);
  const [leaving, setLeaving] = useState(false);
  useEffect(() => { const id = setTimeout(() => setReady(true), ENTER_S * 1000); return () => clearTimeout(id); }, []);
  const leave = (go: () => void) => { if (leaving) return; setLeaving(true); setTimeout(go, LEAVE_S * 1000); };
  const pick = (d: Difficulty) => setDifficulty(difficulty === d ? null : d);
  const name: Record<Difficulty, TrKey> = { adventure: "easy", normal: "normal", hard: "hard" };
  const desc: Record<Difficulty, TrKey> = { adventure: "easyDesc", normal: "normalDesc", hard: "hardDesc" };
  const card = (d: Difficulty, cls: string) => (
    <Card mode={d} name={name[d]} cls={cls} on={difficulty === d} ready={ready && !leaving} t={t}
      onPick={() => pick(d)} onGo={() => { setDifficulty(d); leave(onNext); }} />
  );
  return (
    <div className={`lo-campaign lo-difficulty${leaving ? " leaving" : ""}`}>
      <h2 className="lo-banner"><span>{t("toDifficulty")}</span></h2>
      <div className={`lo-diffs${difficulty ? " chosen" : ""}`}>
        {card("adventure", "wide")}
        {card("normal", "half left")}
        {card("hard", "half right")}
      </div>
      <p className="lo-hint">{difficulty ? <><b>{t(name[difficulty])}.</b> {t(desc[difficulty])}</> : t("diffHint")}</p>
      <button className="lo-corner lo-back" onClick={() => leave(onBack)}><span>{t("back")}</span></button>
      <button className="lo-corner lo-next" disabled={!difficulty} onClick={() => leave(onNext)}><span>{t("toHeroes")}</span></button>
    </div>
  );
}
