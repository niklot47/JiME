# Full import from an installed copy of the game into <work>/packs/core-ffg (used by the app's first-run wizard).
#   python import_all.py --game "<game folder or its JiME_Data>" --work "<work folder>"   # run all steps
#   python import_all.py --check                                                         # check Python packages
# Progress lines for the app start with "@@": "@@step <i> <n> <name>", "@@missing <pkg,...>", "@@ok", "@@fail <step>".
# Output is FFG content: it stays on the user's machine and must never be redistributed.
import argparse, importlib, os, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
# import name -> pip name (requirements.txt)
PACKAGES = {"UnityPy": "UnityPy", "dnfile": "dnfile", "TypeTreeGeneratorAPI": "TypeTreeGeneratorAPI",
            "numpy": "numpy", "PIL": "Pillow", "attrs": "attrs"}


def say(*a):
    print(*a, flush=True)


def check():
    missing = []
    for mod, pip in PACKAGES.items():
        try:
            importlib.import_module(mod)
        except Exception:
            missing.append(pip)
    say(f"python {sys.version.split()[0]} {sys.executable}")
    if missing:
        say("@@missing " + ",".join(missing))
        return 1
    say("@@ok")
    return 0


def data_dir(game):
    """Accept the game folder (with JiME_Data) or JiME_Data itself (also JiME.app/Contents/Resources/Data on macOS)"""
    for d in (os.path.join(game, "JiME_Data"), game, os.path.join(game, "JiME.app", "Contents", "Resources", "Data")):
        if os.path.isfile(os.path.join(d, "resources.assets")):
            return d
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--game")
    ap.add_argument("--work")
    a = ap.parse_args()
    if a.check:
        return check()
    if not a.game or not a.work:
        ap.error("--game and --work are required")
    data = data_dir(a.game)
    if not data:
        say(f"@@fail game: no JiME_Data/resources.assets in {a.game}")
        return 2
    work = os.path.abspath(a.work)
    os.makedirs(os.path.join(work, "out"), exist_ok=True)
    # PYTHONUTF8: open() defaults to UTF-8 on Windows too (the scripts write JSON with non-ASCII text)
    env = dict(os.environ, JIME_DATA=data, JIME_WORK=work, PYTHONIOENCODING="utf-8", PYTHONUNBUFFERED="1", PYTHONUTF8="1")
    env.pop("JIME_MANAGED", None)
    bundles = os.path.join(data, "StreamingAssets", "bundles")
    steps = [
        ("extract_loc", ["extract_loc.py", bundles, os.path.join(work, "out")]),
        ("export_all", ["export_all.py"]),
        ("export_tiles", ["export_tiles.py"]),
        ("make_pack", ["make_pack.py"]),
        ("export_tile_art", ["export_tile_art.py"]),
        ("export_fonts", ["export_fonts.py"]),
        ("export_tokens", ["export_tokens.py"]),
        ("export_fx", ["export_fx.py"]),
        ("export_icons", ["export_icons.py"]),
        ("export_ui", ["export_ui.py"]),
        ("export_atlas", ["export_atlas.py"]),
        ("export_audio", ["export_audio.py"]),
        ("export_ui_layouts", ["export_ui_layouts.py"]),
        ("export_battleboard", ["export_battleboard.py"]),
    ]
    say(f"game data: {data}")
    say(f"work: {work}")
    t0 = time.time()
    for i, (name, args) in enumerate(steps, 1):
        say(f"@@step {i} {len(steps)} {name}")
        r = subprocess.run([sys.executable, "-u", *args], cwd=HERE, env=env)
        if r.returncode != 0:
            say(f"@@fail {name} (exit {r.returncode})")
            return r.returncode or 1
    say(f"done in {time.time() - t0:.0f} s -> {os.path.join(work, 'packs', 'core-ffg')}")
    say("@@ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
