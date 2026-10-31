"""
The same map of the north-west of Middle-earth in one ink: parchment and dark blue (almost black) ink, the names
written in (English), and instead of the adventures' markers little drawings of what happens there (a fort on the
South Downs, the inn, Orthanc, ships at Umbar, the spider's web in Mirkwood ...). Meant as the texture of the map on
the 3D table (a picture, not a pack).

    python tools/maps/middle_earth_ink.py [--width 8192] [--out data/maps/middle-earth-ink.jpg]
"""
import argparse
import math
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import me_geo as G  # noqa: E402
from middle_earth import Canvas, composite, fbm, poly_mask, resample, roughen, sid  # noqa: E402

INK = (22, 28, 50)
PAPER = (234, 218, 180)
FILL = (232, 215, 176)


# ------------------------------------------------------------------ fonts
FONTS = {
    "regular": ["pala.ttf", "georgia.ttf", "DejaVuSerif.ttf"],
    "italic": ["palai.ttf", "georgiai.ttf", "DejaVuSerif-Italic.ttf"],
    "bold": ["palab.ttf", "georgiab.ttf", "DejaVuSerif-Bold.ttf"],
}
_font_cache = {}


def font(kind, size):
    key = (kind, size)
    if key not in _font_cache:
        for name in FONTS[kind]:
            for d in ("C:/Windows/Fonts", "/usr/share/fonts/truetype/dejavu", ""):
                p = os.path.join(d, name) if d else name
                try:
                    _font_cache[key] = ImageFont.truetype(p, size)
                    break
                except OSError:
                    continue
            if key in _font_cache:
                break
        else:
            _font_cache[key] = ImageFont.load_default()
    return _font_cache[key]


# ------------------------------------------------------------------ paper
def parchment(cv, rng):
    W, H = cv.W, cv.H
    n1 = fbm(W, H, [(max(8, W // 5), 0.5), (max(4, W // 20), 0.3), (max(2, W // 110), 0.2)], rng)
    img = np.empty((H, W, 3), np.float32)
    for i, c in enumerate(PAPER):
        img[..., i] = c * (0.88 + 0.14 * n1)
    st = fbm(W, H, [(max(8, W // 9), 1.0)], rng)
    stain = np.clip((st - 0.70) * 4, 0, 1) * 0.12
    img *= (1 - stain[..., None] * np.array([0.5, 0.8, 1.3], np.float32))
    fib = fbm(W, H, [(max(2, W // 1000), 1.0)], rng)
    img *= (0.975 + 0.05 * fib)[..., None]
    return img


def frame(cv, img, d):
    W, H = cv.W, cv.H
    yy = np.linspace(-1, 1, H, dtype=np.float32)[:, None]
    xx = np.linspace(-1, 1, W, dtype=np.float32)[None, :]
    e = np.maximum(np.abs(xx) ** 7, np.abs(yy) ** 7)
    img *= (1 - 0.32 * e)[..., None] * np.array([1, 0.98, 0.94], np.float32)
    m = int(cv.L(0.016))
    d.rectangle([m, m, W - 1 - m, H - 1 - m], outline=INK + (235,), width=max(2, int(cv.L(0.0028))))
    m2 = m + int(cv.L(0.008))
    d.rectangle([m2, m2, W - 1 - m2, H - 1 - m2], outline=INK + (210,), width=max(1, int(cv.L(0.0011))))
    # little corner squares
    k = int(cv.L(0.008))
    for x, y in ((m, m), (W - 1 - m - k, m), (m, H - 1 - m - k), (W - 1 - m - k, H - 1 - m - k)):
        d.rectangle([x, y, x + k, y + k], outline=INK + (235,), width=max(1, int(cv.L(0.0011))))


# ------------------------------------------------------------------ water
def chaikin(pts, n=2, closed=False):
    """corner cutting: the finest jitter of a roughened line smoothed into a pen stroke"""
    for _ in range(n):
        out = [] if closed else [pts[0]]
        m = len(pts)
        for i in range(m if closed else m - 1):
            (x0, y0), (x1, y1) = pts[i], pts[(i + 1) % m]
            out += [(0.75 * x0 + 0.25 * x1, 0.75 * y0 + 0.25 * y1), (0.25 * x0 + 0.75 * x1, 0.25 * y0 + 0.75 * y1)]
        if not closed:
            out.append(pts[-1])
        pts = out
    return pts


def sea(cv, img, ink):
    r = np.random.default_rng(11)
    coast = chaikin(roughen(G.COAST, 0.22, r, depth=5), 4)  # the coloured map's coast without its finest jitter
    sea_poly = coast + [(coast[-1][0], 1.4), (-1.0, 1.4), (-1.0, -0.4), (coast[0][0], -0.4)]
    lakes = {k: chaikin(roughen(v, 0.18, np.random.default_rng(sid(k)), depth=4, closed=True), 3, True) for k, v in G.LAKES.items()}
    polys = [sea_poly] + list(lakes.values())
    sc = 2
    low = poly_mask(cv, polys, sc)
    m = np.asarray(low.resize((cv.W, cv.H), Image.BILINEAR), np.float32) / 255
    # the water a little darker than the land
    img *= (1 - 0.07 * m)[..., None]
    # ripples: ink lines parallel to the coast, fading out to sea
    land = Image.fromarray(255 - np.asarray(low), "L")
    lay = Image.new("RGBA", (cv.W // sc, cv.H // sc), (0, 0, 0, 0))
    for k, dist in enumerate([0.005, 0.010, 0.016, 0.023, 0.031]):
        b = np.asarray(land.filter(ImageFilter.GaussianBlur(cv.L(dist) / sc)), np.float32) / 255
        line = np.clip(1 - np.abs(b - 0.12) / 0.02, 0, 1) * (np.asarray(low, np.float32) / 255)
        a = (line * 255 * (0.75 - k * 0.13)).astype(np.uint8)
        lay.alpha_composite(Image.merge("RGBA", [Image.new("L", lay.size, c) for c in INK] + [Image.fromarray(a, "L")]))
    composite(img, lay.resize((cv.W, cv.H), Image.BILINEAR))
    for pts in polys:
        px = [cv.P(*p) for p in pts]
        ink.line(px[: len(coast)] if pts is sea_poly else px + [px[0]], fill=INK + (245,), width=max(2, int(cv.L(0.0019))))
    return m


def waves(cv, d, rng, sea_m):
    """little wave marks scattered over the open sea"""
    s = cv.L(0.006)
    w = max(1, int(cv.L(0.0009)))
    for _ in range(int(260 * cv.W / 8192 * cv.W / 8192) + 220):
        x, y = rng.random() * cv.W, rng.random() * cv.H
        if sea_m[int(y), int(x)] < 0.99:
            continue
        # far enough from the coast: the 3 px around are sea too
        ok = all(sea_m[min(cv.H - 1, max(0, int(y + dy))), min(cv.W - 1, max(0, int(x + dx)))] > 0.99
                 for dx, dy in ((cv.L(0.03), 0), (-cv.L(0.03), 0), (0, cv.L(0.03)), (0, -cv.L(0.03))))
        if not ok:
            continue
        d.arc([x - s, y - s * 0.5, x, y + s * 0.5], 200, 340, fill=INK + (150,), width=w)
        d.arc([x, y - s * 0.5, x + s, y + s * 0.5], 200, 340, fill=INK + (150,), width=w)


def rivers(cv, d):
    for name, (path, w0, w1) in G.RIVERS.items():
        pts = chaikin(roughen(path, 0.16, np.random.default_rng(sid(name)), depth=4), 4)
        px = [cv.P(*p) for p in pts]
        n = len(px)
        # pen strokes of a few points each (joined round), wider toward the mouth
        k = 8
        for i in range(0, n - 1, k):
            t = i / max(1, n - 2)
            w = cv.L((w0 + (w1 - w0) * t) * 0.8)
            d.line(px[i: i + k + 1], fill=INK + (235,), width=max(1, int(round(w))), joint="curve")


# ------------------------------------------------------------------ land
def marshes(cv, d):
    for name, (u, v, ru, rv) in G.MARSHES.items():
        r = np.random.default_rng(sid(name))
        for _ in range(int(ru * rv * 50000)):
            a, rr = r.random() * 2 * math.pi, math.sqrt(r.random())
            x, y = cv.P(u + math.cos(a) * ru * rr, v + math.sin(a) * rv * rr)
            s = cv.L(0.0035) * (0.7 + 0.6 * r.random())
            w = max(1, int(cv.L(0.0006)))
            d.line([(x - s, y), (x + s, y)], fill=INK + (170,), width=w)
            for k in (-0.35, 0, 0.35):
                d.line([(x + k * s, y - 0.1 * s), (x + k * s * 1.5, y - s * (0.8 + 0.4 * r.random()))], fill=INK + (200,), width=w)


def roads(cv, d):
    w = max(1, int(cv.L(0.0012)))
    for name, path in G.ROADS.items():
        pts = roughen(path, 0.06, np.random.default_rng(sid(name)), depth=4)
        for u, v, *_ in resample(pts, 0.005):
            x, y = cv.P(u, v)
            d.ellipse([x - w, y - w, x + w, y + w], fill=INK + (200,))


def stipple(cv, d, rng, pts, density, size=0.0007):
    """ink dots inside an outline (ash plains, dry lands)"""
    m = np.asarray(poly_mask(cv, [pts], 4))
    xs = [cv.P(*p)[0] for p in pts]
    ys = [cv.P(*p)[1] for p in pts]
    x0, x1, y0, y1 = max(0, min(xs)), min(cv.W - 1, max(xs)), max(0, min(ys)), min(cv.H - 1, max(ys))
    n = int((x1 - x0) * (y1 - y0) / cv.L(0.01) ** 2 * density)
    r = cv.L(size)
    for _ in range(n):
        x, y = x0 + rng.random() * (x1 - x0), y0 + rng.random() * (y1 - y0)
        if m[int(y / 4), int(x / 4)]:
            d.ellipse([x - r, y - r, x + r, y + r], fill=INK + (int(120 + 80 * rng.random()),))


def tufts(cv, d, rng, pts, density):
    """grass tufts (the plains of Rohan)"""
    m = np.asarray(poly_mask(cv, [pts], 4))
    xs = [cv.P(*p)[0] for p in pts]
    ys = [cv.P(*p)[1] for p in pts]
    x0, x1, y0, y1 = max(0, min(xs)), min(cv.W - 1, max(xs)), max(0, min(ys)), min(cv.H - 1, max(ys))
    n = int((x1 - x0) * (y1 - y0) / cv.L(0.01) ** 2 * density)
    s, w = cv.L(0.003), max(1, int(cv.L(0.0005)))
    for _ in range(n):
        x, y = x0 + rng.random() * (x1 - x0), y0 + rng.random() * (y1 - y0)
        if m[int(y / 4), int(x / 4)]:
            for k in (-0.5, 0, 0.5):
                d.line([(x + k * s * 0.3, y), (x + k * s, y - s * (0.7 + 0.4 * rng.random()))], fill=INK + (170,), width=w)


def tree(fill, ink, x, y, r, kind, rng):
    w = max(1, int(r * 0.15))
    ink.line([(x, y + r * 0.2), (x, y + r * 0.95)], fill=INK + (235,), width=w)
    box = [x - r, y - r * 1.1, x + r, y + r * 0.5]
    fill.ellipse(box, fill=FILL + (255,))
    ink.ellipse(box, outline=INK + (240,), width=w)
    # shade: short strokes on the right
    for k in range(2 if kind != "dark" else 3):
        a = -0.3 + k * 0.45
        cx, cy = x + math.cos(a) * r * 0.55, y - r * 0.3 + math.sin(a) * r * 0.55
        ink.line([(cx, cy - r * 0.2), (cx + r * 0.15, cy + r * 0.15)], fill=INK + (200,), width=max(1, w // 2 + 1))
    if kind == "gold":  # mallorn: a little star on the crown
        ink.line([(x - r * 0.3, y - r * 0.3), (x + r * 0.3, y - r * 0.3)], fill=INK + (200,), width=max(1, w // 2))


def forests(cv, rng, sea_m, fill, ink):
    trees = []
    for name, (pts, kind) in G.FORESTS.items():
        r = np.random.default_rng(sid(name))
        poly = roughen(pts, 0.15, r, depth=4, closed=True)
        m = np.asarray(poly_mask(cv, [poly], 4))
        rad = cv.L(0.0048 if kind != "gold" else 0.0056)
        step = rad * 1.55
        xs = [cv.P(*p)[0] for p in poly]
        ys = [cv.P(*p)[1] for p in poly]
        y, row = min(ys), 0
        while y < max(ys):
            x = min(xs) + (step / 2 if row % 2 else 0)
            while x < max(xs):
                jx, jy = x + (r.random() - 0.5) * step * 0.7, y + (r.random() - 0.5) * step * 0.6
                iy, ix = int(jy / 4), int(jx / 4)
                if 0 <= iy < m.shape[0] and 0 <= ix < m.shape[1] and m[iy, ix] and sea_m[min(cv.H - 1, int(jy)), min(cv.W - 1, int(jx))] < 0.5:
                    trees.append((jy, jx, rad * (0.8 + 0.4 * r.random()), kind))
                x += step
            y += step * 0.72
            row += 1
    return trees


def peak(fill, ink, x, y, h, rng, dark=False):
    w = h * (1.5 + 0.6 * rng.random())
    px, py = x + (rng.random() - 0.5) * w * 0.2, y - h
    left, right = (x - w / 2, y), (x + w / 2, y)
    lsh = (x - w * 0.28 + (rng.random() - 0.5) * w * 0.08, y - h * 0.48)
    rsh = (x + w * 0.27 + (rng.random() - 0.5) * w * 0.08, y - h * 0.5)
    fill.polygon([left, lsh, (px, py), rsh, right], fill=FILL + (255,))
    lw = max(1, int(h * 0.065))
    # hatching on the shaded (right) flank: strokes falling from the ridge line
    n = 5 if dark else 4
    for k in range(1, n + 1):
        t = k / (n + 1)
        a = (px + (rsh[0] - px) * t * 1.6 if t < 0.6 else rsh[0] + (right[0] - rsh[0]) * (t - 0.6) / 0.4,
             py + (rsh[1] - py) * t * 1.6 if t < 0.6 else rsh[1] + (right[1] - rsh[1]) * (t - 0.6) / 0.4)
        L = h * (0.45 - 0.25 * t)
        ink.line([a, (a[0] - w * 0.06, a[1] + L)], fill=INK + (190,), width=max(1, lw // 2))
    if dark:
        for k in range(3):
            a = (px - w * 0.08 * (k + 1), py + h * 0.25 * (k + 1))
            ink.line([a, (a[0] + w * 0.04, a[1] + h * 0.2)], fill=INK + (160,), width=max(1, lw // 2))
    ink.line([left, lsh, (px, py), rsh, right], fill=INK + (245,), width=lw, joint="curve")
    ink.line([(px, py), (px + w * 0.03, py + h * 0.5)], fill=INK + (200,), width=max(1, lw // 2))


def hill(fill, ink, x, y, s, rng):
    w = s * 2.3
    box = [x - w / 2, y - s, x + w / 2, y + s]
    fill.pieslice(box, 180, 360, fill=FILL + (255,))
    ink.arc(box, 190, 350, fill=INK + (225,), width=max(1, int(s * 0.13)))
    for k in range(2):
        cx = x + w * (0.12 + 0.12 * k)
        ink.line([(cx, y - s * (0.75 - 0.25 * k)), (cx - s * 0.1, y - s * 0.15)], fill=INK + (170,), width=max(1, int(s * 0.08)))


def relief(cv, rng):
    items = []
    for name, (ridge, size, width) in G.MOUNTAINS.items():
        r = np.random.default_rng(sid(name))
        rid = roughen(ridge, 0.08, r, depth=4)
        dark = name in ("ephel", "ash", "ephel_s")
        for u, v, du, dv in resample(rid, size * 0.55):
            for _ in range(1 + int(r.random() * 2.2)):
                off = (r.random() - 0.5) * width
                x, y = cv.P(u - dv * off, v + du * off)
                items.append((y, x, "peak", cv.L(size * (0.65 + 0.6 * r.random())), dark))
    for name, (u, v, size) in G.PEAKS.items():
        x, y = cv.P(u, v)
        items.append((y + 1e-3, x, "peak", cv.L(size), name == "doom"))
    for name, ridge in G.HILLS.items():
        r = np.random.default_rng(sid(name))
        for u, v, du, dv in resample(ridge, 0.008):
            for _ in range(1 + int(r.random() * 1.6)):
                off = (r.random() - 0.5) * 0.012
                x, y = cv.P(u - dv * off, v + du * off)
                items.append((y, x, "hill", cv.L(0.0045 * (0.8 + 0.5 * r.random())), False))
    # the empty east and south: low hills and dunes here and there
    r = np.random.default_rng(99)
    # clusters, so they read as hill country and dune fields, not as specks
    for _ in range(9):
        cu, cvv = 0.97 + r.random() * 0.24, 0.10 + r.random() * 0.62
        for _ in range(6 + int(r.random() * 6)):
            x, y = cv.P(cu + (r.random() - 0.5) * 0.06, cvv + (r.random() - 0.5) * 0.04)
            items.append((y, x, "hill", cv.L(0.0065 * (0.8 + 0.4 * r.random())), False))
    for _ in range(7):
        cu, cvv = 0.70 + r.random() * 0.50, 0.87 + r.random() * 0.12
        for _ in range(5 + int(r.random() * 5)):
            x, y = cv.P(cu + (r.random() - 0.5) * 0.07, cvv + (r.random() - 0.5) * 0.03)
            items.append((y, x, "dune", cv.L(0.0075 * (0.8 + 0.4 * r.random())), False))
    return items


def dune(ink, x, y, s):
    ink.arc([x - s * 1.6, y - s * 0.6, x + s * 1.6, y + s * 0.6], 200, 340, fill=INK + (170,), width=max(1, int(s * 0.12)))
    ink.arc([x - s * 0.6, y - s * 0.2, x + s * 2.2, y + s * 0.9], 210, 330, fill=INK + (120,), width=max(1, int(s * 0.1)))


# ------------------------------------------------------------------ drawings of the places
def V(fill, ink, kind, x, y, s, rng):
    """a little ink drawing standing on (x, y), about s px high"""
    w = max(1, int(s * 0.07))
    I, F = INK + (245,), FILL + (255,)

    def box(x0, y0, x1, y1):
        fill.rectangle([x0, y0, x1, y1], fill=F)
        ink.rectangle([x0, y0, x1, y1], outline=I, width=w)

    def roof(x0, x1, y0, h):
        fill.polygon([(x0, y0), ((x0 + x1) / 2, y0 - h), (x1, y0)], fill=F)
        ink.line([(x0, y0), ((x0 + x1) / 2, y0 - h), (x1, y0)], fill=I, width=w, joint="curve")

    def merlons(x0, x1, y0):
        n = max(2, int((x1 - x0) / (s * 0.12)))
        for i in range(n):
            if i % 2 == 0:
                a = x0 + (x1 - x0) * i / n
                box(a, y0 - s * 0.08, a + (x1 - x0) / n, y0)

    if kind == "fort":  # a palisade with a gate
        for i in range(9):
            a = x - s * 0.7 + i * s * 0.175
            fill.polygon([(a, y), (a, y - s * 0.45), (a + s * 0.08, y - s * 0.6), (a + s * 0.16, y - s * 0.45), (a + s * 0.16, y)], fill=F)
            ink.line([(a, y), (a, y - s * 0.45), (a + s * 0.08, y - s * 0.6), (a + s * 0.16, y - s * 0.45), (a + s * 0.16, y)], fill=I, width=w)
        ink.arc([x - s * 0.15, y - s * 0.4, x + s * 0.15, y + s * 0.2], 180, 360, fill=I, width=w)
    elif kind in ("inn", "hut", "farm"):
        bw = s * (0.9 if kind == "inn" else 0.6)
        box(x - bw / 2, y - s * 0.45, x + bw / 2, y)
        roof(x - bw / 2 - s * 0.08, x + bw / 2 + s * 0.08, y - s * 0.45, s * 0.38)
        ink.rectangle([x - s * 0.07, y - s * 0.22, x + s * 0.07, y], outline=I, width=w)
        if kind == "inn":  # the sign on a post
            ink.line([(x + bw / 2 + s * 0.2, y), (x + bw / 2 + s * 0.2, y - s * 0.55), (x + bw / 2 + s * 0.05, y - s * 0.55)], fill=I, width=w)
            box(x + bw / 2 + s * 0.08, y - s * 0.5, x + bw / 2 + s * 0.3, y - s * 0.36)
            ink.line([(x + bw / 2 - s * 0.15, y - s * 0.65), (x + bw / 2 - s * 0.15, y - s * 0.85)], fill=I, width=w)  # chimney
        if kind == "farm":  # furrowed fields beside it
            for i in range(4):
                ink.line([(x + s * 0.45, y - s * 0.05 - i * s * 0.08), (x + s * 1.1, y - s * 0.12 - i * s * 0.08)], fill=INK + (170,), width=max(1, w // 2))
    elif kind == "ruin":  # broken walls and a stump of a tower
        box(x - s * 0.6, y - s * 0.3, x - s * 0.15, y)
        box(x + s * 0.1, y - s * 0.55, x + s * 0.4, y)
        fill.polygon([(x - s * 0.6, y - s * 0.3), (x - s * 0.45, y - s * 0.42), (x - s * 0.3, y - s * 0.33), (x - s * 0.15, y - s * 0.45), (x - s * 0.15, y - s * 0.3)], fill=F)
        ink.line([(x - s * 0.6, y - s * 0.3), (x - s * 0.45, y - s * 0.42), (x - s * 0.3, y - s * 0.33), (x - s * 0.15, y - s * 0.45)], fill=I, width=w)
        ink.line([(x + s * 0.1, y - s * 0.55), (x + s * 0.2, y - s * 0.68), (x + s * 0.28, y - s * 0.6), (x + s * 0.4, y - s * 0.72), (x + s * 0.4, y - s * 0.55)], fill=I, width=w)
        for i in range(3):
            ink.rectangle([x + s * 0.2, y - s * (0.45 - i * 0.15), x + s * 0.28, y - s * (0.38 - i * 0.15)], outline=I, width=max(1, w // 2))
    elif kind in ("city", "town"):
        n = 4 if kind == "city" else 3
        for i in range(n):
            hx = x - s * 0.55 + i * s * 1.1 / (n - 1)
            hh = s * (0.35 + 0.15 * ((i * 7) % 3))
            box(hx - s * 0.16, y - hh, hx + s * 0.16, y)
            roof(hx - s * 0.2, hx + s * 0.2, y - hh, s * 0.22)
        if kind == "city":
            box(x - s * 0.1, y - s * 0.95, x + s * 0.1, y - s * 0.3)
            roof(x - s * 0.14, x + s * 0.14, y - s * 0.95, s * 0.25)
    elif kind == "keep":  # a walled stronghold
        box(x - s * 0.7, y - s * 0.35, x + s * 0.7, y)
        merlons(x - s * 0.7, x + s * 0.7, y - s * 0.35)
        box(x - s * 0.18, y - s * 0.85, x + s * 0.18, y - s * 0.35)
        merlons(x - s * 0.18, x + s * 0.18, y - s * 0.85)
        ink.arc([x - s * 0.12, y - s * 0.24, x + s * 0.12, y + s * 0.0], 180, 360, fill=I, width=w)
    elif kind == "orthanc":  # the ring wall and the black tower
        ink.ellipse([x - s * 0.8, y - s * 0.25, x + s * 0.8, y + s * 0.25], outline=I, width=w)
        fill.polygon([(x - s * 0.12, y), (x - s * 0.08, y - s * 1.2), (x + s * 0.08, y - s * 1.2), (x + s * 0.12, y)], fill=INK + (235,))
        for a in (-1, 1):
            ink.line([(x + a * s * 0.08, y - s * 1.2), (x + a * s * 0.16, y - s * 1.36)], fill=I, width=w)
    elif kind == "tower":  # a watchtower
        box(x - s * 0.13, y - s * 0.9, x + s * 0.13, y)
        merlons(x - s * 0.18, x + s * 0.18, y - s * 0.9)
        ink.line([(x, y - s * 0.98), (x, y - s * 1.25)], fill=I, width=w)
        fill.polygon([(x, y - s * 1.25), (x + s * 0.22, y - s * 1.18), (x, y - s * 1.1)], fill=INK + (220,))
    elif kind == "dark_tower":
        fill.polygon([(x - s * 0.2, y), (x - s * 0.12, y - s * 1.1), (x, y - s * 1.3), (x + s * 0.12, y - s * 1.1), (x + s * 0.2, y)], fill=INK + (240,))
        ink.line([(x - s * 0.3, y - s * 1.0), (x - s * 0.12, y - s * 0.95)], fill=I, width=w)
        ink.line([(x + s * 0.3, y - s * 1.0), (x + s * 0.12, y - s * 0.95)], fill=I, width=w)
    elif kind == "cave":  # a dark mouth under a rock
        fill.polygon([(x - s * 0.7, y), (x - s * 0.4, y - s * 0.55), (x + s * 0.1, y - s * 0.7), (x + s * 0.7, y - s * 0.3), (x + s * 0.8, y)], fill=F)
        ink.line([(x - s * 0.7, y), (x - s * 0.4, y - s * 0.55), (x + s * 0.1, y - s * 0.7), (x + s * 0.7, y - s * 0.3), (x + s * 0.8, y)], fill=I, width=w)
        fill.chord([x - s * 0.28, y - s * 0.4, x + s * 0.28, y + s * 0.4], 180, 360, fill=INK + (240,))
    elif kind == "door":  # a dwarf door: an arch in the rock with pillars
        fill.rectangle([x - s * 0.35, y - s * 0.55, x + s * 0.35, y], fill=F)
        ink.arc([x - s * 0.35, y - s * 0.9, x + s * 0.35, y - s * 0.2], 180, 360, fill=I, width=w)
        ink.line([(x - s * 0.35, y - s * 0.55), (x - s * 0.35, y)], fill=I, width=w)
        ink.line([(x + s * 0.35, y - s * 0.55), (x + s * 0.35, y)], fill=I, width=w)
        fill.chord([x - s * 0.2, y - s * 0.7, x + s * 0.2, y - s * 0.3], 180, 360, fill=INK + (230,))
        fill.rectangle([x - s * 0.2, y - s * 0.5, x + s * 0.2, y], fill=INK + (230,))
        ink.line([(x, y - s * 0.95), (x, y - s * 1.05)], fill=I, width=w)  # a star above
        ink.line([(x - s * 0.06, y - s * 1.0), (x + s * 0.06, y - s * 1.0)], fill=I, width=w)
    elif kind == "barrows":  # mounds with standing stones
        for i, (dx, sz) in enumerate(((-0.5, 0.35), (0.15, 0.5), (0.7, 0.3))):
            cx = x + dx * s
            fill.pieslice([cx - sz * s, y - sz * s * 0.9, cx + sz * s, y + sz * s * 0.9], 180, 360, fill=F)
            ink.arc([cx - sz * s, y - sz * s * 0.9, cx + sz * s, y + sz * s * 0.9], 180, 360, fill=I, width=w)
            ink.rectangle([cx - s * 0.04, y - sz * s * 0.9 - s * 0.22, cx + s * 0.04, y - sz * s * 0.9 + s * 0.02], fill=INK + (240,))
    elif kind == "ruin_city":
        ruined_city(fill, ink, x, y, s, rng)
    elif kind == "ruin_lake":
        ruined_city(fill, ink, x, y, s, rng, tall=True)
    elif kind == "great_tree":
        great_tree(fill, ink, x, y, s, rng)
    elif kind == "willow":
        great_tree(fill, ink, x, y, s, rng, willow=True)
    elif kind == "bigtree":  # one great gnarled tree (the Old Willow, an Ent)
        ink.line([(x, y), (x - s * 0.05, y - s * 0.6)], fill=I, width=w * 3)
        for a in (-1, 1):
            ink.line([(x, y - s * 0.4), (x + a * s * 0.35, y - s * 0.75)], fill=I, width=w * 2)
            ink.line([(x, y), (x + a * s * 0.25, y + s * 0.05)], fill=I, width=w)
        box2 = [x - s * 0.6, y - s * 1.25, x + s * 0.6, y - s * 0.55]
        fill.ellipse(box2, fill=F)
        ink.ellipse(box2, outline=I, width=w)
        for k in range(5):
            a = rng.random() * math.pi
            ink.arc([x - s * 0.45 + k * s * 0.18, y - s * 1.1, x - s * 0.25 + k * s * 0.18, y - s * 0.9], 0, 180, fill=INK + (180,), width=max(1, w // 2))
    elif kind == "web":  # a spider's web
        R = s * 0.7
        cy = y - R
        for k in range(8):
            a = k * math.pi / 4
            ink.line([(x, cy), (x + math.cos(a) * R, cy + math.sin(a) * R)], fill=INK + (220,), width=max(1, w // 2))
        for ring in (0.3, 0.55, 0.8, 1.0):
            pts = [(x + math.cos(k * math.pi / 4) * R * ring, cy + math.sin(k * math.pi / 4) * R * ring) for k in range(9)]
            ink.line(pts, fill=INK + (220,), width=max(1, w // 2))
        ink.ellipse([x + R * 0.2, cy + R * 0.1, x + R * 0.45, cy + R * 0.35], fill=INK + (245,))  # the spider
        for k in range(4):
            for a in (-1, 1):
                ink.line([(x + R * 0.32, cy + R * 0.22), (x + R * 0.32 + a * R * 0.25, cy + R * (0.05 + 0.1 * k))], fill=I, width=max(1, w // 2))
    elif kind == "ships":
        for i, (dx, dy) in enumerate(((-0.5, 0), (0.45, 0.2))):
            cx, cy = x + dx * s, y + dy * s
            fill.chord([cx - s * 0.45, cy - s * 0.25, cx + s * 0.45, cy + s * 0.15], 0, 180, fill=F)
            ink.arc([cx - s * 0.45, cy - s * 0.25, cx + s * 0.45, cy + s * 0.15], 0, 180, fill=I, width=w)
            ink.line([(cx - s * 0.45, cy - s * 0.05), (cx + s * 0.45, cy - s * 0.05)], fill=I, width=w)
            ink.line([(cx, cy - s * 0.05), (cx, cy - s * 0.8)], fill=I, width=w)
            fill.polygon([(cx, cy - s * 0.75), (cx + s * 0.3, cy - s * 0.45), (cx, cy - s * 0.2)], fill=INK + (225,))
            fill.polygon([(cx, cy - s * 0.75), (cx - s * 0.22, cy - s * 0.42), (cx, cy - s * 0.22)], fill=F)
            ink.line([(cx, cy - s * 0.75), (cx - s * 0.22, cy - s * 0.42), (cx, cy - s * 0.22)], fill=I, width=max(1, w // 2))
    elif kind == "swords":  # a battle: two crossed swords
        for a in (-1, 1):
            p0, p1 = (x - a * s * 0.45, y), (x + a * s * 0.45, y - s * 0.9)
            ink.line([p0, p1], fill=I, width=w * 2)
            gx, gy = x - a * s * 0.32, y - s * 0.26
            ink.line([(gx - s * 0.12, gy - a * s * 0.06 * 0), (gx + s * 0.12, gy)], fill=I, width=w * 2)
    elif kind == "bridge":
        ink.arc([x - s * 0.7, y - s * 0.45, x + s * 0.7, y + s * 0.45], 200, 340, fill=I, width=w * 2)
        ink.line([(x - s * 0.7, y - s * 0.12), (x + s * 0.7, y - s * 0.12)], fill=I, width=w)
        for k in range(5):
            px_ = x - s * 0.5 + k * s * 0.25
            ink.line([(px_, y - s * 0.12), (px_, y - s * 0.3)], fill=I, width=max(1, w // 2))
    elif kind == "broken_bridge":
        for a in (-1, 1):
            ink.arc([x + a * s * 0.3 - s * 0.5, y - s * 0.4, x + a * s * 0.3 + s * 0.5, y + s * 0.4], 200 if a < 0 else 270, 270 if a < 0 else 340, fill=I, width=w * 2)
        box(x - s * 0.8, y - s * 0.3, x - s * 0.6, y + s * 0.1)
        box(x + s * 0.6, y - s * 0.3, x + s * 0.8, y + s * 0.1)
    elif kind == "tents":
        for dx in (-0.5, 0.0, 0.5):
            cx = x + dx * s
            fill.polygon([(cx - s * 0.25, y), (cx, y - s * 0.45), (cx + s * 0.25, y)], fill=F)
            ink.line([(cx - s * 0.25, y), (cx, y - s * 0.45), (cx + s * 0.25, y)], fill=I, width=w)
            ink.line([(cx, y - s * 0.45), (cx, y - s * 0.58)], fill=I, width=max(1, w // 2))
    elif kind == "lights":  # will-o'-the-wisps over the marsh
        for k in range(5):
            cx, cy = x + (rng.random() - 0.5) * s * 1.4, y - rng.random() * s * 0.6
            ink.ellipse([cx - s * 0.06, cy - s * 0.12, cx + s * 0.06, cy], outline=I, width=max(1, w // 2))
            ink.line([(cx, cy - s * 0.12), (cx, cy - s * 0.2)], fill=INK + (160,), width=max(1, w // 2))
    elif kind == "flame":
        fill.polygon([(x - s * 0.25, y), (x - s * 0.3, y - s * 0.35), (x - s * 0.1, y - s * 0.7), (x, y - s * 0.45), (x + s * 0.12, y - s * 0.85),
                      (x + s * 0.3, y - s * 0.4), (x + s * 0.25, y)], fill=F)
        ink.line([(x - s * 0.25, y), (x - s * 0.3, y - s * 0.35), (x - s * 0.1, y - s * 0.7), (x, y - s * 0.45), (x + s * 0.12, y - s * 0.85),
                  (x + s * 0.3, y - s * 0.4), (x + s * 0.25, y)], fill=I, width=w)
        for a in (-1, 1):
            ink.line([(x + a * s * 0.4, y), (x - a * s * 0.1, y - s * 0.1)], fill=I, width=w)
    elif kind == "holes":  # hobbit holes: round doors in a hillside
        fill.pieslice([x - s * 0.9, y - s * 0.6, x + s * 0.9, y + s * 0.6], 180, 360, fill=F)
        ink.arc([x - s * 0.9, y - s * 0.6, x + s * 0.9, y + s * 0.6], 180, 360, fill=I, width=w)
        for dx in (-0.4, 0.25):
            ink.ellipse([x + dx * s - s * 0.12, y - s * 0.3, x + dx * s + s * 0.12, y - s * 0.06], outline=I, width=w)
            ink.ellipse([x + dx * s + s * 0.03, y - s * 0.19, x + dx * s + s * 0.07, y - s * 0.15], fill=I)
    elif kind == "stilts":  # Lake-town on its piles
        box(x - s * 0.6, y - s * 0.5, x + s * 0.6, y - s * 0.25)
        for i in range(3):
            roof(x - s * 0.6 + i * s * 0.4, x - s * 0.2 + i * s * 0.4, y - s * 0.5, s * 0.25)
        for i in range(7):
            ink.line([(x - s * 0.55 + i * s * 0.18, y - s * 0.25), (x - s * 0.55 + i * s * 0.18, y + s * 0.05)], fill=I, width=w)
    elif kind == "gate":  # a great gate in a cliff
        box(x - s * 0.5, y - s * 0.7, x + s * 0.5, y)
        fill.chord([x - s * 0.22, y - s * 0.6, x + s * 0.22, y - s * 0.1], 180, 360, fill=INK + (235,))
        fill.rectangle([x - s * 0.22, y - s * 0.35, x + s * 0.22, y], fill=INK + (235,))
        for a in (-1, 1):
            ink.line([(x + a * s * 0.38, y), (x + a * s * 0.38, y - s * 0.6)], fill=I, width=w)
    elif kind == "crown":
        pts = [(x - s * 0.35, y - s * 0.1), (x - s * 0.35, y - s * 0.5), (x - s * 0.18, y - s * 0.3), (x, y - s * 0.6),
               (x + s * 0.18, y - s * 0.3), (x + s * 0.35, y - s * 0.5), (x + s * 0.35, y - s * 0.1)]
        fill.polygon(pts, fill=F)
        ink.line(pts + [pts[0]], fill=I, width=w)
        for dx in (-0.35, 0, 0.35):
            ink.ellipse([x + dx * s - s * 0.04, y - s * (0.6 if dx == 0 else 0.5) - s * 0.08, x + dx * s + s * 0.04, y - s * (0.6 if dx == 0 else 0.5)], fill=I)



def ruined_city(fill, ink, x, y, s, rng, tall=False):
    """a fallen city: a broken tower with arched windows, an arcade whose top has crumbled, columns, one lying
    in the rubble"""
    w = max(1, int(s * 0.06))
    I, F = INK + (245,), FILL + (255,)

    def jag(x0, x1, top, depth, n):
        # a broken top edge from x0 to x1 around `top`
        pts = []
        for i in range(n + 1):
            pts.append((x0 + (x1 - x0) * i / n, top + (rng.random() * depth if 0 < i < n else 0)))
        return pts

    # the tower (tall: the slender tower by the lake)
    tx0, tx1 = x - s * 0.78, x - s * (0.50 if not tall else 0.56)
    th = s * (1.05 if not tall else 1.45)
    top = jag(tx0, tx1, y - th, s * 0.18, 4)
    poly = [(tx0, y)] + top + [(tx1, y)]
    fill.polygon(poly, fill=F)
    ink.line(poly, fill=I, width=w, joint="curve")
    for k in range(2 if not tall else 3):
        wy = y - th * (0.35 + 0.25 * k)
        cx = (tx0 + tx1) / 2
        ink.rectangle([cx - s * 0.045, wy - s * 0.08, cx + s * 0.045, wy + s * 0.06], fill=INK + (225,))
        ink.pieslice([cx - s * 0.045, wy - s * 0.13, cx + s * 0.045, wy - s * 0.03], 180, 360, fill=INK + (225,))
    # stone courses on the shaded side
    for k in range(5):
        yy = y - th * (0.12 + 0.15 * k)
        ink.line([(tx1 - s * 0.08, yy), (tx1, yy)], fill=INK + (150,), width=max(1, w // 2))
    # the arcade: three arches, its top broken lower toward the right
    ax0, ax1 = tx1, x + s * 0.35
    top = [(ax0, y - s * 0.62)] + jag(ax0 + s * 0.05, ax1, y - s * 0.5, s * 0.2, 6)[1:]
    top[-1] = (ax1, y - s * 0.28)
    poly = [(ax0, y)] + top + [(ax1, y)]
    fill.polygon(poly, fill=F)
    ink.line(poly[1:-1], fill=I, width=w, joint="curve")
    ink.line([poly[-2], poly[-1]], fill=I, width=w)
    aw = (ax1 - ax0) / 3
    for k in range(3):
        cx = ax0 + aw * (k + 0.5)
        r = aw * 0.32
        top_y = y - s * (0.36 - 0.06 * k)
        ink.pieslice([cx - r, top_y - r, cx + r, top_y + r], 180, 360, fill=INK + (215,))
        ink.rectangle([cx - r, top_y, cx + r, y], fill=INK + (215,))
    # columns: one standing with its capital, one broken
    for cx, ch in ((x + s * 0.52, s * 0.62), (x + s * 0.72, s * 0.34)):
        fill.rectangle([cx - s * 0.05, y - ch, cx + s * 0.05, y], fill=F)
        ink.rectangle([cx - s * 0.05, y - ch, cx + s * 0.05, y], outline=I, width=w)
        if ch > s * 0.5:
            ink.rectangle([cx - s * 0.09, y - ch - s * 0.05, cx + s * 0.09, y - ch], fill=F, outline=I, width=w)
        else:
            ink.line([(cx - s * 0.05, y - ch), (cx, y - ch - s * 0.05), (cx + s * 0.05, y - ch + s * 0.02)], fill=I, width=w)
    # a fallen drum and rubble along the ground
    ink.ellipse([x + s * 0.82, y - s * 0.09, x + s * 0.92, y + s * 0.01], outline=I, width=w)
    ink.line([(x + s * 0.87, y - s * 0.09), (x + s * 1.15, y - s * 0.07)], fill=I, width=w)
    ink.line([(x + s * 0.87, y + s * 0.01), (x + s * 1.15, y + s * 0.0)], fill=I, width=w)
    for k in range(9):
        rx = x - s * 0.9 + rng.random() * s * 2.1
        rr = s * (0.025 + 0.03 * rng.random())
        ink.ellipse([rx - rr * 1.4, y - rr, rx + rr * 1.4, y + rr * 0.6], fill=F, outline=I, width=max(1, w // 2))
    ink.line([(x - s * 0.95, y + s * 0.02), (x + s * 1.2, y + s * 0.02)], fill=INK + (170,), width=max(1, w // 2))


def great_tree(fill, ink, x, y, s, rng, willow=False):
    """an old great tree: roots flaring from a thick trunk, branches, a crown of many lobes with leaf strokes and
    shade on its right (willow: a low dome with long hanging strands)"""
    w = max(1, int(s * 0.045))
    I, F = INK + (245,), FILL + (255,)
    tw = s * 0.13
    trunk = [(x - tw * 2.2, y), (x - tw * 1.1, y - s * 0.08), (x - tw * 0.8, y - s * 0.55), (x - tw * 0.4, y - s * 0.8),
             (x + tw * 0.5, y - s * 0.8), (x + tw * 0.9, y - s * 0.5), (x + tw * 1.2, y - s * 0.08), (x + tw * 2.4, y)]
    fill.polygon(trunk, fill=F)
    ink.line(trunk, fill=I, width=w, joint="curve")
    # bark: a few long strokes, shade on the right
    for k in range(3):
        bx = x + tw * (-0.4 + 0.45 * k)
        ink.line([(bx, y - s * 0.06), (bx + tw * 0.1, y - s * 0.45)], fill=INK + (170,), width=max(1, w // 2))
    for k in range(4):
        ink.line([(x + tw * 0.75, y - s * (0.1 + 0.1 * k)), (x + tw * 1.0, y - s * (0.14 + 0.1 * k))], fill=INK + (190,), width=max(1, w // 2))
    # roots
    for a in (-1, 1):
        ink.arc([x + a * tw * 1.4 - tw * 1.3, y - tw * 0.6, x + a * tw * 1.4 + tw * 1.3, y + tw * 0.6], 180 if a < 0 else 270, 270 if a < 0 else 360, fill=I, width=w)
    # branches into the crown
    for a, h in ((-1, 0.75), (1, 0.72), (-0.4, 0.95), (0.5, 0.98)):
        ink.line([(x + a * tw * 0.3, y - s * 0.7), (x + a * s * 0.32, y - s * h)], fill=I, width=w * 2)
    # the crown: lobes around an ellipse (a dark rim drawn first, the paper over it: one scalloped outline)
    cx, cy = x, y - s * (1.05 if not willow else 0.95)
    rx, ry = s * (0.62 if not willow else 0.7), s * (0.42 if not willow else 0.32)
    lobes = []
    n = 13
    for i in range(n):
        a = i * 2 * math.pi / n + rng.random() * 0.2
        r = s * (0.17 + 0.06 * rng.random())
        lobes.append((cx + math.cos(a) * rx * 0.82, cy + math.sin(a) * ry * 0.82, r))
    lobes.append((cx, cy, min(rx, ry) * 0.95))
    for lx, ly, r in lobes:
        ink.ellipse([lx - r - w, ly - r - w, lx + r + w, ly + r + w], fill=I)
    for lx, ly, r in lobes:
        fill.ellipse([lx - r, ly - r, lx + r, ly + r], fill=F)
    # leaf strokes inside, denser on the shaded right side
    for k in range(26):
        a = rng.random() * 2 * math.pi
        rr = math.sqrt(rng.random())
        lx, ly = cx + math.cos(a) * rx * 0.8 * rr, cy + math.sin(a) * ry * 0.8 * rr
        if lx < cx - rx * 0.2 and rng.random() < 0.6:
            continue
        r = s * 0.06
        ink.arc([lx - r, ly - r, lx + r, ly + r], 20, 160, fill=INK + (190,), width=max(1, w // 2 + 1))
    if willow:
        for k in range(15):
            hx = cx - rx * 0.95 + k * rx * 1.9 / 14
            top = cy + ry * (0.3 + 0.5 * (1 - ((hx - cx) / rx) ** 2) ** 0.5)
            ink.line([(hx, top), (hx + s * 0.02, top + s * (0.25 + 0.15 * rng.random()))], fill=INK + (210,), width=max(1, w // 2 + 1))


# what to draw at the adventures' places (u, v, kind, size in v) - the stories, not their markers
VIGNETTES = {
    "south_downs_fort": (0.300, 0.304, "fort", 0.020),
    "bree_ranger": (0.274, 0.262, "town", 0.016),
    "forsaken_inn": (0.297, 0.250, "inn", 0.016),
    "fornost": (0.252, 0.152, "ruin_city", 0.028),
    "troll_cave": (0.336, 0.196, "cave", 0.018),
    "brandywine_crossing": (0.212, 0.205, "bridge", 0.014),
    "annuminas": (0.168, 0.162, "ruin_lake", 0.024),
    "barrows": (0.246, 0.290, "barrows", 0.016),
    "old_willow": (0.236, 0.274, "willow", 0.022),
    "michel_delving": (0.176, 0.258, "holes", 0.016),
    "eastfarthing": (0.205, 0.252, "farm", 0.012),
    "trading_post": (0.150, 0.250, "hut", 0.013),
    "broadbeams": (0.100, 0.312, "door", 0.018),
    "ember_crown": (0.104, 0.352, "crown", 0.016),
    "secluded_glade": (0.118, 0.372, "flame", 0.012),
    "nalkas_nest": (0.622, 0.364, "web", 0.024),
    "thranduil": (0.665, 0.126, "gate", 0.016),
    "river_running": (0.752, 0.234, "swords", 0.016),
    "moria_west": (0.418, 0.402, "door", 0.020),
    "moria_east": (0.434, 0.412, "gate", 0.016),
    "erebor": (0.720, 0.110, "gate", 0.016),
    "dale": (0.712, 0.130, "city", 0.020),
    "lake_town": (0.726, 0.158, "stilts", 0.016),
    "dale_farms": (0.742, 0.142, "farm", 0.012),
    "orthanc": (0.415, 0.576, "orthanc", 0.026),
    "mering": (0.574, 0.662, "bridge", 0.012),
    "umbar_ships": (0.555, 0.990, "ships", 0.022),
    "anduin_mouths": (0.600, 0.880, "ships", 0.018),
    "rohan_plains": (0.548, 0.634, "swords", 0.016),
    "dunharrow": (0.506, 0.688, "keep", 0.016),
    "osgiliath": (0.624, 0.702, "broken_bridge", 0.018),
    "calembel": (0.526, 0.748, "town", 0.016),
    "fangorn_ent": (0.466, 0.574, "great_tree", 0.034),
    "adorn": (0.416, 0.658, "swords", 0.014),
    "pelargir": (0.620, 0.792, "city", 0.018),
    "entwash_inn": (0.530, 0.636, "inn", 0.014),
    "helms_deep": (0.445, 0.648, "keep", 0.020),
    "dunland": (0.390, 0.532, "tents", 0.016),
    "dead_marshes": (0.620, 0.560, "lights", 0.018),
    "brown_lands": (0.580, 0.492, "tower", 0.016),
    "rohan_east": (0.582, 0.600, "tower", 0.014),
    "edoras": (0.505, 0.666, "keep", 0.018),
    "minas_tirith": (0.610, 0.706, "city", 0.024),
    "minas_morgul": (0.664, 0.704, "dark_tower", 0.020),
    "barad_dur": (0.765, 0.628, "dark_tower", 0.030),
    "dol_guldur": (0.600, 0.432, "dark_tower", 0.020),
    "rivendell": (0.405, 0.227, "town", 0.018),
    "grey_havens": (0.118, 0.256, "ships", 0.016),
    "hobbiton": (0.190, 0.246, "holes", 0.014),
    "tharbad": (0.316, 0.450, "broken_bridge", 0.014),
    "dol_amroth": (0.500, 0.834, "keep", 0.018),
    "carn_dum": (0.400, 0.077, "dark_tower", 0.018),
    "morannon": (0.666, 0.596, "gate", 0.016),
    "weathertop": (0.312, 0.236, "ruin", 0.012),
}


# ------------------------------------------------------------------ writing
def text(lay, x, y, s, angle, size, style="regular", track=0.0, alpha=245):
    """a name written centred on (x, y), turned by angle (degrees, clockwise), letter-spaced by track (em)"""
    f = font(style, max(8, int(size)))
    halo = max(2, int(size * 0.08))
    chars = list(s)
    widths = [f.getlength(c) for c in chars]
    tw = sum(widths) + track * size * (len(chars) - 1)
    pad = int(size * 0.6) + halo
    im = Image.new("RGBA", (int(tw) + 2 * pad, int(size * 1.5) + 2 * pad), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    cx = pad
    for c, cw in zip(chars, widths):
        d.text((cx, im.height / 2), c, font=f, fill=INK + (alpha,), anchor="lm", stroke_width=halo, stroke_fill=PAPER + (110,))
        cx += cw + track * size
    # the halo under the letters only: draw the letters again without it
    cx = pad
    for c, cw in zip(chars, widths):
        d.text((cx, im.height / 2), c, font=f, fill=INK + (alpha,), anchor="lm")
        cx += cw + track * size
    if angle:
        im = im.rotate(-angle, expand=True, resample=Image.BICUBIC)
    lay.alpha_composite(im, (int(x - im.width / 2), int(y - im.height / 2)))


def label_style(key):
    regions = {"ERIADOR", "LINDON", "ANGMAR", "FORODWAITH", "ENEDWAITH", "MINHIRIATH", "ROHAN", "GONDOR", "MORDOR", "RHUN", "HARAD"}
    water = {"SEA", "ANDUIN", "BRANDYWINE", "GREYFLOOD", "RUNNING", "RHUN_SEA", "EVENDIM", "BELFALAS"}
    if key in regions:
        return "regular", 0.35
    if key in water:
        return "italic", 0.05
    if key in {"MISTY", "BLUE", "WHITE", "GREY", "MIRKWOOD", "LORIEN", "FANGORN", "BROWN_LANDS", "DEAD_MARSHES", "SHIRE", "DUNLAND"}:
        return "italic", 0.12
    return "regular", 0.02


# the names that follow a line: a river or a ridge (its shape moved through the name's place), a path of their
# own, or a gentle arc (the big regions); the rest are written straight
FOLLOW = {
    "ANDUIN": ("river", "anduin"), "BRANDYWINE": ("river", "baranduin"), "GREYFLOOD": ("river", "gwathlo"),
    "RUNNING": ("river", "celduin"), "MISTY": ("ridge", "misty"), "BLUE": ("ridge", "luin_s"), "WHITE": ("ridge", "white"),
    "GREY": ("ridge", "grey"), "MIRKWOOD": ("path", [(0.612, 0.380), (0.626, 0.290), (0.644, 0.200)]),
    "LINDON": ("path", [(0.071, 0.380), (0.078, 0.320), (0.080, 0.260)]),
}
ARC = {"ERIADOR": 0.10, "ROHAN": 0.10, "GONDOR": 0.10, "MORDOR": 0.08, "RHUN": 0.10, "HARAD": 0.08, "ANGMAR": 0.10,
       "ENEDWAITH": 0.10, "MINHIRIATH": 0.08, "FORODWAITH": 0.06, "SEA": 0.12, "SHIRE": 0.10, "BROWN_LANDS": 0.06,
       "DEAD_MARSHES": 0.06, "DUNLAND": 0.08}


def _measure(pts):
    acc = [0.0]
    for i in range(1, len(pts)):
        acc.append(acc[-1] + math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]))
    return acc


def _at(pts, acc, s):
    s = max(0.0, min(acc[-1], s))
    i = max(1, next((k for k in range(1, len(acc)) if acc[k] >= s), len(acc) - 1))
    seg = acc[i] - acc[i - 1] or 1e-9
    t = (s - acc[i - 1]) / seg
    (x0, y0), (x1, y1) = pts[i - 1], pts[i]
    return x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, math.atan2(y1 - y0, x1 - x0)


def label_path(cv, key, x, y, width):
    """the line a name is written along, in px, through (x, y), read left to right (or upward); None: straight"""
    if key in FOLLOW:
        kind, src = FOLLOW[key]
        if kind == "river":
            path, *_ = G.RIVERS[src]
            pts = chaikin(roughen(path, 0.16, np.random.default_rng(sid(src)), depth=4), 4)
            pts = chaikin(pts[::14] + [pts[-1]], 4)  # the river's bends, without its wiggles
        elif kind == "ridge":
            pts = chaikin(G.MOUNTAINS[src][0], 4)
        else:
            pts = chaikin(src, 4)
        px = [cv.P(*p) for p in pts]
        if kind != "path":
            # moved so that the point of the line nearest to the name passes through it
            j = min(range(len(px)), key=lambda k: (px[k][0] - x) ** 2 + (px[k][1] - y) ** 2)
            dx, dy = x - px[j][0], y - px[j][1]
            px = [(a + dx, b + dy) for a, b in px]
        return px
    if key in ARC:
        b = ARC[key]
        hw = width * 0.75
        return [(x + t * hw, y + b * hw * t * t) for t in np.linspace(-1, 1, 41)]
    return None


def text_along(lay, pts, x, y, s, size, style, track, alpha=245):
    """a name written along a line: each letter turned to the line, centred on the point of the line nearest (x, y)"""
    # read left to right; a line going mostly up or down is read upward (judged where the name sits)
    j = min(range(len(pts)), key=lambda k: (pts[k][0] - x) ** 2 + (pts[k][1] - y) ** 2)
    p, q = pts[max(0, j - 3)], pts[min(len(pts) - 1, j + 3)]
    a0 = math.atan2(q[1] - p[1], q[0] - p[0])
    if math.cos(a0) < -0.3 or (abs(math.cos(a0)) <= 0.3 and math.sin(a0) > 0):
        pts = pts[::-1]
    # a name longer than its line goes on straight past the line's ends
    ext = size * len(s)
    (x0, y0), (x1, y1) = pts[0], pts[min(3, len(pts) - 1)]
    a = math.atan2(y1 - y0, x1 - x0)
    head = (x0 - math.cos(a) * ext, y0 - math.sin(a) * ext)
    (x0, y0), (x1, y1) = pts[max(0, len(pts) - 4)], pts[-1]
    a = math.atan2(y1 - y0, x1 - x0)
    tail = (x1 + math.cos(a) * ext, y1 + math.sin(a) * ext)
    pts = [head] + list(pts) + [tail]
    acc = _measure(pts)
    j = min(range(len(pts)), key=lambda k: (pts[k][0] - x) ** 2 + (pts[k][1] - y) ** 2)
    s0 = acc[j]
    f = font(style, max(8, int(size)))
    halo = max(2, int(size * 0.08))
    widths = [f.getlength(c) for c in s]
    total = sum(widths) + track * size * (len(s) - 1)
    pos = s0 - total / 2
    for c, cw in zip(s, widths):
        if c != " ":
            px, py, a = _at(pts, acc, pos + cw / 2)
            g = int(size * 1.6) + 2 * halo
            im = Image.new("RGBA", (g, g), (0, 0, 0, 0))
            d = ImageDraw.Draw(im)
            d.text((g / 2, g / 2), c, font=f, fill=INK + (alpha,), anchor="mm", stroke_width=halo, stroke_fill=PAPER + (110,))
            d.text((g / 2, g / 2), c, font=f, fill=INK + (alpha,), anchor="mm")
            im = im.rotate(-math.degrees(a), resample=Image.BICUBIC)
            lay.alpha_composite(im, (int(px - g / 2), int(py - g / 2)))
        pos += cw + track * size


def write_names(cv, lay, keys, alpha=245):
    for key in keys:
        u, v, size, angle, en, _ru, _it = G.LABELS[key]
        style, track = label_style(key)
        x, y = cv.P(u, v)
        px_size = size * cv.s
        f = font(style, max(8, int(px_size)))
        width = sum(f.getlength(c) for c in en) + track * px_size * (len(en) - 1)
        path = label_path(cv, key, x, y, width)
        if path:
            text_along(lay, path, x, y, en, px_size, style, track, alpha)
        else:
            text(lay, x, y, en, angle, px_size, style, track, alpha)


def cartouche(cv, lay, fill, ink):
    """the title in the western sea"""
    x, y = cv.P(-0.115, 0.14)
    w, h = cv.L(0.25), cv.L(0.095)
    box = [x - w / 2, y - h / 2, x + w / 2, y + h / 2]
    fill.rectangle(box, fill=PAPER + (230,))
    ink.rectangle(box, outline=INK + (240,), width=max(2, int(cv.L(0.002))))
    m = cv.L(0.006)
    ink.rectangle([box[0] + m, box[1] + m, box[2] - m, box[3] - m], outline=INK + (200,), width=max(1, int(cv.L(0.0009))))
    text(lay, x, y - h * 0.16, "MIDDLE-EARTH", 0, cv.L(0.021), "regular", 0.16)
    text(lay, x, y + h * 0.24, "the North-West, at the end of the Third Age", 0, cv.L(0.0105), "italic", 0.0)


def compass(cv, ink, fill, u, v, size):
    x, y = cv.P(u, v)
    R = cv.L(size)
    w = max(1, int(R * 0.02))
    ink.ellipse([x - R * 0.72, y - R * 0.72, x + R * 0.72, y + R * 0.72], outline=INK + (220,), width=w)
    ink.ellipse([x - R * 0.66, y - R * 0.66, x + R * 0.66, y + R * 0.66], outline=INK + (160,), width=w)
    for k in range(16):
        a = k * math.pi / 8
        L = R * (1.0 if k % 4 == 0 else 0.62 if k % 2 == 0 else 0.42)
        bw = R * (0.13 if k % 4 == 0 else 0.09)
        tip = (x + math.sin(a) * L, y - math.cos(a) * L)
        lft = (x + math.sin(a - math.pi / 2) * bw, y - math.cos(a - math.pi / 2) * bw)
        rgt = (x + math.sin(a + math.pi / 2) * bw, y - math.cos(a + math.pi / 2) * bw)
        fill.polygon([(x, y), lft, tip], fill=FILL + (255,))
        ink.polygon([(x, y), lft, tip], outline=INK + (230,))
        ink.polygon([(x, y), tip, rgt], fill=INK + (230,), outline=INK + (230,))
    f = font("regular", int(R * 0.28))
    ink.text((x, y - R * 1.12), "N", font=f, fill=INK + (240,), anchor="mm")


def ship(cv, fill, ink, u, v, size, rng):
    x, y = cv.P(u, v)
    V(fill, ink, "ships", x, y, cv.L(size), rng)


# ------------------------------------------------------------------ the whole map
def render(W, H, seed=7):
    cv = Canvas(W, H)
    rng = np.random.default_rng(seed)
    img = parchment(cv, rng)

    lay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(lay)
    marshes(cv, d)
    roads(cv, d)
    rivers(cv, d)
    for pts, _mul in G.TINTS[:2]:  # Mordor's ash, the Brown Lands: stippled
        stipple(cv, d, rng, pts, 1.2 if _mul[0] < 0.8 else 0.5)
    tufts(cv, d, rng, G.TINTS[3][0], 0.25)
    composite(img, lay)

    lay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ink = ImageDraw.Draw(lay)
    sea_m = sea(cv, img, ink)
    waves(cv, ink, rng, sea_m)
    composite(img, lay)

    # the biggest names (regions, the sea) lie under everything drawn on the land, a little paler: the bigger a
    # name, the further back it is
    order = sorted(G.LABELS, key=lambda k: -G.LABELS[k][2])
    big = [k for k in order if G.LABELS[k][2] >= 34]
    lay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    write_names(cv, lay, big, alpha=215)
    composite(img, lay)

    # everything that stands on the land, back to front: its paper fill then its ink, one by one
    trees = forests(cv, rng, sea_m, None, None)
    items = [(y, x, "tree", r, k) for y, x, r, k in trees] + relief(cv, rng)
    for name, (u, v, kind, size) in VIGNETTES.items():
        x, y = cv.P(u, v)
        items.append((y + 0.5, x, "v:" + kind, cv.L(size), None))
    items.sort(key=lambda t: t[0])
    lay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    dl = ImageDraw.Draw(lay)
    for y, x, kind, s, extra in items:
        if kind == "tree":
            tree(dl, dl, x, y, s, extra, rng)
        elif kind == "peak":
            peak(dl, dl, x, y, s, rng, extra)
        elif kind == "hill":
            hill(dl, dl, x, y, s, rng)
        elif kind == "dune":
            dune(dl, x, y, s)
        else:
            V(dl, dl, kind[2:], x, y, s, rng)
    # the fire of Mount Doom: ink rays
    x, y = cv.P(*G.PEAKS["doom"][:2])
    h = cv.L(G.PEAKS["doom"][2])
    for k in range(9):
        a = -math.pi / 2 + (k - 4) * 0.22
        dl.line([(x + math.cos(a) * h * 0.25, y - h + math.sin(a) * h * 0.25), (x + math.cos(a) * h * 0.6, y - h + math.sin(a) * h * 0.6)],
                fill=INK + (200,), width=max(1, int(h * 0.05)))
    ship(cv, dl, dl, -0.05, 0.47, 0.024, rng)
    ship(cv, dl, dl, 0.30, 0.86, 0.020, rng)
    compass(cv, dl, dl, -0.10, 0.80, 0.075)
    cartouche(cv, lay, dl, dl)
    composite(img, lay)

    # the names
    lay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    write_names(cv, lay, [k for k in order if k not in big])
    d = ImageDraw.Draw(lay)
    frame(cv, img, d)
    composite(img, lay)
    return Image.fromarray(np.clip(img, 0, 255).astype(np.uint8), "RGB")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--width", type=int, default=8192)
    ap.add_argument("--out", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "data", "maps", "middle-earth-ink.jpg"))
    a = ap.parse_args()
    W = a.width
    img = render(W, W * 9 // 16)
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    img.save(a.out, quality=92, optimize=True, progressive=True) if a.out.lower().endswith((".jpg", ".jpeg")) else img.save(a.out, optimize=True)
    print(a.out, img.size)


if __name__ == "__main__":
    main()
