"""
A map of the north-west of Middle-earth drawn procedurally (an own drawing of the geography, not a copy of any map
picture): parchment, seas with ripples along the coast, rivers, hand-drawn mountains and hills, forests of little
trees, marshes, roads, towns. The names are not painted in: the app draws them over the map (translated), see
LABELS in me_geo.py. The result is a private pack (data/packs/<id>, gitignored) with the campaigns' map data.

    python tools/maps/middle_earth.py [--width 8192] [--id me-map] [--out data/packs] [--preview]

Needs numpy and Pillow only.
"""
import argparse
import json
import math
import os
import sys
import zlib

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import me_geo as G  # noqa: E402

V0, V1 = -0.03, 1.03  # the v range shown (the 16:9 canvas shows more sea to the west and more of Rhûn to the east)

INK = (58, 42, 28)
PAPER = (232, 214, 172)
SEA = (170, 184, 176)
RIVER = (78, 104, 118)


class Canvas:
    def __init__(self, W, H):
        self.W, self.H = W, H
        h = V1 - V0
        self.w = h * W / H  # canvas width in v units
        self.x0 = G.ASPECT / 2 - self.w / 2
        self.s = H / 1000  # 1/1000 of the height in px

    def P(self, u, v):
        return ((u * G.ASPECT - self.x0) / self.w * self.W, (v - V0) / (V1 - V0) * self.H)

    def L(self, d):
        """a length in v units -> px"""
        return d / (V1 - V0) * self.H

    def frac(self, u, v):
        x, y = self.P(u, v)
        return round(x / self.W, 4), round(y / self.H, 4)


# ------------------------------------------------------------------ helpers
def sid(name):
    """a stable seed per feature (str hash() changes between runs)"""
    return zlib.crc32(name.encode())


def roughen(pts, rough, rng, depth=6, closed=False):
    """midpoint displacement: every segment split, its middle pushed sideways by a share of its length"""
    pts = [tuple(p) for p in pts]
    for _ in range(depth):
        out = []
        n = len(pts)
        for i in range(n if closed else n - 1):
            a, b = pts[i], pts[(i + 1) % n]
            out.append(a)
            dx, dy = b[0] - a[0], b[1] - a[1]
            L = math.hypot(dx, dy) or 1e-9
            off = rng.normal() * L * rough
            out.append(((a[0] + b[0]) / 2 - dy / L * off, (a[1] + b[1]) / 2 + dx / L * off))
        if not closed:
            out.append(pts[-1])
        pts = out
    return pts


def resample(pts, step):
    """points every `step` along a polyline (with the direction there)"""
    out = []
    acc = 0.0
    for i in range(len(pts) - 1):
        (x0, y0), (x1, y1) = pts[i], pts[i + 1]
        L = math.hypot(x1 - x0, y1 - y0)
        if L == 0:
            continue
        while acc <= L:
            t = acc / L
            out.append((x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, (x1 - x0) / L, (y1 - y0) / L))
            acc += step
        acc -= L
    return out


def fbm(W, H, cells, rng):
    """value noise: octaves of random grids smoothly enlarged, 0..1"""
    acc = np.zeros((H, W), np.float32)
    tot = 0.0
    for cell, wgt in cells:
        gw, gh = max(2, W // cell + 2), max(2, H // cell + 2)
        small = Image.fromarray(rng.random((gh, gw)).astype(np.float32), "F")
        big = small.resize((gw * cell, gh * cell), Image.BICUBIC).crop((0, 0, W, H))
        acc += np.asarray(big, np.float32) * wgt
        tot += wgt
    acc /= tot
    lo, hi = np.percentile(acc[:: max(1, H // 200), :: max(1, W // 200)], [1, 99])
    return np.clip((acc - lo) / (hi - lo + 1e-6), 0, 1)


def poly_mask(cv, polys, scale=1):
    """a mask (L) of filled outlines (in u, v) at 1/scale of the canvas"""
    m = Image.new("L", (cv.W // scale, cv.H // scale), 0)
    d = ImageDraw.Draw(m)
    for pts in polys:
        d.polygon([(x / scale, y / scale) for x, y in (cv.P(*p) for p in pts)], fill=255)
    return m


def blend(base, color, mask, alpha=1.0):
    """base (float HxWx3) toward colour where mask (0..1)"""
    m = (mask * alpha)[..., None]
    base *= 1 - m
    base += np.asarray(color, np.float32) * m


# ------------------------------------------------------------------ layers
def parchment(cv, rng):
    W, H = cv.W, cv.H
    n1 = fbm(W, H, [(max(8, W // 6), 0.5), (max(4, W // 24), 0.3), (max(2, W // 120), 0.2)], rng)
    img = np.empty((H, W, 3), np.float32)
    for i, c in enumerate(PAPER):
        img[..., i] = c * (0.86 + 0.16 * n1)
    # stains: a few soft darker blots
    st = fbm(W, H, [(max(8, W // 10), 1.0)], rng)
    stain = np.clip((st - 0.72) * 4, 0, 1) * 0.10
    img *= (1 - stain[..., None] * np.array([0.6, 0.9, 1.4], np.float32))
    # fine fibres
    fib = fbm(W, H, [(max(2, W // 900), 1.0)], rng)
    img *= (0.97 + 0.06 * fib)[..., None]
    return img


def tints(cv, img):
    sc = 8
    for pts, mul in G.TINTS:
        m = poly_mask(cv, [pts], sc).filter(ImageFilter.GaussianBlur(cv.L(0.02) / sc))
        m = np.asarray(m.resize((cv.W, cv.H), Image.BILINEAR), np.float32) / 255
        img *= (1 + (np.asarray(mul, np.float32) - 1) * m[..., None])


def draw_line(d, pts, width, fill):
    d.line(pts, fill=fill, width=max(1, int(round(width))), joint="curve")


def rivers(cv, img, rng):
    lay = Image.new("RGBA", (cv.W, cv.H), (0, 0, 0, 0))
    d = ImageDraw.Draw(lay)
    for name, (path, w0, w1) in G.RIVERS.items():
        r = np.random.default_rng(sid(name))
        pts = roughen(path, 0.16, r, depth=6)
        px = [cv.P(*p) for p in pts]
        n = len(px)
        for i in range(n - 1):
            t = i / max(1, n - 2)
            w = cv.L(w0 + (w1 - w0) * t)
            d.line([px[i], px[i + 1]], fill=RIVER + (235,), width=max(1, int(round(w))))
    composite(img, lay)


def composite(img, lay):
    a = np.asarray(lay, np.float32)
    al = a[..., 3:4] / 255
    img *= 1 - al
    img += a[..., :3] * al


def sea(cv, img, rng):
    """the sea and lakes over the land, ripples along the coasts, the coast inked"""
    r = np.random.default_rng(11)
    coast = roughen(G.COAST, 0.22, r, depth=7)
    big = [(-1.0, 1.4), (-1.0, -0.4), (coast[0][0], -0.4)]
    sea_poly = coast + [(coast[-1][0], 1.4)] + big
    lakes = {k: roughen(v, 0.18, np.random.default_rng(sid(k)), depth=4, closed=True) for k, v in G.LAKES.items()}
    polys = [sea_poly] + list(lakes.values())
    sc = 2
    low = poly_mask(cv, polys, sc)
    m = np.asarray(low.resize((cv.W, cv.H), Image.BILINEAR), np.float32) / 255
    # the water: tinted parchment, a little darker toward the open sea
    deep = low.filter(ImageFilter.GaussianBlur(cv.L(0.05) / sc))
    deep = np.asarray(deep.resize((cv.W, cv.H), Image.BILINEAR), np.float32) / 255
    wn = fbm(cv.W, cv.H, [(max(4, cv.W // 40), 0.6), (max(2, cv.W // 300), 0.4)], rng)
    water = np.empty_like(img)
    for i, c in enumerate(SEA):
        water[..., i] = c * (0.95 + 0.07 * wn) * (1.0 - 0.10 * deep)
    blend(img, (0, 0, 0), m)  # clear
    img += water * m[..., None]
    # a light rim on the land side of the coast (the shore)
    shore = np.asarray(low.filter(ImageFilter.GaussianBlur(cv.L(0.006) / sc)).resize((cv.W, cv.H), Image.BILINEAR), np.float32) / 255
    rim = np.clip(shore * 2.2, 0, 1) * (1 - m)
    blend(img, (238, 226, 192), rim, 0.35)
    # ripples: lines parallel to the coast at growing distances (contours of the blurred land), fading out
    land = Image.fromarray(255 - np.asarray(low), "L")
    lay = Image.new("RGBA", (cv.W // sc, cv.H // sc), (0, 0, 0, 0))
    for k, dist in enumerate([0.006, 0.012, 0.019, 0.027]):
        b = np.asarray(land.filter(ImageFilter.GaussianBlur(cv.L(dist) / sc)), np.float32) / 255
        line = np.clip(1 - np.abs(b - 0.12) / 0.022, 0, 1) * (np.asarray(low, np.float32) / 255)
        a = (line * 255 * (0.55 - k * 0.11)).astype(np.uint8)
        lay.alpha_composite(Image.merge("RGBA", [Image.new("L", lay.size, c) for c in INK] + [Image.fromarray(a, "L")]))
    lay = lay.resize((cv.W, cv.H), Image.BILINEAR)
    composite(img, lay)
    # the coast inked
    lay = Image.new("RGBA", (cv.W, cv.H), (0, 0, 0, 0))
    d = ImageDraw.Draw(lay)
    for pts in polys:
        px = [cv.P(*p) for p in pts]
        d.line(px + [px[0]] if pts is not sea_poly else px[: len(coast)], fill=INK + (230,), width=max(1, int(cv.L(0.0016))))
    composite(img, lay)
    return m


def marshes(cv, d, rng):
    for name, (u, v, ru, rv) in G.MARSHES.items():
        r = np.random.default_rng(sid(name))
        n = int(ru * rv * 60000)
        for _ in range(n):
            a, rr = r.random() * 2 * math.pi, math.sqrt(r.random())
            x, y = cv.P(u + math.cos(a) * ru * rr, v + math.sin(a) * rv * rr)
            s = cv.L(0.0035) * (0.7 + 0.6 * r.random())
            w = max(1, int(cv.L(0.0006)))
            d.line([(x - s * 0.9, y), (x + s * 0.9, y)], fill=RIVER + (200,), width=w)
            for k in (-0.4, 0, 0.4):
                d.line([(x + k * s, y - 0.1 * s), (x + k * s * 1.4, y - s * (0.8 + 0.4 * r.random()))], fill=INK + (190,), width=w)


def roads(cv, d):
    w = max(1, int(cv.L(0.0012)))
    dash, gap = cv.L(0.006), cv.L(0.004)
    for name, path in G.ROADS.items():
        pts = roughen(path, 0.06, np.random.default_rng(sid(name)), depth=4)
        px = [cv.P(*p) for p in pts]
        on, left = True, dash
        for i in range(len(px) - 1):
            (x0, y0), (x1, y1) = px[i], px[i + 1]
            L = math.hypot(x1 - x0, y1 - y0)
            t = 0.0
            while t < L:
                step = min(left, L - t)
                if on:
                    a, b = t / L, (t + step) / L
                    d.line([(x0 + (x1 - x0) * a, y0 + (y1 - y0) * a), (x0 + (x1 - x0) * b, y0 + (y1 - y0) * b)], fill=(140, 72, 48, 210), width=w)
                t += step
                left -= step
                if left <= 0:
                    on = not on
                    left = dash if on else gap


def tree(d, x, y, r, kind, rng):
    col = {"green": ((96, 116, 66), (128, 146, 82)), "dark": ((72, 90, 56), (100, 118, 72)), "gold": ((176, 148, 62), (214, 184, 92))}[kind]
    w = max(1, int(r * 0.16))
    d.line([(x, y), (x, y + r * 0.9)], fill=INK + (230,), width=w)
    box = [x - r, y - r * 1.15, x + r, y + r * 0.55]
    d.ellipse(box, fill=col[0] + (255,), outline=INK + (230,), width=w)
    d.ellipse([x - r * 0.75, y - r * 1.0, x + r * 0.1, y - r * 0.1], fill=col[1] + (255,))


def forests(cv, rng, sea_mask):
    trees = []
    sc = 4
    for name, (pts, kind) in G.FORESTS.items():
        r = np.random.default_rng(sid(name))
        poly = roughen(pts, 0.15, r, depth=4, closed=True)
        m = np.asarray(poly_mask(cv, [poly], sc))
        rad = cv.L(0.0052 if kind != "gold" else 0.0058)
        step = rad * 1.55
        xs = [cv.P(*p)[0] for p in poly]
        ys = [cv.P(*p)[1] for p in poly]
        y = min(ys)
        row = 0
        while y < max(ys):
            x = min(xs) + (step / 2 if row % 2 else 0)
            while x < max(xs):
                jx, jy = x + (r.random() - 0.5) * step * 0.7, y + (r.random() - 0.5) * step * 0.6
                iy, ix = int(jy / sc), int(jx / sc)
                if 0 <= iy < m.shape[0] and 0 <= ix < m.shape[1] and m[iy, ix] and sea_mask[min(cv.H - 1, int(jy)), min(cv.W - 1, int(jx))] < 0.5:
                    trees.append((jy, jx, rad * (0.8 + 0.4 * r.random()), kind))
                x += step
            y += step * 0.72
            row += 1
    lay = Image.new("RGBA", (cv.W, cv.H), (0, 0, 0, 0))
    d = ImageDraw.Draw(lay)
    for y, x, rad, kind in sorted(trees):
        tree(d, x, y, rad, kind, rng)
    return lay


def peak(d, x, y, h, rng, snow=False, dark=False):
    """one hand-drawn mountain: a lit left flank, a shaded right flank with hatching, an inked outline"""
    w = h * (1.5 + 0.6 * rng.random())
    px, py = x + (rng.random() - 0.5) * w * 0.2, y - h
    left, right = (x - w / 2, y), (x + w / 2, y)
    sh = (x + w * 0.08, y)
    # shoulders: a little bend on each flank
    lsh = (x - w * 0.28 + (rng.random() - 0.5) * w * 0.08, y - h * 0.48)
    rsh = (x + w * 0.27 + (rng.random() - 0.5) * w * 0.08, y - h * 0.5)
    light = (122, 108, 96) if dark else (238, 226, 196)
    shade = (78, 66, 58) if dark else (168, 142, 104)
    d.polygon([left, lsh, (px, py), sh], fill=light + (255,))
    d.polygon([(px, py), rsh, right, sh], fill=shade + (255,))
    lw = max(1, int(h * 0.07))
    # hatching on the shaded side
    for k in range(1, 4):
        t = k / 4
        a = (px + (rsh[0] - px) * t, py + (rsh[1] - py) * t)
        d.line([a, (a[0] - w * 0.05, a[1] + h * 0.35)], fill=INK + (150,), width=max(1, lw // 2))
    if snow:
        d.polygon([(px, py), (px - w * 0.13, py + h * 0.28), (px - w * 0.02, py + h * 0.22), (px + w * 0.09, py + h * 0.3)], fill=(250, 248, 240, 255))
    d.line([left, lsh, (px, py), rsh, right], fill=INK + (240,), width=lw, joint="curve")
    d.line([(px, py), (px + w * 0.02, py + h * 0.55)], fill=INK + (200,), width=max(1, lw // 2))


def hill(d, x, y, s, rng):
    w = s * 2.2
    box = [x - w / 2, y - s, x + w / 2, y + s]
    d.pieslice(box, 180, 360, fill=(222, 204, 160, 255))
    d.chord([x, y - s * 0.9, x + w / 2, y + s * 0.9], 270, 360, fill=(190, 166, 122, 255))
    d.arc(box, 190, 350, fill=INK + (220,), width=max(1, int(s * 0.14)))


def mountains(cv, rng):
    items = []
    for name, (ridge, size, width) in G.MOUNTAINS.items():
        r = np.random.default_rng(sid(name))
        rid = roughen(ridge, 0.08, r, depth=4)
        dark = name in ("ephel", "ash", "ephel_s")
        for u, v, du, dv in resample(rid, size * 0.55):
            for _ in range(1 + int(r.random() * 2.2)):
                off = (r.random() - 0.5) * width
                uu, vv = u - dv * off, v + du * off
                h = size * (0.65 + 0.6 * r.random())
                x, y = cv.P(uu, vv)
                items.append((y, x, cv.L(h), dark, size >= 0.024 and r.random() < 0.6))
    for name, (u, v, size) in G.PEAKS.items():
        x, y = cv.P(u, v)
        items.append((y + 1e-3, x, cv.L(size), name == "doom", name in ("erebor", "methedras")))
    hills = []
    for name, ridge in G.HILLS.items():
        r = np.random.default_rng(sid(name))
        for u, v, du, dv in resample(ridge, 0.008):
            for _ in range(1 + int(r.random() * 1.6)):
                off = (r.random() - 0.5) * 0.012
                x, y = cv.P(u - dv * off, v + du * off)
                hills.append((y, x, cv.L(0.0045 * (0.8 + 0.5 * r.random()))))
    lay = Image.new("RGBA", (cv.W, cv.H), (0, 0, 0, 0))
    d = ImageDraw.Draw(lay)
    for y, x, s in sorted(hills):
        hill(d, x, y, s, rng)
    for y, x, h, dark, snow in sorted(items):
        peak(d, x, y, h, rng, snow, dark)
    # the fire of Mount Doom
    x, y = cv.P(*G.PEAKS["doom"][:2])
    h = cv.L(G.PEAKS["doom"][2])
    for k in range(6, 0, -1):
        rr = h * 0.08 * k
        d.ellipse([x - rr, y - h - rr, x + rr, y - h + rr], fill=(230, 90, 30, int(40 + 25 * (6 - k))))
    return lay


def places(cv, d):
    for name, (u, v, kind) in G.PLACES.items():
        x, y = cv.P(u, v)
        s = cv.L(0.0042)
        w = max(1, int(s * 0.25))
        if kind == "town":
            d.ellipse([x - s * 0.6, y - s * 0.6, x + s * 0.6, y + s * 0.6], fill=(150, 60, 40, 255), outline=INK + (255,), width=w)
        elif kind in ("city", "tower", "dark"):
            col = (40, 34, 30) if kind == "dark" else (150, 60, 40)
            # a little keep: a body, two towers with battlements
            d.rectangle([x - s, y - s * 0.6, x + s, y + s * 0.6], fill=col + (255,), outline=INK + (255,), width=w)
            for cx in (x - s * 0.9, x + s * 0.9):
                d.rectangle([cx - s * 0.35, y - s * 1.3, cx + s * 0.35, y + s * 0.6], fill=col + (255,), outline=INK + (255,), width=w)
            if kind == "tower":
                d.rectangle([x - s * 0.3, y - s * 1.8, x + s * 0.3, y - s * 0.6], fill=col + (255,), outline=INK + (255,), width=w)
        else:  # ruin
            d.ellipse([x - s * 0.6, y - s * 0.6, x + s * 0.6, y + s * 0.6], outline=INK + (255,), width=w)
            d.line([(x - s * 0.5, y + s * 0.5), (x + s * 0.5, y - s * 0.5)], fill=INK + (255,), width=w)


def compass(cv, d, u, v, size):
    x, y = cv.P(u, v)
    R = cv.L(size)
    w = max(1, int(R * 0.02))
    d.ellipse([x - R * 0.72, y - R * 0.72, x + R * 0.72, y + R * 0.72], outline=INK + (200,), width=w)
    d.ellipse([x - R * 0.66, y - R * 0.66, x + R * 0.66, y + R * 0.66], outline=INK + (140,), width=w)
    for k in range(16):
        a = k * math.pi / 8
        L = R * (1.0 if k % 4 == 0 else 0.62 if k % 2 == 0 else 0.42)
        bw = R * (0.13 if k % 4 == 0 else 0.09)
        tip = (x + math.sin(a) * L, y - math.cos(a) * L)
        l = (x + math.sin(a - math.pi / 2) * bw, y - math.cos(a - math.pi / 2) * bw)
        r = (x + math.sin(a + math.pi / 2) * bw, y - math.cos(a + math.pi / 2) * bw)
        d.polygon([(x, y), l, tip], fill=(232, 218, 182, 255), outline=INK + (230,))
        d.polygon([(x, y), tip, r], fill=(150, 60, 40, 255) if k == 0 else INK + (230,), outline=INK + (230,))


def frame(cv, img):
    """darkened, slightly burnt edges and a double ink border"""
    W, H = cv.W, cv.H
    yy = np.linspace(-1, 1, H, dtype=np.float32)[:, None]
    xx = np.linspace(-1, 1, W, dtype=np.float32)[None, :]
    e = np.maximum(np.abs(xx) ** 6, np.abs(yy) ** 6)
    img *= (1 - 0.35 * e)[..., None]
    lay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(lay)
    m = int(cv.L(0.016))
    d.rectangle([m, m, W - 1 - m, H - 1 - m], outline=INK + (230,), width=max(2, int(cv.L(0.0025))))
    m2 = m + int(cv.L(0.007))
    d.rectangle([m2, m2, W - 1 - m2, H - 1 - m2], outline=INK + (200,), width=max(1, int(cv.L(0.0011))))
    composite(img, lay)


def render(W, H, seed=7):
    cv = Canvas(W, H)
    rng = np.random.default_rng(seed)
    img = parchment(cv, rng)
    tints(cv, img)
    lay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(lay)
    marshes(cv, d, rng)
    roads(cv, d)
    composite(img, lay)
    rivers(cv, img, rng)
    m = sea(cv, img, rng)
    composite(img, forests(cv, rng, m))
    composite(img, mountains(cv, rng))
    lay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(lay)
    places(cv, d)
    compass(cv, d, -0.10, 0.80, 0.075)
    composite(img, lay)
    frame(cv, img)
    return cv, Image.fromarray(np.clip(img, 0, 255).astype(np.uint8), "RGB")


def write_pack(cv, img, out_root, pack_id, preview=False):
    base = os.path.join(out_root, pack_id)
    os.makedirs(os.path.join(base, "images/campaigns"), exist_ok=True)
    os.makedirs(os.path.join(base, "lang"), exist_ok=True)
    rel = "images/campaigns/middle-earth.jpg"
    img.save(os.path.join(base, rel), quality=90, optimize=True, progressive=True)
    labels = [{"key": f"ME_MAP_{k}", "x": cv.frac(u, v)[0], "y": cv.frac(u, v)[1], "size": s, **({"angle": a} if a else {})}
              for k, (u, v, s, a, *_names) in G.LABELS.items()]
    maps = {str(c): {"image": rel, "zoom": 3.0, "labels": labels,
                     "locations": {str(a): list(cv.frac(u, v)) for a, (u, v) in locs.items()}} for c, locs in G.LOCATIONS.items()}
    with open(os.path.join(base, "images/campaigns/maps.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump(maps, f, ensure_ascii=False, indent=1)
    for i, lang in enumerate(("en", "ru", "it")):
        with open(os.path.join(base, f"lang/{lang}.csv"), "w", encoding="utf-8", newline="\n") as f:
            f.write("key,text\n")
            for k, (*_pos, en, ru, it) in G.LABELS.items():
                text = (en, ru, it)[i].replace('"', '""')
                f.write(f'MeMap|ME_MAP_{k},"{text}"\n')
    with open(os.path.join(base, "pack.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump({"formatVersion": 1, "id": pack_id,
                   "name": {"ru": "Карта Средиземья", "en": "Map of Middle-earth", "it": "Mappa della Terra di Mezzo"},
                   "description": "The campaigns' map, drawn by tools/maps/middle_earth.py. Local only.",
                   "version": "0.1.0", "priority": 5, "origin": "user",
                   "contents": [{"type": "theme", "path": "images"}] + [{"type": "lang", "lang": l, "path": f"lang/{l}.csv"} for l in ("ru", "en", "it")]},
                  f, ensure_ascii=False, indent=1)
    return base


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--width", type=int, default=8192)
    ap.add_argument("--id", default="me-map")
    ap.add_argument("--out", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "data", "packs"))
    ap.add_argument("--preview", help="only write this picture (with the names drawn in, to check them)")
    a = ap.parse_args()
    W = a.width
    H = W * 9 // 16
    cv, img = render(W, H)
    if a.preview:
        from PIL import ImageFont
        d = ImageDraw.Draw(img)
        for k, (u, v, s, ang, en, ru, it) in G.LABELS.items():
            f = ImageFont.truetype("DejaVuSerif.ttf", max(8, int(s * cv.s)))
            x, y = cv.P(u, v)
            t = Image.new("RGBA", (int(len(ru) * s * cv.s) + 20, int(s * cv.s * 1.6)), (0, 0, 0, 0))
            ImageDraw.Draw(t).text((t.width / 2, t.height / 2), ru, font=f, fill=INK + (255,), anchor="mm")
            t = t.rotate(-ang, expand=True, resample=Image.BICUBIC)
            img.paste(t, (int(x - t.width / 2), int(y - t.height / 2)), t)
        for c, locs in G.LOCATIONS.items():
            for _, (u, v) in locs.items():
                x, y = cv.P(u, v)
                d.ellipse([x - 3, y - 3, x + 3, y + 3], outline=(200, 0, 0))
        img.save(a.preview)
        print("preview", a.preview, img.size)
        return
    base = write_pack(cv, img, os.path.abspath(a.out), a.id)
    print(f"{base}: map {W}x{H}, {len(G.LABELS)} names, {sum(len(l) for l in G.LOCATIONS.values())} adventure places")


if __name__ == "__main__":
    main()
