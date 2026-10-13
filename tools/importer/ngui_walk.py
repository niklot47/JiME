# Dev tool: print a scene GameObject hierarchy with NGUI widgets (sprite name, size, depth, colour, anchors).
# Usage: python ngui_walk.py <GameObject path id> [scene file, default level2]
# Example: 368 = the threat bar (UIThreatMeter) in level2; 53 = an EnemyMiniView.
import json,sys
from jload import *
F=FILES[sys.argv[2] if len(sys.argv) > 2 else "level2"]
def walk(gid,dep=0):
    go=F.objects[gid].read()
    line="  "*dep+f"# {go.m_Name} {'' if go.m_IsActive else '(off)'}"
    extra=[]
    for c in go.m_Component:
        co=F.objects.get(c.component.path_id) if c.component.file_id==0 else None
        if co is None: continue
        if co.type.name=="MonoBehaviour":
            full,d=read_mb(co); d=d or {}
            ks={k:d[k] for k in ("mSpriteName","mWidth","mHeight","mDepth","mType","mFillAmount","mColor","mTexture","mText","leftAnchor") if k in d}
            if "leftAnchor" in ks: 
                ks["anch"]=[ (d[a]["relative"],d[a]["absolute"]) for a in ("leftAnchor","rightAnchor","bottomAnchor","topAnchor")]; del ks["leftAnchor"]
            if "mColor" in ks: ks["mColor"]=tuple(round(v,2) for v in ks["mColor"].values())
            extra.append(f"{full.split('.')[-1]} {ks}")
        elif co.type.name in ("Transform","RectTransform"):
            p=co.read().m_LocalPosition; extra.append(f"pos=({p.x:.0f},{p.y:.0f})")
    print(line, " | ".join(extra)[:400])
    for c in go.m_Component:
        co=F.objects.get(c.component.path_id)
        if co is not None and co.type.name in ("Transform","RectTransform"):
            for ch in co.read().m_Children:
                walk(F.objects[ch.path_id].read().m_GameObject.path_id,dep+1)
walk(int(sys.argv[1]))
