"""
A minimal campaign map room as a binary glTF, laid out like a Blender export following the naming convention of
apps/app/src/screens/menu/CampaignMap3D.tsx: a table, the "Map" plane on it (UVs 0..1, v up), a "Camera" looking at
it, a candle-like "Fire" cone. To check the 3D map before a real scene exists, or as a starting point in Blender
(File > Import > glTF).

    python tools/menu-theme/make_test_maproom.py themes/<name>/map/room.glb
"""
import json
import struct
import sys
from pathlib import Path


def box(w, h, d, y0):
    """An axis-aligned box: positions, normals, uvs, indices"""
    x, z = w / 2, d / 2
    faces = [((0, 1, 0), [(-x, y0 + h, -z), (x, y0 + h, -z), (x, y0 + h, z), (-x, y0 + h, z)]),
             ((0, -1, 0), [(-x, y0, z), (x, y0, z), (x, y0, -z), (-x, y0, -z)]),
             ((0, 0, 1), [(-x, y0, z), (-x, y0 + h, z), (x, y0 + h, z), (x, y0, z)]),
             ((0, 0, -1), [(x, y0, -z), (x, y0 + h, -z), (-x, y0 + h, -z), (-x, y0, -z)]),
             ((1, 0, 0), [(x, y0, z), (x, y0 + h, z), (x, y0 + h, -z), (x, y0, -z)]),
             ((-1, 0, 0), [(-x, y0, -z), (-x, y0 + h, -z), (-x, y0 + h, z), (-x, y0, z)])]
    P, N, U, I = [], [], [], []
    for n, quad in faces:
        b = len(P)
        P += quad
        N += [n] * 4
        U += [(0, 0), (1, 0), (1, 1), (0, 1)]
        I += [b, b + 2, b + 1, b, b + 3, b + 2]
    return P, N, U, I


def plane(w, d, y):
    """The map: x right, -z up the picture; uv (0, 1) at the top left (glTF uv origin top left, v down)"""
    x, z = w / 2, d / 2
    P = [(-x, y, -z), (x, y, -z), (x, y, z), (-x, y, z)]
    N = [(0, 1, 0)] * 4
    U = [(0, 0), (1, 0), (1, 1), (0, 1)]
    return P, N, U, [0, 2, 1, 0, 3, 2]


def cone(r, h, y0, n=16):
    import math
    P, N, U, I = [(0, y0 + h, 0)], [(0, 1, 0)], [(0.5, 0)], []
    for i in range(n):
        a = 2 * math.pi * i / n
        P.append((r * math.cos(a), y0, r * math.sin(a)))
        N.append((math.cos(a), 0.4, math.sin(a)))
        U.append((i / n, 1))
    for i in range(n):
        I += [0, 1 + (i + 1) % n, 1 + i]
    return P, N, U, I


def main(out):
    meshes = [("Table", box(7.0, 0.3, 4.6, -0.3), (0.32, 0.2, 0.12)),
              ("Map", plane(5.6, 3.5, 0.002), (0.88, 0.8, 0.62)),
              ("Fire", cone(0.05, 0.16, 0.0), (1.0, 0.6, 0.2))]
    blob = bytearray()
    views, accessors, gmeshes, materials, nodes = [], [], [], [], []

    def add(data, fmt, count, comp, typ, target, minmax=None):
        while len(blob) % 4:
            blob.append(0)
        off = len(blob)
        for v in data:
            blob.extend(struct.pack(fmt, *(v if isinstance(v, tuple) else (v,))))
        views.append({"buffer": 0, "byteOffset": off, "byteLength": len(blob) - off, "target": target})
        acc = {"bufferView": len(views) - 1, "componentType": comp, "count": count, "type": typ}
        if minmax:
            acc["min"], acc["max"] = minmax
        accessors.append(acc)
        return len(accessors) - 1

    for i, (name, (P, N, U, I), col) in enumerate(meshes):
        mn = [min(p[k] for p in P) for k in range(3)]
        mx = [max(p[k] for p in P) for k in range(3)]
        pa = add(P, "<3f", len(P), 5126, "VEC3", 34962, (mn, mx))
        na = add(N, "<3f", len(N), 5126, "VEC3", 34962)
        ua = add(U, "<2f", len(U), 5126, "VEC2", 34962)
        ia = add(I, "<H", len(I), 5123, "SCALAR", 34963)
        materials.append({"name": name, "pbrMetallicRoughness": {"baseColorFactor": [*col, 1], "metallicFactor": 0, "roughnessFactor": 0.85},
                          **({"emissiveFactor": [1, 0.5, 0.1]} if name == "Fire" else {})})
        gmeshes.append({"name": name, "primitives": [{"attributes": {"POSITION": pa, "NORMAL": na, "TEXCOORD_0": ua}, "indices": ia, "material": i}]})
        nodes.append({"name": name, "mesh": i})
    # the camera above the near edge, looking down at the map (rotation about x: -55 degrees)
    import math
    a = math.radians(-55) / 2
    nodes.append({"name": "Camera", "camera": 0, "translation": [0, 4.2, 3.4], "rotation": [math.sin(a), 0, 0, math.cos(a)]})
    gltf = {"asset": {"version": "2.0", "generator": "JiME Reborn make_test_maproom.py"}, "scene": 0,
            "scenes": [{"nodes": list(range(len(nodes)))}], "nodes": nodes, "meshes": gmeshes, "materials": materials,
            "cameras": [{"type": "perspective", "perspective": {"yfov": math.radians(40), "znear": 0.05, "zfar": 100, "aspectRatio": 1.78}}],
            "accessors": accessors, "bufferViews": views, "buffers": [{"byteLength": len(blob)}]}
    js = json.dumps(gltf, separators=(",", ":")).encode()
    js += b" " * (-len(js) % 4)
    while len(blob) % 4:
        blob.append(0)
    out = Path(out)
    out.parent.mkdir(parents=True, exist_ok=True)
    with open(out, "wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(blob)))
        f.write(struct.pack("<II", len(js), 0x4E4F534A) + js)
        f.write(struct.pack("<II", len(blob), 0x004E4942) + bytes(blob))
    print(out, len(js) + len(blob), "bytes")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "data/out/maproom-test.glb")
