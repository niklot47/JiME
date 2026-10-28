"""
Builds the bundled menu theme "jime-theme-autumn" from the user's parallax pictures:
  <src>/1.png .. 4.png  - layers, front (1) to back (4), same size
  <src>/<leaves>.png    - a sheet of leaves on transparent background (the largest other RGBA picture)
Output: apps/app/public/bundled-packs/jime-theme-autumn/ (webp layers, a leaf atlas, a generated fog texture,
images/menu/menu.json for screens/menu/MenuBackground.tsx) and the bundled packs' listings.

Usage: python tools/menu-theme/build_theme.py ["Paralax background"]
"""
import json
import os
import shutil
import sys
from collections import deque

import numpy as np
from PIL import Image, ImageFilter

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SRC = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else os.path.join(REPO, "Paralax background"))
BUNDLED = os.path.join(REPO, "apps", "app", "public", "bundled-packs")
PACK_ID = "jime-theme-autumn"
OUT = os.path.join(BUNDLED, PACK_ID)
MENU = "images/menu"


def save_webp(img, rel, quality=82):
    p = os.path.join(OUT, rel)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    img.save(p, "WEBP", quality=quality, method=6)
    return rel


def write_json(rel, data):
    p = os.path.join(OUT, rel)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w", encoding="utf-8", newline="\n") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
        f.write("\n")


def cut_sprites(sheet, step=4, pad=6, min_px=40):
    """Leaves on a transparent sheet -> (box, label) of each connected part of the alpha mask (on a 1/step grid),
    and the label grid (so a box can keep only its own leaf's pixels)"""
    a = np.array(sheet.split()[3]) > 24
    h, w = a.shape
    g = a[: h - h % step, : w - w % step].reshape(h // step, step, w // step, step).any(axis=(1, 3))
    gh, gw = g.shape
    seen = np.zeros_like(g)
    labels = np.zeros(g.shape, np.int32)
    boxes = []
    for y in range(gh):
        for x in range(gw):
            if not g[y, x] or seen[y, x]:
                continue
            q = deque([(y, x)])
            seen[y, x] = True
            lab = len(boxes) + 1
            part = []
            y0 = y1 = y
            x0 = x1 = x
            n = 0
            while q:
                cy, cx = q.popleft()
                part.append((cy, cx))
                n += 1
                y0, y1, x0, x1 = min(y0, cy), max(y1, cy), min(x0, cx), max(x1, cx)
                for dy in (-1, 0, 1):
                    for dx in (-1, 0, 1):
                        ny, nx = cy + dy, cx + dx
                        if 0 <= ny < gh and 0 <= nx < gw and g[ny, nx] and not seen[ny, nx]:
                            seen[ny, nx] = True
                            q.append((ny, nx))
            if n >= min_px:
                for cy, cx in part:
                    labels[cy, cx] = lab
                boxes.append(((max(0, x0 * step - pad), max(0, y0 * step - pad), min(w, (x1 + 1) * step + pad), min(h, (y1 + 1) * step + pad)), lab))
    return boxes, labels, step


def leaf_atlas(sheet_path, size=96):
    """Each leaf scaled to fit `size`, packed in rows: atlas webp + frames [x, y, w, h]"""
    sheet = Image.open(sheet_path).convert("RGBA")
    boxes, labels, step = cut_sprites(sheet)
    # the label of every pixel (grown by one cell, so the leaf's soft edge stays)
    grown = labels.copy()
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            sh = np.roll(np.roll(labels, dy, 0), dx, 1)
            grown = np.where(grown == 0, sh, grown)
    full = np.kron(grown, np.ones((step, step), np.int32))
    arr = np.array(sheet)
    H, W = full.shape
    tiles = []
    for b, lab in boxes:
        own = arr.copy()
        mask = np.zeros(arr.shape[:2], bool)
        mask[:H, :W] = full == lab
        own[..., 3] = np.where(mask, own[..., 3], 0)
        t = Image.fromarray(own, "RGBA").crop(b)
        t = t.crop(t.getbbox() or (0, 0, t.width, t.height))
        t.thumbnail((size, size), Image.LANCZOS)
        tiles.append(t)
    cols = 8
    rows = (len(tiles) + cols - 1) // cols
    atlas = Image.new("RGBA", (cols * size, rows * size), (0, 0, 0, 0))
    frames = []
    for i, t in enumerate(tiles):
        x, y = (i % cols) * size, (i // cols) * size
        atlas.paste(t, (x, y))
        frames.append([x, y, t.width, t.height])
    rel = save_webp(atlas, f"{MENU}/leaves.webp", quality=88)
    return rel, frames


def fog_texture(w=1024, h=384, seed=7):
    """Soft drifting fog: octaves of blurred noise, wrapping left-right, fading at top and bottom"""
    rng = np.random.default_rng(seed)
    acc = np.zeros((h, w), np.float32)
    for cell, weight in [(128, 0.55), (64, 0.3), (24, 0.15)]:
        gw, gh = w // cell, max(2, h // cell)
        small = rng.random((gh, gw)).astype(np.float32)
        ring = np.concatenate([small, small, small], axis=1)
        img = Image.fromarray((ring * 255).astype(np.uint8)).resize((3 * w, h), Image.BICUBIC)
        img = img.filter(ImageFilter.GaussianBlur(cell / 2)).crop((w, 0, 2 * w, h))
        acc += np.asarray(img, np.float32) / 255 * weight
    acc = (acc - acc.min()) / (acc.max() - acc.min())
    acc = np.clip((acc - 0.2) * 1.6, 0, 1)
    ys = np.linspace(0, 1, h)[:, None]
    acc *= np.sin(ys * np.pi) ** 1.5
    alpha = (acc * 255).astype(np.uint8)
    rgb = np.full((h, w, 3), (255, 236, 214), np.uint8)
    return Image.fromarray(np.dstack([rgb, alpha]), "RGBA")


def rays_texture(sx, sy, w=1280, h=720, seed=3):
    """Sun rays from (sx, sy) (0..1 of the picture): soft beams of random width and strength, fading with distance"""
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    dx, dy = xx - sx * w, (yy - sy * h) * 1.0
    ang = np.arctan2(dy, dx)
    dist = np.hypot(dx, dy) / np.hypot(w, h)
    beams = np.zeros((h, w), np.float32)
    for _ in range(22):
        a0 = rng.uniform(-0.6, 2.4)  # mostly down and to the right of the sun
        wid = rng.uniform(0.01, 0.05)
        d = np.angle(np.exp(1j * (ang - a0)))
        beams += rng.uniform(0.3, 1.0) * np.exp(-(d / wid) ** 2)
    beams = np.clip(beams, 0, 1.4) / 1.4
    fall = np.exp(-dist * 2.2) * np.clip(dist * 12, 0, 1)
    glow = np.exp(-(dist / 0.12) ** 2) * 0.8
    v = np.clip(beams * fall * 0.9 + glow, 0, 1)
    # fade out at the picture's borders: the layer turns a little, its edge must not show
    ex = np.clip(np.minimum(xx, w - 1 - xx) / (0.12 * w), 0, 1)
    ey = np.clip(np.minimum(yy, h - 1 - yy) / (0.12 * h), 0, 1)
    v *= (ex * ey) ** 1.5
    img = Image.fromarray((v * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(3))
    v = np.asarray(img, np.float32) / 255
    rgb = np.dstack([v * 255, v * 214, v * 150]).astype(np.uint8)
    return Image.fromarray(rgb, "RGB")


def water_mask(img):
    """Where the falls and the river of the city layer are: bright, little saturated, not reddish pixels inside the
    water's region; red = water (soft edge), green = speed (the falls fast, the river slower)"""
    a = np.asarray(img.convert("RGBA")).astype(np.float32) / 255
    r, b, al = a[..., 0], a[..., 2], a[..., 3]
    mx, mn = a[..., :3].max(-1), a[..., :3].min(-1)
    sat = (mx - mn) / np.maximum(mx, 1e-3)
    h, w = r.shape
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    yy /= h
    xx /= w
    water = (mx > 0.55) & (sat < 0.32) & (al > 0.5) & (b > r * 0.72)
    region = ((xx > 0.33) & (xx < 0.84) & (yy > 0.46)) | ((xx > 0.38) & (xx < 0.95) & (yy > 0.85))
    region &= ~((xx > 0.73) & (xx < 0.84) & (yy < 0.6))
    m = Image.fromarray((water & region).astype(np.uint8) * 255).filter(ImageFilter.MaxFilter(5)).filter(ImageFilter.GaussianBlur(4))
    speed = np.clip((0.72 - yy) / 0.2, 0, 1) * 0.75 + 0.25
    g = Image.fromarray((speed * 255).astype(np.uint8))
    return Image.merge("RGB", (m, g, Image.new("L", m.size, 0)))


def main():
    if os.path.exists(OUT):
        shutil.rmtree(OUT)
    os.makedirs(OUT)
    layers = []
    # back to front: 4 (sky), 3 (valley), 2 (the city), 1 (the tree on the rock)
    depth = {4: 0.08, 3: 0.3, 2: 0.6, 1: 1.0}
    for n in (4, 3, 2, 1):
        img = Image.open(os.path.join(SRC, f"{n}.png"))
        img = img.convert("RGBA" if img.mode == "RGBA" else "RGB")
        layers.append({"src": save_webp(img, f"{MENU}/layer{n}.webp", 80), "depth": depth[n], "z": (4 - n) * 10})
    effects_water = {"type": "water", "src": f"{MENU}/layer2.webp", "mask": save_webp(water_mask(Image.open(os.path.join(SRC, "2.png"))), f"{MENU}/water.webp", 90),
                     "z": 21, "strength": 0.0025, "speed": 0.585}
    others = [f for f in os.listdir(SRC) if f.lower().endswith(".png") and f[:-4] not in ("1", "2", "3", "4")]
    rgba = [f for f in others if Image.open(os.path.join(SRC, f)).mode == "RGBA"]
    l2 = Image.open(os.path.join(SRC, "2.png"))
    effects = [
        effects_water,
        {"type": "steam", "z": 22, "x": 0.595, "y": 0.69, "width": 0.13, "count": 22, "aspect": round(l2.width / l2.height, 4), "opacity": 0.5},
        # the sun low over the far mountains, its rays through the valley
        {"type": "rays", "texture": save_webp(rays_texture(0.2, 0.2), f"{MENU}/rays.webp", 80), "z": 5, "x": 0.2, "y": 0.2, "opacity": 0.85},
        # fog over the far valley (above the city's roofs), in front of the city lower down, and over the river
        {"type": "fog", "texture": save_webp(fog_texture(), f"{MENU}/fog.webp", 85), "z": 15, "y": 0.36, "height": 0.3, "opacity": 0.75, "speed": 90},
        {"type": "fog", "texture": f"{MENU}/fog.webp", "z": 23, "y": 0.6, "height": 0.32, "opacity": 0.55, "speed": 140, "flip": True},
        {"type": "fog", "texture": f"{MENU}/fog.webp", "z": 24, "y": 0.82, "height": 0.25, "opacity": 0.45, "speed": 110},
        {"type": "rays", "texture": f"{MENU}/rays.webp", "z": 27, "x": 0.2, "y": 0.2, "opacity": 0.5},
    ]
    if rgba:
        sheet = max(rgba, key=lambda f: os.path.getsize(os.path.join(SRC, f)))
        atlas, frames = leaf_atlas(os.path.join(SRC, sheet))
        # two layers of leaves: smaller, slower ones behind the tree on the rock, big ones in front of it
        effects.append({"type": "leaves", "z": 28, "atlas": atlas, "frames": frames, "count": 18, "size": [16, 34], "wind": 0.25, "speed": 0.7})
        effects.append({"type": "leaves", "z": 35, "atlas": atlas, "frames": frames, "count": 12, "size": [40, 76], "wind": 0.35})
    menu = {
        "layers": layers,
        "effects": effects,
        # a slow camera move: an ellipse laid on the screen diagonal (radii in % of the screen, one turn in `period` s)
        "camera": {"rx": 2.2, "ry": 0.9, "angle": -28, "period": 70, "zoom": 1.1},
    }
    write_json(f"{MENU}/menu.json", menu)
    manifest = {
        "formatVersion": 1, "id": PACK_ID,
        "name": {"ru": "Тема: Осенняя долина", "en": "Theme: Autumn valley", "it": "Tema: Valle d'autunno"},
        "description": "The menus' background: parallax layers, fog, sun rays and falling leaves.",
        "version": "0.1.0", "priority": -20, "origin": "bundled", "contents": [{"type": "theme", "path": "images"}],
    }
    write_json("pack.json", manifest)
    files = sorted(os.path.relpath(os.path.join(b, f), OUT).replace("\\", "/") for b, _, fs in os.walk(OUT) for f in fs)
    write_json("__index.json", files)
    lst = []
    for d in sorted(os.listdir(BUNDLED)):
        p = os.path.join(BUNDLED, d, "pack.json")
        if os.path.isdir(os.path.join(BUNDLED, d)) and os.path.exists(p):
            lst.append({"dir": d, "manifest": json.load(open(p, encoding="utf-8"))})
    with open(os.path.join(BUNDLED, "__list.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump(lst, f, ensure_ascii=False, indent=1)
        f.write("\n")
    size = sum(os.path.getsize(os.path.join(OUT, f)) for f in files)
    print(f"{PACK_ID}: {len(files)} files, {size / 1024:.0f} KB, leaves: {len(effects[-1].get('frames', []))}")


if __name__ == "__main__":
    main()
