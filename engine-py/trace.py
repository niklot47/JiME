# Emit comparable JSON traces (one per line) for parity tests with the TS engine.
# Usage: python3 engine-py/trace.py <adv>[,<adv>...|all] <seed_from> <seed_to>
import sys, json
sys.path.insert(0, __file__.rsplit("/", 1)[0].rsplit("\\", 1)[0])
from engine import Game, db

def advs(spec):
    if spec == "all":
        return sorted(int(k) for k, m in db()["models"]["AdventureModel"].items() if (m.get("Prefab") or {}).get("Path"))
    return [int(x) for x in spec.split(",")]

spec, a, b = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
for adv in advs(spec):
    for seed in range(a, b):
        try:
            g = Game(adv, seed=seed).run()
            c = g.campaign
            out = {"adv": adv, "seed": seed, "log": g.log, "ended": g.ended, "result": getattr(g, "result", None),
                   "round": g.round, "threat": g.globals["Threat"], "threat_max": g.threat_max,
                   "warnings": dict(g.warnings), "unimpl": dict(g.unimpl),
                   "coverage": {"\x1f".join(map(str, k)): v for k, v in g.coverage.items()},
                   "campaign": {k: c.get(k) for k in ("next_adventure", "lore", "xp", "items", "titles", "result")},
                   "group": getattr(g, "encounter_group", None)}
        except Exception as e:
            out = {"adv": adv, "seed": seed, "error": f"{type(e).__name__}: {e}"}
        print(json.dumps(out, ensure_ascii=False))
