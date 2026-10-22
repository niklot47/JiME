# Export the game's NGUI interface (local only, FFG content): the whole "UI Root" of the game scene (level2) as a layout tree
# for the app's NGUI view (apps/app/src/ngui/), plus the textures it shows.
#   images/ui/layouts/ui.json   { "root": <node>, "fonts": {<UIFont path id>: "text"|"title"}, "size": [1280, 720] }
#   images/ui/tex/<file>_<pid>.png   UITexture / UI2DSprite images
# node: { n: name, id: GameObject path id, tr: Transform path id (anchor targets), on: active, p: [x, y], s: [sx, sy], r: z degrees, ch: [nodes],
#         w: widget (see widget()), panel: {d: depth, clip: [cx, cy, w, h] | null, off: clip offset, soft: [sx, sy]}, btn: {hover, pressed, disabled, dur},
#         tw: [tweens], loc: localization key }
# "prefabs": { "<GameObject>/<Controller>.<field>": node } - UI prefabs the scene's scripts instantiate at runtime (campaign cards, hero slots,
#   save slots ...), exported the same way; their ids are renumbered from PREFAB_ID0 up (bundle path ids may not fit a JS number)
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
    return [rid(t) or None, r3(a.get("relative", 0)), r3(a.get("absolute", 0))]

def widget(cls, d, af):
    w = {"k": cls, "w": d.get("mWidth", 0), "h": d.get("mHeight", 0), "pv": d.get("mPivot", 4), "d": d.get("mDepth", 0)}
    c = col(d.get("mColor"))
    if c: w["c"] = c
    if d.get("keepAspectRatio"):  # UIWidget.AspectRatioSource: 1 based on width, 2 based on height
        w["ka"] = [d["keepAspectRatio"], r3(d.get("aspectRatio", 1))]
    an = [anchor(d.get(k)) for k in ("leftAnchor", "rightAnchor", "bottomAnchor", "topAnchor")]
    if any(a and a[0] for a in an): w["an"] = an
    if cls in ("sprite", "texture", "sprite2d"):
        if d.get("mType"): w["t"] = d["mType"]  # 0 simple, 1 sliced, 2 tiled, 3 filled, 4 advanced
        if d.get("mType") == 3:
            w["fa"] = r3(d.get("mFillAmount", 1)); w["fd"] = d.get("mFillDirection", 0); w["inv"] = d.get("mInvert", 0)
        if d.get("mFlip"): w["flip"] = d["mFlip"]
        # UIBasicSprite gradient: vertex colours top / bottom (dark fades over pictures: campaign art, hero portraits)
        if d.get("mApplyGradient"): w["grad"] = [col(d.get("mGradientTop"), (9, 9, 9, 9)) or [1, 1, 1, 1], col(d.get("mGradientBottom"), (9, 9, 9, 9)) or [1, 1, 1, 1]]
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

PREFAB_REFS = {}   # "<GameObject>/<Controller>.<field>" -> (assets file, GameObject path id): prefabs referenced by the UI's scripts
PREFAB_ID0 = 900_000_000
_remap = None      # while exporting a prefab: original path id -> new id

def rid(pid):
    if _remap is None or not pid: return pid
    if pid not in _remap:
        _next[0] += 1
        _remap[pid] = PREFAB_ID0 + _next[0]
    return _remap[pid]
_next = [0]

def collect_prefabs(cls, d, af, owner):
    """GameObject references to other files (prefab assets) in a script's fields"""
    for k, v in d.items():
        refs = v if isinstance(v, list) else [v]
        for i, r in enumerate(refs):
            if not (isinstance(r, dict) and r.get("m_PathID") and r.get("m_FileID")): continue
            try:
                o = deref(af, r["m_FileID"], r["m_PathID"])
            except IndexError:
                continue
            if o is None or o.type.name != "GameObject": continue
            key = f"{owner}/{cls}.{k}" + (f"[{i}]" if isinstance(v, list) else "")
            PREFAB_REFS.setdefault(key, (o.assets_file, o.path_id))

# ---------------------------------------------------------------- mesh art (MeshRenderer quads in the UI: difficulty art)
# The difficulty page draws its pictures as meshes with animated Shader Forge materials (FlameDistortion: the texture
# wobbled by a noise texture; ScrollingWithMask: a scrolling texture cut by a mask). Exported as still images: each mesh
# rasterized with its texture (and its alpha / mask texture) into a PNG, placed as a texture widget on a child node.
import numpy as np
from UnityPy.helpers.MeshHelper import MeshHandler
from PIL import Image

_art = {}
def tex_env(md, name):
    for k, v in md["m_SavedProperties"]["m_TexEnvs"]:
        if k == name and v["m_Texture"]["m_PathID"]: return v
    return None

def tex_rgba(af, env):
    o = deref(af, env["m_Texture"]["m_FileID"], env["m_Texture"]["m_PathID"])
    if o is None or o.type.name != "Texture2D": return None
    return np.asarray(o.read().image.convert("RGBA"), np.float32) / 255.0

def sample(img, uv, env):
    """bilinear-free (nearest) sample of img at uv (n x 2), with the material's tiling / offset, repeat wrap"""
    sc, of = env.get("m_Scale", {"x": 1, "y": 1}), env.get("m_Offset", {"x": 0, "y": 0})
    u = (uv[:, 0] * sc["x"] + of["x"]) % 1.0
    v = (uv[:, 1] * sc["y"] + of["y"]) % 1.0
    h, w = img.shape[:2]
    x = np.clip((u * w).astype(int), 0, w - 1)
    y = np.clip(((1 - v) * h).astype(int), 0, h - 1)
    return img[y, x]

def save_plain(af, env, fn):
    """a material texture saved as it is (for the app's own animation of it); its pack path"""
    o = deref(af, env["m_Texture"]["m_FileID"], env["m_Texture"]["m_PathID"])
    o.read().image.save(os.path.join(TEX, fn))
    return f"images/ui/tex/{fn}"

def mesh_art(gid, comps):
    """(child node | None) for a GameObject with a MeshFilter + MeshRenderer"""
    mf = next((c for c in comps if c.type.name == "MeshFilter"), None)
    mr = next((c for c in comps if c.type.name == "MeshRenderer"), None)
    if mf is None or mr is None: return None
    key = (mf.assets_file.name, gid)
    if key in _art: return _art[key]
    _art[key] = None
    try:
        md_ = mr.read_typetree()
        if not md_.get("m_Materials"): return None
        mref = md_["m_Materials"][0]
        mo = deref(mr.assets_file, mref["m_FileID"], mref["m_PathID"])
        mesh_ref = mf.read_typetree()["m_Mesh"]
        meo = deref(mf.assets_file, mesh_ref["m_FileID"], mesh_ref["m_PathID"])
        if mo is None: return None
        md = mo.read_typetree()
        # draw order of the pieces of one picture: the material's render queue (3004..3009 on the difficulty art),
        # else Renderer.sortingOrder
        rq = int(md.get("m_CustomRenderQueue", -1) or -1)
        order = rq - 3000 if rq >= 3000 else int(md_.get("m_SortingOrder", 0) or 0)
        maf = mo.assets_file
        main = tex_env(md, "_MainTex") or tex_env(md, "_Diffuse")
        if main is None: return None
        rgba = tex_rgba(maf, main)
        if rgba is None: return None
        alpha_env = tex_env(md, "_Alpha") or tex_env(md, "_Mask")
        alpha = tex_rgba(maf, alpha_env) if alpha_env else None
        tint = dict(md["m_SavedProperties"].get("m_Colors", [])).get("_TintColor")
        # the material's animation, played by the app over the still picture:
        #   FlameDistortion: the picture wobbles by a scrolling noise (strength in UV units, speed)
        #   ScrollingWithMask: the diffuse texture scrolls sideways under the mask (both exported as they are)
        shader = ""
        try:
            shader = deref(maf, md["m_Shader"]["m_FileID"], md["m_Shader"]["m_PathID"]).read_typetree()["m_ParsedForm"]["m_Name"]
        except Exception:
            pass
        floats = dict(md["m_SavedProperties"].get("m_Floats", []))
        fx = None
        if shader.endswith("FlameDistortion"):
            fx = {"k": "wobble", "s": r3(floats.get("_NoiseStrength", 0)), "v": r3(floats.get("_Speed", 0)), "rev": int(floats.get("_ReverseDirection", 0) or 0)}
        elif shader.endswith("ScrollingWithMask") and alpha_env is not None:
            fx = {"k": "scroll", "v": r3(floats.get("_ScrollSpeed", 0)),
                  "tex": save_plain(maf, main, f"scroll_{mf.assets_file.name.split('.')[0]}_{gid}.png"),
                  "mask": save_plain(maf, alpha_env, f"mask_{mf.assets_file.name.split('.')[0]}_{gid}.png"),
                  "sx": r3(main.get("m_Scale", {"x": 1})["x"]), "sy": r3(main.get("m_Scale", {"y": 1})["y"])}
        if meo is not None:
            h = MeshHandler(meo.read()); h.process()
            V = np.array([v[:2] for v in h.m_Vertices], np.float32)
            U = np.array([u[:2] for u in h.m_UV0], np.float32)
            tris = [t for sub in h.get_triangles() for t in sub]
        else:
            # Unity's built-in Quad (unity default resources is not in the game's data): 1 x 1 around the origin
            V = np.array([[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]], np.float32)
            U = np.array([[0, 0], [1, 0], [0, 1], [1, 1]], np.float32)
            tris = [(0, 3, 1), (3, 0, 2)]
        x0, y0 = V.min(0); x1, y1 = V.max(0)
        bw, bh = float(x1 - x0), float(y1 - y0)
        if bw <= 0 or bh <= 0: return None
        # output resolution: about the texture's density over the UV span, at most 1024
        th, tw = rgba.shape[:2]
        uspan = max(1e-3, float(U[:, 0].max() - U[:, 0].min())); vspan = max(1e-3, float(U[:, 1].max() - U[:, 1].min()))
        W = int(min(1024, max(16, tw * uspan * main.get("m_Scale", {"x": 1})["x"])))
        H = int(min(1024, max(16, W * bh / bw)))
        gx, gy = np.meshgrid((np.arange(W) + 0.5) / W * bw + x0, y1 - (np.arange(H) + 0.5) / H * bh)
        P = np.stack([gx.ravel(), gy.ravel()], 1)
        out = np.zeros((W * H, 4), np.float32)
        for a, b, c in tris:
            A, B, C = V[a], V[b], V[c]
            d = (B[1] - C[1]) * (A[0] - C[0]) + (C[0] - B[0]) * (A[1] - C[1])
            if abs(d) < 1e-12: continue
            l1 = ((B[1] - C[1]) * (P[:, 0] - C[0]) + (C[0] - B[0]) * (P[:, 1] - C[1])) / d
            l2 = ((C[1] - A[1]) * (P[:, 0] - C[0]) + (A[0] - C[0]) * (P[:, 1] - C[1])) / d
            l3 = 1 - l1 - l2
            inside = (l1 >= -1e-4) & (l2 >= -1e-4) & (l3 >= -1e-4)
            if not inside.any(): continue
            uv = l1[inside, None] * U[a] + l2[inside, None] * U[b] + l3[inside, None] * U[c]
            px = sample(rgba, uv, main)
            if alpha is not None:
                am = sample(alpha, uv, alpha_env)
                # an alpha / mask texture: its alpha channel when it has one, else its grey level
                px[:, 3] *= am[:, 3] if am[:, 3].min() < 0.999 else am[:, 0]
            if tint:
                px[:, :3] *= np.array([tint["r"], tint["g"], tint["b"]]) * 2; px[:, 3] *= tint["a"]
            out[inside] = np.clip(px, 0, 1)
        img = Image.fromarray((out.reshape(H, W, 4) * 255).astype(np.uint8), "RGBA")
        fn = f"art_{mf.assets_file.name.split('.')[0]}_{gid}.png"
        img.save(os.path.join(TEX, fn))
        _art[key] = {"n": "#art", "id": -gid, "p": [r3((x0 + x1) / 2), r3((y0 + y1) / 2)],
                     "w": {"k": "texture", "w": r3(bw), "h": r3(bh), "pv": 4, "d": order, "tex": f"images/ui/tex/{fn}", **({"fx": fx} if fx else {})}}
    except Exception as e:
        print("mesh art failed", gid, e)
    return _art[key]


def node(gid, F=F):
    go = F.objects[gid].read()
    comps = [F.objects[c.component.path_id] for c in go.m_Component if c.component.file_id == 0 and c.component.path_id in F.objects]
    tro = next(co for co in comps if co.type.name in ("Transform", "RectTransform"))
    tr = tro.read()
    p, s, q = tr.m_LocalPosition, tr.m_LocalScale, tr.m_LocalRotation
    # tr: the Transform's path id (NGUI anchors point at Transforms)
    n = {"n": go.m_Name, "id": rid(gid), "tr": rid(tro.path_id)}
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
        collect_prefabs(cls, d, co.assets_file, go.m_Name)
        if cls in WIDGETS and "w" not in n:
            n["w"] = widget(WIDGETS[cls], d, co.assets_file)
            if not enabled(co): n["w"]["off"] = True
        elif cls == "UIPanel":
            clip = d.get("mClipping", 0)
            cr = d.get("mClipRange") or {}
            n["panel"] = {"d": d.get("mDepth", 0), "clip": [r3(cr.get("x", 0)), r3(cr.get("y", 0)), r3(cr.get("z", 0)), r3(cr.get("w", 0))] if clip else None}
            off = d.get("mClipOffset") or {}
            if clip and (off.get("x") or off.get("y")): n["panel"]["off"] = [r3(off.get("x", 0)), r3(off.get("y", 0))]
            # UIDrawCall.Clipping.SoftClip (3): the contents fade out over this many units at the region's edges
            soft = d.get("mClipSoftness") or {}
            if clip == 3 and (soft.get("x") or soft.get("y")): n["panel"]["soft"] = [r3(soft.get("x", 0)), r3(soft.get("y", 0))]
            an = [anchor(d.get(k)) for k in ("leftAnchor", "rightAnchor", "bottomAnchor", "topAnchor")]
            if clip and any(a and a[0] for a in an): n["panel"]["an"] = an  # UIPanel.OnAnchor: the clip region follows them
        elif cls in ("UIButton", "UIButtonColor"):
            n["btn"] = {"hover": col(d.get("hover")), "pressed": col(d.get("pressed")), "disabled": col(d.get("disabledColor")), "dur": r3(d.get("duration", 0.2)),
                        "target": rid((d.get("tweenTarget") or {}).get("m_PathID"))}
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
    ch = [node(F.objects[c.path_id].read().m_GameObject.path_id, F) for c in tr.m_Children]
    if "w" not in n:
        art = mesh_art(gid, comps)
        if art: ch.insert(0, art)
    if ch: n["ch"] = ch
    return n

def main():
    os.makedirs(OUT, exist_ok=True); os.makedirs(TEX, exist_ok=True)
    root = next(pid for pid, o in F.objects.items() if o.type.name == "GameObject" and o.read().m_Name == "UI Root")
    tree = node(root)
    # the prefabs the UI scripts instantiate (their own prefab references too, until none is new)
    global _remap
    prefabs, done = {}, set()
    while True:
        todo = [(k, v) for k, v in PREFAB_REFS.items() if k not in done]
        if not todo: break
        for key, (af, gid) in todo:
            done.add(key)
            _remap = {}
            try:
                prefabs[key] = node(gid, af)
            except Exception as e:
                print("prefab failed", key, e)
            _remap = None
    fonts = {f"{k[2]}": {"role": v[0], "name": v[1]} for k, v in _fonts.items()}
    with open(os.path.join(OUT, "ui.json"), "w", encoding="utf-8") as fp:
        json.dump({"size": [1280, 720], "root": tree, "fonts": fonts, "prefabs": prefabs}, fp, ensure_ascii=False, separators=(",", ":"))
    count = lambda n: 1 + sum(count(c) for c in n.get("ch", []))
    print(f"ui prefabs: {len(prefabs)} ({sum(count(p) for p in prefabs.values())} nodes)")
    print(f"ui layouts: {count(tree)} nodes, {len([v for v in _tex.values() if v])} textures, fonts {fonts} -> {OUT}")

if __name__ == "__main__":
    main()
