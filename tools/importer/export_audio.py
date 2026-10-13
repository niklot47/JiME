# Export the game's audio (local only, FFG content) to <JIME_WORK>/packs/core-ffg/audio/<name>.ogg (Ogg Vorbis) and audio.json:
# {
#   "clips": { "<clip name>": { "file": "audio/<name>.ogg", "length": seconds } },
#   "playlists": { "<MasterAudio playlist>": ["<clip name>", ...] },   # TitlescreenMusic, AdventureMusic, AmbientTracks ...
#   "enemies": { "<EnemyModel id>": "<clip name>" }                     # EnemyModel.RevealSounds
# }
# AudioClips are FSB5 (Vorbis) inside the asset files: UnityPy decodes them to PCM (through FMOD), soundfile encodes Ogg Vorbis.
import os, re, io, json, sys
import soundfile as sf
from jload import *

PACK = os.path.join(ROOT, "packs", "core-ffg")
OUT = os.path.join(PACK, "audio")
LONG = 30.0  # music / ambience: stronger compression

def safe(name):
    return re.sub(r"[^A-Za-z0-9_.()-]+", "_", name).strip("_")

def playlists():
    """MasterAudio playlists of the game scene: name -> clip names (in order)."""
    res = {}
    for o in mbs_of("DarkTonic.MasterAudio.MasterAudio"):
        _, d = read_mb(o)
        for pl in (d or {}).get("musicPlaylists", []):
            songs = [s.get("songName") for s in pl.get("MusicSettings", []) if s.get("songName")]
            if songs and pl.get("playlistName") not in res: res[pl["playlistName"]] = songs
    return res

def main():
    os.makedirs(OUT, exist_ok=True)
    only = set(sys.argv[1:])  # optional: clip names to (re)export
    clips = {}
    for f in FILES.values():
        for o in f.objects.values():
            if o.type.name != "AudioClip": continue
            a = o.read()
            name = a.m_Name
            if name in clips or (only and name not in only): continue
            fn = f"{safe(name)}.ogg"
            path = os.path.join(OUT, fn)
            if not os.path.exists(path):
                try:
                    samples = a.samples
                except Exception as e:
                    print("audio failed", name, e); continue
                if not samples: continue
                wav = next(iter(samples.values()))
                data, rate = sf.read(io.BytesIO(wav), dtype="float32")
                level = 0.7 if a.m_Length >= LONG else 0.5
                # write in blocks: libsndfile's Vorbis encoder can crash on one huge write
                tmp = path + ".part"
                with sf.SoundFile(tmp, "w", rate, 1 if data.ndim == 1 else data.shape[1], format="OGG", subtype="VORBIS",
                                  compression_level=level) as out:
                    for i in range(0, len(data), 1 << 15):
                        out.write(data[i:i + (1 << 15)])
                os.replace(tmp, path)
                print(f"  {name}: {a.m_Length:.1f} s", flush=True)
            clips[name] = {"file": f"audio/{fn}", "length": round(float(a.m_Length), 2)}
    db = json.load(open(os.path.join(ROOT, "export", "db.json"), encoding="utf-8"))
    enemies = {}
    for eid, m in db["models"]["EnemyModel"].items():
        for s in m.get("RevealSounds") or []:
            base = os.path.splitext(os.path.basename(s.get("Path", "")))[0]
            if base in clips: enemies[eid] = base; break
    pls = {k: [s for s in v if s in clips] for k, v in playlists().items()}
    with open(os.path.join(OUT, "audio.json"), "w", encoding="utf-8") as fp:
        json.dump({"clips": clips, "playlists": pls, "enemies": enemies}, fp, indent=1, ensure_ascii=False)
    print(f"audio: {len(clips)} clips, {len(pls)} playlists, {len(enemies)} enemy sounds -> {OUT}")

if __name__ == "__main__":
    main()
