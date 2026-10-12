# Run many seeds of one adventure; compare with a reference LogA; report coverage and problems
import sys, re, collections, json
sys.path.insert(0, __file__.rsplit("/", 1)[0])
from engine import Game, load_adventure
adv = int(sys.argv[1]); n = int(sys.argv[2]); ref = sys.argv[3] if len(sys.argv) > 3 else None
outcomes = collections.Counter(); rounds = []; keys = collections.Counter(); cover = collections.Counter()
unimpl = collections.Counter(); warns = collections.Counter(); nexts = collections.Counter(); errors = collections.Counter()
for seed in range(n):
    try:
        g = Game(adv, seed=seed).run()
    except Exception as e:
        errors[f"{type(e).__name__}: {e}"] += 1; continue
    outcomes[(getattr(g, "result", None), g.ended)] += 1
    rounds.append(g.round)
    for k in {x[2] for x in g.log}: keys[k] += 1
    for c, v in g.coverage.items():
        if c[0] == "adv": cover[c] += v
    unimpl.update(g.unimpl); warns.update(g.warnings); nexts[g.campaign["next_adventure"]] += 1
A = load_adventure(adv)
states = [("adv", f["name"], s["name"], A["gameObjects"][str(f["go"])]["name"]) for f in A["fsms"] for s in f["states"]]
hit = [s for s in states if cover[(s[0], s[1], s[2])] > 0]
print(f"runs={n} errors={sum(errors.values())} outcomes={dict(outcomes)} next={dict(nexts)}")
print(f"rounds: min={min(rounds)} avg={sum(rounds)/len(rounds):.1f} max={max(rounds)}")
print(f"adventure FSM state coverage: {len(hit)}/{len(states)}")
print("never reached:", [f"{s[3]}:{s[2]}" for s in states if s not in hit])
print("unimplemented actions:", dict(unimpl))
print("top warnings:", dict(warns.most_common(8)))
print("errors:", dict(errors.most_common(5)))
if ref:
    rk = [m.group(3) for m in re.finditer(r"^\[(\d+)\|(\d+)\|([^|\]]+)", open(ref, encoding="utf-8").read(), re.M) if m.group(1) == "1"]
    rset = set(rk)
    missing = sorted(k for k in rset if k not in keys)
    print(f"reference keys: {len(rset)} distinct; reproduced by engine in some run: {len(rset)-len(missing)}")
    print("reference keys never produced:", missing)
