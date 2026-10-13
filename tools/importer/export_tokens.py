# Export board tokens (local only, FFG content) to <JIME_WORK>/packs/core-ffg/images/tokens/:
#   <TokenTypes id>.png   top face of the token as seen from above (2D board): cut out of the texture with the
#                         token mesh's own top-face UVs, so the shape and the crop are exact;
#   raw/<id>.png          the whole texture (3D board: mapped on the mesh with its UVs);
#   meshes.json           the game's token meshes {round, explore, hexagon}: pos (Unity, z up), uv, faces;
#   tokens.json           { "<id>": { "top": ..., "raw": ..., "mesh": "round" | "explore" | "hexagon" } }.
# Ids: Token3DManager.TokenTypes. Meshes: "Round" (circle tokens), "Explore" (square explore token),
# "Darkness" (the small hexagon tokens).
import os, json
import numpy as np
from PIL import Image, ImageDraw
from jload import *
from proto_extract import extract_mesh_by_name

PACK = os.path.join(ROOT, "packs", "core-ffg")
OUT = os.path.join(PACK, "images", "tokens")
TEXTURES = {
    "Explore-Token": [1], "Search-Token": [2], "Threat-Token": [3],
    "Dwarf-Token": [4], "Elf-Token": [5], "Hobbit-Token": [6], "Human-Token": [7],
    "Darkness-Token": [31], "Difficult Terrain Token": [32], "Fortified Token": [33],
}
MESHES = {"round": "Round", "explore": "Explore", "hexagon": "Darkness"}

def mesh_of(tid):
    return "explore" if tid == 1 else "hexagon" if tid in (31, 32, 33) else "round"

def name_of(o):
    try:
        return o.peek_name()
    except Exception:
        return o.read().m_Name

def top_face(img, mesh):
    """The part of the texture on the mesh's flat top (z = max), masked by those triangles in UV space"""
    w, h = img.size
    P, U = np.array(mesh["pos"]), np.array(mesh["uv"])
    top = P[:, 2] >= P[:, 2].max() - 1e-4
    mask = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(mask)
    for f in mesh["faces"]:
        if all(top[i] for i in f):
            d.polygon([(U[i][0] * w, (1 - U[i][1]) * h) for i in f], fill=255)
    out = img.copy()
    out.putalpha(mask)
    return out.crop(mask.getbbox())

def main():
    os.makedirs(os.path.join(OUT, "raw"), exist_ok=True)
    meshes = {k: extract_mesh_by_name(v, ["resources"]) for k, v in MESHES.items()}
    with open(os.path.join(OUT, "meshes.json"), "w", encoding="utf-8") as fp:
        json.dump({k: m for k, m in meshes.items() if m}, fp)
    found = {}
    for o in FILES["resources.assets"].objects.values():
        if o.type.name != "Texture2D" or name_of(o) not in TEXTURES:
            continue
        img = o.read().image.convert("RGBA")
        for tid in TEXTURES[name_of(o)]:
            mk = mesh_of(tid)
            img.save(os.path.join(OUT, "raw", f"{tid}.png"))
            if meshes.get(mk):
                top_face(img, meshes[mk]).save(os.path.join(OUT, f"{tid}.png"))
            found[str(tid)] = {"top": f"images/tokens/{tid}.png", "raw": f"images/tokens/raw/{tid}.png", "mesh": mk}
    with open(os.path.join(OUT, "tokens.json"), "w", encoding="utf-8") as fp:
        json.dump(dict(sorted(found.items(), key=lambda kv: int(kv[0]))), fp, indent=1)
    print(f"tokens: {len(found)} -> {OUT}; meshes: {[k for k, m in meshes.items() if m]}")

if __name__ == "__main__":
    main()
