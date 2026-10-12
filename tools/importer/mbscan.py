# Scan MonoBehaviours: parse header manually from raw data and resolve script class names
import UnityPy, collections, struct, sys, pickle
UnityPy.config.FALLBACK_UNITY_VERSION = "2022.3.62f2"
env = UnityPy.load(sys.argv[1])
def rd_header(raw):
    off = 0
    go_file, go_pid = struct.unpack_from("<iq", raw, off); off += 12
    enabled = raw[off]; off += 4
    sc_file, sc_pid = struct.unpack_from("<iq", raw, off); off += 12
    n = struct.unpack_from("<i", raw, off)[0]; off += 4
    name = raw[off:off+n].decode("utf-8", "replace"); off += n
    off = (off + 3) & ~3
    return (go_file, go_pid), (sc_file, sc_pid), name, off
script_cache = {}
def script_name(af, sc):
    fid, pid = sc
    key = (af.name, fid, pid)
    if key in script_cache: return script_cache[key]
    try:
        target = af if fid == 0 else af.externals[fid-1]
        if fid != 0:
            nm = target.path.split("/")[-1]
            tf = next(f for k,f in env.files.items() if k.split("/")[-1].lower()==nm.lower())
        else: tf = af
        ms = tf.objects[pid].read()
        r = f"{ms.m_Namespace}.{ms.m_ClassName}" if ms.m_Namespace else ms.m_ClassName
    except Exception as e:
        r = f"?{fid}:{pid}"
    script_cache[key] = r
    return r
rows = []
for o in env.objects:
    if o.type.name != "MonoBehaviour": continue
    raw = o.get_raw_data()
    try:
        go, sc, name, off = rd_header(raw)
    except Exception: continue
    rows.append((o.assets_file.name, o.path_id, go, script_name(o.assets_file, sc), name, len(raw), off))
pickle.dump(rows, open(sys.argv[2], "wb"))
c = collections.Counter((r[0].split('/')[-1], r[3]) for r in rows)
for k, v in c.most_common(70): print(v, k)
