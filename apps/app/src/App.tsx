import { ENGINE_VERSION } from "@jime/engine";

// Placeholder shell: real screens (pack manager, import wizard, game) come in Stage 3
export function App() {
  return (
    <main className="shell">
      <header className="topbar">
        <h1>JiME Reborn</h1>
        <span className="muted">engine {ENGINE_VERSION}</span>
      </header>
      <section className="cards">
        <button className="card">Кампании</button>
        <button className="card">Паки</button>
        <button className="card">Импорт из игры</button>
        <button className="card">Редактор</button>
      </section>
    </main>
  );
}
