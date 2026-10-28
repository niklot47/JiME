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

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

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


def guide(size, regions):
    """
    The markup alone on a transparent picture of the atlas' size, to lay over the atlas as a layer in an image editor:
    every region outlined (cyan) and named with its size, its fixed 9-slice borders dashed (magenta), and the windows that
    must stay transparent or hold something drawn by the app (yellow, named: a portrait, the threat track ...).
    regions: (name, (x, y), w, h, slice [top, right, bottom, left], hints [(label, x0, y0, x1, y1) in 0..1 of the region])
    """
    W, H = size
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    gd = ImageDraw.Draw(img)
    small = font(13)
    tiny = font(11)
    cyan, magenta, yellow = (0, 230, 255, 255), (255, 0, 200, 255), (255, 220, 0, 255)

    def dashed(p0, p1, fill):
        (x0, y0), (x1, y1) = p0, p1
        n = max(1, int(max(abs(x1 - x0), abs(y1 - y0)) // 6))
        for i in range(n):
            a, b = i / n, min(1, (i + 0.5) / n)
            gd.line([(x0 + (x1 - x0) * a, y0 + (y1 - y0) * a), (x0 + (x1 - x0) * b, y0 + (y1 - y0) * b)], fill=fill)

    for name, (x, y), w, h, sl, hints in regions:
        gd.rectangle([x - 1, y - 1, x + w, y + h], outline=cyan, width=1)
        t, r, b, l = sl
        for xx in [v for v in (x + l if l else None, x + w - r if r else None) if v is not None]:
            dashed((xx, y), (xx, y + h), magenta)
        for yy in [v for v in (y + t if t else None, y + h - b if b else None) if v is not None]:
            dashed((x, yy), (x + w, yy), magenta)
        for label, a0, b0, a1, b1 in hints:
            r0 = (x + a0 * w, y + b0 * h, x + a1 * w, y + b1 * h)
            for p, q in (((r0[0], r0[1]), (r0[2], r0[1])), ((r0[2], r0[1]), (r0[2], r0[3])),
                         ((r0[2], r0[3]), (r0[0], r0[3])), ((r0[0], r0[3]), (r0[0], r0[1]))):
                dashed(p, q, yellow)
            gd.text((r0[0] + 3, r0[1] + 2), label, font=tiny, fill=yellow)
        gd.text((x + 2, y + h + 1), f"{name} {w}x{h}", font=small, fill=cyan)
    return img


def layout(regions=None, max_w=1024, fit_labels=False):
    """
    Shelf packing in the list's order (stable: the same regions land in the same places). fit_labels: every slot is at
    least as wide as the region's name in the guide (off for the menu skin, to keep its existing places)
    """
    # room under each region for its name in the guide, and small regions get a wider slot for it
    x = y = GAP
    row = 0
    pos = {}
    small = font(13)
    for name, w, h, *_ in regions or REGIONS:
        slot = max(w, int(small.getlength(f"{name} {w}x{h}")) + 6 if fit_labels else 110)
        if x + slot + GAP > max_w:
            x, y, row = GAP, y + row + GAP + 16, 0
        pos[name] = (x, y)
        x += slot + GAP
        row = max(row, h)
    return pos, max_w, y + row + GAP + 16


# ---------------------------------------------------------------- parts: own pictures of any size instead of atlas rects
# regions that keep their height (the picture is scaled to it, only the middle stretches sideways)
ROW_KINDS = ("button", "seg", "input", "divider", "panel.header", "checkbox", "badge", "logo")
PART_SCALE = 3  # part pictures are stored at 3x the screen size (sharp on HiDPI, still small files)


def _run(d):
    """The stretchable middle: the run around the centre where d stays at the noise level -> (fixed start, fixed end)"""
    n = len(d)
    base = float(np.median(d[int(n * 0.4):max(int(n * 0.4) + 1, int(n * 0.6))]))
    thr = base * 1.6 + 3
    lo = hi = n // 2
    while lo > 0 and d[lo - 1] < thr:
        lo -= 1
    while hi < n - 1 and d[hi + 1] < thr:
        hi += 1
    return lo, n - 1 - hi


def detect_slice(img, row_kind):
    """
    Guess the 9-slice of a frame picture: the columns (rows) that repeat the middle one can stretch, the rest (corners,
    ornaments) stays. Row kinds keep their height: top + bottom take all of it but a 2 px middle.
    Returns [top, right, bottom, left] in the picture's pixels.
    """
    a = np.array(img.filter(ImageFilter.GaussianBlur(2))).astype(float)
    H, W = a.shape[:2]

    def prof(arr):
        w = arr.shape[1]
        c = arr[:, w // 2 - max(1, w // 40):w // 2 + max(1, w // 40)].mean(1)
        return np.abs(arr - c[:, None, :]).mean((0, 2))

    l, r = _run(prof(a))
    if row_kind:
        t = max(1, H // 2 - 1)
        b = H - t - 2
    else:
        t, b = _run(prof(a.transpose(1, 0, 2)))
    # always leave a middle to stretch
    l, r = min(l, W // 2 - 1), min(r, W - W // 2 - 1)
    t, b = min(t, H // 2 - 1), min(b, H - H // 2 - 1)
    return [int(t), int(r), int(b), int(l)]


def largest_piece(img):
    """The biggest opaque piece of the picture, cropped (a sheet with the assembled frame and its loose parts -> the frame)"""
    a = np.array(img)[..., 3] > 16
    if not a.any():
        return img

    def runs(v):
        # [start, stop) of the stretches where v is True
        d = np.diff(np.r_[0, v.astype(np.int8), 0])
        return list(zip(np.flatnonzero(d == 1), np.flatnonzero(d == -1)))

    def split(y0, y1, x0, x1, axis=0, tried=0):
        # cut along fully transparent rows / columns, recursively (pieces laid out on a sheet), keep the biggest
        sub = a[y0:y1, x0:x1]
        rr = runs(sub.any(1)) if axis == 0 else runs(sub.any(0))
        if len(rr) <= 1:
            if tried:
                ys, xs = runs(sub.any(1)), runs(sub.any(0))
                return (y0 + ys[0][0], y0 + ys[-1][1], x0 + xs[0][0], x0 + xs[-1][1])
            return split(y0, y1, x0, x1, 1 - axis, 1)
        best = None
        for s, e in rr:
            box = split(y0 + s, y0 + e, x0, x1, 1, 0) if axis == 0 else split(y0, y1, x0 + s, x0 + e, 0, 0)
            if best is None or (box[1] - box[0]) * (box[3] - box[2]) > (best[1] - best[0]) * (best[3] - best[2]):
                best = box
        return best

    y0, y1, x0, x1 = split(0, a.shape[0], 0, a.shape[1])
    return img.crop((int(x0), int(y0), int(x1), int(y1)))


def variant(img, suffix):
    """A state drawn from the base picture when it has none of its own (button.hover from button ...)"""
    a = np.array(img).astype(float)
    rgb, al = a[..., :3], a[..., 3:]
    if suffix == "hover":
        rgb = rgb * 1.18 + 6
    elif suffix == "pressed":
        rgb = rgb * 0.8
    elif suffix == "disabled":
        g = rgb.mean(2, keepdims=True)
        rgb = (rgb * 0.3 + g * 0.7) * 0.75
        al = al * 0.6
    elif suffix in ("primary", "on"):
        rgb = rgb * np.array([1.2, 1.08, 0.82]) + 8
    return Image.fromarray(np.dstack([np.clip(rgb, 0, 255), al]).astype(np.uint8))


def build_parts(parts_dir, out_d):
    """
    <parts_dir>/<region>.png (any size, e.g. button.png, panel.png): used instead of the atlas rect. Its 9-slice comes from
    <region>.json {"slice": [top, right, bottom, left]} in the picture's pixels; without one it is guessed and the json
    written there to be corrected, with a check picture in _preview/. States without a picture of their own
    (button.hover, card.on ...) are made from the base one. Returns {region: skin.json entry}.
    """
    if not parts_dir or not os.path.isdir(parts_dir):
        return {}
    out = {}
    os.makedirs(os.path.join(out_d, "parts"), exist_ok=True)
    loaded = {}
    for name, w, h, _ in REGIONS:
        own = os.path.join(parts_dir, f"{name}.png")
        if not os.path.exists(own):
            # the longest base with a picture, then the remaining states in order (button.primary.hover from button:
            # primary, then hover); "panel.header" is its own region, not a state of "panel"
            bits = name.split(".")
            for i in range(len(bits) - 1, 0, -1):
                base = ".".join(bits[:i])
                if base in loaded and all(s in ("hover", "pressed", "disabled", "primary", "on") for s in bits[i:]):
                    img, sl, fit = loaded[base]
                    for s in bits[i:]:
                        img = variant(img, s)
                    break
            else:
                continue
            loaded[name] = (img, sl, fit)
        else:
            img = largest_piece(Image.open(own).convert("RGBA"))
            cfg_path = os.path.join(parts_dir, f"{name}.json")
            cfg = json.load(open(cfg_path, encoding="utf-8")) if os.path.exists(cfg_path) else {}
            sl = cfg.get("slice")
            if not sl:
                row = name.split(".")[0] in ROW_KINDS or name in ROW_KINDS
                sl = detect_slice(img, row)
                cfg = {"slice": sl, "note": "slice: top, right, bottom, left in this picture's pixels. fit height: the "
                       "picture always takes the element's whole height, only its middle stretches sideways. Edit, rebuild"}
                if row:
                    cfg["fit"] = "height"
                with open(cfg_path, "w", encoding="utf-8", newline="\n") as f:
                    json.dump(cfg, f, indent=1)
            fit = cfg.get("fit")
            loaded[name] = (img, sl, fit)
            _preview(img, sl, os.path.join(parts_dir, "_preview", f"{name}.png"))
        # stored at PART_SCALE x the region's screen height
        th = max(4, round(h / SCALE * PART_SCALE))
        k = th / img.height
        small = img.resize((max(4, round(img.width * k)), th), Image.LANCZOS)
        rel = f"images/ui-skin/parts/{name}.png"
        small.save(os.path.join(out_d, "parts", f"{name}.png"), optimize=True)
        out[name] = {"src": rel, "slice": [max(1, round(v * k)) if v else 0 for v in sl], "scale": PART_SCALE}
        if fit:
            out[name]["fit"] = fit
    return out


def _preview(img, sl, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    t, r, b, l = sl
    W, H = img.size
    bg = Image.new("RGBA", img.size, (70, 70, 70, 255))
    bg.alpha_composite(img)
    d = ImageDraw.Draw(bg)
    lw = max(1, W // 400)
    for x in (l, W - r):
        d.line([(x, 0), (x, H)], fill=(255, 0, 200, 255), width=lw)
    for y in (t, H - b):
        d.line([(0, y), (W, y)], fill=(255, 0, 200, 255), width=lw)
    bg.convert("RGB").save(path)


def build(out_dir, custom_atlas=None, parts_dir=None):
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
    guide((W, H), [(name, pos[name], w, h, sl, ()) for name, w, h, sl in REGIONS]).save(os.path.join(d, "guide.png"), optimize=True)
    skin = {
        "atlas": "images/ui-skin/atlas.png", "scale": SCALE,
        "regions": {name: {"rect": [*pos[name], w, h], "slice": sl} for name, w, h, sl in REGIONS} | build_parts(parts_dir, d),
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
