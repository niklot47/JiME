// In-game HUD like the original (UI_Game in level2): threat bar with the objective on top, settings button top right,
// bottom bar with the party button, provoke button, enemy tracker and the end-round button; phase banners.
import type { GameView } from "@jime/engine";
import { assetUrl } from "../../data/pack.ts";
import { bg, sliced, spriteUrl, type Atlas, type Say } from "./ui.ts";

// ---------------------------------------------------------------- threat bar
/**
 * UIThreatMeter: frame (Threat_Meter) with the value plate on the right, the fill coloured by ThreatMeterGradient along the
 * track with the liquid texture moving in it and the burning edge, threat event markers (Threat_Event2) in front of the
 * frame at their thresholds, the darkness token on the left while darkness is in effect, the objective under the bar.
 */
export function ThreatBar({ view, art, atlas, say }: { view: GameView; art: Record<string, string>; atlas: Atlas; say: Say }) {
  const max = view.threatMax;
  const frac = max > 0 ? Math.min(1, view.threat / max) : 0;
  const url = (p?: string) => (p ? `url("${assetUrl(p)}")` : undefined);
  const marker = spriteUrl(atlas, "Threat_Event2");
  const dark = spriteUrl(atlas, "DarknessToken");
  const styled = !!art.threatMeter;
  const marks = max > 0 ? view.threatEvents.filter((t) => t > view.threat && t <= max) : [];
  return (
    <div className={`threatbar${styled ? " styled" : ""}`}>
      <div className="meter" title={`Угроза ${view.threat}${max > 0 ? ` из ${max}` : ""}`}>
        {view.darkness && (dark ? <img className="darkness" src={dark} alt="Тьма" title="Тьма" /> : <span className="darkness plain" title="Тьма">●</span>)}
        <div className="track">
          <div className="fill" style={{ width: `${100 * frac}%` }}>
            <div className="ramp" style={{ width: frac > 0 ? `${100 / frac}%` : "100%", backgroundImage: url(art.threatGradient) }} />
            {art.threatLiquid && <div className="liquid" style={{ backgroundImage: url(art.threatLiquid) }} />}
          </div>
          {frac > 0 && art.threatFire && (
            // the burning edge of the fill (ThreatFire); remounted on every change -> flares up
            <span key={view.threat} className="flame" style={{ left: `${100 * frac}%`, backgroundImage: url(art.threatFire) }} />
          )}
        </div>
        {styled && <img className="frame" src={assetUrl(art.threatMeter!)} alt="" />}
        {/* markers sit in front of the frame (Widget_ThreatEvents has a higher depth than the meter) */}
        <div className="marks">
          {marks.map((t, i) => (
            <span key={`${t}:${i}`} className="mark" style={{ left: `${(100 * t) / max}%` }} title={`Событие угрозы на ${t}`}>
              {marker && <img src={marker} alt="" />}<b>{t}</b>
            </span>
          ))}
        </div>
        <span className="value">{view.threat}{max > 0 ? `/${max}` : ""}</span>
      </div>
      <p className="objective" dangerouslySetInnerHTML={{ __html: view.objective ? say(view.objective, view.objectiveInserts) : say("UI_DEFAULT_OBJECTIVE") || "" }} />
    </div>
  );
}

// ---------------------------------------------------------------- phase banner
/** Phase change: the phase name in the game's round plate (Dialog_Round) over the board, then it fades out */
export function PhaseBanner({ text, round, atlas, short, onDone }: {
  text: string; round: number | null; atlas: Atlas; short: boolean; onDone: () => void;
}) {
  return (
    <div className={short ? "phase-banner short" : "phase-banner"} onAnimationEnd={(e) => { if (e.target === e.currentTarget) onDone(); }}>
      <div className={atlas.Dialog_Round ? "plate framed" : "plate"} style={sliced(atlas, "Dialog_Round", 0.5)}>
        {round !== null && <small>Раунд {round}</small>}
        <span dangerouslySetInnerHTML={{ __html: text }} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- round buttons
export function RoundButton({ atlas, sprite, fallback, title, className = "", disabled, onClick }: {
  atlas: Atlas; sprite: string; fallback: string; title: string; className?: string; disabled?: boolean; onClick?: () => void;
}) {
  const has = !!atlas[sprite];
  return (
    <button className={`round-btn ${className}${has ? "" : " plain"}`} style={bg(atlas, sprite)} title={title} aria-label={title}
      disabled={disabled} onClick={onClick}>
      {!has && fallback}
    </button>
  );
}

/** Settings button (top right): the round options plate with the gear icon */
export function GearButton({ atlas, onClick }: { atlas: Atlas; onClick: () => void }) {
  const icon = spriteUrl(atlas, "header_icon_settings");
  return (
    <button className="gear-btn" style={bg(atlas, "Options_Button_toggled")} title="Меню" aria-label="Меню" onClick={onClick}>
      {icon ? <img src={icon} alt="" /> : "⚙"}
    </button>
  );
}

// ---------------------------------------------------------------- bottom bar + enemy tracker
/**
 * The bottom of UI_Game: party button (left corner), the enemy bar (Enemy_Bar) with the provoke button and the enemy
 * medallions (EnemyMiniView: Enemy_Frame_Normal / Enemy_Frame_Elite, portrait on top), end-round button (right corner)
 */
export function BottomBar({ view, atlas, enemyArt, say, attackable, canEndRound, endTitle, busy, onParty, onEnemy, onEndRound }: {
  view: GameView; atlas: Atlas; enemyArt: Record<string, string>; say: Say; attackable: Set<number>; canEndRound: boolean; endTitle: string;
  busy: boolean; onParty: () => void; onEnemy: (uid: number) => void; onEndRound: () => void;
  /** the bar and buttons come from the NGUI layout (NguiHud): only the medallions here */
}) {
  const frame = spriteUrl(atlas, "Enemy_Frame_Normal");
  const elite = spriteUrl(atlas, "Enemy_Frame_Elite");
  const glow = spriteUrl(atlas, "Generic_Circle2");
  const armor = spriteUrl(atlas, "Icon_Armor");
  const strip = text(say);
  return (
    <div className="bottombar">
      <RoundButton atlas={atlas} sprite="Button_Party" fallback="👥" title="Отряд: статус, хроника, предметы" className="party" onClick={onParty} />
      <div className="enemybar" style={bg(atlas, "Enemy_Bar")}>
        <RoundButton atlas={atlas} sprite="Button_Provoke" fallback="!" title="Провокация (пока не реализована)" className="provoke" disabled />
        <div className="tracker">
          {view.enemies.map((e) => {
            const can = attackable.has(e.uid);
            const icon = enemyArt[String(e.model)];
            const hp = Math.max(0, e.unitHp - e.damage);
            return (
              <button key={e.uid} className={`enemy${e.exhausted ? " exhausted" : ""}${e.named ? " named" : ""}${can ? " can" : ""}`}
                title={`${strip(e.name)} ×${e.size} · ${hp}/${e.unitHp}${e.exhausted ? " · истощён" : ""}`} onClick={() => onEnemy(e.uid)}>
                <div className={`medal${frame ? "" : " plain"}`}>
                  {can && glow && <img className="glow" src={glow} alt="" />}
                  {frame && <img className="frame" src={frame} alt="" />}
                  {e.named && elite && <img className="elite" src={elite} alt="" />}
                  {icon ? <img className="portrait" src={assetUrl(icon)} alt="" /> : <div className="noicon">?</div>}
                  {e.size > 1 && <span className="count">{e.size}</span>}
                  {e.armor > 0 && <span className="armor" title="Броня">{armor && <img src={armor} alt="" />}{e.armor}</span>}
                </div>
              </button>
            );
          })}
        </div>
      </div>
      <RoundButton atlas={atlas} sprite="Button_EndRound" fallback="⏳" title={endTitle} className={`endround${canEndRound ? " ready" : ""}`}
        disabled={!canEndRound || busy} onClick={onEndRound} />
    </div>
  );
}

/** Plain text of a localized key (for titles) */
const text = (say: Say) => (key: string) => say(key).replace(/<[^>]+>/g, "");
