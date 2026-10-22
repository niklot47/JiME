import { useEffect, useState } from "react";
import { ENGINE_VERSION, type CampaignSave } from "@jime/engine";
import { MapScreen } from "./screens/MapScreen.tsx";
import { GameScreen } from "./screens/GameScreen.tsx";
import { PacksScreen } from "./screens/PacksScreen.tsx";
import { SetupScreen } from "./screens/SetupScreen.tsx";
import { UiPreviewScreen } from "./screens/UiPreviewScreen.tsx";
import { BattleboardPreviewScreen } from "./screens/BattleboardPreviewScreen.tsx";
import { TitleScreen } from "./screens/title/TitleScreen.tsx";
import { CampaignScreen } from "./screens/CampaignScreen.tsx";
import { inTauri, packsInfo } from "./data/host.ts";
import { PACK_ID, installTheme, themeChoice } from "./data/pack.ts";
import { sound } from "./audio/sound.ts";
import { SoundPanel } from "./audio/SoundPanel.tsx";

type Screen = "title" | "tools" | "campaign" | "map" | "game" | "packs" | "setup" | "ui" | "bb";

export function App() {
  const [screen, setScreen] = useState<Screen>("title");
  const [theme, setTheme] = useState(themeChoice());
  const [campaign, setCampaign] = useState<{ save: CampaignSave; intro: boolean } | null>(null);
  // first run: no imported game pack in the packs folder -> wizard
  useEffect(() => {
    if (!inTauri()) return;
    packsInfo().then((i) => { if (!i.packs.some((p) => p.dir === PACK_ID)) setScreen("setup"); }).catch(() => {});
  }, []);
  // title music on the tools screens; the title, campaign and game screens pick their own
  useEffect(() => { if (screen === "tools") { sound.music("TitlescreenMusic"); sound.ambient(null); } }, [screen]);
  const tools = () => setScreen("tools");
  if (screen === "setup") return <SetupScreen onDone={() => setScreen("title")} onSkip={() => setScreen("title")} />;
  if (screen === "title") return <TitleScreen onPlay={(s, intro) => { setCampaign({ save: s, intro: !!intro }); setScreen("campaign"); }} onTools={tools} />;
  if (screen === "campaign" && campaign) return <CampaignScreen key={campaign.save.slot} save={campaign.save} intro={campaign.intro} onBack={() => setScreen("title")} />;
  if (screen === "map") return <MapScreen onBack={tools} />;
  if (screen === "game") return <GameScreen onBack={tools} />;
  if (screen === "ui") return <UiPreviewScreen onBack={tools} />;
  if (screen === "bb") return <BattleboardPreviewScreen onBack={tools} />;
  if (screen === "packs") return <PacksScreen onBack={tools} onImport={() => setScreen("setup")} />;
  return (
    <main className="shell">
      <header className="topbar">
        <button className="link" onClick={() => setScreen("title")}>← Главное меню</button>
        <h1>JiME Reborn</h1>
        <span className="muted">engine {ENGINE_VERSION}</span>
        <label className="check theme-toggle">
          <input type="checkbox" checked={theme === "original"}
            onChange={(e) => { const t = e.target.checked ? "original" : "plain"; setTheme(t); void installTheme(t); }} />
          Оформление оригинала
        </label>
      </header>
      <section className="cards">
        <button className="card" onClick={() => setScreen("game")}>Одно приключение <span className="muted">— партия без кампании</span></button>
        <button className="card" onClick={() => setScreen("map")}>Карта <span className="muted">— генератор как в оригинале</span></button>
        <button className="card" onClick={() => setScreen("packs")}>Паки <span className="muted">— папка с контентом</span></button>
        <button className="card" disabled>Редактор</button>
        <button className="card" onClick={() => setScreen("ui")}>Интерфейс <span className="muted">— образцы из файлов игры</span></button>
        <button className="card" onClick={() => setScreen("bb")}>Поле боя <span className="muted">— 3D-доски из файлов игры</span></button>
      </section>
      <SoundPanel />
    </main>
  );
}
