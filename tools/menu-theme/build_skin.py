"""
The interface skin of this app's own menus: one atlas picture + skin.json (named regions, each with the borders that do
not stretch - "9-slice"). The app cuts the regions out and draws buttons, panels, cards, fields with them (ui/skin.ts).

  build(out_dir, custom_atlas=None)
    writes <out_dir>/images/ui-skin/atlas.png   the template, drawn in the current look (or a repainted copy)
           <out_dir>/images/ui-skin/guide.png   the same with every region outlined, named, its fixed borders marked
           <out_dir>/images/ui-skin/skin.json   regions: name -> [x, y, w, h], slice [top, right, bottom, left]

To repaint: take atlas.png (and guide.png to see what is where), paint over it keeping every region in its place and size,
put it next to the theme's pictures as ui-skin/atlas.png and rebuild the theme (tools/menu-theme/build_theme.py), or drop
it into a pack of your own as images/ui-skin/atlas.png together with skin.json. The atlas is drawn at twice the screen
size (SCALE): a 160 x 64 button region is an 80 x 32 point button edge.
"""
import json
import os

from PIL import Image, ImageDraw, ImageFont

SCALE = 2
GAP = 12

# name -> (w, h, slice) in atlas pixels; slice = fixed borders [top, right, bottom, left]
REGIONS = [
    ("button", 160, 64, [16, 16, 16, 16]),
    ("button.hover", 160, 64, [16, 16, 16, 16]),
    ("button.pressed", 160, 64, [16, 16, 16, 16]),
    ("button.disabled", 160, 64, [16, 16, 16, 16]),
    ("button.primary", 160, 64, [16, 16, 16, 16]),
    ("button.primary.hover", 160, 64, [16, 16, 16, 16]),
    ("panel", 200, 200, [40, 40, 40, 40]),
    ("panel.header", 200, 60, [12, 40, 12, 40]),
    ("card", 128, 128, [24, 24, 24, 24]),
    ("card.hover", 128, 128, [24, 24, 24, 24]),
    ("card.on", 128, 128, [24, 24, 24, 24]),
    ("input", 128, 60, [14, 14, 14, 14]),
    ("seg", 96, 52, [14, 14, 14, 14]),
    ("seg.on", 96, 52, [14, 14, 14, 14]),
    ("checkbox", 40, 40, [0, 0, 0, 0]),
    ("checkbox.on", 40, 40, [0, 0, 0, 0]),
    ("badge", 48, 48, [0, 0, 0, 0]),
    ("divider", 256, 16, [0, 40, 0, 40]),
    ("logo", 600, 220, [0, 0, 0, 0]),
]

INK = (234, 223, 198, 255)
GOLD = (201, 163, 90, 255)


def font(size, bold=False):
    for f in (["georgiab.ttf", "DejaVuSerif-Bold.ttf"] if bold else ["georgia.ttf", "DejaVuSerif.ttf"]):
        for d in ("C:/Windows/Fonts", "/usr/share/fonts/truetype/dejavu"):
            p = os.path.join(d, f)
            if os.path.exists(p):
                return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def rounded(w, h, r, top, bottom, border, bw=2, glow=None, inner=True):
    """A rounded box: vertical gradient top -> bottom, a border, a faint inner highlight, an optional outer glow"""
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    pad = 6 if glow else 0
    grad = Image.new("RGBA", (w, h))
    gd = ImageDraw.Draw(grad)
    for y in range(h):
        k = y / max(1, h - 1)
        gd.line([(0, y), (w, y)], fill=tuple(int(top[i] + (bottom[i] - top[i]) * k) for i in range(4)))
    mask = Image.new("L", (w, h), 0)
    ImageDraw.Draw(mask).rounded_rectangle([pad, pad, w - 1 - pad, h - 1 - pad], r, fill=255)
    if glow:
        g = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        ImageDraw.Draw(g).rounded_rectangle([1, 1, w - 2, h - 2], r + pad, outline=glow, width=pad)
        img.alpha_composite(g)
    img.paste(grad, (0, 0), mask)
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([pad, pad, w - 1 - pad, h - 1 - pad], r, outline=border, width=bw)
    if inner:
        d.line([(pad + r, pad + bw + 1), (w - 1 - pad - r, pad + bw + 1)], fill=(255, 240, 210, 40), width=2)
    return img


def draw(name, w, h):
    if name.startswith("button"):
        if ".primary" in name:
            hi = ".hover" in name
            return rounded(w, h, 12, (130 if hi else 110, 100 if hi else 83, 46 if hi else 38, 255), (92 if hi else 77, 70 if hi else 58, 33 if hi else 27, 255), (226, 190, 110, 255) if hi else GOLD)
        if ".hover" in name:
            return rounded(w, h, 12, (72, 57, 42, 255), (52, 41, 31, 255), (140, 112, 72, 255))
        if ".pressed" in name:
            return rounded(w, h, 12, (36, 29, 21, 255), (48, 38, 28, 255), (107, 85, 54, 255), inner=False)
        if ".disabled" in name:
            return rounded(w, h, 12, (58, 46, 34, 115), (42, 33, 25, 115), (107, 85, 54, 115), inner=False)
        return rounded(w, h, 12, (58, 46, 34, 255), (42, 33, 25, 255), (107, 85, 54, 255))
    if name == "panel":
        img = rounded(w, h, 20, (26, 21, 16, 225), (18, 15, 12, 225), (90, 70, 48, 255))
        d = ImageDraw.Draw(img)
        # little corner ornaments
        for x, y in ((14, 14), (w - 15, 14), (14, h - 15), (w - 15, h - 15)):
            d.ellipse([x - 4, y - 4, x + 4, y + 4], outline=GOLD, width=2)
        return img
    if name == "panel.header":
        img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        d = ImageDraw.Draw(img)
        d.line([(30, h - 6), (w - 30, h - 6)], fill=(60, 47, 32, 255), width=2)
        d.polygon([(w // 2 - 8, h - 6), (w // 2, h - 12), (w // 2 + 8, h - 6), (w // 2, h)], fill=GOLD)
        return img
    if name.startswith("card"):
        if name == "card.on":
            return rounded(w, h, 16, (52, 42, 30, 235), (36, 29, 21, 235), (226, 183, 102, 255), bw=3, glow=(226, 183, 102, 90))
        if name == "card.hover":
            return rounded(w, h, 16, (50, 40, 30, 230), (38, 31, 23, 230), (120, 96, 62, 255))
        return rounded(w, h, 16, (42, 34, 25, 220), (34, 27, 20, 220), (76, 60, 40, 255))
    if name == "input":
        return rounded(w, h, 10, (24, 20, 14, 255), (30, 25, 18, 255), (107, 85, 54, 255), inner=False)
    if name.startswith("seg"):
        if name == "seg.on":
            return rounded(w, h, 10, (110, 83, 38, 255), (80, 60, 28, 255), (226, 183, 102, 255))
        return rounded(w, h, 10, (44, 35, 26, 255), (36, 29, 21, 255), (90, 70, 48, 255))
    if name.startswith("checkbox"):
        img = rounded(w, h, 6, (27, 22, 16, 255), (34, 28, 20, 255), (140, 112, 72, 255), inner=False)
        if name.endswith(".on"):
            ImageDraw.Draw(img).line([(10, 21), (17, 29), (31, 11)], fill=(240, 205, 120, 255), width=5, joint="curve")
        return img
    if name == "badge":
        img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        d = ImageDraw.Draw(img)
        d.ellipse([2, 2, w - 3, h - 3], fill=GOLD, outline=(120, 90, 40, 255), width=2)
        d.ellipse([8, 6, w - 14, h // 2], fill=(255, 235, 180, 70))
        return img
    if name == "divider":
        img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        d = ImageDraw.Draw(img)
        d.line([(4, h // 2), (w - 5, h // 2)], fill=(107, 85, 54, 255), width=2)
        d.polygon([(w // 2 - 7, h // 2), (w // 2, h // 2 - 7), (w // 2 + 7, h // 2), (w // 2, h // 2 + 7)], fill=GOLD)
        return img
    if name == "logo":
        img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        d = ImageDraw.Draw(img)
        f1, f2 = font(130, True), font(52, True)
        d.text((8, 0), "JiME", font=f1, fill=(240, 220, 174, 255), stroke_width=3, stroke_fill=(30, 20, 10, 200))
        d.text((14, 150), "R e b o r n", font=f2, fill=GOLD, stroke_width=2, stroke_fill=(30, 20, 10, 200))
        return img
    return Image.new("RGBA", (w, h), (255, 0, 255, 255))


def layout(max_w=1024):
    """Shelf packing in the list's order (stable: the same regions land in the same places)"""
    # room under each region for its name in the guide, and small regions get a wider slot for it
    x = y = GAP
    row = 0
    pos = {}
    for name, w, h, _ in REGIONS:
        slot = max(w, 110)
        if x + slot + GAP > max_w:
            x, y, row = GAP, y + row + GAP + 16, 0
        pos[name] = (x, y)
        x += slot + GAP
        row = max(row, h)
    return pos, max_w, y + row + GAP + 16


def build(out_dir, custom_atlas=None):
    d = os.path.join(out_dir, "images", "ui-skin")
    os.makedirs(d, exist_ok=True)
    pos, W, H = layout()
    if custom_atlas and os.path.exists(custom_atlas):
        atlas = Image.open(custom_atlas).convert("RGBA")
        if atlas.size != (W, H):
            raise SystemExit(f"{custom_atlas}: {atlas.size}, the template is {W}x{H} - keep the template's size and places")
    else:
        atlas = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        for name, w, h, _ in REGIONS:
            atlas.alpha_composite(draw(name, w, h), pos[name])
    atlas.save(os.path.join(d, "atlas.png"), optimize=True)
    # the guide: a dark checker under the atlas, every region outlined and named, the fixed borders dashed
    guide = Image.new("RGBA", (W, H), (30, 30, 36, 255))
    gd = ImageDraw.Draw(guide)
    for yy in range(0, H, 16):
        for xx in range(0, W, 16):
            if (xx // 16 + yy // 16) % 2:
                gd.rectangle([xx, yy, xx + 15, yy + 15], fill=(40, 40, 48, 255))
    guide.alpha_composite(atlas)
    gd = ImageDraw.Draw(guide)
    small = font(13)
    for name, w, h, sl in REGIONS:
        x, y = pos[name]
        gd.rectangle([x - 1, y - 1, x + w, y + h], outline=(0, 230, 255, 255), width=1)
        t, r, b, l = sl
        for xx in (x + l, x + w - r) if (l or r) else ():
            for yy in range(y, y + h, 6):
                gd.line([(xx, yy), (xx, min(y + h, yy + 3))], fill=(255, 0, 200, 255))
        for yy in (y + t, y + h - b) if (t or b) else ():
            for xx in range(x, x + w, 6):
                gd.line([(xx, yy), (min(x + w, xx + 3), yy)], fill=(255, 0, 200, 255))
        gd.text((x + 2, y + h + 1), f"{name} {w}x{h}", font=small, fill=(0, 230, 255, 255))
    guide.convert("RGB").save(os.path.join(d, "guide.png"), optimize=True)
    skin = {
        "atlas": "images/ui-skin/atlas.png", "scale": SCALE,
        "regions": {name: {"rect": [*pos[name], w, h], "slice": sl} for name, w, h, sl in REGIONS},
        "colors": {"text": "#eadfc6", "muted": "#b9a582", "accent": "#e2b766", "title": "#f0dcae"},
    }
    with open(os.path.join(d, "skin.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump(skin, f, indent=1)
        f.write("\n")
    return ["images/ui-skin/atlas.png", "images/ui-skin/guide.png", "images/ui-skin/skin.json"]


if __name__ == "__main__":
    import sys
    build(sys.argv[1] if len(sys.argv) > 1 else "data/out/ui-skin-template")
    print("ok")
