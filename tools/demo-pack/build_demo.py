"""
Builds the open demo pack "jime-demo": a small campaign of this project's own (no FFG content), so the app runs
without the imported game. Everything here is invented: heroes, enemies, items, tiles (placeholder art drawn here),
two adventures and their events, texts in ru / en / it.

Output: apps/app/public/bundled-packs/jime-demo/ (+ the listings the pack manager reads: __list.json, __index.json).
Usage: python tools/demo-pack/build_demo.py
"""
import csv
import io
import json
import math
import os
import shutil
import sys

from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, os.path.dirname(__file__))
from demo_texts import TEXTS  # noqa: E402
from demo_content import ADVENTURES, ENCOUNTERS, GROUPS  # noqa: E402
from demo_map import LABELS as MAP_LABELS, LOCATIONS as MAP_LOCATIONS, draw_map  # noqa: E402

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
BUNDLED = os.path.join(REPO, "apps", "app", "public", "bundled-packs")
PACK_ID = "jime-demo"
OUT = os.path.join(BUNDLED, PACK_ID)
LANGS = ("ru", "en", "it")
SHEET = "Demo"


# ------------------------------------------------------------------ helpers
def ref(model, mid, name=None):
    return {"ref": model, "name": name or f"{mid}_{model}", "id": mid}


def font(size, bold=False):
    for f in (["georgiab.ttf", "DejaVuSerif-Bold.ttf", "DejaVuSans-Bold.ttf"] if bold else ["georgia.ttf", "DejaVuSerif.ttf", "DejaVuSans.ttf"]):
        for d in ("C:/Windows/Fonts", "/usr/share/fonts/truetype/dejavu", "/usr/share/fonts/TTF"):
            p = os.path.join(d, f)
            if os.path.exists(p):
                return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def symbol_font(size):
    for p in ("C:/Windows/Fonts/seguisym.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"):
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return font(size, True)


def save_png(img, rel):
    p = os.path.join(OUT, rel)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    img.save(p, optimize=True)
    return rel


def write_json(rel, data):
    p = os.path.join(OUT, rel)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w", encoding="utf-8", newline="\n") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
        f.write("\n")


def gradient(w, h, top, bottom):
    img = Image.new("RGB", (w, h))
    d = ImageDraw.Draw(img)
    for y in range(h):
        k = y / max(1, h - 1)
        d.line([(0, y), (w, y)], fill=tuple(int(top[i] + (bottom[i] - top[i]) * k) for i in range(3)))
    return img


def card(w, h, title, sub, top, bottom):
    """Placeholder art: a gradient with a title (to be replaced by real art)"""
    img = gradient(w, h, top, bottom)
    d = ImageDraw.Draw(img)
    f1, f2 = font(max(14, h // 9), True), font(max(10, h // 16))
    if title:
        tw = d.textlength(title, font=f1)
        d.text(((w - tw) / 2, h * 0.38), title, font=f1, fill=(240, 228, 200))
    if sub:
        sw = d.textlength(sub, font=f2)
        d.text(((w - sw) / 2, h * 0.58), sub, font=f2, fill=(210, 196, 160))
    d.rectangle([4, 4, w - 5, h - 5], outline=(200, 170, 110), width=3)
    return img


def portrait(letter, color, size, sym=False):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.ellipse([2, 2, size - 3, size - 3], fill=color + (255,), outline=(230, 200, 140, 255), width=max(2, size // 32))
    f = symbol_font(int(size * 0.5)) if sym else font(int(size * 0.55), True)
    l, t, r, b = d.textbbox((0, 0), letter, font=f)
    d.text(((size - (r - l)) / 2 - l, (size - (b - t)) / 2 - t), letter, font=f, fill=(250, 240, 220, 255))
    return img


# ------------------------------------------------------------------ texts
def lang_rows(lang):
    rows = [["key", "text"]]
    for k, v in TEXTS.items():
        t = v.get(lang) or v.get("en") or v["ru"]
        rows.append([f"{SHEET}|{k}", t.replace("\n", "\\n")])
    return rows


def write_csv(rel, rows):
    buf = io.StringIO()
    csv.writer(buf, lineterminator="\n").writerows(rows)
    p = os.path.join(OUT, rel)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w", encoding="utf-8", newline="") as f:
        f.write(buf.getvalue())


# ------------------------------------------------------------------ tiles
# hex lattice like the game's tile art: centre = (S*(x + z/2), -1.5*R*z), pointy-top hexes of radius R
R = 1.0189
S = R * math.sqrt(3)
HEX_VERTS = [(0, -R), (-S / 2, -R / 2), (-S / 2, R / 2), (0, R), (S / 2, -R / 2), (S / 2, R / 2)]
HEX_TRIS = [[2, 1, 0], [0, 3, 2], [0, 4, 3], [4, 5, 3]]
DIRS = [(1, -1, 0), (0, -1, 1), (-1, 0, 1), (-1, 1, 0), (0, 1, -1), (1, 0, -1)]

# shapes in axial (q, r) -> cube (x=q, z=r, y=-q-r)
SHAPES = {
    "tri": [(0, 0), (1, 0), (0, 1)],
    "line": [(0, 0), (1, 0), (2, 0)],
    "rhomb": [(0, 0), (1, 0), (0, 1), (1, 1)],
    "five": [(0, 0), (1, 0), (2, 0), (0, 1), (1, 1)],
    "flower": [(0, 0), (1, 0), (1, -1), (0, -1), (-1, 0), (-1, 1), (0, 1)],
}
TERRAIN = {  # name -> colour of the placeholder art
    "grass": (96, 128, 70), "forest": (52, 92, 56), "hills": (140, 120, 80), "road": (170, 150, 110),
    "river": (70, 110, 150), "marsh": (90, 110, 90), "ruins": (120, 110, 105), "camp": (150, 90, 60),
}
# code -> (shape, spaces: [(terrain, [hex indexes])], tile set)
TILES = {
    "D01A": ("flower", [("grass", [0, 1, 2]), ("road", [3, 4]), ("forest", [5, 6])], 1),
    "D01B": ("flower", [("forest", [0, 2, 3]), ("hills", [4, 5, 6, 1])], 1),
    "D02A": ("five", [("grass", [0, 1, 3]), ("river", [2, 4])], 1),
    "D02B": ("five", [("marsh", [0, 3, 4]), ("forest", [1, 2])], 1),
    "D03A": ("rhomb", [("forest", [0, 1]), ("grass", [2, 3])], 1),
    "D03B": ("rhomb", [("hills", [0, 1, 2, 3])], 1),
    "D04A": ("rhomb", [("road", [0, 2]), ("grass", [1, 3])], 1),
    "D04B": ("rhomb", [("ruins", [0, 1, 2, 3])], 1),
    "D05A": ("five", [("hills", [0, 1, 2]), ("grass", [3, 4])], 1),
    "D05B": ("five", [("camp", [0, 1, 3, 4]), ("forest", [2])], 1),
    "D06A": ("tri", [("grass", [0, 1, 2])], 1),
    "D06B": ("tri", [("marsh", [0, 1, 2])], 1),
    "D07A": ("line", [("road", [0, 1, 2])], 1),
    "D07B": ("line", [("river", [0, 1]), ("grass", [2])], 1),
    "D08A": ("tri", [("forest", [0, 1, 2])], 1),
    "D08B": ("tri", [("ruins", [0, 1]), ("grass", [2])], 1),
    "D09A": ("flower", [("ruins", [0, 1, 6]), ("forest", [2, 3]), ("grass", [4, 5])], 1),
    "D09B": ("flower", [("camp", [0, 4, 5]), ("hills", [1, 2, 3, 6])], 1),
    "D10A": ("rhomb", [("grass", [0, 1]), ("forest", [2, 3])], 1),
    "D10B": ("rhomb", [("marsh", [0, 1, 2, 3])], 1),
}


def cube(q, r):
    return {"x": q, "y": -q - r, "z": r}


def center(c):
    return (S * (c["x"] + c["z"] / 2), -1.5 * R * c["z"])


def build_tiles():
    tiles, standard, models, art = [], {}, {}, {}
    hash_base = 9100000
    for i, code in enumerate(sorted(TILES)):
        shape, spaces, tset = TILES[code]
        hexes = [cube(q, r) for q, r in SHAPES[shape]]
        space_of = {}
        for si, (_, hx) in enumerate(spaces):
            for h in hx:
                space_of[h] = si
        assert sorted(space_of) == list(range(len(hexes))), code
        keyed = {(h["x"], h["y"], h["z"]): j for j, h in enumerate(hexes)}
        edges, conn = [], [set() for _ in spaces]
        for j, h in enumerate(hexes):
            for d, (dx, dy, dz) in enumerate(DIRS):
                n = keyed.get((h["x"] + dx, h["y"] + dy, h["z"] + dz))
                if n is None:
                    edges.append({"hex": j, "dir": d, "traits": 0, "open": True})
                elif space_of[n] != space_of[j]:
                    conn[space_of[j]].add(space_of[n])
        tiles.append({"code": code, "hexes": [{**h, "space": space_of[j]} for j, h in enumerate(hexes)],
                      "spaces": [{"traits": 0, "hexes": hx, "connected": sorted(conn[si])} for si, (_, hx) in enumerate(spaces)],
                      "edges": edges})
        standard[code] = {"model": ref("TileModel", code, code), "spaces": [{"traits": 0, "connected": sorted(conn[si])} for si in range(len(spaces))]}
        other = code[:-1] + ("B" if code.endswith("A") else "A")
        models[code] = {"m_Name": code, "_id": code, "OtherSideId": other, "Set": tset,
                        "DefaultExploreKeys": [f"TILE_{code}"], "HashId": hash_base + i}
        art[code] = draw_tile(code, hexes, spaces, space_of)
    for m in models.values():
        m["OtherSideHashId"] = models[m["OtherSideId"]]["HashId"]
    return tiles, standard, models, art


# the vertexes (HEX_VERTS indexes) on the side of a hex towards DIRS[d] (world y up)
EDGE_VERTS = {0: (5, 4), 1: (4, 0), 2: (0, 1), 3: (1, 2), 4: (2, 3), 5: (3, 5)}


def draw_tile(code, hexes, spaces, space_of):
    centers = [center(h) for h in hexes]
    xs = [c[0] + vx for c in centers for vx, _ in HEX_VERTS]
    ys = [c[1] + vy for c in centers for _, vy in HEX_VERTS]
    pad = 0.05
    x0, x1, y0, y1 = min(xs) - pad, max(xs) + pad, min(ys) - pad, max(ys) + pad
    W, H = x1 - x0, y1 - y0
    px = 160  # pixels per unit
    iw, ih = int(W * px), int(H * px)
    img = Image.new("RGBA", (iw, ih), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    def to_px(x, y):  # image y goes down, world y up
        return ((x - x0) / W * iw, (1 - (y - y0) / H) * ih)

    ring = (0, 1, 2, 3, 5, 4)
    for j, c in enumerate(centers):
        col = TERRAIN[spaces[space_of[j]][0]]
        d.polygon([to_px(c[0] + HEX_VERTS[v][0], c[1] + HEX_VERTS[v][1]) for v in ring], fill=col + (255,))
        cx, cy = to_px(*c)
        for k in range(14):
            a, rr = k * 2.399, (k % 5 + 1) * px * 0.12
            d.ellipse([cx + math.cos(a) * rr - 3, cy + math.sin(a) * rr - 3, cx + math.cos(a) * rr + 3, cy + math.sin(a) * rr + 3],
                      fill=tuple(max(0, v - 25) for v in col) + (255,))
    keyed = {(h["x"], h["y"], h["z"]): j for j, h in enumerate(hexes)}
    for j, h in enumerate(hexes):
        c = centers[j]
        for dd, (dx, dy, dz) in enumerate(DIRS):
            n = keyed.get((h["x"] + dx, h["y"] + dy, h["z"] + dz))
            a, b = EDGE_VERTS[dd]
            pa = to_px(c[0] + HEX_VERTS[a][0], c[1] + HEX_VERTS[a][1])
            pb = to_px(c[0] + HEX_VERTS[b][0], c[1] + HEX_VERTS[b][1])
            if n is None:
                d.line([pa, pb], fill=(60, 45, 30, 255), width=6)
            elif space_of[n] != space_of[j]:
                d.line([pa, pb], fill=(235, 220, 170, 255), width=4)
    f = font(int(px * 0.32), True)
    cx, cy = to_px(*centers[0])
    tw = d.textlength(code, font=f)
    d.text((cx - tw / 2, cy - px * 0.62), code, font=f, fill=(250, 240, 210, 255), stroke_width=3, stroke_fill=(40, 30, 20, 255))
    tex = save_png(img, f"images/tiles/{code}.png")

    def uv(x, y):
        return [round((x - x0) / W, 5), round((y - y0) / H, 5)]

    art_hexes = []
    for c in centers:
        verts = [[round(c[0] + vx, 4), round(c[1] + vy, 4)] for vx, vy in HEX_VERTS]
        art_hexes.append({"center": [round(c[0], 4), round(c[1], 4)], "verts": verts, "uvs": [uv(*v) for v in verts], "tris": HEX_TRIS})
    nodes = [[round(centers[hx[-1]][0], 4), round(centers[hx[-1]][1] - 0.25, 4)] for _, hx in spaces]
    c0 = centers[0]
    return {"texture": tex, "hexes": art_hexes, "explore": [round(c0[0], 4), round(c0[1] + 0.3, 4), 0],
            "callout": [round(c0[0], 4), round(c0[1] - 0.6, 4)], "nodes": nodes}


# ------------------------------------------------------------------ the models
# every id is in the 9000s (codes D..): the demo can lie next to an imported game without overriding its models
HEROES = [  # id, key, letter, colour, weapon, armor, race key
    (9001, "HERO_AIRA", "А", (70, 110, 80), 9101, 9111, "RACE_DEMO_HUMAN"),
    (9002, "HERO_BORIN", "Б", (120, 80, 60), 9102, 9112, "RACE_DEMO_DWARF"),
    (9003, "HERO_MAEVE", "М", (90, 80, 130), 9103, 9113, "RACE_DEMO_HUMAN"),
    (9004, "HERO_TOLLAN", "Т", (130, 110, 60), 9104, 9111, "RACE_DEMO_HALFLING"),
]
ITEMS = [  # id, key, level, two-handed, upgrades, upgrade cost
    (9101, "ITEM_DEMO_BOW", 1, 1, [9121], 20), (9102, "ITEM_DEMO_HAMMER", 1, 1, [9122], 20),
    (9103, "ITEM_DEMO_STAFF", 1, 1, [9123], 20), (9104, "ITEM_DEMO_DAGGER", 1, 0, [9124], 20),
    (9111, "ITEM_DEMO_LEATHER", 1, 0, [], 0), (9112, "ITEM_DEMO_MAIL", 1, 0, [], 0), (9113, "ITEM_DEMO_CLOAK", 1, 0, [], 0),
    (9121, "ITEM_DEMO_LONGBOW", 2, 1, [], 0), (9122, "ITEM_DEMO_WARHAMMER", 2, 1, [], 0),
    (9123, "ITEM_DEMO_RUNESTAFF", 2, 1, [], 0), (9124, "ITEM_DEMO_FANG", 2, 0, [], 0),
    (9131, "ITEM_DEMO_LANTERN", 1, 0, [], 0), (9132, "ITEM_DEMO_FERRY_TOKEN", 1, 0, [], 0),
]
SKILLS = [(9200 + i, f"SKILL_DEMO_{i}", st) for i, st in enumerate([1] * 12 + [2] * 12 + [3] * 4)]
HERO_SKILLS = {9001: [9200, 9201, 9202], 9002: [9203, 9204, 9205], 9003: [9206, 9207, 9208], 9004: [9209, 9210, 9211]}
ROLES = [(9001, "ROLE_DEMO_SCOUT", [9212, 9213], [9214, 9215, 9216, 9217]), (9002, "ROLE_DEMO_GUARDIAN", [9218, 9219], [9220, 9221, 9222, 9223])]
TITLES = [(9001, "TITLE_DEMO_FORD_WARDEN"), (9002, "TITLE_DEMO_SHADOWBANE")]
ENEMIES = [  # id, key, health, armor, costs, activations
    (9001, "ENEMY_DEMO_BANDIT", 5, 0, [(1, 6), (2, 11), (3, 15)], [9001, 9002]),
    (9002, "ENEMY_DEMO_WOLF", 4, 0, [(1, 5), (2, 9), (3, 12)], [9003, 9004]),
    (9003, "ENEMY_DEMO_SHADE", 8, 1, [(1, 12)], [9005, 9006]),
]
ACTIVATIONS = [  # id, enemy, damage per group size (size, physical, fear)
    (9001, "BANDIT", [(1, 2, 0), (2, 3, 0), (3, 3, 1)]), (9002, "BANDIT", [(1, 1, 1), (2, 2, 1), (3, 3, 1)]),
    (9003, "WOLF", [(1, 2, 0), (2, 3, 0), (3, 4, 0)]), (9004, "WOLF", [(1, 1, 1), (2, 2, 1), (3, 2, 2)]),
    (9005, "SHADE", [(1, 1, 3)]), (9006, "SHADE", [(1, 3, 2)]),
]
CAMPAIGN, PRODUCT = 9001, 90
# the game's own variables (GlobalVariables): the engine reads and writes them by name
SYSTEM_GLOBALS = {
    "EnemyPoints": {"type": "int", "value": 0}, "PlayerCount": {"type": "int", "value": 5}, "Round": {"type": "int", "value": 1},
    "Threat": {"type": "int", "value": 0}, "Campaign/Lore": {"type": "int", "value": 0}, "IsDarkness": {"type": "bool", "value": 0},
    "IsTutorial": {"type": "bool", "value": 0}, "CorruptionPresence": {"type": "bool", "value": 0},
    "DarknessMessageOverride": {"type": "string", "value": ""}, "PartyName": {"type": "string", "value": ""},
}
# ItemType (actions.ts): 0 weapon, 1 armor, 2 item, 3 mount; copies in the box (default 1)
ITEM_TYPE = {9111: 1, 9112: 1, 9113: 1, 9131: 2, 9132: 2}
ITEM_COPIES = {9111: 2}
CUTSCENES = [(9001, "CAM_DEMO_PROLOGUE"), (9002, "CAM_DEMO_VICTORY"), (9003, "CAM_DEMO_DEFEAT")]


def build_db(tile_models, standard, tiles):
    M = {}
    M["HeroModel"] = {str(h): {"m_Name": f"{h}_{k}", "_id": h, "NameKey": f"{k}_NAME", "RaceKey": race,
                               "DefaultArmor": ref("ItemModel", ar), "DefaultWeapon": ref("ItemModel", w), "Gender": 0, "Traits": 0,
                               "StartingSkills": [{"Skill": ref("SkillModel", s), "Quantity": 2 if n == 0 else 1} for n, s in enumerate(HERO_SKILLS[h])]}
                      for h, k, _, _, w, ar, race in HEROES}
    M["ItemModel"] = {str(i): {"m_Name": f"{i}_{k}", "_id": i, "NameKey": k, "Level": lv, "Type": ITEM_TYPE.get(i, 0), **({"Is2Handed": 1} if two else {}),
                               "Upgrades": [ref("ItemModel", u) for u in up], "UpgradeCost": cost}
                      for i, k, lv, two, up, cost in ITEMS}
    M["SkillModel"] = {str(i): {"m_Name": f"{i}_{k}", "_id": i, "NameKey": k, "SourceType": st} for i, k, st in SKILLS}
    M["RoleModel"] = {str(i): {"m_Name": f"{i}_{k}", "_id": i, "NameKey": k, "CoreSkills": [ref("SkillModel", s) for s in core],
                               "UpgradeSkills": [ref("SkillModel", s) for s in up]} for i, k, core, up in ROLES}
    M["TitleModel"] = {str(i): {"m_Name": f"{i}_{k}", "_id": i, "NameKey": k} for i, k in TITLES}
    M["EnemyActivationModel"] = {str(i): {"m_Name": f"{i:03d}_{e} Activation", "KeyActivation": f"ENEMY_DEMO_{e}_ACTIVATION_{i}",
                                          "KeyAttackFlavor": f"ENEMY_DEMO_{e}_ATTACK_{i}", "MinGroupSize": 1, "MaxGroupSize": 3,
                                          "Damage": [{"Size": s, "Physical": p, **({"Fear": f} if f else {})} for s, p, f in dmg]}
                                 for i, e, dmg in ACTIVATIONS}
    M["EnemyModel"] = {str(i): {"m_Name": f"{i}_{k}", "_id": i, "KeySingular": k, "KeyPlural": f"{k}_PLURAL",
                                "MaxUnitCount": max(n for n, _ in costs), "MaxUnitsInPlay": 6, "Costs": [{"Num": n, "Cost": c} for n, c in costs],
                                "Traits": 0, "Armor": armor, "Health": hp, "Activations": [ref("EnemyActivationModel", a) for a in acts], "Bonuses": []}
                       for i, k, hp, armor, costs, acts in ENEMIES}
    M["EnemyBonusModel"] = {}
    M["TerrainNodeModel"] = {}
    M["LastStandModel"] = {"9001": {"m_Name": "9001_Last_Stand_Physical", "_id": 9001, "Type": 10, "MessageKeys": ["LAST_STAND_DEMO_D_1", "LAST_STAND_DEMO_D_2"]},
                           "9002": {"m_Name": "9002_Last_Stand_Fear", "_id": 9002, "Type": 20, "MessageKeys": ["LAST_STAND_DEMO_F_1", "LAST_STAND_DEMO_F_2"]}}
    M["CutsceneModel"] = {str(i): {"m_Name": f"{i}_{k}", "TextKey": k} for i, k in CUTSCENES}
    M["CampaignModel"] = {str(CAMPAIGN): {"m_Name": f"{CAMPAIGN}_Shadows over Greyford", "_id": CAMPAIGN, "TitleKey": "CAM_DEMO_TITLE", "DescriptionKey": "CAM_DEMO_DESC",
                                "ContentsKey": "CAM_DEMO_CONTENTS", "AssetBundleCode": "DemoGreyford", "Products": [ref("ProductModel", PRODUCT)],
                                "Adventures": [ref("AdventureModel", a["id"]) for a in ADVENTURES],
                                "LastStands": [ref("LastStandModel", 9001), ref("LastStandModel", 9002)],
                                "CutscenePrologue": ref("CutsceneModel", 9001), "CutsceneVictory": ref("CutsceneModel", 9002), "CutsceneDefeat": ref("CutsceneModel", 9003)}}
    M["AdventureModel"] = {str(a["id"]): a["model"] for a in ADVENTURES}
    M["EncounterModel"] = {str(e["id"]): e["model"] for e in ENCOUNTERS}
    M["EncounterGroupModel"] = {str(g["_id"]): g for g in GROUPS}
    M["TileModel"] = tile_models
    M["ProductModel"] = {str(PRODUCT): {"m_Name": f"{PRODUCT}_Demo Set", "Standalone": 1, "NameKey": "PROD_DEMO_TITLE", "DescriptionKey": "PROD_DEMO_DESC", "ContentsKey": "PROD_DEMO_CONTENTS",
                               "Tiles": [ref("TileModel", c, c) for c in sorted(tile_models)],
                               "Enemies": [ref("EnemyModel", e[0]) for e in ENEMIES],
                               "Items": [{"Item": ref("ItemModel", i[0]), "Quantity": ITEM_COPIES.get(i[0], 1)} for i in ITEMS],
                               "Heroes": [ref("HeroModel", h[0]) for h in HEROES],
                               "Skills": [{"Skill": ref("SkillModel", s[0]), "Quantity": 3} for s in SKILLS],
                               "Encounters": [ref("EncounterModel", e["id"], e["model"]["m_Name"]) for e in ENCOUNTERS],
                               "Roles": [ref("RoleModel", r[0]) for r in ROLES], "Titles": [ref("TitleModel", t[0]) for t in TITLES],
                               "EncounterGroups": [ref("EncounterGroupModel", g["_id"], g["m_Name"]) for g in GROUPS]}}
    return {"format": "jime-db", "formatVersion": 1, "models": M, "standardTiles": standard, "globals": SYSTEM_GLOBALS, "tiles": tiles, "productOrder": [PRODUCT]}


# ------------------------------------------------------------------ art
def build_art(db):
    heroes = {}
    for h, k, letter, col, *_ in HEROES:
        save_png(portrait(letter, col, 256), f"images/heroes/{h}.png")
        save_png(portrait(letter, col, 96), f"images/heroes/{h}_icon.png")
        heroes[str(h)] = {"name": f"{k}_NAME", "icon": f"images/heroes/{h}_icon.png", "portrait": f"images/heroes/{h}.png"}
    write_json("images/heroes/heroes.json", heroes)
    letters = {"ENEMY_DEMO_BANDIT": "Р", "ENEMY_DEMO_WOLF": "В", "ENEMY_DEMO_SHADE": "Т"}
    write_json("images/enemies/enemies.json", {str(i): save_png(portrait(letters[k], (110, 50, 45), 128), f"images/enemies/{i}.png") for i, k, *_ in ENEMIES})
    write_json("images/items/items.json", {str(i): {"Icon": save_png(portrait(TEXTS[k]["ru"][0], (90, 80, 60), 96), f"images/items/{i}.png")} for i, k, *_ in ITEMS})
    camp = card(1024, 576, TEXTS["CAM_DEMO_TITLE"]["ru"], "JiME Reborn · демо", (40, 52, 70), (20, 18, 22))
    write_json("images/campaigns/campaigns.json", {str(CAMPAIGN): {"Image": save_png(camp, f"images/campaigns/{CAMPAIGN}.png"),
                                                                    "ThumbnailImage": save_png(camp.resize((256, 144)), f"images/campaigns/{CAMPAIGN}_thumb.png")}})
    advs = {}
    for a in ADVENTURES:
        img = card(1024, 576, TEXTS[a["model"]["NameKey"]]["ru"], TEXTS[a["model"]["LocationKey"]]["ru"], (60, 70, 50), (25, 22, 18))
        advs[str(a["id"])] = {"LocationArt": save_png(img, f"images/adventures/{a['id']}.png")}
    write_json("images/adventures/adventures.json", advs)
    # the campaign's map (demo_map.py): the picture, where each adventure is, the names on it
    pic = draw_map(2400, 1500).convert("RGB")
    rel = "images/campaigns/9001_map.jpg"
    os.makedirs(os.path.join(OUT, "images", "campaigns"), exist_ok=True)
    pic.save(os.path.join(OUT, rel), quality=86, optimize=True)
    write_json("images/campaigns/maps.json", {str(CAMPAIGN): {"image": rel, "zoom": 2.4, "labels": MAP_LABELS,
                                                              "locations": {str(k): v for k, v in MAP_LOCATIONS.items()}}})
    cuts = {}
    for i in (str(c[0]) for c in CUTSCENES):
        img = card(1280, 720, "", "", (30, 34, 44) if i != "9003" else (44, 24, 24), (12, 12, 14))
        cuts[i] = {"Texture": save_png(img, f"images/cutscenes/{i}.png")}
    write_json("images/cutscenes/cutscenes.json", cuts)
    write_json("images/products/products.json", {str(PRODUCT): {"Image": save_png(card(512, 512, "Демо", "JiME Reborn", (70, 60, 40), (30, 26, 20)), f"images/products/{PRODUCT}.png")}})
    # tokens by Token3DType: explore (1), search (2), threat (3), person (7)
    tokens = {}
    for tid, letter, col in [(1, "?", (60, 90, 120)), (2, "◎", (150, 120, 60)), (3, "!", (140, 50, 40)), (7, "☺", (70, 110, 80))]:
        tokens[str(tid)] = {"top": save_png(portrait(letter, col, 128, sym=True), f"images/tokens/{tid}.png")}
    write_json("images/tokens/tokens.json", tokens)


# ------------------------------------------------------------------ pack listings
def index_pack(dirpath):
    out = []
    for base, _, files in os.walk(dirpath):
        for f in files:
            rel = os.path.relpath(os.path.join(base, f), dirpath).replace("\\", "/")
            if rel != "__index.json":
                out.append(rel)
    return sorted(out)


def main():
    if os.path.exists(OUT):
        shutil.rmtree(OUT)
    os.makedirs(OUT)
    tiles, standard, tile_models, art = build_tiles()
    db = build_db(tile_models, standard, tiles)
    write_json("scenario/db.json", db)
    write_json("scenario/tileart.json", {"standard": art, "custom": {}})
    for a in ADVENTURES:
        write_json(f"scenario/adventures/{a['id']}.json", a["prefab"])
    for e in ENCOUNTERS:
        write_json(f"scenario/encounters/{e['id']}.json", e["prefab"])
    build_art(db)
    missing = sorted({k for k in TEXTS if not all(TEXTS[k].get(l) for l in LANGS)})
    if missing:
        print("texts without every language:", ", ".join(missing[:20]))
    for lang in LANGS:
        write_csv(f"lang/{lang}.csv", lang_rows(lang))
    manifest = {
        "formatVersion": 1, "id": PACK_ID,
        "name": {"ru": "Демо: Тени над Серым Бродом", "en": "Demo: Shadows over Greyford", "it": "Demo: Ombre su Guadogrigio"},
        "description": "A small open campaign of JiME Reborn (no content of the original game).",
        # below an imported game (priority 0): where both name the same thing (interface texts, token art) the game wins
        "version": "0.1.0", "priority": -10, "origin": "bundled", "license": "MIT",
        "contents": [{"type": "scenario", "path": "scenario"}] + [{"type": "lang", "lang": l, "path": f"lang/{l}.csv"} for l in LANGS],
    }
    write_json("pack.json", manifest)
    write_json("__index.json", index_pack(OUT))
    lst = []
    for d in sorted(os.listdir(BUNDLED)):
        p = os.path.join(BUNDLED, d, "pack.json")
        if os.path.isdir(os.path.join(BUNDLED, d)) and os.path.exists(p):
            lst.append({"dir": d, "manifest": json.load(open(p, encoding="utf-8"))})
    with open(os.path.join(BUNDLED, "__list.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump(lst, f, ensure_ascii=False, indent=1)
        f.write("\n")
    files = index_pack(OUT)
    size = sum(os.path.getsize(os.path.join(OUT, f)) for f in files)
    print(f"{PACK_ID}: {len(files)} files, {size / 1024:.0f} KB -> {OUT}")


if __name__ == "__main__":
    main()
