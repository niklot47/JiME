# Export the battleboard 3D art (local only, FFG content) to <JIME_WORK>/packs/core-ffg/battleboard/:
#   <skin>.glb         environment scenes Battleboard_Forest / _Rock / _Town (level5..7 "ArtAssets"): island, edges,
#                      set dressing, board squares BB_01..09 / Chasm_01..09, river grid pieces (BBEdgeGrid), lights;
#                      the river corner / nub / T prefabs of BBManager's pools under the root node "RiverPrefabs";
#                      node extras: active (false = inactive GameObject), mb (MonoBehaviour classes), light, particles
#   pieces/<Type>.glb  full 3D terrain pieces (Resources/Prefabs/Terrain/PoolFull3DMesh_*), Token3DManager.GetPiecesPool
#   terrain.json       terrain token meshes (PoolTokens3D_Terrain_*) like images/tokens/meshes.json + texture per type
# Statically batched renderers keep their world-space vertices under a node with the inverse world matrix.
import os, json, re
import numpy as np
from UnityPy.helpers.MeshHelper import MeshHandler
from jload import *
from glb import Glb, trs, trs_matrix

PACK = os.path.join(ROOT, "packs", "core-ffg")
OUT = os.path.join(PACK, "battleboard")
SKINS = {"Board-Forest": "forest", "Board-Rock": "rock", "Board-Quarry": "rock", "Board-Town": "town"}
PIECES = ["Fire", "Bushes", "Rocks", "Statue", "Webs", "Rubbles", "Fog", "Barrel", "Table", "Logs", "Elevations",
          "Walls", "Fences", "Trenches", "Pits", "Fountains", "Ponds", "Chests", "Barricades"]


def shader_name(af, m):
    try:
        sh = deref(af, m.m_Shader.m_FileID, m.m_Shader.m_PathID).read()
        pf = getattr(sh, "m_ParsedForm", None)
        return (pf.m_Name if pf else sh.m_Name) or ""
    except Exception:
        return ""


def obj_of(af, pptr):
    return deref(af, pptr.m_FileID, pptr.m_PathID) if pptr.m_PathID else None


def props(mat):
    sp = mat.m_SavedProperties
    as_dict = lambda v: dict(v) if isinstance(v, list) else (v or {})
    return as_dict(sp.m_TexEnvs), as_dict(sp.m_Floats), as_dict(sp.m_Colors)


class Exporter:
    def __init__(self):
        self.g = Glb()
        self.meshes, self.mats, self.texs, self.prims = {}, {}, {}, {}

    def used(self, ext):
        u = self.g.j.setdefault("extensionsUsed", [])
        if ext not in u:
            u.append(ext)

    # ---------------------------------------------------------------- resources
    def texture(self, af, pptr):
        o = obj_of(af, pptr)
        if o is None:
            return None
        key = (o.assets_file.name, o.path_id)
        if key not in self.texs:
            try:
                self.texs[key] = self.g.image(o.read().image)
            except Exception as e:
                print("  texture failed", e)
                self.texs[key] = None
        return self.texs[key]

    def material(self, af, pptr):
        o = obj_of(af, pptr)
        if o is None:
            return None
        key = (o.assets_file.name, o.path_id)
        if key in self.mats:
            return self.mats[key]
        m = o.read()
        tex, fl, col = props(m)
        c = col.get("_Color") or col.get("_BaseColor") or col.get("_TintColor")
        mat = {"name": m.m_Name, "pbrMetallicRoughness": {"metallicFactor": 0.0,
                                                          "roughnessFactor": float(max(0.35, 1 - fl.get("_Glossiness", 0.2)))}}
        if c is not None:
            mat["pbrMetallicRoughness"]["baseColorFactor"] = [c.r, c.g, c.b, c.a]
        alpha = False
        # the main texture: Standard / mobile _MainTex, Shader Forge _Diffuse, else the first texture set
        te = next((tex[k] for k in ("_MainTex", "_BaseMap", "_Diffuse", "_Albedo", "_Texture") if k in tex and tex[k].m_Texture.m_PathID), None)
        if te is None:
            te = next((v for k, v in tex.items() if v.m_Texture.m_PathID and "Normal" not in k and "Bump" not in k), None)
        if te is not None and te.m_Texture.m_PathID:
            t = self.texture(o.assets_file, te.m_Texture)
            if t:
                ti, alpha = t
                info = {"index": ti}
                sx, sy, ox, oy = te.m_Scale.x, te.m_Scale.y, te.m_Offset.x, te.m_Offset.y
                if (sx, sy, ox, oy) != (1, 1, 0, 0):
                    info["extensions"] = {"KHR_texture_transform": {"scale": [sx, sy], "offset": [ox, 1 - oy - sy]}}
                    self.used("KHR_texture_transform")
                mat["pbrMetallicRoughness"]["baseColorTexture"] = info
        shader = shader_name(o.assets_file, m)
        mat["extras"] = {"shader": shader, "queue": int(m.m_CustomRenderQueue)}
        mode = fl.get("_Mode")
        # the scenes use mobile / Shader Forge shaders: their names tell unlit, cutout and blended ones
        if shader.startswith("Mobile/Unlit"):
            mat["extensions"] = {"KHR_materials_unlit": {}}
            self.used("KHR_materials_unlit")
        if "Blended" in shader or "Multiply" in shader or "AlphaWShadow" in shader or "VerteValueAlpha" in shader \
                or (mode is not None and mode >= 2 and shader.startswith("Standard")):
            mat["alphaMode"] = "BLEND"
        elif "Alpha" in shader or "EdgeGrass" in shader or "Cutout" in shader or (mode is not None and mode >= 1 and shader.startswith("Standard")):
            mat["alphaMode"] = "MASK"
            mat["alphaCutoff"] = float(fl.get("_Cutoff", 0.5))
            mat["doubleSided"] = True
        self.g.j["materials"].append(mat)
        self.mats[key] = len(self.g.j["materials"]) - 1
        return self.mats[key]

    def mesh(self, af, pptr):
        o = obj_of(af, pptr)
        if o is None:
            return None
        key = (o.assets_file.name, o.path_id)
        if key in self.meshes:
            return self.meshes[key]
        m = o.read()
        h = MeshHandler(m)
        h.process()
        if not h.m_Vertices:
            self.meshes[key] = None
            return None
        V = np.array([v[:3] for v in h.m_Vertices], np.float32)
        V[:, 0] *= -1
        attrs = {"POSITION": self.g.accessor(V, "VEC3", minmax=True)}
        if h.m_Normals and len(h.m_Normals) == len(V):
            N = np.array([n[:3] for n in h.m_Normals], np.float32)
            N[:, 0] *= -1
            attrs["NORMAL"] = self.g.accessor(N, "VEC3")
        if h.m_UV0 and len(h.m_UV0) == len(V):
            U = np.array([u[:2] for u in h.m_UV0], np.float32)
            U[:, 1] = 1 - U[:, 1]
            attrs["TEXCOORD_0"] = self.g.accessor(U, "VEC2")
        if h.m_Colors and len(h.m_Colors) == len(V):
            C = np.array([c[:4] for c in h.m_Colors], np.float32)
            if C.max() > 1.001:
                C /= 255.0
            if C.min() < 0.999:
                attrs["COLOR_0"] = self.g.accessor(C, "VEC4")
        subs = []
        for tri in h.get_triangles():
            if not tri:
                subs.append(None)
                continue
            # winding reversed with the mirrored x (front faces then agree with the mesh normals)
            idx = np.array(tri, np.uint32)[:, [0, 2, 1]].reshape(-1)
            subs.append(self.g.accessor(idx, "SCALAR", target=34963))
        self.meshes[key] = (m.m_Name, attrs, subs)
        return self.meshes[key]

    def renderer_mesh(self, af, mf, mr):
        md = self.mesh(af, mf.m_Mesh)
        if md is None:
            return None, False
        name, attrs, subs = md
        sb = mr.m_StaticBatchInfo
        batched = sb.subMeshCount > 0
        first, count = (sb.firstSubMesh, sb.subMeshCount) if batched else (0, len(subs))
        mats = [self.material(af, p) for p in mr.m_Materials]
        key = (id(md), first, count, tuple(mats))
        if key in self.prims:
            return self.prims[key], batched
        prims = []
        for i in range(count):
            si = first + i
            if si >= len(subs) or subs[si] is None:
                continue
            p = {"attributes": attrs, "indices": subs[si]}
            mi = mats[min(i, len(mats) - 1)] if mats else None
            if mi is not None:
                p["material"] = mi
            prims.append(p)
        if not prims:
            return None, batched
        self.g.j["meshes"].append({"name": name, "primitives": prims})
        self.prims[key] = len(self.g.j["meshes"]) - 1
        return self.prims[key], batched

    # ---------------------------------------------------------------- hierarchy
    def go(self, go_obj, parent=None, world=np.eye(4), extra=None):
        af = go_obj.assets_file
        go = go_obj.read()
        comps = [deref(af, c.component.m_FileID, c.component.m_PathID) for c in go.m_Component]
        comps = [c for c in comps if c is not None]
        tro = next((c for c in comps if c.type.name in ("Transform", "RectTransform")), None)
        tr = tro.read()
        t = trs(tr)
        n = {"name": go.m_Name, **t}
        ex = dict(extra or {})
        if not go.m_IsActive:
            ex["active"] = False
        mbs, mf, mr = [], None, None
        for c in comps:
            tn = c.type.name
            if tn == "MonoBehaviour":
                si = script_info(c)
                if si:
                    cls = si[1].split(".")[-1]
                    mbs.append(cls)
                    if cls == "BBEdgeCorner":
                        # BBEdgeCorner: the straight river pieces towards the neighbour corners
                        _, d = read_mb(c)
                        for k in ("EdgeNorth", "EdgeEast", "EdgeSouth", "EdgeWest"):
                            pp = d.get(k) or {}
                            go2 = deref(af, pp.get("m_FileID", 0), pp.get("m_PathID", 0)) if pp.get("m_PathID") else None
                            ex[k] = go2.read().m_Name if go2 is not None else None
            elif tn == "MeshFilter":
                mf = c.read()
            elif tn == "MeshRenderer":
                mr = c.read()
            elif tn == "ParticleSystem":
                ex["particles"] = True
            elif tn == "Light":
                L = c.read()
                ex["light"] = {"type": int(L.m_Type), "color": [L.m_Color.r, L.m_Color.g, L.m_Color.b],
                               "intensity": float(L.m_Intensity), "range": float(L.m_Range),
                               "spot": float(getattr(L, "m_SpotAngle", 30.0)), "shadows": int(L.m_Shadows.m_Type)}
        if mbs:
            ex["mb"] = mbs
        if ex:
            n["extras"] = ex
        w = world @ trs_matrix(t)
        idx = self.g.node(n, parent)
        if mf is not None and mr is not None and mr.m_Enabled:
            mi, batched = self.renderer_mesh(af, mf, mr)
            if mi is not None:
                if batched:
                    inv = np.linalg.inv(w)
                    self.g.node({"name": go.m_Name + ":batched", "mesh": mi, "matrix": [float(x) for x in inv.flatten(order="F")]}, idx)
                else:
                    self.g.j["nodes"][idx]["mesh"] = mi
        for ch in tr.m_Children:
            cto = deref(af, ch.m_FileID, ch.m_PathID)
            if cto is None:
                continue
            gpp = cto.read().m_GameObject
            self.go(deref(af, gpp.m_FileID, gpp.m_PathID), idx, w)
        return idx

    def save(self, path):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        self.g.save(path)
        print(f"  {os.path.relpath(path, PACK)}: {len(self.g.j['nodes'])} nodes, {len(self.g.j.get('meshes', []))} meshes, "
              f"{len(self.g.j.get('images', []))} images, {len(self.g.bin) // 1024} KB")


def roots(af):
    for o in af.objects.values():
        if o.type.name == "Transform":
            t = o.read()
            if not t.m_Father.m_PathID:
                yield deref(af, t.m_GameObject.m_FileID, t.m_GameObject.m_PathID)


def find_mb(af, cls):
    for o in af.objects.values():
        if o.type.name == "MonoBehaviour":
            si = script_info(o)
            if si and si[1].endswith(cls):
                return o
    return None


def pool_prefab(af, pptr):
    po = obj_of(af, pptr)
    if po is None:
        return None
    _, d = read_mb(po)
    p = d.get("Prefab") or {}
    return deref(po.assets_file, p.get("m_FileID", 0), p.get("m_PathID", 0)) if p.get("m_PathID") else None


def export_scenes():
    for lv in ("level5", "level6", "level7"):
        af = FILES[lv]
        rs = [r for r in roots(af) if r.read().m_Name == "ArtAssets"]
        if not rs:
            continue
        names = {o.read().m_Name for o in af.objects.values() if o.type.name == "GameObject"}
        skin = next((s for k, s in SKINS.items() if k in names), lv)
        ex = Exporter()
        ex.go(rs[0])
        # BBManager: river prefab pools
        bm = find_mb(af, "BBManager")
        if bm is not None:
            _, d = read_mb(bm)
            # board materials (BBManager.SetBoardSkin puts one on every board square): a hidden quad each
            mats = ex.g.node({"name": "BoardMaterials", "extras": {"active": False}})
            quad = None
            for k, nm in (("MatGrass", "grass"), ("MatQuarry", "quarry"), ("MatTown", "town")):
                pp = d.get(k) or {}
                if not pp.get("m_PathID"):
                    continue
                from types import SimpleNamespace as NS
                mi = ex.material(af, NS(m_FileID=pp["m_FileID"], m_PathID=pp["m_PathID"]))
                if quad is None:
                    quad = {"POSITION": ex.g.accessor(np.array([[0, 0, 0], [1, 0, 0], [0, 0, 1]], np.float32), "VEC3", minmax=True)}
                ex.g.j["meshes"].append({"name": nm, "primitives": [{"attributes": quad, "material": mi}]})
                ex.g.node({"name": nm, "mesh": len(ex.g.j["meshes"]) - 1}, mats)
            holder = ex.g.node({"name": "RiverPrefabs", "extras": {"active": False}})
            for k, nm in (("PoolRiverCornerPrefabs", "corner"), ("PoolRiverNubPrefabs", "nub"), ("PoolRiverTPrefabs", "t")):
                pp = d.get(k) or {}
                if not pp.get("m_PathID"):
                    continue
                from types import SimpleNamespace as NS
                pf = pool_prefab(af, NS(m_FileID=pp["m_FileID"], m_PathID=pp["m_PathID"]))
                if pf is not None:
                    i = ex.go(pf, holder)
                    ex.g.j["nodes"][i]["name"] = nm
        ex.save(os.path.join(OUT, f"{skin}.glb"))


def export_pieces():
    from prefab import CONT, RA
    from types import SimpleNamespace as NS
    for nm in PIECES:
        key = f"prefabs/terrain/poolfull3dmesh_{nm.lower()}"
        if key not in CONT:
            print("  missing", key)
            continue
        root = RA.objects[CONT[key]["m_PathID"]]
        pr = None
        for c in root.read().m_Component:
            o = deref(RA, c.component.m_FileID, c.component.m_PathID)
            if o is not None and o.type.name == "MonoBehaviour":
                _, d = read_mb(o)
                p = d.get("Prefab") or {}
                if p.get("m_PathID"):
                    pr = deref(RA, p["m_FileID"], p["m_PathID"])
        if pr is None:
            print("  no prefab", nm)
            continue
        ex = Exporter()
        ex.go(pr)
        ex.save(os.path.join(OUT, "pieces", f"{nm}.glb"))


def export_background():
    from prefab import CONT
    key = "textures_runtime/backgrounds/background_battleboard"
    if key not in CONT:
        print("  no background")
        return
    o = deref(FILES["resources.assets"], CONT[key]["m_FileID"], CONT[key]["m_PathID"])
    img = o.read().image
    img.thumbnail((2048, 2048))
    img.convert("RGB").save(os.path.join(OUT, "background.jpg"), "JPEG", quality=88)
    print("  background", img.size)


def main():
    print("battleboard scenes")
    export_background()
    export_scenes()
    print("terrain pieces")
    export_pieces()


if __name__ == "__main__":
    main()
