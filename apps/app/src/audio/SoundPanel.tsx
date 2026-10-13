// Sound settings: volumes, mute and where the music comes from (original playlists / own tracks from packs / both)
import { useEffect, useState } from "react";
import { sound, type MusicSource, type SoundSettings } from "./sound.ts";

export function useSound(): SoundSettings {
  const [s, setS] = useState(sound.settings);
  useEffect(() => sound.onChange(() => setS(sound.settings)), []);
  return s;
}

/** Mute toggle (game panel) */
export function MuteButton() {
  const s = useSound();
  return (
    <button onClick={() => sound.set({ muted: !s.muted })} title={s.muted ? "Включить звук" : "Выключить звук"}>{s.muted ? "🔇" : "🔊"}</button>
  );
}

const SLIDERS: [keyof SoundSettings, string][] = [["master", "Общая"], ["music", "Музыка"], ["ambient", "Атмосфера"], ["sfx", "Эффекты"]];

export function SoundPanel() {
  const s = useSound();
  return (
    <section className="sound-panel">
      <h3>Звук</h3>
      {SLIDERS.map(([k, label]) => (
        <label key={k} className="slider">
          <span>{label}</span>
          <input type="range" min={0} max={1} step={0.05} value={s[k] as number} onChange={(e) => sound.set({ [k]: Number(e.target.value) })} />
        </label>
      ))}
      <label className="slider">
        <span>Музыка из</span>
        <select value={s.source} onChange={(e) => sound.set({ source: e.target.value as MusicSource })}>
          <option value="original">оригинала</option>
          <option value="own">своих треков</option>
          <option value="mixed">вперемешку</option>
        </select>
      </label>
      <label className="check"><input type="checkbox" checked={s.muted} onChange={(e) => sound.set({ muted: e.target.checked })} /> Без звука</label>
      <p className="muted small">Свои треки: файлы <code>.ogg</code>/<code>.mp3</code> в папке <code>audio/music/</code> любого включённого пака.</p>
    </section>
  );
}
