import json,sys
from jload import *
F=FILES["level2"]
for pid in map(int,sys.argv[1:]):
    full,d=read_mb(F.objects[pid])
    print(pid,full,{k:d.get(k) for k in ("mAtlas","mSpriteName","mSprite","mTexture","mColor","mWidth","mHeight","mDepth") if k in d})
