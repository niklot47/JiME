# Export the campaign map room and the rest locations (local only, FFG content) to <JIME_WORK>/packs/core-ffg/maproom/:
#   maproom.glb   the MapRoom scene (level9): the Middle-earth map, location markers (CampaignMapLocation), the paths
#                 between them (CampaignMapPath: a row of footprints that grow in one by one), the campfire, the camera rig
#   rest.glb      the RestLocations scene (level8): the camp scenes shown at the rest (RestAreaVisuals: forest / dungeon)
#   maproom.json  { "locations": [{ node, ids: [AdventureModel ids], pos: [x, y, z] }], "paths": [{ node, from, to }],
#                   "campfire": node, "camera": node }   (node = GameObject path id, also in the glb node extras "goid")
# Node extras as export_battleboard (active, mb, light, particles) plus goid.
import os, json
import numpy as np
from jload import *
from glb import trs, trs_matrix
from export_battleboard import Exporter, roots, find_mb

PACK = os.path.join(ROOT, "packs", "core-ffg")
OUT = os.path.join(PACK, "maproom")
INFO = {}


def export_lightmaps(af, prefix):
    """the scene's baked lightmaps (LightmapSettings) as images: RGBM decoded (gamma space, 5 * a * rgb) and halved,
    so 0..2 fits a PNG -> [pack paths] (the app multiplies by 2 in gamma space)"""
    from PIL import Image
    ls = next((o for o in af.objects.values() if o.type.name == "LightmapSettings"), None)
    if ls is None:
        return []
    out = []
    for i, e in enumerate(ls.read_typetree().get("m_Lightmaps", [])):
        pp = e.get("lightmap") or e.get("m_Lightmap") or {}
        o = deref(af, pp.get("m_FileID", 0), pp.get("m_PathID", 0)) if pp.get("m_PathID") else None
        if o is None:
            out.append(None)
            continue
        a = np.asarray(o.read().image.convert("RGBA"), np.float32) / 255.0
        L = a[..., :3] * a[..., 3:4] * 5.0
        img = Image.fromarray((np.clip(L / 2.0, 0, 1) * 255 + 0.5).astype(np.uint8), "RGB")
        fn = f"{prefix}-lightmap-{i}.png"
        img.save(os.path.join(OUT, fn))
        out.append(f"maproom/{fn}")
    return out


class SceneExporter(Exporter):
    """Exporter that tags every node with its GameObject path id and the map scripts' data"""
    def go(self, go_obj, parent=None, world=np.eye(4), extra=None):
        ex = dict(extra or {})
        ex["goid"] = go_obj.path_id
        ex.update(INFO.get(go_obj.path_id, {}))
        return super().go(go_obj, parent, world, ex)


def go_of(af, pptr):
    """GameObject path id of a component / GameObject reference"""
    if not pptr or not pptr.get("m_PathID"):
        return None
    o = deref(af, pptr.get("m_FileID", 0), pptr["m_PathID"])
    if o is None:
        return None
    if o.type.name == "GameObject":
        return o.path_id
    d = o.read_typetree()
    return d.get("m_GameObject", {}).get("m_PathID")


def world_pos(af, gid):
    """world position of a GameObject (its Transform chain)"""
    go = af.objects[gid].read()
    tro = next(deref(af, c.component.m_FileID, c.component.m_PathID) for c in go.m_Component
               if deref(af, c.component.m_FileID, c.component.m_PathID).type.name == "Transform")
    m = np.eye(4)
    tr = tro.read()
    chain = []
    while True:
        chain.append(trs_matrix(trs(tr)))
        if not tr.m_Father.m_PathID:
            break
        tr = deref(af, tr.m_Father.m_FileID, tr.m_Father.m_PathID).read()
    for c in reversed(chain):
        m = m @ c
    return [round(float(v), 4) for v in m[:3, 3]]


def export_maproom():
    af = FILES["level9"]
    data = {"locations": [], "paths": []}
    for o in af.objects.values():
        if o.type.name != "MonoBehaviour":
            continue
        si = script_info(o)
        cls = si[1].split(".")[-1] if si else ""
        if cls == "CampaignMapLocation":
            _, d = read_mb(o)
            gid = d["m_GameObject"]["m_PathID"]
            ids = [int(x) for x in d.get("AdventureIds") or []]
            INFO.setdefault(gid, {})["location"] = ids
            data["locations"].append({"node": gid, "name": af.objects[gid].read().m_Name, "ids": ids, "pos": world_pos(af, gid)})
        elif cls == "CampaignMapPath":
            _, d = read_mb(o)
            gid = d["m_GameObject"]["m_PathID"]
            a, b = go_of(af, d.get("StartMapLocation")), go_of(af, d.get("EndMapLocation"))
            INFO.setdefault(gid, {})["path"] = [a, b]
            data["paths"].append({"node": gid, "from": a, "to": b})
    mv = find_mb(af, "MapRoomVisuals")
    if mv is not None:
        _, d = read_mb(mv)
        data["campfire"] = go_of(af, d.get("MapCampfire"))
        data["camera"] = go_of(af, d.get("MapCameraParent"))
        data["map"] = go_of(af, d.get("MapParent"))
    os.makedirs(OUT, exist_ok=True)
    data["lightmaps"] = export_lightmaps(af, "maproom")
    ex = SceneExporter(lightmaps=len(data["lightmaps"]))
    for r in roots(af):
        ex.go(r)
    ex.save(os.path.join(OUT, "maproom.glb"))
    with open(os.path.join(OUT, "maproom.json"), "w", encoding="utf-8") as fp:
        json.dump(data, fp, indent=1)
    print(f"  map: {len(data['locations'])} locations, {len(data['paths'])} paths")


def export_rest():
    INFO.clear()  # (path ids are per scene file)
    af = FILES["level8"]
    rv = find_mb(af, "RestAreaVisuals")
    info = {}
    if rv is not None:
        _, d = read_mb(rv)
        info = {k: go_of(af, d.get(k)) for k in ("RestLocationsParent", "VisualsForest", "VisualsDungeon")}
    ex = SceneExporter()
    for r in roots(af):
        ex.go(r)
    ex.save(os.path.join(OUT, "rest.glb"))
    with open(os.path.join(OUT, "rest.json"), "w", encoding="utf-8") as fp:
        json.dump(info, fp, indent=1)


def main():
    print("map room")
    export_maproom()
    print("rest locations")
    export_rest()


if __name__ == "__main__":
    main()
