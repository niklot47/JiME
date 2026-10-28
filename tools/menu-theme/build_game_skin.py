"""
The in-game interface of this app's own look (threat bar, enemy bar and medallions, round buttons, dialogs): one sheet,
cut into the sprites the game screen asks for by the original NGUI sprite names (Threat_Event2, Enemy_Frame_Normal ...,
see apps/app/src/screens/game/Hud.tsx, Dialogs.tsx). The sizes and 9-slice borders are the original sprites' ones, so
the screen's layout fits them as it is.

  build(out_dir, custom_sheet=None)
    writes <out_dir>/images/ui-skin/game_atlas.png   the sheet (template drawn here, or a repainted copy)
           <out_dir>/images/ui-skin/game_guide.png   the markup alone (transparent): lay it over the sheet as a layer
           <out_dir>/images/ui/atlas/<Name>.png      every sprite cut out
           <out_dir>/images/ui/atlas/atlas.json      name -> {file, w, h, border [left, right, top, bottom]}

The imported game (core-ffg, priority 0) is above the theme pack (priority -20), so its own atlas wins while it is
enabled; this one is the look without it. Unlike the menu skin the sheet is 1:1 with the sprites (no SCALE).
"""
import json
import math
import os

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

from build_skin import GAP, GOLD, font, guide, layout, rounded, sheet_from, write_regions

# name, w, h, border [left, right, top, bottom] (NGUI order, as images/ui/atlas/atlas.json), hints for the guide
GAME = [
    ("Threat_Meter", 1024, 74, [0, 0, 0, 0], [("track (transparent)", 0.056, 0.28, 0.844, 0.72), ("value", 0.865, 0.0, 0.995, 1.0)]),
    ("Enemy_Bar", 1024, 44, [0, 0, 0, 0], []),
    ("Threat_Gradient", 64, 4, [0, 0, 0, 0], []),
    ("Threat_Liquid", 256, 256, [0, 0, 0, 0], [("tiles, overlay", 0, 0, 1, 1)]),
    ("Threat_Fire", 128, 128, [0, 0, 0, 0], []),
    ("Threat_Event2", 127, 128, [0, 0, 0, 0], [("number", 0.3, 0.32, 0.7, 0.68)]),
    ("DarknessToken", 128, 128, [0, 0, 0, 0], []),
    ("Button_Party", 128, 128, [0, 0, 0, 0], []),
    ("Button_EndRound", 128, 128, [0, 0, 0, 0], []),
    ("Button_Provoke", 128, 128, [0, 0, 0, 0], []),
    ("Options_Button_toggled", 128, 128, [0, 0, 0, 0], [("icon", 0.18, 0.18, 0.82, 0.82)]),
    ("header_icon_settings", 62, 62, [0, 0, 0, 0], []),
    ("Enemy_Frame_Normal", 195, 195, [0, 0, 0, 0], [("portrait", 0.128, 0.093, 0.872, 0.826)]),
    ("Enemy_Frame_Elite", 197, 255, [0, 0, 0, 0], [("normal frame", 0.005, 0.0725, 0.995, 0.836)]),
    ("Generic_Circle2", 64, 64, [30, 30, 30, 30], []),
    ("Icon_Armor", 63, 64, [0, 0, 0, 0], []),
    ("Icon_Skull", 64, 106, [0, 0, 0, 0], []),
    ("Enemy_HealthBarBG", 256, 35, [0, 0, 0, 0], []),
    ("Dialog_Round", 220, 108, [0, 0, 48, 48], []),
    ("Dialog_Chronicle", 537, 73, [0, 0, 30, 30], []),
    ("Enemy_9_Slice", 256, 167, [122, 122, 75, 75], []),
    ("Button_Generic", 80, 83, [34, 34, 37, 37], []),
    ("Button_Arrowless", 221, 66, [45, 45, 33, 33], []),
    ("Button_MessageBox", 230, 78, [68, 68, 0, 0], []),
    ("Button_CombatDialog", 152, 186, [0, 0, 0, 0], []),
    ("Damage_Holder", 244, 246, [0, 0, 0, 0], [("value", 0.25, 0.25, 0.75, 0.75)]),
    ("Frame_Empty", 64, 37, [32, 32, 9, 28], []),
    ("Frame_Lore", 300, 101, [0, 0, 0, 0], []),
    ("StartingItemFrame", 412, 125, [0, 0, 0, 0], []),
    ("HeroFrame", 216, 512, [0, 0, 104, 48], [("portrait", 0.1, 0.06, 0.9, 0.8)]),
    ("Dialog_HeroMenu", 785, 511, [83, 0, 0, 0], []),
]

USE = {
    "Threat_Meter": "the threat bar's frame (the track window stays transparent)", "Enemy_Bar": "the bar of enemies at the bottom",
    "Threat_Gradient": "the threat fill's colours left to right", "Threat_Liquid": "the moving texture in the threat fill (tiles)",
    "Threat_Fire": "the burning edge of the threat fill", "Threat_Event2": "threat event markers on the bar", "DarknessToken": "the darkness mark",
    "Button_Party": "the party button (bottom left)", "Button_EndRound": "end the round (bottom right)", "Button_Provoke": "provoke",
    "Options_Button_toggled": "the settings button's plate", "header_icon_settings": "the gear on it",
    "Enemy_Frame_Normal": "an enemy medallion (portrait inside)", "Enemy_Frame_Elite": "the named enemy's crown and banner",
    "Generic_Circle2": "the glow of an enemy that can be attacked", "Icon_Armor": "armour", "Icon_Skull": "a defeated mark",
    "Enemy_HealthBarBG": "an enemy's health bar", "Dialog_Round": "the phase plate", "Dialog_Chronicle": "chronicle rows",
    "Enemy_9_Slice": "the enemy window", "Button_Generic": "green buttons of messages", "Button_Arrowless": "buttons of choices",
    "Button_MessageBox": "message box buttons", "Button_CombatDialog": "the attack dialog's buttons", "Damage_Holder": "the damage value",
    "Frame_Empty": "an empty slot", "Frame_Lore": "the lore frame", "StartingItemFrame": "item rows", "HeroFrame": "a hero's card in the party menu",
    "Dialog_HeroMenu": "the party menu",
}

DARK = (34, 27, 20, 255)
DARK2 = (22, 18, 13, 255)
RIM = (107, 85, 54, 255)
GOLD2 = (226, 190, 110, 255)
RED = (120, 28, 18, 255)


def ss(w, h, fn, k=3):
    """Draw at k times the size and scale down (antialiased shapes)"""
    big = Image.new("RGBA", (w * k, h * k), (0, 0, 0, 0))
    fn(ImageDraw.Draw(big), w * k, h * k, k)
    return big.resize((w, h), Image.LANCZOS)


def medallion(w, h, icon=None, fill=DARK, rim=GOLD):
    def f(d, W, H, k):
        m = 4 * k
        d.ellipse([m, m, W - m, H - m], fill=(10, 8, 6, 160))
        d.ellipse([m + 2 * k, m + 2 * k, W - m - 2 * k, H - m - 2 * k], fill=fill, outline=rim, width=5 * k)
        d.ellipse([m + 10 * k, m + 10 * k, W - m - 10 * k, H - m - 10 * k], outline=(255, 235, 190, 40), width=2 * k)
        if icon:
            icon(d, W, H, k)
    return ss(w, h, f)


def icon_hourglass(d, W, H, k):
    cx, t, b, s = W / 2, H * 0.27, H * 0.73, W * 0.17
    d.polygon([(cx - s, t), (cx + s, t), (cx, H / 2)], fill=GOLD2)
    d.polygon([(cx - s, b), (cx + s, b), (cx, H / 2)], fill=GOLD2)
    d.line([(cx - s * 1.2, t), (cx + s * 1.2, t)], fill=GOLD2, width=4 * k)
    d.line([(cx - s * 1.2, b), (cx + s * 1.2, b)], fill=GOLD2, width=4 * k)


def icon_party(d, W, H, k):
    for dx, r in ((-0.13, 0.085), (0.13, 0.085), (0, 0.1)):
        cx, cy = W * (0.5 + dx), H * (0.42 if dx == 0 else 0.45)
        d.ellipse([cx - W * r, cy - W * r, cx + W * r, cy + W * r], fill=GOLD2 if dx == 0 else GOLD)
        d.pieslice([cx - W * r * 1.9, cy + W * r * 0.9, cx + W * r * 1.9, cy + W * r * 4.4], 180, 360, fill=GOLD2 if dx == 0 else GOLD)


def icon_bang(d, W, H, k):
    cx = W / 2
    d.polygon([(cx - W * 0.06, H * 0.25), (cx + W * 0.06, H * 0.25), (cx + W * 0.03, H * 0.6), (cx - W * 0.03, H * 0.6)], fill=GOLD2)
    d.ellipse([cx - W * 0.05, H * 0.66, cx + W * 0.05, H * 0.76], fill=GOLD2)


def icon_gear(d, W, H, k, color=GOLD2):
    cx, cy, r = W / 2, H / 2, W * 0.3
    pts = []
    for i in range(16):
        a = i * math.pi / 8
        rr = r if i % 2 == 0 else r * 0.78
        for da in (-0.13, 0.13):
            pts.append((cx + rr * math.cos(a + da), cy + rr * math.sin(a + da)))
    d.polygon(pts, fill=color)
    d.ellipse([cx - r * 0.38, cy - r * 0.38, cx + r * 0.38, cy + r * 0.38], fill=(0, 0, 0, 0))


def icon_eye(d, W, H, k):
    cx, cy = W / 2, H / 2
    d.ellipse([cx - W * 0.25, cy - H * 0.13, cx + W * 0.25, cy + H * 0.13], fill=(150, 120, 210, 255))
    d.ellipse([cx - W * 0.07, cy - H * 0.11, cx + W * 0.07, cy + H * 0.11], fill=(15, 8, 25, 255))


def threat_meter(w, h):
    def f(d, W, H, k):
        x0, x1 = W * 0.03, W * 0.855
        d.rounded_rectangle([x0, H * 0.14, x1, H * 0.86], H * 0.3, fill=DARK, outline=GOLD, width=3 * k)
        # the track window stays transparent: the fill is drawn under the frame
        d.rounded_rectangle([W * 0.056, H * 0.28, W * 0.844, H * 0.72], H * 0.1, fill=(0, 0, 0, 0))
        d.rounded_rectangle([W * 0.054, H * 0.26, W * 0.846, H * 0.74], H * 0.11, outline=RIM, width=2 * k)
        # value plate
        d.rounded_rectangle([W * 0.865, H * 0.04, W * 0.995, H * 0.96], H * 0.35, fill=DARK2, outline=GOLD, width=3 * k)
        d.rounded_rectangle([W * 0.872, H * 0.14, W * 0.988, H * 0.86], H * 0.28, outline=(255, 235, 190, 45), width=2 * k)
        for xx in (x0 + H * 0.2, x1 - H * 0.2):
            d.ellipse([xx - H * 0.07, H / 2 - H * 0.07, xx + H * 0.07, H / 2 + H * 0.07], fill=GOLD)
    img = ss(w, h, f)
    a = np.array(img)
    y0, y1, xa, xb = int(h * 0.28), int(h * 0.72), int(w * 0.056), int(w * 0.844)
    a[y0:y1, xa:xb, 3] = 0
    return Image.fromarray(a)


def enemy_bar(w, h):
    img = Image.new("RGBA", (w, h))
    d = ImageDraw.Draw(img)
    for y in range(h):
        t = y / (h - 1)
        d.line([(0, y), (w, y)], fill=(int(52 - 30 * t), int(24 - 12 * t), int(20 - 10 * t), 235))
    d.line([(0, 1), (w, 1)], fill=GOLD, width=2)
    d.line([(0, 4), (w, 4)], fill=(90, 60, 30, 200), width=1)
    return img


def liquid(w, h, seed=3):
    rng = np.random.default_rng(seed)
    n = rng.random((h // 8, w // 8))
    big = np.kron(n, np.ones((8, 8)))
    t = np.tile(big, (3, 3))
    img = Image.fromarray((t * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(6))
    a = np.array(img)[h:2 * h, w:2 * w].astype(float)
    a = (a - a.min()) / max(1, a.max() - a.min())
    g = (90 + 140 * a).astype(np.uint8)
    return Image.fromarray(np.dstack([g, g, g, np.full_like(g, 255)]))


def fire(w, h):
    yy, xx = np.mgrid[0:h, 0:w]
    dx, dy = (xx - w / 2) / (w * 0.22), (yy - h * 0.58) / (h * 0.42)
    r = np.sqrt(dx * dx + dy * dy)
    v = np.clip(1 - r, 0, 1) ** 1.6
    rgb = np.dstack([255 * np.ones_like(v), 120 + 120 * v, 30 + 150 * v ** 2])
    return Image.fromarray(np.dstack([rgb, 255 * v]).astype(np.uint8))


def gradient(w, h):
    stops = [(0, (0x52, 0x11, 0x0d)), (0.33, (0x8c, 0x10, 0x00)), (0.66, (0xc0, 0x4a, 0x10)), (1, (0xe7, 0x86, 0x21))]
    img = Image.new("RGBA", (w, h))
    for x in range(w):
        t = x / (w - 1)
        for (a, ca), (b, cb) in zip(stops, stops[1:]):
            if a <= t <= b:
                k = (t - a) / (b - a)
                c = tuple(int(ca[i] + (cb[i] - ca[i]) * k) for i in range(3))
        for y in range(h):
            img.putpixel((x, y), (*c, 255))
    return img


def enemy_frame(w, h):
    def f(d, W, H, k):
        cx, cy = W / 2, H * 0.46
        r = W * 0.41
        d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=GOLD, width=7 * k)
        d.ellipse([cx - r + 7 * k, cy - r + 7 * k, cx + r - 7 * k, cy + r - 7 * k], outline=RIM, width=3 * k)
        d.rounded_rectangle([W * 0.22, H * 0.8, W * 0.78, H * 0.97], 8 * k, fill=DARK, outline=GOLD, width=3 * k)
    img = ss(w, h, f)
    a = np.array(img)
    yy, xx = np.mgrid[0:h, 0:w]
    inside = ((xx - w / 2) ** 2 + (yy - h * 0.46) ** 2) < (w * 0.37) ** 2
    a[inside & (yy < h * 0.8), 3] = 0
    return Image.fromarray(a)


def elite_frame(w, h):
    def f(d, W, H, k):
        cx, cy = W / 2, H * (0.0725 + 0.46 * 0.7635)
        r = W * 0.44
        d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=(200, 40, 30, 255), width=5 * k)
        # crown above
        top = H * 0.075
        pts = [(W * 0.3, top + H * 0.06), (W * 0.36, 0 + 4 * k), (W * 0.43, top), (W * 0.5, 2 * k), (W * 0.57, top), (W * 0.64, 4 * k), (W * 0.7, top + H * 0.06)]
        d.polygon(pts + [(W * 0.7, top + H * 0.09), (W * 0.3, top + H * 0.09)], fill=GOLD2, outline=(120, 90, 40, 255))
        # banner below
        y0 = H * 0.84
        d.polygon([(W * 0.1, y0), (W * 0.9, y0), (W * 0.82, H * 0.92), (W * 0.9, H - 2 * k), (W * 0.1, H - 2 * k), (W * 0.18, H * 0.92)],
                  fill=RED, outline=GOLD, width=3 * k)
    return ss(w, h, f)


def glow(w, h):
    yy, xx = np.mgrid[0:h, 0:w]
    r = np.sqrt((xx - w / 2 + 0.5) ** 2 + (yy - h / 2 + 0.5) ** 2) / (w / 2)
    v = np.clip(1 - np.abs(r - 0.82) / 0.18, 0, 1)
    return Image.fromarray(np.dstack([np.full_like(v, 255), np.full_like(v, 215), np.full_like(v, 120), 255 * v]).astype(np.uint8))


def armor(w, h):
    def f(d, W, H, k):
        d.polygon([(W * 0.5, H * 0.05), (W * 0.9, H * 0.18), (W * 0.84, H * 0.6), (W * 0.5, H * 0.95), (W * 0.16, H * 0.6), (W * 0.1, H * 0.18)],
                  fill=(110, 118, 130, 255), outline=(220, 225, 230, 255), width=3 * k)
        d.line([(W * 0.5, H * 0.12), (W * 0.5, H * 0.86)], fill=(220, 225, 230, 180), width=2 * k)
    return ss(w, h, f)


def skull(w, h):
    def f(d, W, H, k):
        d.ellipse([W * 0.12, H * 0.15, W * 0.88, H * 0.6], fill=(225, 215, 190, 255))
        d.rounded_rectangle([W * 0.28, H * 0.5, W * 0.72, H * 0.75], 6 * k, fill=(225, 215, 190, 255))
        for ex in (0.34, 0.66):
            d.ellipse([W * (ex - 0.11), H * 0.33, W * (ex + 0.11), H * 0.47], fill=(30, 20, 15, 255))
        for tx in (0.38, 0.5, 0.62):
            d.line([(W * tx, H * 0.64), (W * tx, H * 0.75)], fill=(30, 20, 15, 255), width=2 * k)
    return ss(w, h, f)


def button(w, h, green=False, r=14):
    if green:
        return rounded(w, h, r, (78, 98, 46, 255), (48, 64, 28, 255), (160, 170, 100, 255))
    return rounded(w, h, r, (58, 46, 34, 255), (42, 33, 25, 255), GOLD)


def panel(w, h, r=18, a=235):
    img = rounded(w, h, r, (30, 24, 18, a), (18, 15, 12, a), GOLD)
    d = ImageDraw.Draw(img)
    for x, y in ((14, 14), (w - 15, 14), (14, h - 15), (w - 15, h - 15)):
        d.ellipse([x - 4, y - 4, x + 4, y + 4], outline=GOLD, width=2)
    return img


def draw(name, w, h):
    if name == "Threat_Meter":
        return threat_meter(w, h)
    if name == "Enemy_Bar":
        return enemy_bar(w, h)
    if name == "Threat_Gradient":
        return gradient(w, h)
    if name == "Threat_Liquid":
        return liquid(w, h)
    if name == "Threat_Fire":
        return fire(w, h)
    if name == "Threat_Event2":
        return medallion(w, h, fill=RED, rim=GOLD2)
    if name == "DarknessToken":
        return medallion(w, h, icon_eye, fill=(30, 18, 45, 255), rim=(150, 120, 210, 255))
    if name == "Button_Party":
        return medallion(w, h, icon_party)
    if name == "Button_EndRound":
        return medallion(w, h, icon_hourglass)
    if name == "Button_Provoke":
        def f(d, W, H, k):
            d.rounded_rectangle([4 * k, 4 * k, W - 4 * k, H - 4 * k], 22 * k, fill=RED, outline=GOLD, width=5 * k)
            icon_bang(d, W, H, k)
        return ss(w, h, f)
    if name == "Options_Button_toggled":
        return medallion(w, h)
    if name == "header_icon_settings":
        return ss(w, h, icon_gear)
    if name == "Enemy_Frame_Normal":
        return enemy_frame(w, h)
    if name == "Enemy_Frame_Elite":
        return elite_frame(w, h)
    if name == "Generic_Circle2":
        return glow(w, h)
    if name == "Icon_Armor":
        return armor(w, h)
    if name == "Icon_Skull":
        return skull(w, h)
    if name == "Enemy_HealthBarBG":
        return rounded(w, h, 12, (16, 12, 9, 240), (28, 22, 16, 240), RIM, inner=False)
    if name in ("Dialog_Round", "Dialog_Chronicle", "Frame_Lore", "StartingItemFrame"):
        return panel(w, h, r=min(24, h // 3))
    if name in ("Enemy_9_Slice", "Dialog_HeroMenu", "HeroFrame"):
        return panel(w, h, r=24)
    if name == "Button_Generic":
        return button(w, h, green=True, r=20)
    if name in ("Button_Arrowless", "Button_MessageBox"):
        return button(w, h, r=20)
    if name == "Button_CombatDialog":
        return rounded(w, h, 18, (52, 42, 30, 240), (36, 29, 21, 240), GOLD, bw=3)
    if name == "Damage_Holder":
        return medallion(w, h, fill=DARK2)
    if name == "Frame_Empty":
        return rounded(w, h, 8, (24, 20, 14, 220), (30, 25, 18, 220), RIM, inner=False)
    return Image.new("RGBA", (w, h), (255, 0, 255, 255))


def build(out_dir, custom_sheet=None):
    d = os.path.join(out_dir, "images", "ui-skin")
    a_dir = os.path.join(out_dir, "images", "ui", "atlas")
    os.makedirs(d, exist_ok=True)
    os.makedirs(a_dir, exist_ok=True)
    pos, W, H = layout(GAME, max_w=1024 + 2 * GAP, fit_labels=True)
    sheet = sheet_from(custom_sheet, GAME, pos, (W, H), draw)
    if custom_sheet:
        write_regions(custom_sheet, GAME, pos)
    sheet.save(os.path.join(d, "game_atlas.png"), optimize=True)
    # guide slices are [top, right, bottom, left]
    guide((W, H), [(n, pos[n], w, h, [b[2], b[1], b[3], b[0]], hints) for n, w, h, b, hints in GAME]).save(
        os.path.join(d, "game_guide.png"), optimize=True)
    index = {}
    files = ["images/ui-skin/game_atlas.png", "images/ui-skin/game_guide.png", "images/ui/atlas/atlas.json"]
    for name, w, h, border, _ in GAME:
        x, y = pos[name]
        sheet.crop((x, y, x + w, y + h)).save(os.path.join(a_dir, f"{name}.png"), optimize=True)
        index[name] = {"file": f"images/ui/atlas/{name}.png", "w": w, "h": h, "border": border}
        files.append(f"images/ui/atlas/{name}.png")
    with open(os.path.join(a_dir, "atlas.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump(index, f, indent=1)
        f.write("\n")
    return files


if __name__ == "__main__":
    import sys
    build(sys.argv[1] if len(sys.argv) > 1 else "data/out/game-skin-template")
    print("ok")
