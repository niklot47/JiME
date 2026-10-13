import { useState } from "react";
import { ENGINE_VERSION } from "@jime/engine";
import { MapScreen } from "./screens/MapScreen.tsx";
import { GameScreen } from "./screens/GameScreen.tsx";

type Screen = "home" | "map" | "game";

export function App() {
  const [screen, setScreen] = useState<Screen>("home");
  if (screen === "map") return <MapScreen onBack={() => setScreen("home")} />;
  if (screen === "game") return <GameScreen onBack={() => setScreen("home")} />;
  return (
    <main className="shell">
      <header className="topbar">
        <h1>JiME Reborn</h1>
        <span className="muted">engine {ENGINE_VERSION}</span>
      </header>
      <section className="cards">
        <button className="card" onClick={() => setScreen("game")}>Игра <span className="muted">— партия на карте (ранняя версия)</span></button>
        <button className="card" onClick={() => setScreen("map")}>Карта <span className="muted">— генератор как в оригинале</span></button>
        <button className="card" disabled>Кампании</button>
        <button className="card" disabled>Паки</button>
        <button className="card" disabled>Редактор</button>
      </section>
    </main>
  );
}
