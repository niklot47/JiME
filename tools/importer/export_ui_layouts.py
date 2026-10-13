# Export the game's NGUI interface (local only, FFG content): the whole "UI Root" of the game scene (level2) as a layout tree
# for the app's NGUI view (apps/app/src/ngui/), plus the textures it shows.
#   images/ui/layouts/ui.json   { "root": <node>, "fonts": {<UIFont path id>: "text"|"title"}, "size": [1280, 720] }
#   images/ui/tex/<file>_<pid>.png   UITexture / UI2DSprite images
# node: { n: name, id: GameObject path id, tr: Transform path id (anchor targets), on: active, p: [x, y], s: [sx, sy], r: z degrees, ch: [nodes],
#         w: widget (see widget()), panel: {d: depth, clip: [cx, cy, w, h] | null, off: clip offset}, btn: {hover, pressed, disabled, dur},
#         tw: [tweens], loc: localization key }
# Coordinates are NGUI's: UI units (1280 x 720 reference, UIRoot fits height), y up, origin at the parent's position.
import os, sys, json, math
from jload import *

PACK = os.path.join(ROOT, "packs", "core-ffg")
OUT = os.path.join(PACK, "images", "ui", "layouts")
TEX = os.path.join(PACK, "images", "ui", "tex")
SCENE = "level2"
F = FILES[SCENE]

def r3(v): return round(float(v), 3)
def col(c, default=(1, 1, 1, 1)):
    if not c: return None
    v = [r3(c["r"]), r3(c["g"]), r3(c["b"]), r3(c["a"])]
    return None if tuple(v) == tuple(default) else v

def enabled(co): return co.get_raw_data()[12] != 0

_mat = {}
def material_color(af, ref):
    """_Color of a custom material on a UITexture (the enemy health bar fills: red health, grey armor, dark lethal)"""
    if not ref or not ref.get("m_PathID"): return None
    key = (af.name, ref["m_FileID"], ref["m_PathID"])
    if key not in _mat:
        c = None
        o = deref(af, ref["m_FileID"], ref["m_PathID"])
        try:
            if o is not None and o.type.name == "Material":
                cols = dict(o.read_typetree().get("m_SavedProperties", {}).get("m_Colors", []))
                c = col(cols.get("_Color"))
        except Exception as e:
            print("material failed", key, e)
        _mat[key] = c
    return _mat[key]

_tex = {}
def texture(af, ref):
    """Export a Texture2D / Sprite referenced by a widget; returns the pack path"""
    if not ref or not ref.get("m_PathID"): return None
    key = (af.name, ref["m_FileID"], ref["m_PathID"])
    if key in _tex: return _tex[key]
    o = deref(af, ref["m_FileID"], ref["m_PathID"])
    path = None
    try:
        if o is not None and o.type.name in ("Texture2D", "Sprite"):
            img = sprite_image(o.read()) if o.type.name == "Sprite" else o.read().image
            img.thumbnail((1024, 1024))
            fn = f"{o.assets_file.name.split('.')[0]}_{o.path_id}.png"
            img.save(os.path.join(TEX, fn))
            path = f"images/ui/tex/{fn}"
    except Exception as e:
        print("texture failed", key, e)
    _tex[key] = path
    return path

_fonts = {}
def font_role(af, ref):
    """NGUI bitmap font -> the pack's font role: Romic (titles) or Garamond (text)"""
    if not ref or not ref.get("m_PathID"): return None
    key = (af.name, ref["m_FileID"], ref["m_PathID"])
    if key not in _fonts:
        role = "text"
        o = deref(af, ref["m_FileID"], ref["m_PathID"])
        try:
            _, d = read_mb(o)
            nm = json.dumps(d.get("mSprite") if d else "", default=str) + str((d or {}).get("mFont", ""))
            go = o.assets_file.objects[d["m_GameObject"]["m_PathID"]].read().m_Name if d and d.get("m_GameObject") else ""
            if "romic" in (go + nm).lower(): role = "title"
            _fonts[key] = (role, go)
        except Exception:
            _fonts[key] = (role, "")
    return _fonts[key][0]

def anchor(a):
    if not a: return None
    t = a.get("target", {}).get("m_PathID", 0)
    return [t or None, r3(a.get("relative", 0)), r3(a.get("absolute", 0))]

def widget(cls, d, af):
    w = {"k": cls, "w": d.get("mWidth", 0), "h": d.get("mHeight", 0), "pv": d.get("mPivot", 4), "d": d.get("mDepth", 0)}
    c = col(d.get("mColor"))
    if c: w["c"] = c
    an = [anchor(d.get(k)) for k in ("leftAnchor", "rightAnchor", "bottomAnchor", "topAnchor")]
    if any(a and a[0] for a in an): w["an"] = an
    if cls in ("sprite", "texture", "sprite2d"):
        if d.get("mType"): w["t"] = d["mType"]  # 0 simple, 1 sliced, 2 tiled, 3 filled, 4 advanced
        if d.get("mType") == 3:
            w["fa"] = r3(d.get("mFillAmount", 1)); w["fd"] = d.get("mFillDirection", 0); w["inv"] = d.get("mInvert", 0)
        if d.get("mFlip"): w["flip"] = d["mFlip"]
    if cls == "sprite": w["sp"] = d.get("mSpriteName") or None
    if cls == "texture": w["tex"] = texture(af, d.get("mTexture"))
    if cls == "sprite2d": w["tex"] = texture(af, d.get("mSprite"))
    if cls in ("texture", "sprite2d"):
        mc = material_color(af, d.get("mMat"))
        if mc: w["mc"] = mc
    if cls == "label":
        lb = {"text": d.get("mText", ""), "size": d.get("mFontSize", 20), "font": font_role(af, d.get("mFont")) or "text",
              "al": d.get("mAlignment", 0), "ov": d.get("mOverflow", 0), "style": d.get("mFontStyle", 0)}
        if d.get("mEffectStyle"):
            lb["eff"] = [d["mEffectStyle"], col(d.get("mEffectColor"), (0, 0, 0, 0)) or [0, 0, 0, 1], r3(d.get("mEffectDistance", {}).get("x", 1))]
        if d.get("mApplyGradient"): lb["grad"] = [col(d.get("mGradientTop"), (9, 9, 9, 9)), col(d.get("mGradientBottom"), (9, 9, 9, 9))]
        if d.get("mSpacingY"): lb["sy"] = d["mSpacingY"]
        if d.get("mMaxLineCount"): lb["lines"] = d["mMaxLineCount"]
        w["lb"] = lb
    return w

TWEENS = {"TweenScale": "scale", "TweenAlpha": "alpha", "TweenPosition": "pos", "TweenRotation": "rot", "TweenColor": "color", "TweenWidth": "width", "TweenHeight": "height"}
def tween(kind, d):
    def v(x):
        if isinstance(x, dict): return [r3(x[k]) for k in ("x", "y", "z", "r", "g", "b", "a") if k in x]
        return r3(x) if isinstance(x, (int, float)) else x
    return {"k": kind, "from": v(d.get("from")), "to": v(d.get("to")), "dur": r3(d.get("duration", 1)), "delay": r3(d.get("delay", 0)),
            "style": d.get("style", 0), "on": bool(d.get("m_Enabled", 1)), "group": d.get("tweenGroup", 0)}

WIDGETS = {"UISprite": "sprite", "UITexture": "texture", "UI2DSprite": "sprite2d", "UILabel": "label", "FFG_UILabel": "label", "UIWidget": "widget"}

def node(gid):
    go = F.objects[gid].read()
    comps = [F.objects[c.component.path_id] for c in go.m_Component if c.component.file_id == 0 and c.component.path_id in F.objects]
    tro = next(co for co in comps if co.type.name in ("Transform", "RectTransform"))
    tr = tro.read()
    p, s, q = tr.m_LocalPosition, tr.m_LocalScale, tr.m_LocalRotation
    # tr: the Transform's path id (NGUI anchors point at Transforms)
    n = {"n": go.m_Name, "id": gid, "tr": tro.path_id}
    if not go.m_IsActive: n["on"] = False
    if p.x or p.y: n["p"] = [r3(p.x), r3(p.y)]
    if (s.x, s.y) != (1, 1): n["s"] = [r3(s.x), r3(s.y)]
    rz = math.degrees(2 * math.atan2(q.z, q.w))
    if abs(rz) > 0.01: n["r"] = r3(rz)
    for co in comps:
        if co.type.name != "MonoBehaviour": continue
        full, d = read_mb(co)
        if not d or "__error__" in d: continue
        cls = (full or "").split(".")[-1]
        if cls in WIDGETS and "w" not in n:
            n["w"] = widget(WIDGETS[cls], d, co.assets_file)
            if not enabled(co): n["w"]["off"] = True
        elif cls == "UIPanel":
            clip = d.get("mClipping", 0)
            cr = d.get("mClipRange") or {}
            n["panel"] = {"d": d.get("mDepth", 0), "clip": [r3(cr.get("x", 0)), r3(cr.get("y", 0)), r3(cr.get("z", 0)), r3(cr.get("w", 0))] if clip else None}
            off = d.get("mClipOffset") or {}
            if clip and (off.get("x") or off.get("y")): n["panel"]["off"] = [r3(off.get("x", 0)), r3(off.get("y", 0))]
        elif cls in ("UIButton", "UIButtonColor"):
            n["btn"] = {"hover": col(d.get("hover")), "pressed": col(d.get("pressed")), "disabled": col(d.get("disabledColor")), "dur": r3(d.get("duration", 0.2)),
                        "target": (d.get("tweenTarget") or {}).get("m_PathID")}
        elif cls in TWEENS:
            n.setdefault("tw", []).append(tween(TWEENS[cls], d | {"m_Enabled": enabled(co)}))
        elif cls in ("UILocalizationPacket", "UILocalize") and d.get("key"):
            n["loc"] = d["key"]
        elif cls == "UIGrid":
            # UIGrid.ResetPosition inputs (the app repositions the active children like Reposition())
            n["grid"] = {"k": "grid", "cell": [r3(d.get("cellWidth", 200)), r3(d.get("cellHeight", 200))], "cols": d.get("maxPerLine", 0),
                         "arr": d.get("arrangement", 0), "pv": d.get("pivot", 0), "exp": d.get("expansionStyle", 0),
                         "sort": d.get("sorting", 0), "hide": d.get("hideInactive", 0)}
        elif cls == "UITable":
            n["grid"] = {"k": "table", "cols": d.get("columns", 0), "dir": d.get("direction", 0), "sort": d.get("sorting", 0),
                         "pv": d.get("pivot", 0), "cpv": d.get("cellAlignment", 0), "hide": d.get("hideInactive", 0),
                         "pad": [r3(d.get("padding", {}).get("x", 0)), r3(d.get("padding", {}).get("y", 0))] if isinstance(d.get("padding"), dict) else [0, 0]}
        else:
            n.setdefault("mb", []).append(cls)
    ch = [node(F.objects[c.path_id].read().m_GameObject.path_id) for c in tr.m_Children]
    if ch: n["ch"] = ch
    return n

def main():
    os.makedirs(OUT, exist_ok=True); os.makedirs(TEX, exist_ok=True)
    root = next(pid for pid, o in F.objects.items() if o.type.name == "GameObject" and o.read().m_Name == "UI Root")
    tree = node(root)
    fonts = {f"{k[2]}": {"role": v[0], "name": v[1]} for k, v in _fonts.items()}
    with open(os.path.join(OUT, "ui.json"), "w", encoding="utf-8") as fp:
        json.dump({"size": [1280, 720], "root": tree, "fonts": fonts}, fp, ensure_ascii=False, separators=(",", ":"))
    count = lambda n: 1 + sum(count(c) for c in n.get("ch", []))
    print(f"ui layouts: {count(tree)} nodes, {len([v for v in _tex.values() if v])} textures, fonts {fonts} -> {OUT}")

if __name__ == "__main__":
    main()
