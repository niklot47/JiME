# Extract assets for the 3D prototype: tile hex geometry + textures, token meshes, props, particle textures
import os, json, io, math, re
import numpy as np
from PIL import Image
from jload import *

OUT = os.path.join(ROOT, "proto", "assets")
os.makedirs(OUT, exist_ok=True)
L4 = FILES["level4"]

def quat_mat(q):
    x, y, z, w = q.x, q.y, q.z, q.w
    return np.array([[1-2*(y*y+z*z), 2*(x*y-z*w), 2*(x*z+y*w)],
                     [2*(x*y+z*w), 1-2*(x*x+z*z), 2*(y*z-x*w)],
                     [2*(x*z-y*w), 2*(y*z+x*w), 1-2*(x*x+y*y)]])

def world_matrix(f, tr_obj):
    """4x4 world matrix of a Transform by walking its parents."""
    m = np.eye(4)
    chain = []
    t = tr_obj
    while t is not None:
        tr = t.read()
        chain.append(tr)
        t = f.objects.get(tr.m_Father.path_id) if tr.m_Father.path_id else None
    for tr in reversed(chain):
        local = np.eye(4)
        local[:3, :3] = quat_mat(tr.m_LocalRotation) * np.array([tr.m_LocalScale.x, tr.m_LocalScale.y, tr.m_LocalScale.z])
        local[:3, 3] = [tr.m_LocalPosition.x, tr.m_LocalPosition.y, tr.m_LocalPosition.z]
        m = m @ local
    return m

def comp(f, go, typ):
    for c in go.m_Component:
        o = f.objects[c.component.path_id]
        if o.type.name == typ: return o
        if o.type.name == "MonoBehaviour" and typ.startswith("MB:"):
            si = script_info(o)
            if si and si[1].endswith(typ[3:]): return o
    return None

def mesh_arrays(mesh):
    """Parse UnityPy OBJ export into flat arrays (positions, uvs, indices) keeping Unity vertex order."""
    v, vt, faces = [], [], []
    for line in mesh.export().splitlines():
        s = line.split()
        if not s: continue
        if s[0] == "v": v.append([float(x) for x in s[1:4]])
        elif s[0] == "vt": vt.append([float(x) for x in s[1:3]])
        elif s[0] == "f": faces.append([int(p.split("/")[0]) - 1 for p in s[1:]])
    return np.array(v), np.array(vt) if vt else None, faces

def save_tex(tex_obj, name, size=1024, fmt="JPEG", quality=85):
    img = tex_obj.read().image
    img.thumbnail((size, size))
    p = os.path.join(OUT, name)
    if fmt == "JPEG": img.convert("RGB").save(p, "JPEG", quality=quality)
    else: img.save(p, "PNG")
    return name

def find_texture(name):
    for f in FILES.values():
        for o in f.objects.values():
            if o.type.name == "Texture2D":
                try:
                    if o.read().m_Name == name: return o
                except Exception: pass
    return None

def tile_models():
    out = {}
    for o in FILES["sharedassets0.assets"].objects.values():
        if o.type.name == "MonoBehaviour" and script_info(o) and script_info(o)[1] == "FFG.JIME.TileModel":
            _, d = read_mb(o); out[o.path_id] = d
    return out

def extract_tiles(codes):
    tms = tile_models()
    tiles = {}
    for o in L4.objects.values():
        if o.type.name != "MonoBehaviour" or not script_info(o) or script_info(o)[1] != "FFG.JIME.Tile": continue
        _, t = read_mb(o)
        tm = tms.get(t["Model"]["m_PathID"])
        if not tm or tm["_id"] not in codes: continue
        code = tm["_id"]
        tile_go = L4.objects[t["m_GameObject"]["m_PathID"]].read()
        tile_tr = comp(L4, tile_go, "Transform")
        inv = np.linalg.inv(world_matrix(L4, tile_tr))
        hexes = []
        for h in t["Hexes"]:
            hc = L4.objects[h["m_PathID"]]
            _, hd = read_mb(hc)
            hgo = L4.objects[hd["m_GameObject"]["m_PathID"]].read()
            m = re.match(r"Hex_(-?\d+),(-?\d+)", hgo.m_Name)
            q, r = (int(m.group(1)), int(m.group(2))) if m else (0, 0)
            mf = comp(L4, hgo, "MeshFilter").read()
            mesh = file_of(L4, mf.m_Mesh.file_id).objects[mf.m_Mesh.path_id].read()
            V, VT, F = mesh_arrays(mesh)
            uvmap = comp(L4, hgo, "MB:HexUVMapping")
            uvs = None
            if uvmap is not None:
                _, ud = read_mb(uvmap)
                uvs = [[u["x"], u["y"]] for u in ud.get("UVs") or []]
            W = inv @ world_matrix(L4, comp(L4, hgo, "Transform"))
            Vw = (W @ np.c_[-V[:, 0], V[:, 1], V[:, 2], np.ones(len(V))].T).T[:, :3]  # OBJ export mirrors X
            if uvs is None or len(uvs) != len(V): uvs = (VT.tolist() if VT is not None else [[0, 0]] * len(V))
            hexes.append({"q": q, "r": r, "pos": np.round(Vw, 4).tolist(), "uv": np.round(np.array(uvs), 5).tolist(), "faces": F})
        img_path = tm.get("Image", {}).get("Path", "")
        tex = find_texture(os.path.splitext(os.path.basename(img_path))[0]) if img_path else None
        tex_file = save_tex(tex, f"tile_{code}.jpg", 1024) if tex else None
        tiles[code] = {"hexes": hexes, "texture": tex_file, "hash": tm.get("HashId")}
        print("tile", code, len(hexes), "hexes", tex_file)
    return tiles

def extract_mesh_by_name(name, files=None):
    for fn, f in FILES.items():
        if files and not any(x in fn for x in files): continue
        for o in f.objects.values():
            if o.type.name == "Mesh":
                m = o.read()
                if m.m_Name == name:
                    V, VT, F = mesh_arrays(m)
                    V[:, 0] *= -1
                    return {"pos": np.round(V, 4).tolist(), "uv": np.round(VT, 5).tolist() if VT is not None else None, "faces": F}
    return None

if __name__ == "__main__":
    codes = ["302A", "100A", "400A", "207A", "306A", "203B", "308B", "209A"]
    data = {"tiles": extract_tiles(codes)}
    # token disc and terrain token textures (as in the original map view)
    data["tokenMesh"] = extract_mesh_by_name("Round", ["resources"])
    data["terrainMesh"] = extract_mesh_by_name("Statue", ["resources"])
    data["textures"] = {}
    for tn, fname in [("Search-Token", "tok_search.png"), ("Threat-Token", "tok_threat.png"), ("Human-Token", "tok_person.png"),
                      ("Explore-Token", "tok_explore.png"), ("9_Fire", "ter_fire.png"), ("0_Bushes", "ter_bushes.png"),
                      ("8_Statue", "ter_statue.png"), ("1_Rocks", "ter_rocks.png"), ("cloud_type_a", "fx_cloud.png"),
                      ("smoketex", "fx_smoke.png"), ("part_dust", "fx_dust.png"), ("ThreatFire", "fx_fire.png"),
                      ("noise_clouds", "fx_noise.jpg")]:
        t = find_texture(tn)
        if t is None: print("missing texture", tn); continue
        data["textures"][tn] = save_tex(t, fname, 512, "JPEG" if fname.endswith(".jpg") else "PNG")
    # battle map props
    props = {}
    for mn in ["Statue08_b", "Wall06", "Rocks3_lp:Group20184", "Small_Tree_01", "Small_Tree_02", "Firelogs", "S_bush_01", "WallTop"]:
        m = extract_mesh_by_name(mn, ["sharedassets5", "sharedassets6", "sharedassets7", "sharedassets8"])
        if m: props[mn] = m
    data["props"] = props
    for tn, fname in [("JIME_Battleboard_Rocks_BS", "bb_ground.jpg"), ("rocks_atlas", "prop_rocks.jpg"), ("Trees", "prop_trees.png"),
                      ("PropAtlas", "prop_atlas.jpg"), ("Terrain_Diffuse", "bb_terrain.jpg"), ("Wood", "prop_wood.jpg")]:
        t = find_texture(tn)
        if t is None: print("missing texture", tn); continue
        data["textures"][tn] = save_tex(t, fname, 1024, "PNG" if fname.endswith(".png") else "JPEG")
    json.dump(data, open(os.path.join(OUT, "scene.json"), "w"))
    print("props", list(props), "textures", list(data["textures"]))
