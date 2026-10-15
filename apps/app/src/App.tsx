import { useEffect, useState } from "react";
import { ENGINE_VERSION } from "@jime/engine";
import { MapScreen } from "./screens/MapScreen.tsx";
import { GameScreen } from "./screens/GameScreen.tsx";
import { PacksScreen } from "./screens/PacksScreen.tsx";
import { SetupScreen } from "./screens/SetupScreen.tsx";
import { UiPreviewScreen } from "./screens/UiPreviewScreen.tsx";
import { BattleboardPreviewScreen } from "./screens/BattleboardPreviewScreen.tsx";
import { inTauri, packsInfo } from "./data/host.ts";
import { PACK_ID, installTheme, themeChoice } from "./data/pack.ts";
import { sound } from "./audio/sound.ts";
import { SoundPanel } from "./audio/SoundPanel.tsx";

type Screen = "home" | "map" | "game" | "packs" | "setup" | "ui" | "bb";

export function App() {
  const [screen, setScreen] = useState<Screen>("home");
  const [theme, setTheme] = useState(themeChoice());
  // first run: no imported game pack in the packs folder -> wizard
  useEffect(() => {
    if (!inTauri()) return;
    packsInfo().then((i) => { if (!i.packs.some((p) => p.dir === PACK_ID)) setScreen("setup"); }).catch(() => {});
  }, []);
  // title music on the menu screens; the game screen picks its own playlists
  useEffect(() => { if (screen !== "game") { sound.music("TitlescreenMusic"); sound.ambient(null); } }, [screen]);
  if (screen === "setup") return <SetupScreen onDone={() => setScreen("home")} onSkip={() => setScreen("home")} />;
  if (screen === "map") return <MapScreen onBack={() => setScreen("home")} />;
  if (screen === "game") return <GameScreen onBack={() => setScreen("home")} />;
  if (screen === "ui") return <UiPreviewScreen onBack={() => setScreen("home")} />;
  if (screen === "bb") return <BattleboardPreviewScreen onBack={() => setScreen("home")} />;
  if (screen === "packs") return <PacksScreen onBack={() => setScreen("home")} onImport={() => setScreen("setup")} />;
  return (
    <main className="shell">
      <header className="topbar">
        <h1>JiME Reborn</h1>
        <span className="muted">engine {ENGINE_VERSION}</span>
        <label className="check theme-toggle">
          <input type="checkbox" checked={theme === "original"}
            onChange={(e) => { const t = e.target.checked ? "original" : "plain"; setTheme(t); void installTheme(t); }} />
          Оформление оригинала
        </label>
      </header>
      <section className="cards">
        <button className="card" onClick={() => setScreen("game")}>Игра <span className="muted">— партия на карте (ранняя версия)</span></button>
        <button className="card" onClick={() => setScreen("map")}>Карта <span className="muted">— генератор как в оригинале</span></button>
        <button className="card" disabled>Кампании</button>
        <button className="card" onClick={() => setScreen("packs")}>Паки <span className="muted">— папка с контентом</span></button>
        <button className="card" disabled>Редактор</button>
        <button className="card" onClick={() => setScreen("ui")}>Интерфейс <span className="muted">— образцы из файлов игры</span></button>
        <button className="card" onClick={() => setScreen("bb")}>Поле боя <span className="muted">— 3D-доски из файлов игры</span></button>
      </section>
      <SoundPanel />
    </main>
  );
}
