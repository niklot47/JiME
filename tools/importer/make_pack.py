# Build the local "core-ffg" pack from importer output (data/export + data/out/loc.json).
# The pack contains FFG content: it lives in data/ (git-ignored) and must never be redistributed.
import csv, io, json, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
WORK = os.environ.get("JIME_WORK", os.path.join(ROOT, "data"))
EXPORT = os.path.join(WORK, "export")
LOC = os.path.join(WORK, "out", "loc.json")
PACK_ID = "core-ffg"
OUT = os.path.join(WORK, "packs", PACK_ID)
FORMAT_VERSION = 1
LANGS = ("en", "ru", "it")


def dump(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))


TILES = os.path.join(EXPORT, "tiles.json")
GEO = json.load(open(TILES, encoding="utf-8")) if os.path.exists(TILES) else None


def scenario(kind, data):
    model = data["model"]
    env = {"format": "jime-scenario", "formatVersion": FORMAT_VERSION, "kind": kind,
           "id": model.get("_id"), "source": "ffg"}
    env.update(data)
    custom = (GEO or {}).get("custom", {}).get(str(model.get("_id")))
    if kind == "adventure" and custom:
        env.setdefault("ext", {})["customTiles"] = custom  # GameObject pid -> tile geometry
    return env


def main():
    if not os.path.exists(os.path.join(EXPORT, "db.json")):
        sys.exit(f"no export at {EXPORT}; run tools/importer/export_all.py first")
    counts = {}
    for kind, sub in (("adventure", "adventures"), ("encounter", "encounters")):
        src = os.path.join(EXPORT, sub)
        names = sorted(n for n in os.listdir(src) if n.endswith(".json"))
        for n in names:
            with open(os.path.join(src, n), encoding="utf-8") as f:
                dump(os.path.join(OUT, "scenario", sub, n), scenario(kind, json.load(f)))
        counts[sub] = len(names)

    with open(os.path.join(EXPORT, "db.json"), encoding="utf-8") as f:
        db = json.load(f)
    if GEO:
        db["tiles"] = GEO["standard"]          # StandardTiles bucket order + hex/edge geometry
        db["productOrder"] = GEO["products"]   # JIME_Database.Products order
    else:
        print("warning: no export/tiles.json (run export_tiles.py): map generator geometry missing")
    dump(os.path.join(OUT, "scenario", "db.json"), {"format": "jime-db", "formatVersion": FORMAT_VERSION, **db})

    contents = [{"type": "scenario", "path": "scenario"}]
    if os.path.exists(LOC):
        with open(LOC, encoding="utf-8") as f:
            loc = json.load(f)
        for lang in LANGS:
            buf = io.StringIO()
            w = csv.writer(buf, lineterminator="\n")
            w.writerow(["key", "text"])
            n = 0
            for key in sorted(loc):
                text = loc[key].get(lang)
                if text:
                    w.writerow([key, text]); n += 1
            path = os.path.join(OUT, "lang", f"{lang}.csv")
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "w", encoding="utf-8", newline="") as f:
                f.write(buf.getvalue())
            contents.append({"type": "lang", "lang": lang, "path": f"lang/{lang}.csv"})
            counts[f"lang/{lang}"] = n
    else:
        print(f"warning: {LOC} not found, pack has no lang content")

    manifest = {
        "formatVersion": FORMAT_VERSION,
        "id": PACK_ID,
        "name": {"en": "Journeys in Middle-earth (imported)", "ru": "Путешествия по Средиземью (импорт)",
                 "it": "Viaggi nella Terra di Mezzo (importato)"},
        "description": "Built locally from the user's installed copy of the game. Do not redistribute.",
        "version": "1.0.0",
        "priority": 0,
        "origin": "ffg-import",
        "contents": contents,
    }
    with open(os.path.join(OUT, "pack.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
    print(f"pack {PACK_ID} -> {OUT}")
    for k, v in counts.items():
        print(f"  {k}: {v}")


if __name__ == "__main__":
    main()
