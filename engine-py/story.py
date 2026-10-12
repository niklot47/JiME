# Render an engine run as a readable story using localized texts
import sys, re, json, os
sys.path.insert(0, __file__.rsplit("/", 1)[0])
from engine import Game
LOC = json.load(open(os.path.join(os.environ.get("JIME_WORK", os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")), "out", "loc.json"), encoding="utf-8"))
L = {}
for k, v in LOC.items(): L.setdefault(k.split("|", 1)[1], v)
def tr(key, lang):
    v = L.get(key) or {}
    return v.get(lang) or v.get("en")
def render(key, ins, lang):
    t = tr(key, lang)
    if t is None: return f"<{key}>"
    vals = [tr(i, lang) or i for i in ins]
    for n, v in enumerate(vals):
        t = t.replace("{%d}" % n, v)
    t = re.sub(r"\[/?[a-z]+\]", "", t).replace("\\n", "\n")
    return t.strip()
adv, seed, lang = int(sys.argv[1]), int(sys.argv[2]), (sys.argv[3] if len(sys.argv) > 3 else "ru")
g = Game(adv, seed=seed).run()
cur = None
skip = {"UI_RALLY_PHASE_INSTRUCTIONS", "UI_CONFIRM", "UI_PHASE_HERO", "UI_RALLY_PHASE"}
print(f"# {tr(g.model.get('NameKey'), lang)} — seed {seed}, {g.players} героя, итог: {getattr(g, 'result', g.ended)}, раундов: {g.round}\n")
for a, r, k, ins in g.log:
    if r != cur:
        cur = r; print(f"\n## Раунд {r}\n")
    if k in skip: continue
    print(f"[{k}] " + render(k, ins, lang).replace("\n", " ") + "\n")
