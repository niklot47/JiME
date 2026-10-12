# Walk a prefab hierarchy in resources.assets and list components
from jload import *
import pickle
def _container():
    """Resources path -> PPtr map from globalgamemanagers' ResourceManager (cached in JIME_WORK)."""
    p = os.path.join(ROOT, "res_container.pkl")
    if not os.path.exists(p):
        for o in FILES["globalgamemanagers"].objects.values():
            if o.type.name == "ResourceManager":
                os.makedirs(ROOT, exist_ok=True)
                pickle.dump(o.read_typetree()["m_Container"], open(p, "wb"))
    return dict((k, v) for k, v in pickle.load(open(p, "rb")))
CONT = _container()
RA = FILES["resources.assets"]
def prefab_root(path):
    return RA.objects[CONT[path.lower()]["m_PathID"]]
def walk(go_obj, depth=0, acc=None):
    acc = [] if acc is None else acc
    go = go_obj.read()
    comps = [RA.objects[c.component.path_id] for c in go.m_Component]
    acc.append((depth, go.m_Name, go_obj.path_id, comps))
    for co in comps:
        if co.type.name in ("Transform", "RectTransform"):
            for ch in co.read().m_Children:
                tr = RA.objects[ch.path_id].read()
                walk(RA.objects[tr.m_GameObject.path_id], depth + 1, acc)
    return acc
def comp_name(co):
    if co.type.name == "MonoBehaviour":
        si = script_info(co); return si[1].split(".")[-1] if si else "?"
    return co.type.name
