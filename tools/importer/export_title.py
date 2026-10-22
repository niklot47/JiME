# Export the title screen's background (local only, FFG content) to <JIME_WORK>/packs/core-ffg/maproom/:
#   title.glb   the Titlescreen scene (level1, Z_Art / TitlescreenVisuals): a painted forest battle - Aragorn, Legolas
#               and Gimli against orcs - as painted cut-out cards standing in 3D, trees, terrain, light shafts, dust
#   title.json  { "camera": {fov, near, far, clear}, "clips": { name: { dur, fps, loop, tracks: [track] } },
#                 "states": [clip names in the Animator's order: CameraWiggle -> TitleArtSequence] }
#               track: { path (node path under Z_Art, "" = Z_Art), prop, n (values per frame), v: [frames * n] }
#               prop: "pos" | "euler" (degrees, Unity order ZXY) | "scale" (Unity space: not mirrored) |
#                     "fov" | "color.r/g/b/a" | "add.r/g/b/a" (the renderer's material: _Color, _ColorAdd - the
#                     characters' flashes) | "fx:<name or hash>" (camera effect values)
# The Animator's clips are Mecanim muscle clips (streamed cubic keys + constants): evaluated here and sampled.
import os, sys, json, zlib, struct
import numpy as np
from jload import *
import glb
from export_maproom import SceneExporter, OUT
from export_battleboard import roots

FPS = 30
# properties animated on renderers' materials (type 23): attribute = crc32 of "material.<prop>.<c>"
MAT_PROPS = ["_Color", "_ColorAdd", "_TintColor", "_MainColor", "_Tint", "_Alpha", "_Opacity", "_Fade", "_Cutoff"]
FX_NAMES = ["DOFParams.Focus", "DOFParams.FocalLengthMultiplier", "FocalLengthMultiplier", "Strength", "LensDirtIntensity",
            "ChromaticAberrationOffset", "DOFParams.BokehThreshold", "DOFParams.BokehStrength"]


def names_of_hash():
    out = {zlib.crc32(b"field of view"): "fov", zlib.crc32(b"m_Enabled"): "enabled"}
    for p in MAT_PROPS:
        for c in "rgbaxyzw":
            out[zlib.crc32(f"material.{p}.{c}".encode())] = f"color.{c}" if p != "_Alpha" else "alpha"
        out[zlib.crc32(f"material.{p}".encode())] = f"mat{p}"
        # (Mecanim material bindings: the property name's crc32 in the low 28 bits, the component (4..7 = r g b a)
        # in the top four)
        for k, c in enumerate("rgba"):
            out[(zlib.crc32(p.encode()) & 0x0FFFFFFF) | ((4 + k) << 28)] = f"{'add' if p == '_ColorAdd' else 'color'}.{c}"
    for n in FX_NAMES:
        out[zlib.crc32(n.encode())] = "fx:" + n
    return out


def streamed_keys(words, count):
    """StreamedClip: frames of (time, keys [(curve, a, b, c, d)]) -> per curve [(time, a, b, c, d)]"""
    raw = struct.pack(f"<{len(words)}I", *words)
    pos, curves = 0, [[] for _ in range(count)]
    while pos < len(raw):
        t, nk = struct.unpack_from("<fI", raw, pos); pos += 8
        for _ in range(nk):
            idx, a, b, c, d = struct.unpack_from("<i4f", raw, pos); pos += 20
            if 0 <= idx < count:
                curves[idx].append((t, a, b, c, d))
    return curves


def eval_curve(keys, t):
    k = None
    for key in keys:
        if key[0] <= t: k = key
        else: break
    if k is None: k = keys[0]
    dt = t - k[0] if np.isfinite(k[0]) else 0.0
    return ((k[1] * dt + k[2]) * dt + k[3]) * dt + k[4]


def clip_tracks(clip, paths, hashes):
    mc = clip["m_MuscleClip"]
    data = mc["m_Clip"]["data"]
    sc, dc, cc = data["m_StreamedClip"], data["m_DenseClip"], data["m_ConstantClip"]["data"]
    ns = sc["curveCount"]
    s_keys = streamed_keys(sc["data"], ns)
    dense = np.array(dc["m_SampleArray"], np.float32).reshape(-1, dc["m_CurveCount"]) if dc["m_CurveCount"] else None
    dur = float(mc["m_StopTime"] - mc["m_StartTime"])
    frames = int(round(dur * FPS)) + 1
    times = [min(dur, i / FPS) for i in range(frames)]

    def curve(i):
        if i < ns:
            ks = s_keys[i]
            return [eval_curve(ks, t) for t in times] if ks else [0.0] * frames
        i -= ns
        if i < dc["m_CurveCount"]:
            return [float(dense[min(len(dense) - 1, int(round((t - dc["m_BeginTime"]) * dc["m_SampleRate"]))), i]) for t in times]
        i -= dc["m_CurveCount"]
        return [float(cc[i])] * frames

    tracks, ci = [], 0
    for b in clip["m_ClipBindingConstant"]["genericBindings"]:
        path = paths.get(b["path"], hex(b["path"]))
        if b["typeID"] == 4:
            n = {1: 3, 2: 4, 3: 3, 4: 3}.get(b["attribute"], 1)
            prop = {1: "pos", 2: "quat", 3: "scale", 4: "euler"}.get(b["attribute"], f"t{b['attribute']}")
        else:
            n = 1
            prop = hashes.get(b["attribute"], f"{b['typeID']}:{b['attribute']}")
        cols = [curve(ci + k) for k in range(n)]
        ci += n
        v = [round(float(cols[k][f]), 5) for f in range(frames) for k in range(n)]
        tracks.append({"path": path, "prop": prop, "n": n, "v": v})
    return {"dur": dur, "fps": FPS, "loop": bool(mc.get("m_LoopTime")), "tracks": tracks}


def export_title():
    af = FILES["level1"]
    gos = {pid: o.read() for pid, o in af.objects.items() if o.type.name == "GameObject"}
    trs = {pid: o.read() for pid, o in af.objects.items() if o.type.name == "Transform"}
    z = next(pid for pid, g in gos.items() if g.m_Name == "Z_Art")
    ztr = next(pid for pid, t in trs.items() if t.m_GameObject.m_PathID == z)
    paths = {0: ""}

    def walk(tpid, prefix):
        for c in trs[tpid].m_Children:
            p = (prefix + "/" if prefix else "") + gos[trs[c.m_PathID].m_GameObject.m_PathID].m_Name
            paths[zlib.crc32(p.encode())] = p
            walk(c.m_PathID, p)
    walk(ztr, "")
    hashes = names_of_hash()

    anim = next(o for o in af.objects.values() if o.type.name == "Animator")
    ref = anim.read_typetree()["m_Controller"]
    ctrl = deref(af, ref["m_FileID"], ref["m_PathID"])
    ct = ctrl.read_typetree()
    clips, order = {}, []
    for x in ct["m_AnimationClips"]:
        clip = deref(ctrl.assets_file, x["m_FileID"], x["m_PathID"]).read_typetree()
        clips[clip["m_Name"]] = clip_tracks(clip, paths, hashes)
        order.append(clip["m_Name"])
    unknown = sorted({t["prop"] for c in clips.values() for t in c["tracks"] if ":" in t["prop"] and not t["prop"].startswith("fx:")})
    if unknown: print("  unresolved animated properties:", unknown)

    cam = next(o for o in af.objects.values() if o.type.name == "Camera").read_typetree()
    bg = cam["m_BackGroundColor"]
    info = {"camera": {"fov": cam["field of view"], "near": cam["near clip plane"], "far": cam["far clip plane"],
                       "clear": [bg["r"], bg["g"], bg["b"]]},
            "states": order, "clips": clips}
    rs = next((o for o in af.objects.values() if o.type.name == "RenderSettings"), None)
    if rs is not None:
        r = rs.read_typetree()
        info["ambient"] = {k: r.get(k) for k in ("m_AmbientSkyColor", "m_AmbientEquatorColor", "m_AmbientGroundColor", "m_AmbientMode", "m_AmbientIntensity")}
        info["fog"] = {k: r.get(k) for k in ("m_Fog", "m_FogColor", "m_FogMode", "m_FogDensity", "m_LinearFogStart", "m_LinearFogEnd")}

    # the painted cards are large atlases: keep more of their detail than the boards' 1024 px
    glb.Glb.image.__defaults__ = (2048,)
    ex = SceneExporter()
    for r in roots(af):
        if gos.get(r.path_id) and gos[r.path_id].m_Name in ("PersistentGameObject", "TitlescreenDynamicSoundGroup"):
            continue
        ex.go(r)
    os.makedirs(OUT, exist_ok=True)
    ex.save(os.path.join(OUT, "title.glb"))
    with open(os.path.join(OUT, "title.json"), "w", encoding="utf-8") as fp:
        json.dump(info, fp, separators=(",", ":"))
    print(f"  title: clips {[(k, round(c['dur'], 1), len(c['tracks'])) for k, c in clips.items()]}")


def main():
    print("title screen")
    export_title()


if __name__ == "__main__":
    main()
