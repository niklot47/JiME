# Extract localization CSV text assets from bundles and merge into key -> {lang: text}
import UnityPy, csv, io, json, sys, os, collections
src, out = sys.argv[1], sys.argv[2]
man = json.load(open(os.path.join(src, "manifest.dat"), encoding="utf-8-sig")) if os.path.exists(os.path.join(src,"manifest.dat")) else None
table = collections.defaultdict(dict)   # (sheet, key) -> {lang: text}
for fn in os.listdir(src):
    if len(fn) != 32: continue
    env = UnityPy.load(os.path.join(src, fn))
    for o in env.objects:
        if o.type.name != "TextAsset": continue
        t = o.read()
        s = t.m_Script
        if isinstance(s, bytes): s = s.decode("utf-8", "replace")
        sheet, lang = t.m_Name.rsplit("_", 1)
        for row in csv.reader(io.StringIO(s)):
            if not row or row[0].startswith("//") or row[0] == "KEY": continue
            if len(row) >= 2: table[(sheet, row[0])][lang] = ",".join(row[1:]) if len(row) > 2 else row[1]
os.makedirs(out, exist_ok=True)
langs = ["en", "ru", "it"]
with open(os.path.join(out, "loc_en_ru_it.csv"), "w", newline="", encoding="utf-8-sig") as f:
    w = csv.writer(f); w.writerow(["sheet", "key"] + langs)
    for (sheet, key), v in sorted(table.items()):
        w.writerow([sheet, key] + [v.get(l, "") for l in langs])
json.dump({f"{s}|{k}": v for (s, k), v in table.items()}, open(os.path.join(out, "loc.json"), "w", encoding="utf-8"), ensure_ascii=False)
c = collections.Counter(s for s, k in table)
print(len(table), dict(c))
