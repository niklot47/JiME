# Export all JiME scenario data (adventures, encounters, tiles, enemies, globals) to neutral JSON
import json, os, re, sys, pickle, struct
from jload import *
from prefab import CONT, RA, walk, comp_name
from fsmdump import fsm_to_dict, simplify
from compact import compact

OUT = os.path.join(ROOT, "export")
os.makedirs(OUT, exist_ok=True)
SA0 = FILES["sharedassets0.assets"]
PTR = re.compile(r"^ptr\((-?\d+):(-?\d+)\)$")

# ---------- model index (sharedassets0 ScriptableObjects) ----------
MODEL_TYPES = {"AdventureModel", "EncounterModel", "EncounterGroupModel", "TileModel", "EnemyModel",
               "EnemyActivationModel", "EnemyBonusModel", "ItemModel", "SkillModel", "TitleModel",
               "CampaignModel", "ProductModel", "TerrainNodeModel", "LastStandModel", "RoleModel", "HeroModel"}
models = {}      # pid -> (type, data)
for o in SA0.objects.values():
    if o.type.name != "MonoBehaviour": continue
    si = script_info(o)
    if not si: continue
    t = si[1].split(".")[-1]
    if t in MODEL_TYPES:
        _, d = read_mb(o)
        models[o.path_id] = (t, d)

def model_ref(pid):
    m = models.get(pid)
    if not m: return {"ref": "sa0", "pid": pid}
    t, d = m
    r = {"ref": t, "name": d.get("m_Name")}
    if "_id" in d: r["id"] = d["_id"]
    return r

def strip(d):
    return {k: v for k, v in d.items() if k not in ("m_GameObject", "m_Enabled", "m_Script")}

# ---------- pointer resolution ----------
def owner_go(f, pid):
    o = f.objects.get(pid)
    if o is None: return None
    if o.type.name == "GameObject": return pid
    try:
        raw = o.get_raw_data()
        return struct.unpack_from("<q", raw, 4)[0]
    except Exception: return None

def resolve(v, f):
    """Replace ptr(...) strings and raw PPtr dicts with semantic refs."""
    if isinstance(v, str):
        m = PTR.match(v)
        if not m: return v
        fid, pid = int(m.group(1)), int(m.group(2))
        return resolve({"m_FileID": fid, "m_PathID": pid}, f)
    if isinstance(v, dict):
        if set(v) == {"m_FileID", "m_PathID"} or (set(v) <= {"m_FileID", "m_PathID"} and "m_PathID" in v):
            fid, pid = v.get("m_FileID", 0), v["m_PathID"]
            if pid == 0: return None
            tf = file_of(f, fid)
            if tf is None: return {"ref": "ext", "fid": fid, "pid": pid}
            if tf.name.endswith("sharedassets0.assets"): return model_ref(pid)
            if tf is f:
                o = f.objects.get(pid)
                kind = o.type.name if o else "?"
                if kind == "MonoBehaviour": kind = (script_info(o) or ("", "?"))[1].split(".")[-1]
                return {"ref": "go", "go": owner_go(f, pid), "kind": kind}
            return {"ref": "obj", "file": tf.name, "pid": pid}
        return {k: resolve(x, f) for k, x in v.items()}
    if isinstance(v, list): return [resolve(x, f) for x in v]
    return v

def compact_resolved(v, f):
    return resolve(compact(v), f)

# ---------- prefab export ----------
def export_prefab(path):
    tree = walk(RA.objects[CONT[path.lower()]["m_PathID"]])
    gos, fsms = {}, []
    parents = {}
    stack = []
    for depth, name, pid, comps in tree:
        while stack and stack[-1][0] >= depth: stack.pop()
        parent = stack[-1][1] if stack else None
        stack.append((depth, pid))
        entry = {"name": name, "parent": parent, "components": {}}
        go = RA.objects[pid].read()
        if not go.m_IsActive:
            entry["on"] = 0
        for c in comps:
            cn = comp_name(c)
            if cn == "Transform":
                # Unity local transform: position, rotation (quaternion x y z w), scale (identity parts omitted)
                t = c.read()
                p, q, sc = t.m_LocalPosition, t.m_LocalRotation, t.m_LocalScale
                tr = {}
                if (p.x, p.y, p.z) != (0, 0, 0): tr["p"] = [round(p.x, 5), round(p.y, 5), round(p.z, 5)]
                if (q.x, q.y, q.z, q.w) != (0, 0, 0, 1): tr["r"] = [round(q.x, 6), round(q.y, 6), round(q.z, 6), round(q.w, 6)]
                if (sc.x, sc.y, sc.z) != (1, 1, 1): tr["s"] = [round(sc.x, 5), round(sc.y, 5), round(sc.z, 5)]
                if tr: entry["tr"] = tr
                continue
            if cn in ("Transform", "MeshFilter", "MeshRenderer", "BoxCollider", "Animation", "MeshCollider",
                      "HexUVMapping", "Edge", "ParticleSystem", "ParticleSystemRenderer", "FsmSerializer",
                      "IYieldableComponent", "RectTransform", "CanvasRenderer"):
                continue
            if cn == "PlayMakerFSM":
                fd = fsm_to_dict(c)
                for s in fd["states"]:
                    for a in s["actions"]:
                        a["params"] = compact_resolved(a["params"], RA)
                fd["variables"] = resolve(fd["variables"], RA)
                fd["go"] = pid
                fsms.append(fd)
                entry["components"].setdefault("PlayMakerFSM", []).append(len(fsms) - 1)
                continue
            if c.type.name == "MonoBehaviour":
                _, d = read_mb(c)
                if d is None: continue
                if cn == "HexCoordinates": continue
                entry["components"][cn] = compact_resolved(strip(d), RA)
            else:
                entry["components"][cn] = True
        gos[pid] = entry
    return {"root": tree[0][2], "gameObjects": gos, "fsms": fsms}

def export_models():
    out = {}
    for pid, (t, d) in models.items():
        out.setdefault(t, {})[str(d.get("_id", pid))] = compact_resolved(strip(d), SA0)
    return out

def export_standard_tiles():
    l4 = FILES["level4"]
    res = {}
    for o in l4.objects.values():
        if o.type.name != "MonoBehaviour": continue
        si = script_info(o)
        if not si or si[1] != "FFG.JIME.Tile": continue
        _, t = read_mb(o)
        m = resolve(t["Model"], l4)
        spaces = []
        sp_ids = [s["m_PathID"] for s in t["Spaces"]]
        for spid in sp_ids:
            _, s = read_mb(l4.objects[spid])
            spaces.append({"traits": s["Traits"], "connected": [sp_ids.index(c["m_PathID"]) if c["m_PathID"] in sp_ids else -1 for c in s["ConnectedSpaces"]]})
        code = models[t["Model"]["m_PathID"]][1]["_id"] if t["Model"]["m_PathID"] in models else None
        res[code] = {"model": m, "spaces": spaces}
    return res

def export_globals():
    o = next(mbs_of("PlayMakerGlobals"))
    _, d = read_mb(o)
    g = {}
    for k, lst in d["variables"].items():
        if isinstance(lst, list) and lst and isinstance(lst[0], dict) and "name" in lst[0]:
            for v in lst:
                val = v.get("value")
                g[v["name"]] = {"type": k.replace("Variables", ""), "value": simplify(val) if isinstance(val, (dict, list)) else val}
    return g

if __name__ == "__main__":
    db = {"models": export_models()}
    db["standardTiles"] = export_standard_tiles()
    db["globals"] = export_globals()
    json.dump(db, open(os.path.join(OUT, "db.json"), "w", encoding="utf-8"), ensure_ascii=False, default=str)
    print("models:", {k: len(v) for k, v in db["models"].items()}, "tiles", len(db["standardTiles"]), "globals", len(db["globals"]))
    # adventures
    os.makedirs(os.path.join(OUT, "adventures"), exist_ok=True)
    n_ok = 0
    for aid, a in db["models"]["AdventureModel"].items():
        p = (a.get("Prefab") or {}).get("Path", "")
        if not p: continue
        key = p.replace("Assets/Resources/", "").replace(".prefab", "").lower()
        if key not in CONT: print("missing", key); continue
        pf = export_prefab(key)
        pf["model"] = a
        json.dump(pf, open(os.path.join(OUT, "adventures", f"{aid}.json"), "w", encoding="utf-8"), ensure_ascii=False, default=str)
        n_ok += 1
    print("adventures", n_ok)
    os.makedirs(os.path.join(OUT, "encounters"), exist_ok=True)
    n_ok = 0
    for eid, e in db["models"]["EncounterModel"].items():
        p = (e.get("Prefab") or {}).get("Path", "")
        if not p: continue
        key = p.replace("Assets/Resources/", "").replace(".prefab", "").lower()
        if key not in CONT: print("missing", key); continue
        pf = export_prefab(key)
        pf["model"] = e
        json.dump(pf, open(os.path.join(OUT, "encounters", f"{eid}.json"), "w", encoding="utf-8"), ensure_ascii=False, default=str)
        n_ok += 1
    print("encounters", n_ok)
