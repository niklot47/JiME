// In-game dialogs like the original: the message box (Button_Generic, 9-slice) with green buttons (Button_MessageBox),
// the test stepper (Damage_Holder between orange - / + plates), combat and enemy info (Dialog_EnemyInfo),
// party menu (Dialog_HeroMenu: status / chronicle / items) and the settings menu. All text comes from the game's
// localization when it has a key, else Russian UI text.
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Answer, Decision, GameView, LogEntry } from "@jime/engine";
import { assetUrl } from "../../data/pack.ts";
import { SoundPanel } from "../../audio/SoundPanel.tsx";
import { GLYPH, bg, resultText, sliced, spriteUrl, type Atlas, type Say } from "./ui.ts";

/** Dark message box at the top of the board (the original's dialog) */
export function MessageBox({ atlas, children, wide }: { atlas: Atlas; children: ReactNode; wide?: boolean }) {
  return <div className={`msgbox${wide ? " wide" : ""}`} style={sliced(atlas, "Button_Generic", 0.5)}>{children}</div>;
}

/** Green dialog button (Button_MessageBox); arrow: the "➔" of choices */
export function GreenButton({ atlas, onClick, children, arrow, disabled, html }: {
  atlas: Atlas; onClick: () => void; children?: ReactNode; arrow?: boolean; disabled?: boolean; html?: string;
}) {
  const props = html !== undefined ? { dangerouslySetInnerHTML: { __html: (arrow ? "➔ " : "") + html } } : { children: <>{arrow && "➔ "}{children}</> };
  return <button className="green-btn" style={sliced(atlas, "Button_MessageBox", 0.45)} disabled={disabled} onClick={onClick} {...props} />;
}

const say0 = (say: Say, key: string, fallback: string) => say(key) || fallback;

// ---------------------------------------------------------------- messages
/** One unread log message with Continue (and skip-all when several are waiting) */
export function MessageDialog({ atlas, say, entry, left, onNext, onSkipAll }: {
  atlas: Atlas; say: Say; entry: LogEntry; left: number; onNext: () => void; onSkipAll: () => void;
}) {
  return (
    <div className="dialog-area">
      <MessageBox atlas={atlas}><p className="text" dangerouslySetInnerHTML={{ __html: say(entry[2], entry[3]) }} /></MessageBox>
      <div className="dialog-buttons">
        <GreenButton atlas={atlas} onClick={onNext}>{say0(say, "UI_CONTINUE", "Продолжить")}</GreenButton>
        {left > 1 && <button className="link skip" onClick={onSkipAll}>пропустить все ({left})</button>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- tests and numbers
/** The original's number input: orange − / + around the medallion with the value, Confirm under it */
export function NumberInput({ atlas, icon, okText, onOk }: { atlas: Atlas; icon?: string; okText: string; onOk: (n: number) => void }) {
  const [n, setN] = useState(0);
  const holder = spriteUrl(atlas, "Damage_Holder");
  return (
    <div className="numinput">
      <div className="row center">
        <button className="side minus" style={bg(atlas, "Button_Arrowless")} onClick={() => setN((v) => Math.max(0, v - 1))} aria-label="меньше">−</button>
        <div className="holder" style={holder ? { backgroundImage: `url("${holder}")` } : undefined}>
          <b>{n}</b>{icon && <span className="glyph">{icon}</span>}
        </div>
        <button className="side plus" style={bg(atlas, "Button_Arrowless")} onClick={() => setN((v) => v + 1)} aria-label="больше">+</button>
      </div>
      <GreenButton atlas={atlas} onClick={() => onOk(n)}>{okText}</GreenButton>
    </div>
  );
}

// ---------------------------------------------------------------- decisions
export function DecisionDialog({ d, view, atlas, say, enemyArt, onAnswer }: {
  d: Decision; view: GameView; atlas: Atlas; say: Say; enemyArt: Record<string, string>; onAnswer: (a: Answer) => void;
}) {
  const prompt = "inserts" in d && d.key ? <p className="text" dangerouslySetInnerHTML={{ __html: say(d.key, d.inserts) }} /> : null;
  const confirm = say0(say, "UI_CONFIRM", "Подтвердить");
  const cancel = say0(say, "UI_CANCEL", "Отмена");
  switch (d.kind) {
    case "choice":
      return (
        <div className="dialog-area">
          {prompt && <MessageBox atlas={atlas}>{prompt}</MessageBox>}
          <div className={`dialog-buttons grid${d.choices.length + (d.canCancel ? 1 : 0) > 2 ? " two" : ""}`}>
            {d.choices.map((c, i) => <GreenButton key={i} atlas={atlas} arrow onClick={() => onAnswer(i)} html={say(c.key, c.inserts) || `#${i + 1}`} />)}
            {d.canCancel && <GreenButton atlas={atlas} onClick={() => onAnswer(null)}>{cancel}</GreenButton>}
          </div>
        </div>
      );
    case "test":
      return (
        <div className="dialog-area">
          {prompt && <MessageBox atlas={atlas}>{prompt}</MessageBox>}
          <p className="hint">Сколько <span className="glyph">{GLYPH.success}</span> успехов? <span className="muted">(важно до {d.top})</span></p>
          <NumberInput atlas={atlas} icon={GLYPH.success} okText={confirm} onOk={onAnswer} />
        </div>
      );
    case "attack":
      return (
        <div className="dialog-area">
          <EnemyCard atlas={atlas} say={say} art={enemyArt} enemy={view.enemies.find((e) => e.uid === d.uid) ?? null} title={d.enemy} />
          <p className="hint">Нанесённый урон <span className="glyph">{GLYPH.damage}</span></p>
          <NumberInput atlas={atlas} icon={GLYPH.damage} okText={say0(say, "UI_RESOLVE_ATTACK", "Применить")} onOk={onAnswer} />
        </div>
      );
    case "confirm":
      return (
        <div className="dialog-area">
          {prompt && <MessageBox atlas={atlas}>{prompt}</MessageBox>}
          <div className="dialog-buttons">
            <GreenButton atlas={atlas} onClick={() => onAnswer(true)}>Да</GreenButton>
            <GreenButton atlas={atlas} onClick={() => onAnswer(false)}>Нет</GreenButton>
          </div>
        </div>
      );
    case "lastStand":
      return (
        <div className="dialog-area">
          <MessageBox atlas={atlas}>
            <h3>Последний рубеж: Герой {d.hero + 1} ({d.physical ? "урон" : "страх"})</h3>
            {d.key && <p className="text" dangerouslySetInnerHTML={{ __html: say(d.key, d.inserts) }} />}
          </MessageBox>
          <div className="dialog-buttons">
            <GreenButton atlas={atlas} onClick={() => onAnswer(true)}>Пройден</GreenButton>
            <GreenButton atlas={atlas} onClick={() => onAnswer(false)}>Провален</GreenButton>
          </div>
        </div>
      );
    case "lastStandType":
      return (
        <div className="dialog-area">
          <MessageBox atlas={atlas}><p className="text" dangerouslySetInnerHTML={{ __html: say0(say, "UI_CHOOSE_LAST_STAND", "От чего герой повержен?") }} /></MessageBox>
          <div className="dialog-buttons">
            <GreenButton atlas={atlas} onClick={() => onAnswer(true)} html={say0(say, "UI_PHYSICAL", "Урон")} />
            <GreenButton atlas={atlas} onClick={() => onAnswer(false)} html={say0(say, "UI_FEAR", "Страх")} />
          </div>
        </div>
      );
    case "hero":
      return (
        <div className="dialog-area">
          {prompt && <MessageBox atlas={atlas}>{prompt}</MessageBox>}
          <div className="dialog-buttons">
            {Array.from({ length: d.players }, (_, i) => <GreenButton key={i} atlas={atlas} onClick={() => onAnswer({ player: i, skip: false })}>Герой {i + 1}</GreenButton>)}
            {d.canSkip && <GreenButton atlas={atlas} onClick={() => onAnswer({ player: 0, skip: true })}>Пропустить</GreenButton>}
          </div>
        </div>
      );
    case "action":
      return null; // the board, the tracker and the end-round button answer it
  }
}

// ---------------------------------------------------------------- enemies
type EnemyView = GameView["enemies"][number];

/** Head of Dialog_EnemyInfo: portrait medallion, name, one health bar per figure */
export function EnemyCard({ atlas, say, art, enemy, title }: { atlas: Atlas; say: Say; art: Record<string, string>; enemy: EnemyView | null; title: string }) {
  const frame = spriteUrl(atlas, "Enemy_Frame_Normal");
  const icon = enemy ? art[String(enemy.model)] : undefined;
  const bars = enemy ? Array.from({ length: enemy.size }, (_, i) => (i === 0 ? Math.max(0, enemy.unitHp - enemy.damage) : enemy.unitHp)) : [];
  return (
    <div className="enemy-card" style={sliced(atlas, "Enemy_9_Slice", 0.5)}>
      <div className="head">
        <div className="medal">
          {frame && <img className="frame" src={frame} alt="" />}
          {icon && <img className="portrait" src={assetUrl(icon)} alt="" />}
        </div>
        <div>
          <h3 dangerouslySetInnerHTML={{ __html: say(title) }} />
          <p className="muted">{enemy?.armor ? `Броня ${enemy.armor}` : "Без бонусов"}{enemy?.exhausted ? " · истощён" : ""}</p>
        </div>
      </div>
      {enemy && bars.map((hp, i) => (
        <div key={i} className="unit">
          <span className="hpnum">{hp}/{enemy.unitHp}</span>
          <div className="bar" style={bg(atlas, "Enemy_HealthBarBG")}>
            {Array.from({ length: enemy.unitHp }, (_, k) => <i key={k} className={k < hp ? "on" : ""} />)}
          </div>
        </div>
      ))}
    </div>
  );
}

export function EnemyInfoDialog({ atlas, say, art, enemy, canAttack, onAttack, onClose }: {
  atlas: Atlas; say: Say; art: Record<string, string>; enemy: EnemyView; canAttack: boolean; onAttack: () => void; onClose: () => void;
}) {
  const sword = spriteUrl(atlas, "Button_CombatDialog");
  return (
    <div className="modal" onClick={onClose}>
      <div className="modal-body row center" onClick={(e) => e.stopPropagation()}>
        <EnemyCard atlas={atlas} say={say} art={art} enemy={enemy} title={enemy.name} />
        {canAttack && (
          <button className="attack-btn" style={sword ? { backgroundImage: `url("${sword}")` } : undefined} title={say("UI_ATTACK") || "Атака"} onClick={onAttack}>
            {!sword && "⚔"}
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- party menu
export function PartyDialog({ view, atlas, say, log, items, lastStands, onLastStand, onClose }: {
  view: GameView; atlas: Atlas; say: Say; log: readonly LogEntry[]; items: { id: number; key: string | null; name: string }[];
  /** hero -> action option of a last stand available now */
  lastStands: Map<number, number>; onLastStand: (option: number) => void; onClose: () => void;
}) {
  const [tab, setTab] = useState<"status" | "chronicle" | "items">("status");
  const tabs: [typeof tab, string][] = [["status", "Статус"], ["chronicle", say("UI_CHRONICLE") || "Хроника"], ["items", say("UI_INVENTORY") || "Снаряжение"]];
  const skull = spriteUrl(atlas, "Icon_Skull");
  return (
    <div className="modal" onClick={onClose}>
      <div className="modal-body party" onClick={(e) => e.stopPropagation()}>
        <div className="tabs">
          {tabs.map(([k, label]) => (
            <button key={k} className={k === tab ? "on" : ""} style={sliced(atlas, "Button_MessageBox", 0.45)} onClick={() => setTab(k)}>{label}</button>
          ))}
        </div>
        <div className="panel" style={bg(atlas, "Dialog_HeroMenu")}>
          {tab === "status" && (
            <>
              <div className="lore" style={bg(atlas, "Frame_Lore")}><span>{(say("UI_LORE") || "Сведения:").replace(/:?$/, ":")}</span> <b>{view.campaign.lore}</b></div>
              <p className="muted xp">Опыт кампании: {view.campaign.xp}</p>
              <div className="heroes">
                {view.heroes.map((h, i) => (
                  <div key={i} className={h.defeated ? "hero down" : "hero"} style={sliced(atlas, "HeroFrame", 0.35)}>
                    <b>Герой {i + 1}</b>
                    {/* Sprite_LastStand: skull with the next last stand difficulty; a button while a last stand can be made */}
                    <button className="laststand" style={sliced(atlas, "Frame_Empty", 0.5)} disabled={!lastStands.has(i)}
                      title={lastStands.has(i) ? "Провести последний рубеж" : "Сложность следующего последнего рубежа"}
                      onClick={() => onLastStand(lastStands.get(i)!)}>
                      {skull && <img src={skull} alt="" />}{h.defeated ? "повержен" : h.lastStand}
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
          {tab === "chronicle" && <Chronicle log={log} say={say} atlas={atlas} />}
          {tab === "items" && (
            <ul className="items">
              {items.length ? items.map((it) => <li key={it.id} style={sliced(atlas, "StartingItemFrame", 0.4)}>{(it.key && say(it.key)) || it.name}</li>)
                : <li className="muted">Пока нет предметов кампании.</li>}
            </ul>
          )}
        </div>
        <GreenButton atlas={atlas} onClick={onClose}>{say("UI_RESUME") || "Продолжить"}</GreenButton>
      </div>
    </div>
  );
}

function Chronicle({ log, say, atlas }: { log: readonly LogEntry[]; say: Say; atlas: Atlas }) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [log.length]);
  const items: ReactNode[] = [];
  let round = 0;
  log.forEach(([, r, key, ins], i) => {
    if (r !== round) { round = r; items.push(<div key={`r${i}`} className="round">Раунд {r}</div>); }
    const html = say(key, ins);
    if (html) items.push(<p key={i} dangerouslySetInnerHTML={{ __html: html }} />);
  });
  return <div className="chronicle" style={sliced(atlas, "Dialog_Chronicle", 0.5)}>{items}<div ref={end} /></div>;
}

// ---------------------------------------------------------------- settings
export function SettingsDialog({ atlas, say, view3d, labels, canUndo, onView3d, onLabels, onUndo, onSave, onQuit, onClose }: {
  atlas: Atlas; say: Say; view3d: boolean; labels: boolean; canUndo: boolean;
  onView3d: (v: boolean) => void; onLabels: (v: boolean) => void; onUndo: () => void; onSave: () => void; onQuit: () => void; onClose: () => void;
}) {
  return (
    <div className="modal" onClick={onClose}>
      <div className="modal-body settings" style={bg(atlas, "Dialog_HeroMenu")} onClick={(e) => e.stopPropagation()}>
        <h3>Меню</h3>
        <label className="check"><input type="checkbox" checked={view3d} onChange={(e) => onView3d(e.target.checked)} /> 3D-доска</label>
        <label className="check"><input type="checkbox" checked={labels} onChange={(e) => onLabels(e.target.checked)} /> Названия жетонов</label>
        <SoundPanel />
        <div className="dialog-buttons">
          <GreenButton atlas={atlas} disabled={!canUndo} onClick={onUndo}>↶ Отменить ход</GreenButton>
          <GreenButton atlas={atlas} onClick={onSave}>Сохранить в файл</GreenButton>
          <GreenButton atlas={atlas} onClick={onQuit}>Выйти из партии</GreenButton>
          <GreenButton atlas={atlas} onClick={onClose}>{say("UI_RESUME") || "Продолжить"}</GreenButton>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- end of the game
export function GameOverDialog({ view, atlas, onQuit }: { view: GameView; atlas: Atlas; onQuit: () => void }) {
  return (
    <div className="dialog-area">
      <MessageBox atlas={atlas}>
        <h3>{resultText(view) || "Игра окончена"}</h3>
        <p className="text">Раунд {view.round} · сведения {view.campaign.lore} · опыт {view.campaign.xp}</p>
      </MessageBox>
      <div className="dialog-buttons"><GreenButton atlas={atlas} onClick={onQuit}>В меню партий</GreenButton></div>
    </div>
  );
}
