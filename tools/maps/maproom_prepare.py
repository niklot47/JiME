"""
Clean up and light the map room scene (maproom.blend) for the app, then export it as the theme's 3D campaign map.

    blender -b maproom.blend --python tools/maps/maproom_prepare.py -- [--export themes/like-original/scenes/maproom.glb] [--save]

What it does (each step is skipped when already done, so it can run again after editing the scene):
  - removes what is left of the old map room (the excluded "Collection": its empties, particle meshes, materials and
    pictures) and the reference marks (_Erebor, _Fornost, ...), then everything no longer used
  - names what the app looks for (screens/menu/CampaignMap3D.tsx): the map mesh "Map", the candle's wick "Flame_Candle"
    (a flame drawn there), the candle's light "Flicker_Candle" (it flickers)
  - one picture per file (the parchment copies were packed six times)
  - lights: the candle, a warm lamp over the table, a cool fill from the window side; the overview "Camera"
  - exports a .glb (lights, camera, textures as WebP)
"""
import sys

import bpy
from mathutils import Vector

args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
EXPORT = args[args.index("--export") + 1] if "--export" in args else None
SAVE = "--save" in args

# ---------------------------------------------------------------- the old room and the marks
old = bpy.data.collections.get("Collection")
if old:
    for o in list(old.all_objects):
        bpy.data.objects.remove(o, do_unlink=True)
    bpy.data.collections.remove(old)
for n in ("_Erebor", "_Fornost", "_Pelargir", "_Wethertop"):
    if n in bpy.data.objects:
        bpy.data.objects.remove(bpy.data.objects[n], do_unlink=True)

# ---------------------------------------------------------------- names the app looks for
RENAME = {"Plane.002": "Map", "_CandelFire": "Flame_Candle", "Plane": "Table", "Plane.001": "Floor", "Plane.003": "Map_Old",
          "Cylinder": "Inkwell", "Cylinder.001": "Candle_Dish", "Cylinder.002": "Candle", "Pen1": "Quill", "Plane.007": "Quill_2"}
for a, b in RENAME.items():
    o = bpy.data.objects.get(a)
    if o:
        o.name = b
        if o.data and o.type == "MESH":
            o.data.name = b
for o in bpy.data.objects:
    if o.name.startswith("Plane.0") and o.type == "MESH":
        o.name = "Paper"  # the loose sheets (Blender numbers them Paper.001 ...)
        o.data.name = o.name

# ---------------------------------------------------------------- one picture per file
seen = {}
for im in list(bpy.data.images):
    key = bpy.path.abspath(im.filepath).lower() if im.filepath else None
    if not key:
        continue
    if key in seen:
        im.user_remap(seen[key])
    else:
        seen[key] = im
bpy.data.orphans_purge(do_local_ids=True, do_linked_ids=True, do_recursive=True)
# the map's picture: the current data/maps/middle-earth-ink.jpg (tools/maps/middle_earth_ink.py), packed anew
ink = bpy.data.images.get("middle-earth-ink.jpg")
if ink and ink.filepath and __import__("os").path.exists(bpy.path.abspath(ink.filepath)):
    if ink.packed_file:
        ink.unpack(method="USE_ORIGINAL")
    ink.reload()
    ink.pack()
    print("map picture", ink.filepath, tuple(ink.size))

# ---------------------------------------------------------------- lights and the camera
col = bpy.data.collections.get("Collection 2") or bpy.context.scene.collection


def put(name, data):
    o = bpy.data.objects.get(name)
    if o is None:
        o = bpy.data.objects.new(name, data)
        col.objects.link(o)
    return o


def look(o, target):
    d = Vector(target) - o.location
    o.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()


def light(name, kind, loc, energy, color, size=0.1, spot=None, target=None):
    ld = bpy.data.lights.get(name) or bpy.data.lights.new(name, kind)
    if ld.type != kind:
        ld.type = kind
    ld.energy, ld.color = energy, color
    if kind in ("POINT", "SPOT"):
        ld.shadow_soft_size = size
    if kind == "SPOT" and spot:
        ld.spot_size, ld.spot_blend = spot
    o = put(name, ld)
    o.location = loc
    if target is not None:
        look(o, target)
    return o


m = bpy.data.objects["Map"]
bb = [m.matrix_world @ Vector(c) for c in m.bound_box]
centre = sum(bb, Vector()) / 8
wick = bpy.data.objects["Flame_Candle"].matrix_world.translation
# the strengths are physical (the scene is in metres, the table 72 m long) and the app lights it as the glTF says,
# in candela and lux (lamps: W / 4 pi * 683, the sun: W/m2 * 683); a few lux on the map is a well lit room
# the candle: warm, a little above the wick (about 45 cd: a glow on the map's corner, not a hot spot on Eriador)
light("Flicker_Candle", "POINT", wick + Vector((0, 0, 0.6)), 0.8, (1.0, 0.58, 0.26), size=0.4)
# a lamp hanging over the table, warm, its cone holding the map (about 2.5 lux on it)
light("Lamp", "SPOT", centre + Vector((-2, 4, 34)), 50, (1.0, 0.86, 0.68), size=3, spot=(1.15, 0.6), target=centre)
# cool fill from the window side (moonlight), weak (about 0.5 lux)
light("Moon", "SUN", centre + Vector((-30, 20, 30)), 0.0008, (0.62, 0.72, 1.0), target=centre)
# the overview: from the south edge of the table, looking down onto the map (north up)
cd = bpy.data.cameras.get("Camera") or bpy.data.cameras.new("Camera")
cd.lens = 32
cd.clip_start, cd.clip_end = 0.1, 500
cam = put("Camera", cd)
cam.location = centre + Vector((0, 25, 34))
look(cam, centre + Vector((0, 1.5, 0)))
bpy.context.scene.camera = cam

if SAVE:
    bpy.ops.wm.save_mainfile()
    print("saved", bpy.data.filepath)
if EXPORT:
    bpy.ops.export_scene.gltf(filepath=EXPORT, export_format="GLB", export_cameras=True, export_lights=True,
                              export_image_format="WEBP", export_image_quality=85, export_apply=True,
                              export_import_convert_lighting_mode="SPEC")
    print("exported", EXPORT)
print("objects", sorted(o.name for o in bpy.data.objects))
print("images", [(i.name, tuple(i.size)) for i in bpy.data.images])
