import json,sys
from jload import *
F=FILES[sys.argv[1]]; root=int(sys.argv[2])
def short(d):
    if not isinstance(d,dict): return d
    r={}
    for k,v in d.items():
        if k in ("m_GameObject","m_Script","m_Enabled","m_Name","mChanged","mPlayMode"): continue
        if isinstance(v,(dict,list)) and len(json.dumps(v,default=str))>300: v=str(v)[:300]
        r[k]=v
    return r
def walk(gid,dep=0):
    go=F.objects[gid].read()
    print("  "*dep+"#",go.m_Name,gid, "active" if go.m_IsActive else "inactive")
    for c in go.m_Component:
        co=F.objects.get(c.component.path_id) if c.component.file_id==0 else None
        if co is None: continue
        if co.type.name in ("Transform","RectTransform"):
            tr=co.read()
            continue
        if co.type.name=="MonoBehaviour":
            full,d=read_mb(co)
            print("  "*dep+"  -",full,co.path_id,json.dumps(short(d),default=str)[:700])
        else: print("  "*dep+"  -",co.type.name)
    for c in go.m_Component:
        co=F.objects.get(c.component.path_id)
        if co is not None and co.type.name in ("Transform","RectTransform"):
            for ch in co.read().m_Children:
                walk(F.objects[ch.path_id].read().m_GameObject.path_id,dep+1)
walk(root)
