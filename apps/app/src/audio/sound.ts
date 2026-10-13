// Sound manager: music playlists, ambience and effects from the packs (audio/audio.json from tools/importer/export_audio.py).
// Web Audio (fetch + decodeAudioData) instead of <audio>: works the same for the Vite server and the Tauri "jime-pack" scheme.
//
// Own music: any enabled pack may add files under audio/music/ (.ogg, .mp3, .wav, .m4a); the "music" setting picks
// the original playlists, only own tracks, or both mixed. A pack may also replace audio/audio.json (playlists) as a layer.
import { assetUrl, loadPackSet, packText } from "../data/pack.ts";

export interface AudioDb {
  clips: Record<string, { file: string; length: number }>;
  playlists: Record<string, string[]>;
  enemies: Record<string, string>;
}

export type MusicSource = "original" | "own" | "mixed";
export interface SoundSettings { master: number; music: number; ambient: number; sfx: number; muted: boolean; source: MusicSource }
const DEFAULTS: SoundSettings = { master: 0.8, music: 0.55, ambient: 0.35, sfx: 0.8, muted: false, source: "original" };
const KEY = "jime.audio";
const OWN_RE = /^audio\/music\/.+\.(ogg|mp3|wav|m4a|flac)$/i;
const FADE = 2.5;

function readSettings(): SoundSettings {
  try {
    return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<SoundSettings>) };
  } catch {
    return { ...DEFAULTS };
  }
}

type Bus = "music" | "ambient" | "sfx";
interface Track { node: AudioBufferSourceNode; gain: GainNode }

class Sound {
  settings = readSettings();
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private bus: Partial<Record<Bus, GainNode>> = {};
  private db: Promise<AudioDb | null> | null = null;
  private own: Promise<string[]> | null = null;
  private buffers = new Map<string, Promise<AudioBuffer | null>>();
  private layer: Record<"music" | "ambient", { list: string | null; track: Track | null; gen: number; last: string | null }> = {
    music: { list: null, track: null, gen: 0, last: null },
    ambient: { list: null, track: null, gen: 0, last: null },
  };
  private listeners = new Set<() => void>();

  /** Create the context on the first user gesture (autoplay rules); safe to call often */
  private audio(): AudioContext | null {
    if (this.ctx) return this.ctx;
    const C = (globalThis as any).AudioContext ?? (globalThis as any).webkitAudioContext;
    if (!C) return null;
    const ctx: AudioContext = new C();
    this.master = ctx.createGain();
    this.master.connect(ctx.destination);
    for (const b of ["music", "ambient", "sfx"] as Bus[]) {
      const g = ctx.createGain();
      g.connect(this.master);
      this.bus[b] = g;
    }
    this.ctx = ctx;
    this.apply();
    return ctx;
  }

  /** Resume after a user gesture; starts the music asked for before the context could run */
  async unlock(): Promise<void> {
    const ctx = this.audio();
    if (ctx && ctx.state === "suspended") await ctx.resume().catch(() => {});
  }

  /** Install a one-time document listener that unlocks audio on the first click/key */
  install(): void {
    const go = async () => {
      await this.unlock();
      for (const l of ["music", "ambient"] as const) if (this.layer[l].list && !this.layer[l].track) void this.next(l);
    };
    document.addEventListener("pointerdown", go, { capture: true });
    document.addEventListener("keydown", go, { capture: true });
  }

  onChange(f: () => void): () => void {
    this.listeners.add(f);
    return () => this.listeners.delete(f);
  }

  set(p: Partial<SoundSettings>): void {
    const sourceChanged = p.source !== undefined && p.source !== this.settings.source;
    this.settings = { ...this.settings, ...p };
    try { localStorage.setItem(KEY, JSON.stringify(this.settings)); } catch { /* per session only */ }
    this.apply();
    if (sourceChanged && this.layer.music.list) this.next("music");
    for (const f of this.listeners) f();
  }

  private apply(): void {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    const s = this.settings;
    this.master.gain.setTargetAtTime(s.muted ? 0 : s.master, t, 0.05);
    this.bus.music?.gain.setTargetAtTime(s.music, t, 0.05);
    this.bus.ambient?.gain.setTargetAtTime(s.ambient, t, 0.05);
    this.bus.sfx?.gain.setTargetAtTime(s.sfx, t, 0.05);
  }

  /** Packs changed: forget the clip list and the decoded clips */
  reset(): void {
    this.db = null;
    this.own = null;
    this.buffers.clear();
  }

  private loadDb(): Promise<AudioDb | null> {
    return (this.db ??= packText("audio/audio.json").then((t) => JSON.parse(t) as AudioDb).catch(() => null));
  }

  private ownTracks(): Promise<string[]> {
    return (this.own ??= loadPackSet().then((s) => [...s.files.keys()].filter((p) => OWN_RE.test(p)).sort()).catch(() => []));
  }

  /** Decoded buffer of a pack file (virtual path) */
  private buffer(path: string): Promise<AudioBuffer | null> {
    const ctx = this.audio();
    if (!ctx) return Promise.resolve(null);
    let b = this.buffers.get(path);
    if (!b) {
      b = fetch(assetUrl(path))
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
        .then((a) => ctx.decodeAudioData(a))
        .catch(() => null);
      this.buffers.set(path, b);
    }
    return b;
  }

  /** One-shot effect by clip name (audio.json) */
  async sfx(name: string, volume = 1, rate = 1): Promise<void> {
    const db = await this.loadDb();
    const clip = db?.clips[name];
    const ctx = this.audio();
    if (!clip || !ctx || ctx.state !== "running" || this.settings.muted || this.settings.sfx <= 0) return;
    const buf = await this.buffer(clip.file);
    if (!buf) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.value = volume;
    src.connect(g).connect(this.bus.sfx!);
    src.start();
  }

  /** Random one of several effects */
  any(names: readonly string[], volume = 1): void {
    if (names.length) void this.sfx(names[Math.floor(Math.random() * names.length)]!, volume, 0.95 + Math.random() * 0.1);
  }

  /** Reveal sound of an enemy model (EnemyModel.RevealSounds) */
  async enemy(model: number, volume = 0.9): Promise<void> {
    const db = await this.loadDb();
    const name = db?.enemies[String(model)];
    if (name) void this.sfx(name, volume);
  }

  /** Background music playlist (MasterAudio name, e.g. "AdventureMusic"); null stops it */
  music(list: string | null): void { this.play("music", list); }
  /** Ambience playlist (e.g. "AmbientTracks"); null stops it */
  ambient(list: string | null): void { this.play("ambient", list); }

  private play(l: "music" | "ambient", list: string | null): void {
    const st = this.layer[l];
    if (st.list === list) return;
    st.list = list;
    if (!list) { this.stop(l); return; }
    this.next(l);
  }

  private stop(l: "music" | "ambient"): void {
    const st = this.layer[l];
    st.gen++;
    const tr = st.track;
    st.track = null;
    if (tr && this.ctx) {
      const t = this.ctx.currentTime;
      tr.gain.gain.cancelScheduledValues(t);
      tr.gain.gain.setValueAtTime(tr.gain.gain.value, t);
      tr.gain.gain.linearRampToValueAtTime(0, t + FADE);
      tr.node.stop(t + FADE + 0.1);
    }
  }

  /** Files of a playlist with the own-music setting applied */
  private async files(l: "music" | "ambient", list: string): Promise<string[]> {
    const db = await this.loadDb();
    const orig = (db?.playlists[list] ?? []).map((n) => db!.clips[n]?.file).filter((f): f is string => !!f);
    if (l === "ambient" || list === "TitlescreenMusic") return orig;
    const src = this.settings.source;
    if (src === "original") return orig;
    const own = await this.ownTracks();
    if (src === "own") return own.length ? own : orig;
    return [...orig, ...own];
  }

  /** Crossfade to a random track of the current playlist (not the one just played); chains itself */
  private async next(l: "music" | "ambient"): Promise<void> {
    const st = this.layer[l];
    const list = st.list;
    const ctx = this.audio();
    if (!list || !ctx) return;
    const gen = ++st.gen;
    const files = await this.files(l, list);
    if (!files.length || gen !== st.gen) return;
    const pick = files.length > 1 ? files.filter((f) => f !== st.last) : files;
    const file = pick[Math.floor(Math.random() * pick.length)]!;
    const buf = await this.buffer(file);
    if (!buf || gen !== st.gen || st.list !== list) return;
    if (ctx.state !== "running") return; // started by install() after the first gesture
    const old = st.track;
    const node = ctx.createBufferSource();
    node.buffer = buf;
    const gain = ctx.createGain();
    const t = ctx.currentTime;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(1, t + FADE);
    node.connect(gain).connect(this.bus[l]!);
    node.start(t);
    st.track = { node, gain };
    st.last = file;
    if (old) {
      old.gain.gain.cancelScheduledValues(t);
      old.gain.gain.setValueAtTime(old.gain.gain.value, t);
      old.gain.gain.linearRampToValueAtTime(0, t + FADE);
      old.node.stop(t + FADE + 0.1);
    }
    // next track a little before the end (crossfade); a lone track loops through the same path
    const wait = Math.max(1, buf.duration - FADE) * 1000;
    setTimeout(() => { if (st.gen === gen && st.list === list) void this.next(l); }, wait);
  }
}

export const sound = new Sound();
