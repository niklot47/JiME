# Dump every FSM inside an adventure prefab into a readable text file + JSON
import sys, json
from prefab import *
from fsmdump import fsm_to_dict
from compact import fmt_action, loc
def dump(path, out_base):
    tree = walk(prefab_root(path))
    result = []; lines = []
    for depth, name, pid, comps in tree:
        for c in comps:
            if comp_name(c) != "PlayMakerFSM": continue
            f = fsm_to_dict(c); f["gameObject"] = name; result.append(f)
            lines.append(f"\n######## [{name}] FSM '{f['name']}'  start='{f['start']}'")
            if f["variables"]: lines.append("vars: " + json.dumps(f["variables"], ensure_ascii=False, default=str))
            if f["global"]: lines.append("global: " + json.dumps(f["global"], ensure_ascii=False))
            for s in f["states"]:
                lines.append(f"== {s['name']}  -> {s['transitions']}")
                for a in s["actions"]:
                    lines.append("    " + ("" if a["enabled"] else "(off) ") + fmt_action(a))
    json.dump(result, open(out_base + ".json", "w"), ensure_ascii=False, indent=1, default=str)
    open(out_base + ".txt", "w").write("\n".join(lines))
    return result
if __name__ == "__main__":
    r = dump(sys.argv[1], sys.argv[2]); print(len(r), "fsms", sum(len(f["states"]) for f in r), "states")
