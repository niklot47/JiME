# Dev tool: render a scene's NGUI hierarchy offline into a PNG (and dump the layout as JSON), as a pixel reference for
# rebuilding the original UI. Draws UISprite (simple / sliced / filled), UITexture, UI2DSprite and UILabel boxes in NGUI
# depth order, from the layout saved in the scene (anchors as last laid out in the editor; runtime tweens not applied).
# Usage: python ngui_render.py <GameObject path id> [scene=level2] [out=<JIME_WORK>/out/ngui/<name>.png] [--all]
#   --all: also draw inactive children (to see every state of a dialog at once)
import os, sys, json, math
from PIL import Image, ImageDraw, ImageFont
from jload import *

ATLAS_DIR = os.path.join(ROOT, "packs", "core-ffg", "images", "ui", "atlas")
ATLAS = json.load(open(os.path.join(ATLAS_DIR, "atlas.json"), encoding="utf-8")) if os.path.exists(os.path.join(ATLAS_DIR, "atlas.json")) else {}
# NGUI UIWidget.Pivot: TopLeft, Top, TopRight, Left, Center, Right, BottomLeft, Bottom, BottomRight -> offset of the rect
PIVOT = {0: (0, 1), 1: (0.5, 1), 2: (1, 1), 3: (0, 0.5), 4: (0.5, 0.5), 5: (1, 0.5), 6: (0, 0), 7: (0.5, 0), 8: (1, 0)}

args = [a for a in sys.argv[1:] if not a.startswith("--")]
SHOW_ALL = "--all" in sys.argv
root_id = int(args[0])
scene = args[1] if len(args) > 1 else "level2"
F = FILES[scene]
_img_cache = {}

def sprite_img(name):
    if name not in _img_cache:
        a = ATLAS.get(name)
        _img_cache[name] = Image.open(os.path.join(ROOT, "packs", "core-ffg", a["file"])).convert("RGBA") if a else None
    return _img_cache[name]

def deref_img(af, ref):
    if not ref or not ref.get("m_PathID"): return None
    key = (af.name, ref["m_FileID"], ref["m_PathID"])
    if key in _img_cache: return _img_cache[key]
    o = deref(af, ref["m_FileID"], ref["m_PathID"])
    img = None
    try:
        if o is not None and o.type.name in ("Texture2D", "Sprite"): img = o.read().image.convert("RGBA")
    except Exception: img = None
    _img_cache[key] = img
    return img

def components(go):
    out = []
    for c in go.m_Component:
        if c.component.file_id != 0: continue
        co = F.objects.get(c.component.path_id)
        if co is not None: out.append(co)
    return out

widgets = []  # dicts

def enabled(co):
    """MonoBehaviour.m_Enabled from the raw header (GameObject PPtr: 12 bytes, then the enabled byte)"""
    return co.get_raw_data()[12] != 0

def walk(gid, m, panel_depth, active=True, path="", root=False):
    """m: 2D affine (a, b, c, d, tx, ty) from this node's parent space to the root space"""
    go = F.objects[gid].read()
    act = active and (go.m_IsActive or SHOW_ALL)
    comps = components(go)
    tr = next((co for co in comps if co.type.name in ("Transform", "RectTransform")), None)
    if tr is None: return
    t = tr.read()
    p, s, q = t.m_LocalPosition, t.m_LocalScale, t.m_LocalRotation
    ang = 2 * math.atan2(q.z, q.w)  # rotation about z only (UI)
    ca, sa = math.cos(ang) * s.x, math.sin(ang) * s.x
    cb, sb = -math.sin(ang) * s.y, math.cos(ang) * s.y
    if root: ca, sa, cb, sb = 1, 0, 0, 1  # the root's own transform is the canvas (UI Root scales to world units)
    a, b, c, d, tx, ty = m
    # local -> parent: [ca cb; sa sb] + p ; then parent -> root
    px_, py_ = (0.0, 0.0) if root else (p.x, p.y)
    nm = (a * ca + c * sa, b * ca + d * sa, a * cb + c * sb, b * cb + d * sb, a * px_ + c * py_ + tx, b * px_ + d * py_ + ty)
    name = f"{path}/{go.m_Name}" if path else go.m_Name
    pd = panel_depth
    for co in comps:
        if co.type.name != "MonoBehaviour": continue
        full, dd = read_mb(co)
        if not dd: continue
        cls = (full or "").split(".")[-1]
        if cls == "UIPanel": pd = dd.get("mDepth", 0)
        if cls in ("UISprite", "UITexture", "UI2DSprite", "UILabel", "UIWidget") and "mWidth" in dd:
            col = dd.get("mColor", {"r": 1, "g": 1, "b": 1, "a": 1})
            w = {"path": name, "cls": cls, "active": act and (SHOW_ALL or enabled(co)),
                 "w": dd["mWidth"], "h": dd["mHeight"], "pivot": dd.get("mPivot", 4), "depth": dd.get("mDepth", 0), "panel": pd,
                 "m": nm, "color": [col["r"], col["g"], col["b"], col["a"]], "type": dd.get("mType", 0),
                 "fill": dd.get("mFillAmount", 1.0), "fillDir": dd.get("mFillDirection", 4)}
            if cls == "UISprite": w["sprite"] = dd.get("mSpriteName")
            if cls == "UITexture": w["tex"] = dd.get("mTexture")
            if cls == "UI2DSprite": w["tex"] = dd.get("mSprite")
            if cls == "UILabel":
                w["text"] = dd.get("mText", ""); w["fontSize"] = dd.get("mFontSize", 20); w["align"] = dd.get("mAlignment", 0)
            w["_af"] = co.assets_file
            widgets.append(w)
    for ch in t.m_Children:
        cgo = F.objects[ch.path_id].read().m_GameObject.path_id
        walk(cgo, nm, pd, act, name)

walk(root_id, (1, 0, 0, 1, 0, 0), 0, root=True)

def sliced_image(img, w, h, border):
    l, r, t, b = border
    W, H = img.size
    w, h = max(1, int(round(w))), max(1, int(round(h)))
    out = Image.new("RGBA", (w, h))
    xs = [(0, l, 0, min(l, w)), (l, W - r, min(l, w), max(min(l, w), w - r)), (W - r, W, max(0, w - r), w)]
    ys = [(0, t, 0, min(t, h)), (t, H - b, min(t, h), max(min(t, h), h - b)), (H - b, H, max(0, h - b), h)]
    for sx0, sx1, dx0, dx1 in xs:
        for sy0, sy1, dy0, dy1 in ys:
            if sx1 <= sx0 or sy1 <= sy0 or dx1 <= dx0 or dy1 <= dy0: continue
            out.paste(img.crop((sx0, sy0, sx1, sy1)).resize((dx1 - dx0, dy1 - dy0)), (dx0, dy0))
    return out

# canvas: bounds of the drawn widgets in root space (NGUI: y up)
draw = [w for w in widgets if w["active"] and w["cls"] != "UIWidget"]
def corners(w):
    px, py = PIVOT.get(w["pivot"], (0.5, 0.5))
    x0, y0 = -px * w["w"], -py * w["h"]
    a, b, c, d, tx, ty = w["m"]
    return [(a * x + c * y + tx, b * x + d * y + ty) for x, y in ((x0, y0), (x0 + w["w"], y0), (x0, y0 + w["h"]), (x0 + w["w"], y0 + w["h"]))]
pts = [p for w in draw for p in corners(w)]
if not pts: sys.exit("nothing to draw")
minx, maxx = min(p[0] for p in pts), max(p[0] for p in pts)
miny, maxy = min(p[1] for p in pts), max(p[1] for p in pts)
W, H = int(maxx - minx) + 4, int(maxy - miny) + 4
canvas = Image.new("RGBA", (W, H), (40, 34, 28, 255))
dr = ImageDraw.Draw(canvas)
try: font = ImageFont.truetype(os.path.join(ROOT, "packs", "core-ffg", "fonts", "text.ttf"), 18)
except Exception: font = ImageFont.load_default()

for w in sorted(draw, key=lambda w: (w["panel"], w["depth"])):
    cs = corners(w)
    x0 = min(p[0] for p in cs) - minx + 2; x1 = max(p[0] for p in cs) - minx + 2
    y0 = maxy - max(p[1] for p in cs) + 2; y1 = maxy - min(p[1] for p in cs) + 2
    bw, bh = int(round(x1 - x0)), int(round(y1 - y0))
    if bw < 1 or bh < 1: continue
    img = None
    if w["cls"] == "UISprite" and w.get("sprite"):
        src = sprite_img(w["sprite"])
        if src is not None:
            border = ATLAS[w["sprite"]]["border"]
            img = sliced_image(src, bw, bh, border) if w["type"] == 1 and any(border) else src.resize((bw, bh))
    elif w["cls"] in ("UITexture", "UI2DSprite"):
        src = deref_img(w["_af"], w.get("tex"))
        if src is not None: img = src.resize((bw, bh))
    if img is not None:
        r, g, b, a = w["color"]
        if (r, g, b, a) != (1, 1, 1, 1):
            ch = img.split()
            img = Image.merge("RGBA", [ch[0].point(lambda v, k=r: int(v * k)), ch[1].point(lambda v, k=g: int(v * k)),
                                       ch[2].point(lambda v, k=b: int(v * k)), ch[3].point(lambda v, k=a: int(v * k))])
        if w["type"] == 3 and w["fill"] < 1:  # filled: horizontal crop only
            img = img.crop((0, 0, max(1, int(bw * w["fill"])), bh))
        canvas.alpha_composite(img, (int(round(x0)), int(round(y0))))
    elif w["cls"] == "UILabel" and w.get("text"):
        r, g, b, a = w["color"]
        dr.multiline_text((x0 + 2, y0), w["text"][:200], fill=(int(r * 255), int(g * 255), int(b * 255), int(a * 255)), font=font)
    elif w["cls"] in ("UISprite", "UITexture", "UI2DSprite"):
        dr.rectangle((x0, y0, x1, y1), outline=(255, 0, 255, 160))

name = F.objects[root_id].read().m_Name
out = args[2] if len(args) > 2 else os.path.join(ROOT, "out", "ngui", f"{scene}_{name}{'_all' if SHOW_ALL else ''}.png")
os.makedirs(os.path.dirname(out), exist_ok=True)
canvas.save(out)
layout = [{k: v for k, v in w.items() if not k.startswith("_")} | {"rect": corners(w)} for w in widgets]
json.dump(layout, open(out[:-4] + ".json", "w", encoding="utf-8"), ensure_ascii=False, indent=0, default=str)
print(f"{out}: {W}x{H}, {len(draw)} widgets drawn of {len(widgets)}")
