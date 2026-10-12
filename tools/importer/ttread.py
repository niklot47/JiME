# Minimal typetree binary reader with path tracing (for debugging layout mismatches)
import struct
class N:
    __slots__ = ("t", "n", "flag", "ch", "lvl")
def build(nodes):
    root = None; stack = []
    for x in nodes:
        n = N(); n.t, n.n, n.flag, n.ch, n.lvl = x.m_Type, x.m_Name, x.m_MetaFlag, [], x.m_Level
        while stack and stack[-1].lvl >= n.lvl: stack.pop()
        if stack: stack[-1].ch.append(n)
        else: root = n
        stack.append(n)
    return root
PRIM = {"int": "<i", "SInt32": "<i", "UInt32": "<I", "unsigned int": "<I", "float": "<f", "double": "<d",
        "SInt64": "<q", "UInt64": "<Q", "long long": "<q", "SInt16": "<h", "UInt16": "<H", "short": "<h",
        "UInt8": "<B", "SInt8": "<b", "char": "<B", "bool": "<?", "Type*": "<i"}
class R:
    def __init__(self, data, off=0, trace=None): self.d, self.o, self.trace = data, off, trace
    def align(self): self.o = (self.o + 3) & ~3
    def read(self, node, path=""):
        p = f"{path}.{node.n}"
        if self.trace is not None: self.trace.append((self.o, p, node.t))
        if node.t in PRIM:
            v = struct.unpack_from(PRIM[node.t], self.d, self.o)[0]; self.o += struct.calcsize(PRIM[node.t])
        elif node.t == "string" and (not node.ch or node.ch[0].ch[1].t == "char"):
            n = struct.unpack_from("<i", self.d, self.o)[0]; self.o += 4
            if n < 0 or self.o + n > len(self.d): raise ValueError(f"bad string len {n} at {p} off {self.o-4}")
            v = self.d[self.o:self.o + n].decode("utf-8", "replace"); self.o += n; self.align()
            return v
        elif node.ch and node.ch[0].t == "Array":
            v = self.read_array(node.ch[0], p)
        elif node.t == "Array":
            v = self.read_array(node, path)
        else:
            v = {}
            for c in node.ch: v[c.n] = self.read(c, p)
        if node.flag & 0x4000: self.align()
        return v
    def read_array(self, arr, p):
        n = struct.unpack_from("<i", self.d, self.o)[0]; self.o += 4
        if n < 0 or n > 10_000_000: raise ValueError(f"bad array len {n} at {p} off {self.o-4}")
        el = arr.ch[1]
        if el.t in PRIM and el.t in ("UInt8", "char"):
            v = bytes(self.d[self.o:self.o + n]); self.o += n
        else:
            v = [self.read(el, p + "[]") for _ in range(n)]
        if arr.flag & 0x4000: self.align()
        return v
