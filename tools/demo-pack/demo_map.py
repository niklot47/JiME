"""
The demo campaign's map: a parchment with a river, its ford, hills and woods (all drawn here), and where each adventure
happens on it. The campaign map format (images/campaigns/maps.json, merged over the packs per campaign):

  { "<CampaignModel id>": { "image": "<pack path>", "locations": { "<AdventureModel id>": [x, y] }, "zoom": 2.6 } }

x, y in 0..1 of the picture (0, 0 = top left). zoom: how much the map is enlarged on the chosen adventure.
"labels": [{"key": <text key>, "x", "y", "size": <height in 1/1000 of the picture's height>, "angle": degrees}] names on
the map, drawn by the app in the player's language.
"""
import math

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

INK = (74, 52, 30)


def _noise(w, h, cell, seed):
    rng = np.random.default_rng(seed)
    small = rng.random((h // cell + 2, w // cell + 2)).astype(np.float32)
    img = Image.fromarray((small * 255).astype(np.uint8)).resize((w + 2 * cell, h + 2 * cell), Image.BICUBIC)
    return np.asarray(img.crop((cell, cell, cell + w, cell + h)), np.float32) / 255


def parchment(w, h):
    n = _noise(w, h, 160, 1) * 0.5 + _noise(w, h, 48, 2) * 0.3 + _noise(w, h, 12, 3) * 0.2
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    edge = np.minimum(np.minimum(xx, w - 1 - xx) / (0.18 * w), np.minimum(yy, h - 1 - yy) / (0.18 * h))
    burn = np.clip(edge, 0, 1) ** 0.6
    base = np.array([226, 200, 150], np.float32)
    rgb = base * (0.82 + 0.22 * n[..., None]) * (0.55 + 0.45 * burn[..., None])
    return Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8), "RGB")


def _curve(points, steps=60):
    """Catmull-Rom through the points"""
    out = []
    p = [points[0]] + points + [points[-1]]
    for i in range(1, len(p) - 2):
        p0, p1, p2, p3 = p[i - 1], p[i], p[i + 1], p[i + 2]
        for s in range(steps):
            t = s / steps
            out.append(tuple(0.5 * ((2 * p1[k]) + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t * t
                                    + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t ** 3) for k in (0, 1)))
    out.append(points[-1])
    return out


def draw_map(w, h):
    """The picture without words: the names are labels of maps.json (texts, so they are translated)"""
    img = parchment(w, h)
    d = ImageDraw.Draw(img)
    S = lambda x, y: (x * w, y * h)  # noqa: E731
    # the river from the hills in the north to the south-east, the ford where the road crosses it
    river = _curve([S(0.12, 0.0), S(0.2, 0.2), S(0.33, 0.38), S(0.42, 0.58), S(0.55, 0.72), S(0.75, 0.82), S(1.0, 0.9)])
    for wid, col in ((26, (150, 170, 170)), (14, (120, 150, 160))):
        d.line(river, fill=col, width=wid, joint="curve")
    d.line(river, fill=INK, width=3, joint="curve")
    # the road
    road = _curve([S(0.0, 0.62), S(0.2, 0.6), S(0.4, 0.55), S(0.52, 0.45), S(0.66, 0.36), S(0.85, 0.3), S(1.0, 0.24)])
    for i in range(0, len(road) - 1, 3):
        d.line([road[i], road[i + 1]], fill=(110, 80, 50), width=5)
    # hills in the north-east, woods in the south-west
    rng = np.random.default_rng(5)
    for _ in range(46):
        x, y = rng.uniform(0.55, 0.95) * w, rng.uniform(0.06, 0.24) * h
        s = rng.uniform(30, 55)
        d.arc([x - s, y - s * 0.6, x + s, y + s * 0.6], 200, 340, fill=INK, width=4)
    for _ in range(70):
        x, y = rng.uniform(0.05, 0.35) * w, rng.uniform(0.7, 0.95) * h
        s = rng.uniform(14, 24)
        d.polygon([(x, y - s * 1.6), (x - s, y), (x + s, y)], outline=INK, width=3)
        d.line([(x, y), (x, y + s * 0.5)], fill=INK, width=3)
    # a camp of the bandits on the hill side
    cx, cy = S(0.69, 0.33)
    for dx in (-40, 0, 40):
        d.polygon([(cx + dx, cy - 36), (cx + dx - 26, cy + 10), (cx + dx + 26, cy + 10)], outline=INK, width=4)
    # a compass
    kx, ky, r = S(0.9, 0.68)[0], S(0.9, 0.68)[1], 90
    for a in range(0, 360, 90):
        t = math.radians(a)
        d.polygon([(kx + r * math.sin(t), ky - r * math.cos(t)), (kx + 18 * math.cos(t), ky + 18 * math.sin(t)),
                   (kx - 18 * math.cos(t), ky - 18 * math.sin(t))], fill=INK)
    d.ellipse([kx - r * 0.55, ky - r * 0.55, kx + r * 0.55, ky + r * 0.55], outline=INK, width=4)
    return img.filter(ImageFilter.GaussianBlur(0.6))


LABELS = [
    {"key": "MAP_DEMO_GREYFORD", "x": 0.5, "y": 0.62, "size": 42},
    {"key": "MAP_DEMO_RIVER", "x": 0.25, "y": 0.27, "size": 30, "angle": 52},
    {"key": "MAP_DEMO_HILLS", "x": 0.76, "y": 0.06, "size": 34},
]
LOCATIONS = {9101: [0.43, 0.555], 9102: [0.69, 0.32]}
