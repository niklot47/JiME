"""
Reference copies of the imported game's 3D scenes for remodelling them (personal use, local only - never committed):
for every .glb of the pack (map room, rest, title, battleboards and their terrain pieces)
  <out>/<name>.glb                 the original (Blender: File > Import > glTF 2.0 - hierarchy, textures, sizes)
  <out>/obj/<name>.obj + .mtl      the same as OBJ (one object per mesh, named by its path), textures in obj/tex/
  <out>/objects.md                 the list: every object group with its size (scene units)
Particle systems (":psmat" / ":psmesh") are left out.

Usage: python tools/importer/export_3d_reference.py [pack dir] [out dir]
"""
import json
import os
import shutil
import struct
import sys

import numpy as np

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
PACK = sys.argv[1] if len(sys.argv) > 1 else os.path.join(REPO, "data", "packs", "core-ffg")
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(REPO, "data", "3d_reference")
COMP = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
NCOMP = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}


def read_glb(path):
    b = open(path, "rb").read()
    jlen = struct.unpack_from("<I", b, 12)[0]
    g = json.loads(b[20:20 + jlen])
    off = 20 + jlen
    blen = struct.unpack_from("<I", b, off)[0]
    return g, b[off + 8: off + 8 + blen]


def accessor(g, binary, i):
    a = g["accessors"][i]
    bv = g["bufferViews"][a["bufferView"]]
    dt = np.dtype(COMP[a["componentType"]])
    n = NCOMP[a["type"]]
    start = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
    stride = bv.get("byteStride", dt.itemsize * n)
    raw = np.frombuffer(binary, dtype=np.uint8, count=stride * (a["count"] - 1) + dt.itemsize * n, offset=start)
    out = np.lib.stride_tricks.as_strided(raw, shape=(a["count"], dt.itemsize * n), strides=(stride, 1)).copy()
    return out.view(dt).reshape(a["count"], n)


def local_matrix(n):
    if "matrix" in n:
        return np.array(n["matrix"], np.float64).reshape(4, 4).T
    t = np.array(n.get("translation", [0, 0, 0]), np.float64)
    x, y, z, w = n.get("rotation", [0, 0, 0, 1])
    s = np.array(n.get("scale", [1, 1, 1]), np.float64)
    r = np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                  [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                  [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])
    m = np.eye(4)
    m[:3, :3] = r * s
    m[:3, 3] = t
    return m


def safe(s):
    return "".join(c if c.isalnum() or c in "-_." else "_" for c in s)


def export(path, name, lines):
    g, binary = read_glb(path)
    obj_dir = os.path.join(OUT, "obj")
    tex_dir = os.path.join(obj_dir, "tex")
    os.makedirs(tex_dir, exist_ok=True)
    # textures
    tex_files = {}
    for ii, im in enumerate(g.get("images", [])):
        if "bufferView" not in im:
            continue
        bv = g["bufferViews"][im["bufferView"]]
        ext = ".png" if "png" in im.get("mimeType", "") else ".jpg"
        fn = f"{safe(name)}_{ii}{ext}"
        with open(os.path.join(tex_dir, fn), "wb") as f:
            f.write(binary[bv.get("byteOffset", 0): bv.get("byteOffset", 0) + bv["byteLength"]])
        tex_files[ii] = fn
    mats = []
    with open(os.path.join(obj_dir, f"{name}.mtl"), "w", encoding="utf-8") as mtl:
        for mi, m in enumerate(g.get("materials", [])):
            mn = safe(f"{mi}_{m.get('name', 'mat')}")
            mats.append(mn)
            pbr = m.get("pbrMetallicRoughness", {})
            c = pbr.get("baseColorFactor", [1, 1, 1, 1])
            mtl.write(f"newmtl {mn}\nKd {c[0]:.3f} {c[1]:.3f} {c[2]:.3f}\nd {c[3]:.3f}\n")
            t = pbr.get("baseColorTexture")
            if t is not None:
                src = g["textures"][t["index"]].get("source")
                if src in tex_files:
                    mtl.write(f"map_Kd tex/{tex_files[src]}\n")
            mtl.write("\n")
    # walk the scene: world matrices, one OBJ object per mesh node
    groups = {}
    vbase = tbase = 1
    obj = open(os.path.join(obj_dir, f"{name}.obj"), "w", encoding="utf-8")
    obj.write(f"# {name}: reference geometry exported from the imported game (personal use)\nmtllib {name}.mtl\n")

    def walk(i, parent, trail):
        nonlocal vbase, tbase
        n = g["nodes"][i]
        nm = n.get("name", f"node{i}")
        m = parent @ local_matrix(n)
        tr = trail + [nm]
        particle = ":psmat" in nm or ":psmesh" in nm
        if "mesh" in n and not particle:
            group = "/".join(tr[:3]) if len(tr) > 3 else "/".join(tr[:-1]) or nm
            obj.write(f"o {safe('/'.join(tr))}\n")
            for p in g["meshes"][n["mesh"]]["primitives"]:
                if p.get("mode", 4) != 4 or "POSITION" not in p["attributes"]:
                    continue
                pos = accessor(g, binary, p["attributes"]["POSITION"]).astype(np.float64)
                w = (np.c_[pos, np.ones(len(pos))] @ m.T)[:, :3]
                uv = accessor(g, binary, p["attributes"]["TEXCOORD_0"]).astype(np.float64) if "TEXCOORD_0" in p["attributes"] else None
                idx = accessor(g, binary, p["indices"]).ravel() if "indices" in p else np.arange(len(pos))
                # a statically batched renderer uses a part of the combined mesh: keep only its own vertices
                used, idx = np.unique(idx, return_inverse=True)
                w = w[used]
                pos = pos[used]
                if uv is not None:
                    uv = uv[used]
                if "material" in p:
                    obj.write(f"usemtl {mats[p['material']]}\n")
                obj.write("".join(f"v {a:.5f} {b:.5f} {c:.5f}\n" for a, b, c in w))
                if uv is not None:
                    obj.write("".join(f"vt {a:.5f} {1 - b:.5f}\n" for a, b in uv))
                # a mirrored transform (negative determinant) flips the winding
                tri = idx.reshape(-1, 3)
                if np.linalg.det(m[:3, :3]) < 0:
                    tri = tri[:, ::-1]
                for t in tri:
                    if uv is not None:
                        obj.write("f " + " ".join(f"{vbase + k}/{tbase + k}" for k in t) + "\n")
                    else:
                        obj.write("f " + " ".join(str(vbase + k) for k in t) + "\n")
                vbase += len(pos)
                if uv is not None:
                    tbase += len(uv)
                lo, hi = w.min(0), w.max(0)
                gl, gh = groups.get(group, (lo, hi))
                groups[group] = (np.minimum(gl, lo), np.maximum(gh, hi))
        for c in n.get("children", []):
            walk(c, m, tr)

    for r in g["scenes"][g.get("scene", 0)]["nodes"]:
        walk(r, np.eye(4), [])
    obj.close()
    lines.append(f"\n## {name}\n\n| object | size x · y · z (units) |\n|---|---|")
    for k in sorted(groups):
        lo, hi = groups[k]
        d = hi - lo
        lines.append(f"| {k} | {d[0]:.2f} · {d[1]:.2f} · {d[2]:.2f} |")


def main():
    if os.path.exists(OUT):
        shutil.rmtree(OUT)
    os.makedirs(OUT)
    scenes = []
    for sub in ("maproom", "battleboard", os.path.join("battleboard", "pieces")):
        d = os.path.join(PACK, sub)
        if os.path.isdir(d):
            scenes += [(os.path.join(d, f), (f[:-4] if sub != os.path.join("battleboard", "pieces") else "piece_" + f[:-4])) for f in sorted(os.listdir(d)) if f.endswith(".glb")]
    lines = ["# 3D objects of the original (reference for remodelling)",
             "", "units of the scene (Unity units: the relative sizes are right), the axes as Blender imports them (Y up in the file, Blender turns it to Z up).",
             "Particle systems are not exported (fire, smoke, dust, light shafts are effects, not models)."]
    for path, name in scenes:
        shutil.copy2(path, os.path.join(OUT, f"{name}.glb"))
        export(path, name, lines)
        print("ok", name)
    open(os.path.join(OUT, "objects.md"), "w", encoding="utf-8").write("\n".join(lines) + "\n")


if __name__ == "__main__":
    main()
