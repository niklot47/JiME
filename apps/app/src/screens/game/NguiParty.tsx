// The original's party menu (UI_Game/Dialog_HeroMenu) drawn from the exported layout, driven like
// FFG.JIME.UIHeroMenuDialog + UIHeroPortrait (decompiled code): tabs Status / Chronicle / Inventory.
// Status: lore, one portrait per hero (grey when defeated, last stand difficulty from 2), a click on a portrait asks
// "<hero> makes a last stand?" in the menu's own popup (MessagePopup_New) and then starts it.
// Chronicle: the adventure's rounds and the messages of the chosen round (the game fills both lists from prefabs that
// are not in the scene: drawn here inside the list frames). Inventory: the party's heroes / the group's items.
import { useState } from "react";
import type { GameView, LogEntry } from "@jime/engine";
import { NguiView, type Binds } from "../../ngui/NguiView.tsx";
import { findNode, type UiLayoutFile } from "../../ngui/types.ts";
import type { Atlas, Say } from "./ui.ts";

type Tab = "status" | "chronicle" | "inventory";
const TAB_X: Record<Tab, number> = { status: -185.141, chronicle: 7.93, inventory: 201.071 }; // Table_Tabs children
const TOP: [number, number] = [0, 216]; // MessagePopup placement Top, as in NguiMessage
const HEROES = 5;

export interface PartyHero { id: number; name: string; icon?: string; portrait?: string }

export function NguiParty({ layout, atlas, say, view, log, party, advName, items, lastStands, onLastStand, onClose }: {
  layout: UiLayoutFile; atlas: Atlas; say: Say; view: GameView; log: readonly LogEntry[]; party: PartyHero[];
  advName: string | null; items: { id: number; key: string | null; name: string }[];
  /** hero -> action option of a last stand available now */
  lastStands: Map<number, number>; onLastStand: (option: number) => void; onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>("status");
  const [round, setRound] = useState(view.round);
  const [heroInv, setHeroInv] = useState(false);
  const [asking, setAsking] = useState<number | null>(null);
  const menu = findNode(layout.root, "UI_Game/Dialog_HeroMenu");
  if (!menu) return null;
  const heroName = (i: number) => (party[i]?.name ? say(party[i]!.name) : "") || `Герой ${i + 1}`;

  const b: Binds = {
    Dialog_HeroMenu: { show: true },
    Sprite_Selected: { at: [TAB_X[tab], 0] },
    Tab_Status: { onClick: () => setTab("status") },
    Tab_Chronicle: { onClick: () => { setTab("chronicle"); setRound(view.round); } },
    Tab_Inventory: { onClick: () => setTab("inventory") },
    Parent_HeroStatus: { show: tab === "status" },
    Parent_Chronicle: { show: tab === "chronicle" },
    Parent_Inventory: { show: tab === "inventory" },
    z_InputBlocker: { show: false },
    "Label_LoreValue (1)": { text: String(view.campaign.lore) },
  };

  // ---- status: UIHeroPortrait per player
  for (let i = 0; i < HEROES; i++) {
    const f = `Sprite_HeroFrame (${i})`;
    const h = view.heroes[i];
    if (!h) { b[f] = { show: false }; continue; }
    const can = lastStands.has(i) && !h.defeated;
    b[f] = { show: true, onClick: can ? () => setAsking(i) : undefined, disabled: !can,
      title: h.defeated ? "Повержен" : can ? "Провести проверку на стойкость (последний рубеж)" : undefined };
    b[`${f}//Texture_Hero`] = { ...(party[i]?.portrait ? { tex: party[i]!.portrait } : {}), color: h.defeated ? [0.5, 0.5, 0.5, 1] : undefined };
    b[`${f}//Label_HeroName`] = { html: heroName(i) };
    b[`${f}//Sprite_Corruption`] = { show: false }; // corruption (Shadowed Paths) is not modelled
    b[`${f}//Sprite_LastStand`] = { show: h.lastStand > 1 };
    b[`${f}//Label_Difficulty`] = { text: String(h.lastStand) };
  }

  // ---- chronicle: rounds of this adventure, messages of the chosen one (MessageCache.GetMessages)
  const adv = log.length ? log[log.length - 1]![0] : 0;
  const shown = (e: LogEntry) => e[0] === adv && !e[2].startsWith("RULE:") && !!say(e[2], e[3]);
  const rounds = [...new Set(log.filter(shown).map((e) => e[1]))].sort((x, y) => x - y);
  const messages = log.filter((e) => shown(e) && e[1] === round);
  b.Label_AdventureName = { html: advName ? say(advName) : "" };
  b.Button_PageAdventureLeft = { show: false };
  b.Button_PageAdventureRight = { show: false };
  b.ScrollView_RoundLog = { show: false };
  b["Sprite_RoundList/Sprite_Highlight"] = { show: false };
  b["Sprite_RoundList/Widget_Scroller"] = {
    content: (
      <div className="ng-list ng-rounds">
        {rounds.map((r) => (
          <button key={r} className={r === round ? "on" : ""} onClick={() => setRound(r)}
            dangerouslySetInnerHTML={{ __html: say("UI_ROUND_X", [String(r)]) || `Раунд ${r}` }} />
        ))}
      </div>
    ),
  };
  b.ScrollView_MessageLog = { show: false };
  b["Sprite_MessageLog/Widget_Scroller"] = {
    content: messages.length ? (
      <div className="ng-list ng-messages">
        {messages.map((e, i) => <p key={i} dangerouslySetInnerHTML={{ __html: say(e[2], e[3]) }} />)}
      </div>
    ) : undefined,
  };
  b.Label_NoMessages = { show: messages.length === 0 };

  // ---- inventory: heroes (their own cards are not modelled) / the group's campaign items
  b.Option_Hero = { onClick: () => setHeroInv(true) };
  b.Option_Group = { onClick: () => setHeroInv(false) };
  b["Sprite_Tabs/Sprite_Selected"] = { at: [heroInv ? -60 : 60, 1] };
  b.Content_HeroInventory = { show: heroInv };
  b.Content_GroupInventory = {
    show: !heroInv,
    content: (
      <div className="ng-list ng-items">
        {items.length ? items.map((it) => <div key={it.id} className="ng-item">{(it.key && say(it.key)) || it.name}</div>)
          : <p className="ng-none">Нет предметов</p>}
      </div>
    ),
  };
  b["Scroll View"] = { show: false };
  for (let i = 0; i < HEROES; i++) {
    const r = `Hero_Items (${i})`;
    if (!view.heroes[i]) { b[r] = { show: false }; continue; }
    b[r] = { show: true, ...(party[i]?.icon ? { tex: party[i]!.icon } : {}), title: heroName(i) };
    // ItemMiniView slots without an item: "None selected"
    b[`${r}//Label_ItemName`] = { show: false };
    b[`${r}//Label_NoneSelected`] = { show: true };
    b[`${r}//Sprite_Level`] = { show: false };
    b[`${r}//Sprite_IconType`] = { show: false };
  }

  // ---- PopupLastStand (MessagePopup_New): "<hero> makes a last stand?"
  // drawn over the dialog (its saved panel depth 12 is below the dialog's 20)
  b.MessagePopup_New = asking === null ? { show: false } : { show: true, at: TOP, depth: 30 };
  if (asking !== null) {
    b["MessagePopup_New/Label_Message"] = { pv: 1, at: [0, 0], w: 750, al: 2,
      html: say("UI_LAST_STAND_HERO_CONFIRMATION", [heroName(asking)]) || `${heroName(asking)} проводит проверку на стойкость?` };
    b["MessagePopup_New//Sprite_ExtraIcon"] = { show: false };
    b["MessagePopup_New//Button_Confirm"] = { show: true, onClick: () => { const o = lastStands.get(asking); setAsking(null); if (o !== undefined) onLastStand(o); } };
    b["MessagePopup_New//Button_Cancel"] = { show: true, onClick: () => setAsking(null) };
    b["Button_Confirm/Label_Confirm"] = { html: say("UI_CONFIRM") || "Подтвердить" };
    b["Button_Cancel/Label_Cancel"] = { html: say("UI_CANCEL") || "Отмена" };
  }
  return (
    // a click beside the dialog closes it (like the party button again)
    <div className="ngui-modal" onClick={(e) => {
      if ((e.target as HTMLElement).closest(".ng-click")) return;
      const r = e.currentTarget.querySelector('[data-n="Sprite_BG"]')?.getBoundingClientRect();
      if (!r || e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) onClose();
    }}>
      <NguiView layout={layout} atlas={atlas} show={[menu]} binds={b} say={say} className="ngui-party" />
    </div>
  );
}
