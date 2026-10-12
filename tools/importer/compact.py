# Compact decoded FSM params: drop defaults, render localization packets as keys
import json, os
_LOCP = os.path.join(os.environ.get("JIME_WORK", os.path.expanduser("~/jime")), "out", "loc.json")
LOC = json.load(open(_LOCP, encoding="utf-8")) if os.path.exists(_LOCP) else {}
LOCK = {}
for k, v in LOC.items():
    LOCK.setdefault(k.split("|", 1)[1], v)
def loc(key, lang="ru"):
    v = LOCK.get(key); return (v or {}).get(lang) or (v or {}).get("en")
def is_empty(v):
    return v in (None, "", 0, False, [], {}, 0.0)
def compact(v):
    if isinstance(v, dict):
        t = v.get("_type", "")
        if t.endswith("IA_LocalizationPacket") or t == "LocalizationPacket":
            out = {}
            if v.get("Key"): out["key"] = v["Key"]
            ins = [compact(i) for i in v.get("Inserts", [])]
            # keep inserts up to the last one carrying content (IsUsed is an editor-only flag)
            def has(c): return any(k not in ("filter", "MultiplyByPlayerCount") and not is_empty(x) for k, x in c.items())
            while ins and not has(ins[-1]): ins.pop()
            if ins: out["inserts"] = ins
            if v.get("RawText"): out["raw"] = v["RawText"]
            opts = [o["Key"] for o in v.get("LocalizationOptions", []) if o.get("Key")]
            if opts: out["options"] = opts
            if list(out) == ["key"]: return "«" + out["key"] + "»"
            return out or None
        if t.endswith("PacketInsert"):
            o = {k: compact(x) for k, x in v.items() if k not in ("_type", "IsUsed", "ShowColor", "Filter") and not is_empty(compact(x))}
            o["filter"] = v.get("Filter"); return o
        if set(v) >= {"useVariable", "name", "value"}:
            return "@" + v["name"] if v["useVariable"] and v["name"] else compact(v["value"])
        o = {k: compact(x) for k, x in v.items() if k != "_type"}
        return {k: x for k, x in o.items() if not is_empty(x)}
    if isinstance(v, list):
        l = [compact(x) for x in v]
        if all(not isinstance(x, (dict, list)) for x in v): return l
        return l if any(not is_empty(x) for x in l) else []
    return v
def fmt_action(a):
    p = compact(a["params"])
    return a["action"] + " " + json.dumps(p, ensure_ascii=False, default=str) if p else a["action"]
