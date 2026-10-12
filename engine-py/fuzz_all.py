# Run every adventure with several seeds; summarize robustness and coverage
import sys, collections, json, os, glob, traceback
sys.path.insert(0, __file__.rsplit("/", 1)[0])
from engine import Game, load_adventure, db
n = int(sys.argv[1]) if len(sys.argv) > 1 else 10
D = db()
rows = []; unimpl = collections.Counter(); warns = collections.Counter(); errs = collections.Counter()
for aid, am in sorted(D["models"]["AdventureModel"].items(), key=lambda x: int(x[0])):
    if not (am.get("Prefab") or {}).get("Path"): continue
    A = load_adventure(aid)
    states = {(f["name"], s["name"], f["go"]) for f in A["fsms"] for s in f["states"]}
    hit = set(); out = collections.Counter(); rounds = []; err = 0
    for seed in range(n):
        try:
            g = Game(int(aid), seed=seed).run()
            out[getattr(g, "result", None) or g.ended] += 1; rounds.append(g.round)
            unimpl.update(g.unimpl); warns.update({w.split(" ")[0] + " " + " ".join(w.split(" ")[1:3]): c for w, c in g.warnings.items()})
            for f in g.all_fsms:
                if f.owner.src == "adv":
                    for (src, fn, sn), c in g.coverage.items():
                        pass
            for (src, fn, sn), c in g.coverage.items():
                if src == "adv": hit.add((fn, sn))
        except Exception as e:
            err += 1; errs[f"{type(e).__name__}: {str(e)[:80]}"] += 1
    cov = len({(a, b) for a, b, c in states} & hit) / max(1, len({(a, b) for a, b, c in states}))
    rows.append((int(aid), am.get("m_Name"), am.get("Type") or 0, dict(out), err, sum(rounds) / max(1, len(rounds)), cov))
print(f"{'id':>4} {'type':>4} {'cov':>5} {'avgR':>5} err  outcomes  name")
for r in rows:
    print(f"{r[0]:>4} {r[2]:>4} {r[6]*100:>4.0f}% {r[5]:>5.1f} {r[4]:>3}  {r[3]}  {r[1]}")
print("\nunimplemented:", dict(unimpl.most_common()))
print("errors:", dict(errs.most_common(10)))
print("warnings:", dict(warns.most_common(15)))
json.dump(rows, open(os.path.join(os.environ.get("JIME_WORK", os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")), "out", "fuzz_all.json"), "w"))
