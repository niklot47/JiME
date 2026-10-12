# Assemble the self-contained prototype page (textures as data URIs, geometry as inline JSON)
import json, base64, os
HERE = os.path.dirname(os.path.abspath(__file__))
A = os.path.join(os.environ.get("JIME_WORK", os.path.expanduser("~/jime")), "proto", "assets")
d = json.load(open(os.path.join(A, "scene.json")))
tex = {}
def uri(fn):
    b = open(os.path.join(A, fn), "rb").read()
    mime = "image/png" if fn.endswith(".png") else "image/jpeg"
    return f"data:{mime};base64," + base64.b64encode(b).decode()
for code, t in d["tiles"].items():
    tex["TILE:" + t["texture"].replace("tile_", "")] = uri(t["texture"])
for name, fn in d["textures"].items():
    tex[name] = uri(fn)
# trim geometry precision
def r(v):
    if isinstance(v, float): return round(v, 4)
    if isinstance(v, list): return [r(x) for x in v]
    if isinstance(v, dict): return {k: r(x) for k, x in v.items()}
    return v
scene = r({k: d[k] for k in ("tiles", "tokenMesh", "terrainMesh", "props", "hexRadius")})
html = open(os.path.join(HERE, "page.html")).read()
html = html.replace("/*SCENE*/", "window.SCENE=" + json.dumps(scene, separators=(",", ":")) + ";")
html = html.replace("/*TEX*/", "window.TEXDATA=" + json.dumps(tex) + ";")
html = html.replace("/*APP*/", open(os.path.join(HERE, "app.js")).read())
out = os.path.join(HERE, "..", "jime3d.html")
open(out, "w").write(html)
print(out, round(len(html) / 1e6, 2), "MB")
