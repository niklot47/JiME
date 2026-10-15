# Unity ParticleSystem -> compact JSON for the app's particle player (local only, FFG content).
# Curves are sampled at 9 points (0..1), "minmax" values become [min, max] (constant / random between two constants)
# or {"c": [samples], "c2": [samples]} for curves (times their multiplier).

def _curve_eval(curve, t):
    ks = curve.get("m_Curve") or []
    if not ks:
        return 1.0
    if t <= ks[0]["time"]:
        return ks[0]["value"]
    for a, b in zip(ks, ks[1:]):
        if t <= b["time"]:
            dt = b["time"] - a["time"]
            if dt <= 0:
                return b["value"]
            u = (t - a["time"]) / dt
            # cubic Hermite with the key tangents
            m0, m1 = a.get("outSlope", 0) * dt, b.get("inSlope", 0) * dt
            u2, u3 = u * u, u * u * u
            return (2 * u3 - 3 * u2 + 1) * a["value"] + (u3 - 2 * u2 + u) * m0 + (-2 * u3 + 3 * u2) * b["value"] + (u3 - u2) * m1
    return ks[-1]["value"]


def samples(curve, mul=1.0, n=9):
    return [round(_curve_eval(curve, i / (n - 1)) * mul, 4) for i in range(n)]


def minmax(x):
    """MinMaxCurve: state 0 constant, 1 curve, 2 random between curves, 3 random between constants"""
    if not isinstance(x, dict):
        return [x, x]
    st = x.get("minMaxState", 0)
    s = x.get("scalar", 0.0)
    if st == 0:
        return [round(s, 4), round(s, 4)]
    if st == 3:
        return [round(x.get("minScalar", 0.0), 4), round(s, 4)]
    out = {"c": samples(x["maxCurve"], s)}
    if st == 2:
        out["c2"] = samples(x["minCurve"], s)
    return out


def gradient(g):
    n_c, n_a = g.get("m_NumColorKeys", 2), g.get("m_NumAlphaKeys", 2)
    cs = [[round(g[f"ctime{i}"] / 65535, 4), g[f"key{i}"]["r"], g[f"key{i}"]["g"], g[f"key{i}"]["b"]] for i in range(n_c)]
    al = [[round(g[f"atime{i}"] / 65535, 4), g[f"key{i}"]["a"]] for i in range(n_a)]
    return {"c": cs, "a": al}


def min_max_gradient(x):
    st = x.get("minMaxState", 0)
    col = lambda c: [round(c["r"], 4), round(c["g"], 4), round(c["b"], 4), round(c["a"], 4)]
    if st == 0:
        return {"k": [col(x["maxColor"])]}
    if st == 2:
        return {"k": [col(x["minColor"]), col(x["maxColor"])]}
    if st == 1:
        return {"g": gradient(x["maxGradient"])}
    return {"g": gradient(x["maxGradient"]), "g2": gradient(x["minGradient"])}


def particle_params(t, r):
    """t: ParticleSystem typetree, r: ParticleSystemRenderer typetree (or None)"""
    im, em, sh = t["InitialModule"], t["EmissionModule"], t["ShapeModule"]
    p = {
        "dur": t.get("lengthInSec", 5.0), "loop": bool(t.get("looping", True)), "prewarm": bool(t.get("prewarm", False)),
        "delay": minmax(t.get("startDelay", 0)), "speed": t.get("simulationSpeed", 1.0), "world": t.get("moveWithTransform", 0) == 1,
        "scaling": t.get("scalingMode", 1), "max": im.get("maxNumParticles", 1000),
        "life": minmax(im["startLifetime"]), "size": minmax(im["startSize"]), "v0": minmax(im["startSpeed"]),
        "rot": minmax(im["startRotation"]), "color": min_max_gradient(im["startColor"]), "grav": minmax(im["gravityModifier"]),
        "rate": minmax(em["rateOverTime"]),
    }
    bursts = []
    for b in em.get("m_Bursts") or []:
        cnt = b.get("countCurve", {}) if isinstance(b.get("countCurve"), dict) else {}
        bursts.append([b.get("time", 0), cnt.get("scalar", b.get("minCount", 0)), b.get("cycleCount", 1), b.get("repeatInterval", 0.01)])
    if bursts:
        p["bursts"] = bursts
    if sh.get("enabled"):
        rad = sh.get("radius")
        p["shape"] = {"type": sh.get("type", 4), "radius": rad.get("value", 1) if isinstance(rad, dict) else rad, "angle": sh.get("angle", 25),
                      "arc": (sh.get("arc") or {}).get("value", 360) if isinstance(sh.get("arc"), dict) else sh.get("arc", 360),
                      "len": sh.get("length", 5), "thick": sh.get("radiusThickness", 1),
                      "pos": [sh["m_Position"]["x"], sh["m_Position"]["y"], sh["m_Position"]["z"]],
                      "rot": [sh["m_Rotation"]["x"], sh["m_Rotation"]["y"], sh["m_Rotation"]["z"]],
                      "scale": [sh["m_Scale"]["x"], sh["m_Scale"]["y"], sh["m_Scale"]["z"]],
                      "rnd": sh.get("randomDirectionAmount", 0), "sph": sh.get("sphericalDirectionAmount", 0)}
    if t["ColorModule"]["enabled"]:
        p["col"] = min_max_gradient(t["ColorModule"]["gradient"])
    if t["SizeModule"]["enabled"]:
        p["sol"] = minmax(t["SizeModule"]["curve"])
    if t["RotationModule"]["enabled"]:
        p["rol"] = minmax(t["RotationModule"]["curve"])
    vm = t["VelocityModule"]
    if vm["enabled"]:
        p["vol"] = {"x": minmax(vm["x"]), "y": minmax(vm["y"]), "z": minmax(vm["z"]), "world": bool(vm.get("inWorldSpace"))}
    fm = t["ForceModule"]
    if fm["enabled"]:
        p["force"] = {"x": minmax(fm["x"]), "y": minmax(fm["y"]), "z": minmax(fm["z"]), "world": bool(fm.get("inWorldSpace"))}
    nm = t["NoiseModule"]
    if nm["enabled"]:
        p["noise"] = {"strength": minmax(nm["strength"]), "freq": nm.get("frequency", 0.5), "scroll": minmax(nm.get("scrollSpeed", 0))}
    uv = t["UVModule"]
    if uv["enabled"] and uv.get("mode", 0) == 0:
        p["sheet"] = {"x": uv.get("tilesX", 1), "y": uv.get("tilesY", 1), "frame": minmax(uv["frameOverTime"]), "start": minmax(uv.get("startFrame", 0)),
                      "cycles": uv.get("cycles", 1), "anim": uv.get("animationType", 0), "row": uv.get("rowIndex", 0)}
    if r is not None:
        p["render"] = {"mode": r.get("m_RenderMode", 0), "len": r.get("m_LengthScale", 2), "vel": r.get("m_VelocityScale", 0),
                       "maxSize": r.get("m_MaxParticleSize", 0.5), "minSize": r.get("m_MinParticleSize", 0),
                       "align": r.get("m_RenderAlignment", 0), "pivot": [r.get("m_Pivot", {}).get(k, 0) for k in "xyz"] if isinstance(r.get("m_Pivot"), dict) else [0, 0, 0]}
    if im.get("rotation3D"):
        p["rot3"] = [minmax(im.get("startRotationX", 0)), minmax(im.get("startRotationY", 0)), minmax(im["startRotation"])]
    if im.get("size3D"):
        p["size3"] = [minmax(im["startSize"]), minmax(im.get("startSizeY", 0)), minmax(im.get("startSizeZ", 0))]
    return p
