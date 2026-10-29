"""
Builds a theme pack from a theme folder (themes/<name>/, not committed):

  themes/<name>/theme.json        id, names, priority, private, the menu background and its effects (see like-original)
  themes/<name>/background/       pictures of the menu background (parallax layers 1..4.png, leaves.png, an image)
  themes/<name>/ui/atlas.png      the menus' skin sheet (template written there when missing), ui/parts/<region>.png
                                  own pictures of single elements of any size (button.png, logo.png ...)
  themes/<name>/ui/game_atlas.png the in-game skin sheet
  themes/<name>/guides/           written: the sheets' markup (transparent layers), parts/ check pictures of the slices

Output: the pack jime-theme-<id> in apps/app/public/bundled-packs/ (committed) or, with "private": true, in data/packs/
(local only: for pictures that must not be distributed). menu.background: "parallax" (layers + effects), "image" (one
picture, slow camera), later "scene" (a 3D scene).

Usage: python tools/menu-theme/build_theme.py [themes/like-original]
"""
import json
import os
import shutil
import sys
from collections import deque

import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
from build_skin import build as build_skin  # noqa: E402
from build_game_skin import build as build_game_skin  # noqa: E402
from PIL import Image, ImageFilter

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SRC = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else os.path.join(REPO, "themes", "like-original"))
THEME = json.load(open(os.path.join(SRC, "theme.json"), encoding="utf-8"))
PACK_ID = f"jime-theme-{THEME['id']}"
BUNDLED = os.path.join(REPO, "apps", "app", "public", "bundled-packs")
PACKS = os.path.join(REPO, "data", "packs") if THEME.get("private") else BUNDLED
OUT = os.path.join(PACKS, PACK_ID)
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


def leaf_atlas(sheet_path, size=96, name="leaves"):
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
    # name: a file name next to the menu's pictures, or a whole pack path
    rel = save_webp(atlas, name if "/" in name else f"{MENU}/{name}.webp", quality=88)
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


def water_mask(img, regions, exclude):
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
    inside = lambda r: (xx > r[0]) & (yy > r[1]) & (xx < r[2]) & (yy < r[3])  # noqa: E731
    region = np.zeros_like(water)
    for r in regions:
        region |= inside(r)
    for r in exclude:
        region &= ~inside(r)
    m = Image.fromarray((water & region).astype(np.uint8) * 255).filter(ImageFilter.MaxFilter(5)).filter(ImageFilter.GaussianBlur(4))
    speed = np.clip((0.72 - yy) / 0.2, 0, 1) * 0.75 + 0.25
    g = Image.fromarray((speed * 255).astype(np.uint8))
    return Image.merge("RGB", (m, g, Image.new("L", m.size, 0)))


def src(rel):
    return os.path.join(SRC, rel)


def background(sec, prefix="", parallax=None):
    """
    One background for screens/menu/MenuBackground.tsx (images/menu/menu.json, rest-forest.json, rest-cave.json):
      {"background": "image", "image": file, "camera": {...}}   one picture, a slow camera
      {"background": "parallax", "parallax": {layers, effects, camera}}   (the menu may keep its parallax at the top)
      {"background": "scene", "scene": file.glb}   a 3D scene from Blender (SceneBackground.tsx: its camera, lights,
                                                     animations; "Flicker*" objects get a flickering light)
    prefix: of the written files (the camp's next to the menu's)
    """
    kind = sec.get("background", "parallax")
    if kind == "image":
        img = Image.open(src(sec["image"])).convert("RGB")
        return {"layers": [{"src": save_webp(img, f"{MENU}/{prefix}image.webp", 82), "depth": 0.3, "z": 0}], "effects": [],
                "camera": sec.get("camera", {"rx": 1.2, "ry": 0.5, "angle": -28, "period": 90, "zoom": 1.05})}
    if kind == "scene":
        rel = f"{MENU}/{prefix}scene{os.path.splitext(sec['scene'])[1].lower()}"
        shutil.copy2(src(sec["scene"]), os.path.join(OUT, rel))
        return {"scene": rel}
    if kind != "parallax":
        raise SystemExit(f"background {kind!r}: one of image, parallax, scene")
    P = sec.get("parallax") or parallax
    layers, effects, done = [], [], {}
    n = len(P["layers"])
    for i, L in enumerate(P["layers"]):
        img = Image.open(src(L["file"]))
        img = img.convert("RGBA" if img.mode == "RGBA" else "RGB")
        rel = save_webp(img, f"{MENU}/{prefix}layer{n - i}.webp", 80)
        done[L["file"]] = rel
        layers.append({"src": rel, "depth": L["depth"], "z": i * 10})
    leaves = {}
    for e in P.get("effects", []):
        e = dict(e)
        kind = e["type"]
        if kind == "water":
            layer = e.pop("layer")
            if layer not in done:
                raise SystemExit(f"water: {layer} must be one of the parallax layers")
            pic = Image.open(src(layer))
            e["src"] = done[layer]
            e["mask"] = save_webp(water_mask(pic, e.pop("regions"), e.pop("exclude", [])), f"{MENU}/{prefix}water.webp", 90)
        elif kind == "steam":
            pic = Image.open(src(e.pop("layer")))
            e["aspect"] = round(pic.width / pic.height, 4)
        elif kind == "rays":
            name = f"{MENU}/rays.webp"
            if not os.path.exists(os.path.join(OUT, name)):
                save_webp(rays_texture(e["x"], e["y"]), name, 80)
            e["texture"] = name
        elif kind == "fog":
            name = f"{MENU}/fog.webp"
            if not os.path.exists(os.path.join(OUT, name)):
                save_webp(fog_texture(), name, 85)
            e["texture"] = name
        elif kind == "leaves":
            sheet = e.pop("sheet")
            if sheet not in leaves:
                leaves[sheet] = leaf_atlas(src(sheet), name=f"{prefix}leaves")
            e["atlas"], e["frames"] = leaves[sheet]
        effects.append(e)
    return {"layers": layers, "effects": effects, "camera": P.get("camera", {})}


def layered_art(folder, name):
    """
    A picture in layers (ui/art/<name>/): 1.png, 2.png ... from the back to the front (same size, transparent where the
    layers behind show), and optionally layers.json:
      {"frame": [left, top, right, bottom],          the card's edges in the picture (px): the frame fills the card,
                                                     what lies outside it sticks out of the card
       "layers": [{"file": "1.png", "depth": 0.1,    depth: how far it moves with the pointer (0 still .. 1)
                   "flicker": {"min": 0.3, "max": 1, "speed": 1},   its opacity wanders (fire glints)
                   "blend": "screen",                its blending (screen, lighten, multiply, overlay ...)
                   "distort": {"strength": 0.004, "speed": 1, "rise": 0, "scale": 40, "flicker": 0}},
                                                     drawn wavering instead (heat haze: rise > 0; fur, cloth: rise 0)
       "effects": [{"type": "fog" | "embers" | "steam" | "rays" | "leaves", "z": 15, ..., "hover": true}]}
    Layer N (counting from 1 at the back) is drawn at z = N * 10: an effect with z 15 goes between layers 1 and 2.
    "hover": the effect shows only while the card is hovered or chosen; "depth" on an effect: it moves like the layers
    of that depth. Effects' fields as in the menu's parallax, x / y / width fractions of the whole picture (fog: y,
    height, opacity, speed, flip; embers: x, y, width, count, color, size [min, max] px, speed; steam: x, y, width,
    count, opacity; rays: x, y, opacity; leaves: "sheet" a picture of one or more leaves in this folder, count,
    size [min, max] px, wind, speed).
    """
    cfg_path = os.path.join(folder, "layers.json")
    cfg = json.load(open(cfg_path, encoding="utf-8")) if os.path.exists(cfg_path) else {}
    files = cfg.get("layers") or [{"file": f} for f in sorted(
        (f for f in os.listdir(folder) if os.path.splitext(f)[0].isdigit() and f.lower().endswith((".png", ".webp", ".jpg"))),
        key=lambda f: int(os.path.splitext(f)[0]))]
    n = len(files)
    layers, effects = [], []
    size = None
    # the stored pictures: at most 1400 px on their long side (the frame is kept in the original's pixels)
    for i, L in enumerate(files):
        img = Image.open(os.path.join(folder, L["file"]))
        size = size or [img.width, img.height]
        img = img.convert("RGBA" if img.mode in ("RGBA", "LA", "P") else "RGB")
        img.thumbnail((1400, 1400), Image.LANCZOS)
        rel = save_webp(img, f"images/ui-skin/art/{name}/{i + 1}.webp", 86)
        depth = L.get("depth", round(i / max(1, n - 1), 3))
        z = (i + 1) * 10
        if "distort" in L:
            effects.append({"type": "distort", "src": rel, "z": z, "depth": depth, **L["distort"]})
            continue
        layer = {"src": rel, "depth": depth, "z": z}
        for k in ("flicker", "blend"):
            if k in L:
                layer[k] = L[k]
        layers.append(layer)
    aspect = size[0] / size[1] if size else 1.0
    for e in cfg.get("effects", []):
        e = dict(e)
        k = e["type"]
        if k == "fog" and "texture" not in e:
            rel = "images/ui-skin/art/fog.webp"
            if not os.path.exists(os.path.join(OUT, rel)):
                save_webp(fog_texture(), rel, 85)
            e["texture"] = rel
        elif k == "rays" and "texture" not in e:
            e["texture"] = save_webp(rays_texture(e.get("x", 0.5), e.get("y", 0.2)), f"images/ui-skin/art/{name}/rays.webp", 80)
        elif k == "steam":
            e.setdefault("aspect", round(aspect, 4))
        elif k == "leaves":
            e["atlas"], e["frames"] = leaf_atlas(os.path.join(folder, e.pop("sheet")), name=f"images/ui-skin/art/{name}/leaves.webp")
        effects.append(e)
    out = {"layers": layers, "effects": effects}
    if size and cfg.get("frame"):
        out["size"], out["frame"] = size, cfg["frame"]
    print(f"  layered art {name}: {n} layers, {len(effects)} effects{', frame' if 'frame' in out else ''}")
    return out


def regions_doc(path):
    """guides/regions.md: every region of both sheets, its size, fixed borders and where the app uses it"""
    from build_skin import REGIONS, USE
    from build_game_skin import GAME, USE as GAME_USE
    lines = ["# UI regions of the theme", "", "Sizes in the sheet's pixels; slice = the borders that do not stretch (top, right, bottom, left).",
             "Menu sheet ui/atlas.png is drawn at 2x the screen size; the in-game sheet ui/game_atlas.png at 1x.",
             "Any region can instead be its own picture of any size: ui/parts/<name>.png (+ <name>.json with its slice).", "",
             "## Menus (ui/atlas.png, guide: guides/guide.png)", "", "| region | size | slice | where |", "|---|---|---|---|"]
    for name, w, h, sl in REGIONS:
        lines.append(f"| `{name}` | {w}x{h} | {sl} | {USE.get(name, USE.get(name.split('.')[0], ''))} |")
    lines += ["", "## In game (ui/game_atlas.png, guide: guides/game_guide.png; the original's sprite names)", "",
              "| region | size | slice (left, right, top, bottom) | where |", "|---|---|---|---|"]
    for name, w, h, b, _ in GAME:
        lines.append(f"| `{name}` | {w}x{h} | {b} | {GAME_USE.get(name, '')} |")
    lines += ["", "## Pictures and layered pictures (ui/art/)", "",
              "- `ui/art/<name>.png`: a picture (CSS --sk-art-<name>): difficulty-adventure, difficulty-normal, difficulty-hard.",
              "- `ui/art/<name>/1.png, 2.png ...` + `layers.json`: a picture in layers with effects between them (see build_theme.layered_art).", ""]
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(lines))


def main():
    if os.path.exists(OUT):
        shutil.rmtree(OUT)
    os.makedirs(OUT)
    write_json(f"{MENU}/menu.json", background(THEME.get("menu", {}), "", THEME.get("parallax")))
    # the camp of the rest: theme.json "rest": {"forest": {...}, "cave": {...}} like the menu's; none: a drawn camp
    for area, sec in THEME.get("rest", {}).items():
        write_json(f"{MENU}/rest-{area}.json", background(sec, f"rest-{area}-"))
    # the campaign map's 3D room (a glTF from Blender; naming convention in screens/menu/CampaignMap3D.tsx):
    # theme.json "campaignMap": {"scene": "map/room.glb"}; without it the map is the campaign's picture
    scene = THEME.get("campaignMap", {}).get("scene")
    if scene:
        rel = f"{MENU}/mapscene{os.path.splitext(scene)[1].lower()}"
        shutil.copy2(src(scene), os.path.join(OUT, rel))
        write_json(f"{MENU}/campaign-map.json", {"scene": rel})
    # the interface skins: the theme's sheets (templates written there when missing, or extended with new regions),
    # its own element pictures (ui/parts), the markup to guides/
    ui, guides = src("ui"), src("guides")
    os.makedirs(ui, exist_ok=True)
    os.makedirs(guides, exist_ok=True)
    for sheet, guide_png, build in (("atlas.png", "guide.png", build_skin), ("game_atlas.png", "game_guide.png", build_game_skin)):
        custom = os.path.join(ui, sheet)
        if build is build_skin:
            build(OUT, custom, os.path.join(ui, "parts"), os.path.join(guides, "parts"))
        else:
            build(OUT, custom)
        # the sheet as built (a template, or the theme's own extended by new regions) goes back as the one to paint
        shutil.copy2(os.path.join(OUT, "images", "ui-skin", sheet), custom)
        shutil.copy2(os.path.join(OUT, "images", "ui-skin", guide_png), os.path.join(guides, guide_png))
    # pictures (not frames) of the theme: ui/art/<name>.png -> skin region "art.<name>" (CSS --sk-art-<name>), e.g.
    # difficulty-adventure, difficulty-normal, difficulty-hard for the difficulty cards
    art_src = os.path.join(ui, "art")
    layered = {}
    if os.path.isdir(art_src):
        for d in sorted(os.listdir(art_src)):
            if os.path.isdir(os.path.join(art_src, d)):
                layered[d] = layered_art(os.path.join(art_src, d), d)
    write_json("images/ui-skin/layered.json", layered)
    if os.path.isdir(art_src):
        skin_path = os.path.join(OUT, "images", "ui-skin", "skin.json")
        skin = json.load(open(skin_path, encoding="utf-8"))
        for f in sorted(os.listdir(art_src)):
            stem, ext = os.path.splitext(f)
            if ext.lower() not in (".png", ".jpg", ".jpeg", ".webp"):
                continue
            img = Image.open(os.path.join(art_src, f))
            img = img.convert("RGBA" if img.mode in ("RGBA", "LA", "P") else "RGB")
            img.thumbnail((1600, 1600), Image.LANCZOS)
            skin["regions"][f"art.{stem}"] = {"src": save_webp(img, f"images/ui-skin/art/{stem}.webp", 84)}
        with open(skin_path, "w", encoding="utf-8", newline="\n") as fh:
            json.dump(skin, fh, indent=1)
            fh.write("\n")
    os.makedirs(art_src, exist_ok=True)
    # (the app needs the menu atlas, the in-game sprites are cut out of their sheet)
    regions_doc(os.path.join(guides, "regions.md"))
    for f in ("guide.png", "game_guide.png", "game_atlas.png"):
        os.remove(os.path.join(OUT, "images", "ui-skin", f))
    manifest = {
        "formatVersion": 1, "id": PACK_ID, "name": THEME["name"], "description": THEME.get("description", ""),
        "version": THEME.get("version", "0.1.0"), "priority": THEME.get("priority", -20),
        "origin": "user" if THEME.get("private") else "bundled", "contents": [{"type": "theme", "path": "images"}],
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
    print(f"{PACK_ID} -> {os.path.relpath(OUT, REPO)}: {len(files)} files, {size / 1024:.0f} KB")


if __name__ == "__main__":
    main()
