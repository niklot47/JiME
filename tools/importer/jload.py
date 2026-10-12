# Shared loader: UnityPy env + typetree generator for MonoBehaviours without embedded typetrees
import UnityPy, struct, os
from UnityPy.helpers.TypeTreeGenerator import TypeTreeGenerator
UnityPy.config.FALLBACK_UNITY_VERSION = "2022.3.62f2"
# Paths: JIME_WORK = working/output folder, JIME_DATA = game's JiME_Data folder (or a copy), JIME_MANAGED = its Managed folder
ROOT = os.environ.get("JIME_WORK", os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "data"))
DATA = os.environ.get("JIME_DATA", os.path.join(ROOT, "data"))
MANAGED = os.environ.get("JIME_MANAGED") or (os.path.join(DATA, "Managed") if os.path.isdir(os.path.join(DATA, "Managed")) else os.path.join(ROOT, "managed"))
env = UnityPy.load(*[os.path.join(DATA, f) for f in os.listdir(DATA) if not os.path.isdir(os.path.join(DATA, f))], *([os.path.join(DATA, "StreamingAssets", "bundles")] if os.path.isdir(os.path.join(DATA, "StreamingAssets", "bundles")) else []))
gen = TypeTreeGenerator("2022.3.62f2")
gen.load_local_dll_folder(MANAGED)
FILES = {k.split("/")[-1].lower(): f for k, f in env.files.items() if hasattr(f, "objects")}
_node_cache, _script_cache = {}, {}

def file_of(af, fid):
    if fid == 0: return af
    nm = af.externals[fid - 1].path.split("/")[-1].lower()
    return FILES.get(nm)

def deref(af, fid, pid):
    f = file_of(af, fid)
    if f is None or pid not in f.objects: return None
    return f.objects[pid]

def script_info(obj):
    raw = obj.get_raw_data()
    off = 12 + 4
    fid, pid = struct.unpack_from("<iq", raw, off)
    key = (obj.assets_file.name, fid, pid)
    if key not in _script_cache:
        so = deref(obj.assets_file, fid, pid)
        if so is None: _script_cache[key] = None
        else:
            ms = so.read()
            full = f"{ms.m_Namespace}.{ms.m_ClassName}" if ms.m_Namespace else ms.m_ClassName
            _script_cache[key] = (ms.m_AssemblyName, full)
    return _script_cache[key]

def read_mb(obj):
    si = script_info(obj)
    if si is None: return None, None
    asm, full = si
    if si not in _node_cache:
        try: _node_cache[si] = gen.get_nodes_up(asm, full)
        except Exception: _node_cache[si] = None
    nodes = _node_cache[si]
    if nodes is None: return full, None
    from ttread import build, R
    key = ("tt",) + si
    if key not in _node_cache: _node_cache[key] = build(gen.get_nodes(asm if asm.endswith(".dll") else asm + ".dll", full))
    try: return full, R(obj.get_raw_data()).read(_node_cache[key])
    except Exception as e: return full, {"__error__": str(e)}

def mbs_of(cls_name, file_filter=None):
    for f in FILES.values():
        if file_filter and file_filter not in f.name: continue
        for o in f.objects.values():
            if o.type.name != "MonoBehaviour": continue
            si = script_info(o)
            if si and si[1] == cls_name: yield o
