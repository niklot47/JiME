# Minimal glTF 2.0 binary (GLB) writer for Unity scenes and prefabs (local only, FFG content).
# Unity is left-handed (x right, y up, z forward); glTF is right-handed: x is mirrored (positions, normals,
# quaternion y/z negated, triangle winding reversed) and texture v flipped.
import io, json, struct
import numpy as np

FLOAT, UINT32 = 5126, 5125


class Glb:
    def __init__(self):
        self.bin = bytearray()
        self.j = {"asset": {"version": "2.0", "generator": "jime importer"}, "scene": 0, "scenes": [{"nodes": []}],
                  "nodes": [], "meshes": [], "materials": [], "textures": [], "images": [], "accessors": [],
                  "bufferViews": [], "samplers": [{"magFilter": 9729, "minFilter": 9987, "wrapS": 10497, "wrapT": 10497}]}

    def view(self, data, target=None):
        while len(self.bin) % 4:
            self.bin.append(0)
        v = {"buffer": 0, "byteOffset": len(self.bin), "byteLength": len(data)}
        if target:
            v["target"] = target
        self.bin += data
        self.j["bufferViews"].append(v)
        return len(self.j["bufferViews"]) - 1

    def accessor(self, arr, typ, minmax=False, target=34962):
        arr = np.ascontiguousarray(arr, dtype=np.uint32 if typ == "SCALAR" else np.float32)
        a = {"bufferView": self.view(arr.tobytes(), target), "componentType": UINT32 if typ == "SCALAR" else FLOAT,
             "count": int(arr.shape[0]), "type": typ}
        if minmax:
            a["min"] = [float(x) for x in arr.min(axis=0)]
            a["max"] = [float(x) for x in arr.max(axis=0)]
        self.j["accessors"].append(a)
        return len(self.j["accessors"]) - 1

    def image(self, img, max_size=1024):
        img = img.copy()
        img.thumbnail((max_size, max_size))
        alpha = img.mode in ("RGBA", "LA") and img.getchannel("A").getextrema()[0] < 250
        buf = io.BytesIO()
        if alpha:
            img.convert("RGBA").save(buf, "PNG", optimize=True)
            mime = "image/png"
        else:
            img.convert("RGB").save(buf, "JPEG", quality=85)
            mime = "image/jpeg"
        self.j["images"].append({"bufferView": self.view(buf.getvalue()), "mimeType": mime})
        self.j["textures"].append({"sampler": 0, "source": len(self.j["images"]) - 1})
        return len(self.j["textures"]) - 1, alpha

    def node(self, n, parent=None):
        self.j["nodes"].append(n)
        i = len(self.j["nodes"]) - 1
        if parent is None:
            self.j["scenes"][0]["nodes"].append(i)
        else:
            self.j["nodes"][parent].setdefault("children", []).append(i)
        return i

    def save(self, path):
        while len(self.bin) % 4:
            self.bin.append(0)
        self.j["buffers"] = [{"byteLength": len(self.bin)}]
        for k in ("meshes", "materials", "textures", "images", "accessors"):
            if not self.j[k]:
                del self.j[k]
        js = json.dumps(self.j, separators=(",", ":")).encode()
        js += b" " * ((4 - len(js) % 4) % 4)
        with open(path, "wb") as fp:
            fp.write(struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(self.bin)))
            fp.write(struct.pack("<II", len(js), 0x4E4F534A) + js)
            fp.write(struct.pack("<II", len(self.bin), 0x004E4942) + bytes(self.bin))


def trs(tr):
    """glTF TRS of a Unity Transform (mirrored x)"""
    p, q, s = tr.m_LocalPosition, tr.m_LocalRotation, tr.m_LocalScale
    out = {}
    if (p.x, p.y, p.z) != (0, 0, 0):
        out["translation"] = [-p.x, p.y, p.z]
    if (q.x, q.y, q.z, q.w) != (0, 0, 0, 1):
        out["rotation"] = [q.x, -q.y, -q.z, q.w]
    if (s.x, s.y, s.z) != (1, 1, 1):
        out["scale"] = [s.x, s.y, s.z]
    return out


def quat_mat(x, y, z, w):
    return np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                     [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                     [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])


def trs_matrix(t):
    m = np.eye(4)
    q = t.get("rotation", [0, 0, 0, 1])
    m[:3, :3] = quat_mat(*q) * np.array(t.get("scale", [1, 1, 1]))
    m[:3, 3] = t.get("translation", [0, 0, 0])
    return m
