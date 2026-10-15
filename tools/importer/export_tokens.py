# Export board tokens (local only, FFG content) to <JIME_WORK>/packs/core-ffg/images/tokens/:
#   <TokenTypes id>.png   top face of the token as seen from above (2D board): cut out of the texture with the
#                         token mesh's own top-face UVs, so the shape and the crop are exact;
#   raw/<id>.png          the whole texture (3D board: mapped on the mesh with its UVs);
#   meshes.json           the game's token meshes {round, explore, hexagon}: pos (Unity, z up), uv, faces;
#   tokens.json           { "<id>": { "top": ..., "raw": ..., "mesh": "round" | "explore" | "hexagon" } }.
# Ids: Token3DManager.TokenTypes. Meshes: "Round" (circle tokens), "Explore" (square explore token),
# "Darkness" (the small hexagon tokens).
import os, json
import numpy as np
from PIL import Image, ImageDraw
from jload import *
from proto_extract import extract_mesh_by_name, mesh_arrays

PACK = os.path.join(ROOT, "packs", "core-ffg")
OUT = os.path.join(PACK, "images", "tokens")
TEXTURES = {
    "Explore-Token": [1], "Search-Token": [2], "Threat-Token": [3],
    "Dwarf-Token": [4], "Elf-Token": [5], "Hobbit-Token": [6], "Human-Token": [7],
    "Darkness-Token": [31], "Difficult Terrain Token": [32], "Fortified Token": [33],
}
MESHES = {"round": "Round", "explore": "Explore", "hexagon": "Darkness"}

def mesh_of(tid):
    return "explore" if tid == 1 else "hexagon" if tid in (31, 32, 33) else "round"

def name_of(o):
    try:
        return o.peek_name()
    except Exception:
        return o.read().m_Name

def top_face(img, mesh):
    """The part of the texture on the mesh's flat top (z = max), masked by those triangles in UV space"""
    w, h = img.size
    P, U = np.array(mesh["pos"]), np.array(mesh["uv"])
    top = P[:, 2] >= P[:, 2].max() - 1e-4
    mask = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(mask)
    for f in mesh["faces"]:
        if all(top[i] for i in f):
            d.polygon([(U[i][0] * w, (1 - U[i][1]) * h) for i in f], fill=255)
    out = img.copy()
    out.putalpha(mask)
    return out.crop(mask.getbbox())

TERRAIN_POOLS = {"terrain_small_circle": "PoolTokens3D_Terrain_Small_Circle", "terrain_large_circle": "PoolTokens3D_Terrain_Large_Circle",
                 "terrain_small_rect": "PoolTokens3D_Terrain_Small_Rectangle", "terrain_edge": "PoolTokens3D_Terrain_Edge"}


def unit_cube():
    pos, uv, faces = [], [], []
    for axis in range(3):
        for sgn in (1, -1):
            u, v = [(a) for a in range(3) if a != axis]
            base = len(pos)
            for cu, cv in ((0, 0), (1, 0), (1, 1), (0, 1)):
                p = [0.0, 0.0, 0.0]
                p[axis] = 0.5 * sgn
                p[u] = cu - 0.5
                p[v] = cv - 0.5
                pos.append(p)
                uv.append([cu, cv])
            faces += [[base, base + 1, base + 2], [base, base + 2, base + 3]] if sgn > 0 else [[base, base + 2, base + 1], [base, base + 3, base + 2]]
    return {"pos": pos, "uv": uv, "faces": faces}


def terrain_tokens(meshes, found):
    """Battleboard terrain tokens (Token3DManager terrain pools): each pool's token mesh and its material per TokenType"""
    from prefab import CONT, RA
    for mk, pool in TERRAIN_POOLS.items():
        key = f"prefabs/terrain/{pool.lower()}"
        if key not in CONT:
            print("  missing", key)
            continue
        root = RA.objects[CONT[key]["m_PathID"]].read()
        tp = None
        for c in root.m_Component:
            o = deref(RA, c.component.m_FileID, c.component.m_PathID)
            if o is not None and o.type.name == "MonoBehaviour":
                si = script_info(o)
                if si and si[1].endswith("Token3DPool"):
                    tp = read_mb(o)[1]
        if tp is None:
            continue
        # Pool (PrefabPool) -> Prefab -> its MeshFilter
        pp = tp["Pool"]
        po = deref(RA, pp["m_FileID"], pp["m_PathID"])
        pd = read_mb(po)[1]
        pfo = deref(po.assets_file, pd["Prefab"]["m_FileID"], pd["Prefab"]["m_PathID"])
        pf = pfo.read()
        mesh = None
        scale = None
        for c in pf.m_Component:
            o = deref(pfo.assets_file, c.component.m_FileID, c.component.m_PathID)
            if o is not None and o.type.name == "Transform":
                sc = o.read().m_LocalScale
                scale = [sc.x, sc.y, sc.z]
            if o is not None and o.type.name == "MeshFilter":
                mo = o.read().m_Mesh
                mobj = deref(o.assets_file, mo.m_FileID, mo.m_PathID) or next(
                    (x for f in FILES.values() for x in [f.objects.get(mo.m_PathID)] if x is not None and x.type.name == "Mesh"), None)
                if mobj is None:
                    # Unity's built-in cube (the edge tokens): a unit cube, every face mapped 0..1
                    mesh = unit_cube()
                    continue
                m = mobj.read()
                V, VT, F = mesh_arrays(m)
                V[:, 0] *= -1
                mesh = {"pos": np.round(V, 4).tolist(), "uv": np.round(VT, 5).tolist() if VT is not None else None, "faces": F}
        if mesh is None:
            print("  no mesh", pool)
            continue
        if scale and scale != [1, 1, 1]:
            mesh["scale"] = [round(v, 4) for v in scale]
        meshes[mk] = mesh
        for pair in tp.get("Materials") or []:
            tid = int(pair["TokenType"])
            mp = pair["Material"]
            mat = deref(RA, mp["m_FileID"], mp["m_PathID"])  # the pool's own file
            if mat is None:
                continue
            te = dict(mat.read().m_SavedProperties.m_TexEnvs).get("_MainTex")
            if te is None or not te.m_Texture.m_PathID:
                continue
            img = deref(mat.assets_file, te.m_Texture.m_FileID, te.m_Texture.m_PathID).read().image.convert("RGBA")
            img.save(os.path.join(OUT, "raw", f"{tid}.png"))
            top_face(img, mesh).save(os.path.join(OUT, f"{tid}.png"))
            found[str(tid)] = {"top": f"images/tokens/{tid}.png", "raw": f"images/tokens/raw/{tid}.png", "mesh": mk}
        print("  terrain tokens", mk, sorted(int(p["TokenType"]) for p in tp.get("Materials") or []))


def main():
    os.makedirs(os.path.join(OUT, "raw"), exist_ok=True)
    meshes = {k: extract_mesh_by_name(v, ["resources"]) for k, v in MESHES.items()}
    with open(os.path.join(OUT, "meshes.json"), "w", encoding="utf-8") as fp:
        json.dump({k: m for k, m in meshes.items() if m}, fp)
    found = {}
    for o in FILES["resources.assets"].objects.values():
        if o.type.name != "Texture2D" or name_of(o) not in TEXTURES:
            continue
        img = o.read().image.convert("RGBA")
        for tid in TEXTURES[name_of(o)]:
            mk = mesh_of(tid)
            img.save(os.path.join(OUT, "raw", f"{tid}.png"))
            if meshes.get(mk):
                top_face(img, meshes[mk]).save(os.path.join(OUT, f"{tid}.png"))
            found[str(tid)] = {"top": f"images/tokens/{tid}.png", "raw": f"images/tokens/raw/{tid}.png", "mesh": mk}
    terrain_tokens(meshes, found)
    with open(os.path.join(OUT, "meshes.json"), "w", encoding="utf-8") as fp:
        json.dump({k: m for k, m in meshes.items() if m}, fp)
    with open(os.path.join(OUT, "tokens.json"), "w", encoding="utf-8") as fp:
        json.dump(dict(sorted(found.items(), key=lambda kv: int(kv[0]))), fp, indent=1)
    print(f"tokens: {len(found)} -> {OUT}; meshes: {[k for k, m in meshes.items() if m]}")

if __name__ == "__main__":
    main()
