# Export the game's text fonts (local only, FFG content) to <JIME_WORK>/packs/core-ffg/fonts/.
# They also carry the in-text icons (U+F460..F47A: Main|GLYPH_* keys, e.g. GLYPH_WISDOM, GLYPH_DAMAGE),
# so the app needs them to show tests and damage/fear lines correctly.
import os, sys, json
import UnityPy

DATA = os.environ.get("JIME_DATA") or os.path.expanduser("~/mnt/Journeys in Middle-earth/JiME_Data")
WORK = os.environ.get("JIME_WORK") or os.path.join(os.path.dirname(__file__), "..", "..", "data")
OUT = os.path.join(WORK, "packs", "core-ffg", "fonts")
# asset name -> (file name, role)
FONTS = {
    "AGaramondPro-Regular_LOTRJIMEAPP": ("text.ttf", "text"),
    "RomicStd-Medium_App02": ("title.ttf", "title"),
}

def main():
    os.makedirs(OUT, exist_ok=True)
    env = UnityPy.load(os.path.join(DATA, "resources.assets"))
    found = {}
    for o in env.objects:
        if o.type.name != "Font":
            continue
        d = o.read()
        if d.m_Name in FONTS and len(d.m_FontData):
            fn, role = FONTS[d.m_Name]
            with open(os.path.join(OUT, fn), "wb") as f:
                f.write(bytes(d.m_FontData))
            found[role] = {"file": f"fonts/{fn}", "source": d.m_Name}
    with open(os.path.join(OUT, "fonts.json"), "w", encoding="utf-8") as f:
        json.dump(found, f, indent=1)
    print(f"fonts: {len(found)}/{len(FONTS)} -> {OUT}")
    if len(found) != len(FONTS):
        sys.exit(1)

if __name__ == "__main__":
    main()
