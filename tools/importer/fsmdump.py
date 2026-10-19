# Decode PlayMakerFSM ActionData into readable actions with named parameters
import struct, json, os
from jload import gen, ROOT
from ttread import build, R
PDT = {0:'Integer',1:'Boolean',2:'Float',3:'String',4:'Color',5:'ObjectReference',6:'LayerMask',7:'Enum',8:'Vector2',9:'Vector3',10:'Vector4',11:'Rect',12:'Array',13:'Character',14:'AnimationCurve',15:'FsmFloat',16:'FsmInt',17:'FsmBool',18:'FsmString',19:'FsmGameObject',20:'FsmOwnerDefault',21:'FunctionCall',22:'FsmAnimationCurve',23:'FsmEvent',24:'FsmObject',25:'FsmColor',26:'Unsupported',27:'GameObject',28:'FsmVector3',29:'LayoutOption',30:'FsmRect',31:'FsmEventTarget',32:'FsmMaterial',33:'FsmTexture',34:'Quaternion',35:'FsmQuaternion',36:'FsmProperty',37:'FsmVector2',38:'FsmTemplateControl',39:'FsmVar',40:'CustomClass',41:'FsmArray',42:'FsmEnum'}
LIST = {'FsmFloat':'fsmFloatParams','FsmInt':'fsmIntParams','FsmBool':'fsmBoolParams','FsmString':'fsmStringParams',
        'FsmGameObject':'fsmGameObjectParams','FsmOwnerDefault':'fsmOwnerDefaultParams','FunctionCall':'functionCallParams',
        'FsmAnimationCurve':'animationCurveParams','FsmObject':'fsmObjectParams','FsmMaterial':'fsmObjectParams','FsmTexture':'fsmObjectParams',
        'FsmColor':'fsmColorParams','FsmVector3':'fsmVector3Params','FsmVector2':'fsmVector2Params','FsmRect':'fsmRectParams',
        'FsmQuaternion':'fsmQuaternionParams','FsmEventTarget':'fsmEventTargetParams','FsmProperty':'fsmPropertyParams',
        'LayoutOption':'layoutOptionParams','FsmTemplateControl':'fsmTemplateControlParams','FsmVar':'fsmVarParams',
        'FsmArray':'fsmArrayParams','FsmEnum':'fsmEnumParams','String':'stringParams',
        'ObjectReference':'unityObjectParams','GameObject':'unityObjectParams','FsmEvent':'stringParams'}
_root = None
def fsm_root():
    global _root
    if _root is None: _root = build(gen.get_nodes("PlayMaker.dll", "PlayMakerFSM"))
    return _root
def read_fsm(obj):
    return R(obj.get_raw_data()).read(fsm_root())
def simplify(v):
    # Collapse Fsm* wrappers to value or @variable
    if isinstance(v, dict):
        if v.get("useVariable") and v.get("name"): return "@" + v["name"]
        for k in ("value", "intValue", "floatValue", "boolValue", "stringValue"):
            if k in v and len(v) <= 6: return simplify(v[k])
        if "m_PathID" in v: return f"ptr({v['m_FileID']}:{v['m_PathID']})" if v["m_PathID"] else None
        return {k: simplify(x) for k, x in v.items()}
    if isinstance(v, list): return [simplify(x) for x in v]
    return v
def decode_bytes(t, b):
    if t == 'Integer' or t == 'Enum' or t == 'LayerMask': return struct.unpack('<i', b[:4])[0] if len(b) >= 4 else None
    if t == 'Boolean': return bool(b[0]) if b else None
    if t == 'Float': return round(struct.unpack('<f', b[:4])[0], 4) if len(b) >= 4 else None
    if t in ('FsmEvent', 'Character'): return b.decode('utf-8', 'replace')
    if t in ('Vector2', 'Vector3', 'Vector4', 'Color', 'Rect', 'Quaternion'): return [round(x, 3) for x in struct.unpack('<%df' % (len(b)//4), b)]
    return b.hex()
def decode_actions(ad):
    names = ad["actionNames"]; starts = list(ad["actionStartIndex"]) + [len(ad["paramDataType"])]
    out = []
    for i, an in enumerate(names):
        params = {}
        j = starts[i]
        def take(j):
            t = PDT.get(ad["paramDataType"][j], str(ad["paramDataType"][j])); pos = ad["paramDataPos"][j]; size = ad["paramByteDataSize"][j]
            if t == 'Array':
                n = ad["arrayParamSizes"][pos]; vals = []; j += 1
                for _ in range(n):
                    v, j = take(j); vals.append(v)
                return vals, j
            if t == 'CustomClass':
                n = ad["customTypeSizes"][pos]; obj = {"_type": ad["customTypeNames"][pos]}; j += 1
                for _ in range(n):
                    pn = ad["paramName"][j]; v, j = take(j); obj[pn] = v
                return obj, j
            if t in LIST:
                lst = ad.get(LIST[t]) or []
                v = simplify(lst[pos]) if pos < len(lst) else None
            else:
                v = decode_bytes(t, bytes(ad["byteData"][pos:pos + size]))
            return v, j + 1
        while j < starts[i + 1]:
            pn = ad["paramName"][j]; v, j = take(j); params[pn] = v
        out.append({"action": an.split(".")[-1], "enabled": bool(ad["actionEnabled"][i]), "params": params})
    return out
def fsm_to_dict(obj):
    return fsm_data_to_dict(read_fsm(obj)["fsm"])

def fsm_data_to_dict(d):
    """An Fsm (as decoded from a PlayMakerFSM or an FsmTemplate) to the exported form"""
    states = []
    for s in d["states"]:
        states.append({"name": s["name"], "transitions": {t["fsmEvent"]["name"]: t["toState"] for t in s["transitions"]},
                       "actions": decode_actions(s["actionData"])})
    var = {}
    for k, lst in d["variables"].items():
        if isinstance(lst, list) and lst and isinstance(lst[0], dict) and "name" in lst[0]:
            for v in lst: var[v["name"]] = simplify({kk: vv for kk, vv in v.items() if kk not in ("name", "tooltip", "showInInspector", "networkSync", "useVariable")})
    return {"name": d["name"], "start": d["startState"], "variables": var,
            "global": {t["fsmEvent"]["name"]: t["toState"] for t in d["globalTransitions"]}, "states": states}
