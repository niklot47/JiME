# Run one adventure with the bot and print a LogA-style log
import sys, json
sys.path.insert(0, __file__.rsplit("/", 1)[0])
from engine import Game
adv = int(sys.argv[1]) if len(sys.argv) > 1 else 1
seed = int(sys.argv[2]) if len(sys.argv) > 2 else 1
g = Game(adv, seed=seed).run()
for a, r, k, ins in g.log:
    print(f"[{a}|{r}|{k}" + "".join("|" + i for i in ins) + "]")
print("ENDED:", g.ended, getattr(g, "result", None), "round", g.round, "threat", g.globals["Threat"], "/", g.threat_max, file=sys.stderr)
print("next:", g.campaign["next_adventure"], "lore", g.campaign["lore"], "xp", g.campaign["xp"], file=sys.stderr)
print("unimpl:", dict(g.unimpl), file=sys.stderr)
print("warnings:", dict(g.warnings.most_common(12)), file=sys.stderr)
print("group:", getattr(g, "encounter_group", None), "tiles:", [(s["id"], [t.code for t in s["tiles"]]) for s in g.sections], file=sys.stderr)
