"""佳文和博文的消防车 — the truck, built in Blender from code and exported as one glTF binary.

usage: blender -b --factory-startup --python build_truck.py -- <out.glb> [preview.png]

Frame: Blender Z up, the truck faces -Y (the glTF exporter turns that into +Z forward, Y up in three.js).
Units are metres; overall about 8.6 m long, 2.5 m wide, 3.3 m high.

Everything that moves hangs under a named empty (a pivot), so the page can animate it:
  Steer_FL/FR > Wheel_*     wheels (spin about X; the front pair also steer about Z)
  Door_FL/FR/RL/RR          cab doors (hinged at their front edge)
  Shutter_<side>_<bay>      roll-up shutters (pivot at the top edge: the page scales them up into the roll)
  Ladder_Turntable > Ladder_Boom > Ladder_Fly1 > Ladder_Fly2 > Ladder_Nozzle > Nozzle_Tip
  Outrigger_<pos> > Outrigger_<pos>_Jack
  Hose_Reel, Valve_1..4 (+ Valve_n_Out), Bell, Kid_*_Arm, Wiper_L/R
Lights carry their own materials (Light_Red, Light_Blue, Light_Amber, Light_Head, Light_Tail, Light_Work, Gauge_Face)
so the page can switch their emission. Every tappable thing has a custom property "tap" (exported as glTF extras).
Static parts are joined per parent and material at the end to keep the draw calls low.
"""
import bpy, bmesh, math, sys, os
from mathutils import Vector, Matrix, Euler

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = argv[0] if argv else os.path.join(os.path.dirname(__file__), 'truck.glb')
PREVIEW = argv[1] if len(argv) > 1 else None

bpy.ops.wm.read_factory_settings(use_empty=True)
SCN = bpy.context.scene
COL = SCN.collection
PI = math.pi

# ---------------------------------------------------------------- materials
MATS = {}
def hexrgb(h):
    h = h.lstrip('#'); c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return [(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4) for x in c] + [1.0]   # sRGB -> linear

def mat(name, color, metal=0.0, rough=0.5, coat=0.0, emit=None, strength=0.0, alpha=1.0):
    if name in MATS: return MATS[name]
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = hexrgb(color)
    b.inputs['Metallic'].default_value = metal
    b.inputs['Roughness'].default_value = rough
    if coat:
        b.inputs['Coat Weight'].default_value = coat
        b.inputs['Coat Roughness'].default_value = 0.08
    if emit:
        b.inputs['Emission Color'].default_value = hexrgb(emit)
        b.inputs['Emission Strength'].default_value = strength
    if alpha < 1:
        b.inputs['Alpha'].default_value = alpha
        m.surface_render_method = 'BLENDED'
    MATS[name] = m
    return m

RED = mat('Paint_Red', '#d9261c', rough=0.32, coat=0.8)
RED_D = mat('Paint_RedDark', '#a3170f', rough=0.4, coat=0.5)
WHITE = mat('Paint_White', '#f4f1ea', rough=0.35, coat=0.6)
CHROME = mat('Chrome', '#e6e8ea', metal=1.0, rough=0.12)
ALU = mat('Aluminium', '#b9bec4', metal=1.0, rough=0.36)
PLATE = mat('DiamondPlate', '#c5c9ce', metal=1.0, rough=0.3)        # the page adds a diamond-plate normal map
BLACK = mat('Rubber', '#1b1c1e', rough=0.85)
DARK = mat('Dark', '#2b2e33', rough=0.55)
GREY = mat('Grey', '#6c7179', rough=0.5)
GLASS = mat('Glass', '#9fc9dc', metal=0.0, rough=0.05, alpha=0.32)
YELLOW = mat('Yellow', '#ffc61a', rough=0.4, coat=0.3)
ORANGE = mat('Orange', '#ff7a1a', rough=0.45)
BRASS = mat('Brass', '#d9a441', metal=1.0, rough=0.25)
HOSE_W = mat('Hose_White', '#efe9dc', rough=0.7)
HOSE_Y = mat('Hose_Yellow', '#f2c230', rough=0.7)
HOSE_R = mat('Hose_Red', '#c4271d', rough=0.65)
SEAT = mat('Seat', '#33363c', rough=0.75)
INNER = mat('Inner', '#d9d7d1', rough=0.6)
SKIN = mat('Skin', '#f6d2b5', rough=0.6)
NAVY = mat('Turnout_Navy', '#2f3b5c', rough=0.7)
REFLECT = mat('Reflective', '#e8f06a', rough=0.3, emit='#2a2c10', strength=0.4)
STRIPE = mat('Stripe', '#f4f1ea', rough=0.35, coat=0.6)              # decal panels: the page puts text on them
DECAL = mat('Decal_Panel', '#f4f1ea', rough=0.4, coat=0.6)
CHEVRON = mat('Chevron', '#ffc61a', rough=0.35)
# lights: emission is driven by the page
L_RED = mat('Light_Red', '#ff2a1f', rough=0.15, emit='#ff2a1f', strength=0.0)
L_BLUE = mat('Light_Blue', '#2a6bff', rough=0.15, emit='#2a6bff', strength=0.0)
L_AMBER = mat('Light_Amber', '#ffad1f', rough=0.15, emit='#ffad1f', strength=0.0)
L_HEAD = mat('Light_Head', '#f2f4f7', rough=0.05, emit='#fff6dc', strength=0.0)
L_TAIL = mat('Light_Tail', '#b0140c', rough=0.15, emit='#ff2010', strength=0.0)
L_WORK = mat('Light_Work', '#eef3f7', rough=0.1, emit='#ffffff', strength=0.0)
L_BAY = mat('Light_Bay', '#ffffff', rough=0.3, emit='#fff3d6', strength=0.0)
GAUGE = mat('Gauge_Face', '#fbfbf7', rough=0.4, emit='#ffffff', strength=0.0)
EYE = mat('Eye', '#1a1a1a', rough=0.2)
CHEEK = mat('Cheek', '#f39a8f', rough=0.6)
HAIR = mat('Hair', '#2a1d16', rough=0.8)
V_RED = mat('Valve_Red', '#e8332a', rough=0.35)
V_BLUE = mat('Valve_Blue', '#2f7ae5', rough=0.35)
V_GREEN = mat('Valve_Green', '#2fb45a', rough=0.35)
V_YELLOW = mat('Valve_Yellow', '#ffcc1a', rough=0.35)
CONE_O = mat('Cone_Orange', '#ff6a14', rough=0.5)

# ---------------------------------------------------------------- mesh factory (bmesh; transforms baked into the mesh)
STATIC = []          # objects that may be merged at the end

def _obj(name, bm, m, parent, loc, static, sharp=None, bev=0.0, bev_seg=2):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me); bm.free()
    for p in me.polygons: p.use_smooth = True
    me.set_sharp_from_angle(angle=math.radians(sharp if sharp is not None else 40))
    o = bpy.data.objects.new(name, me)
    COL.objects.link(o)
    if m: me.materials.append(m)
    o.parent = parent
    o.location = loc
    if bev > 0:
        md = o.modifiers.new('bevel', 'BEVEL'); md.width = bev; md.segments = bev_seg; md.limit_method = 'ANGLE'
        md.angle_limit = math.radians(40); md.harden_normals = False
    if static: STATIC.append(o)
    return o

def _xf(bm, rot=(0, 0, 0), pre=None):
    M = Euler(rot, 'XYZ').to_matrix().to_4x4()
    if pre is not None: M = M @ pre
    bmesh.ops.transform(bm, matrix=M, verts=bm.verts)

def box(name, size, loc=(0, 0, 0), m=RED, parent=None, rot=(0, 0, 0), bev=0.02, static=True):
    bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts); _xf(bm, rot)
    return _obj(name, bm, m, parent, loc, static, bev=bev)

def cyl(name, r, h, loc=(0, 0, 0), m=CHROME, parent=None, rot=(0, 0, 0), seg=32, r2=None, static=True, bev=0.0, caps=True):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=caps, cap_tris=False, segments=seg, radius1=r, radius2=(r if r2 is None else r2), depth=h)
    _xf(bm, rot)
    return _obj(name, bm, m, parent, loc, static, bev=bev, bev_seg=2)

def sph(name, r, loc=(0, 0, 0), m=CHROME, parent=None, scale=(1, 1, 1), rot=(0, 0, 0), seg=24, static=True):
    bm = bmesh.new(); bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=max(8, seg // 2), radius=r)
    bmesh.ops.scale(bm, vec=Vector(scale), verts=bm.verts); _xf(bm, rot)
    return _obj(name, bm, m, parent, loc, static, sharp=80)

def torus(name, R, r, loc=(0, 0, 0), m=BLACK, parent=None, rot=(0, 0, 0), seg=32, rseg=12, arc=2 * PI, static=True):
    bm = bmesh.new(); rings = []
    n = seg if arc >= 2 * PI - 1e-6 else seg + 1
    for i in range(n):
        a = arc * i / seg; ring = []
        for j in range(rseg):
            b = 2 * PI * j / rseg
            ring.append(bm.verts.new(((R + r * math.cos(b)) * math.cos(a), (R + r * math.cos(b)) * math.sin(a), r * math.sin(b))))
        rings.append(ring)
    for i in range(len(rings) - (0 if arc >= 2 * PI - 1e-6 else 1)):
        A, B = rings[i], rings[(i + 1) % len(rings)]
        for j in range(rseg): bm.faces.new((A[j], A[(j + 1) % rseg], B[(j + 1) % rseg], B[j]))
    _xf(bm, rot)
    return _obj(name, bm, m, parent, loc, static, sharp=80)

def lathe(name, prof, loc=(0, 0, 0), m=CHROME, parent=None, rot=(0, 0, 0), seg=32, static=True):
    """profile: [(radius, z), ...] revolved about Z"""
    bm = bmesh.new(); rings = []
    for (rr, z) in prof:
        rings.append([bm.verts.new((rr * math.cos(2 * PI * i / seg), rr * math.sin(2 * PI * i / seg), z)) for i in range(seg)])
    for k in range(len(rings) - 1):
        A, B = rings[k], rings[k + 1]
        for i in range(seg): bm.faces.new((A[i], A[(i + 1) % seg], B[(i + 1) % seg], B[i]))
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    _xf(bm, rot)
    return _obj(name, bm, m, parent, loc, static, sharp=50)

def tube(name, pts, r, m=CHROME, parent=None, seg=12, static=True):
    """a pipe through points (local coords), for rails, handles, mirror arms"""
    bm = bmesh.new(); rings = []
    P = [Vector(p) for p in pts]
    for i, p in enumerate(P):
        d = (P[min(i + 1, len(P) - 1)] - P[max(i - 1, 0)]).normalized()
        up = Vector((0, 0, 1)) if abs(d.z) < 0.9 else Vector((1, 0, 0))
        u = d.cross(up).normalized(); v = d.cross(u).normalized()
        rings.append([bm.verts.new(p + (u * math.cos(2 * PI * j / seg) + v * math.sin(2 * PI * j / seg)) * r) for j in range(seg)])
    for k in range(len(rings) - 1):
        A, B = rings[k], rings[k + 1]
        for j in range(seg): bm.faces.new((A[j], A[(j + 1) % seg], B[(j + 1) % seg], B[j]))
    for ring in (rings[0], rings[-1]): bm.faces.new(ring if ring is rings[-1] else list(reversed(ring)))
    return _obj(name, bm, m, parent, (0, 0, 0), static, sharp=60)

def empty(name, loc=(0, 0, 0), parent=None, rot=(0, 0, 0), tap=None):
    e = bpy.data.objects.new(name, None); COL.objects.link(e)
    e.empty_display_size = 0.2
    e.parent = parent; e.location = loc; e.rotation_euler = rot
    if tap: e['tap'] = tap
    return e

def tap(o, kind):
    o['tap'] = kind; return o

# ---------------------------------------------------------------- dimensions
W2 = 1.22                    # half width of the body
WR, WW = 0.52, 0.36          # wheel radius, tyre width
AX = [-2.9, 1.75, 3.0]       # axle Y positions (front, rear tandem)
TRACK = 1.02                 # tyre centre X
FR_Z = 0.95                  # top of the frame rails
CAB_Y0, CAB_Y1 = -4.25, -1.85
BODY_Y0, BODY_Y1 = -1.75, 4.15
BODY_Z0, BODY_Z1 = 0.78, 2.55

ROOT = empty('FireTruck')

# ---------------------------------------------------------------- chassis
CH = empty('Chassis', parent=ROOT)
for sx in (-1, 1):
    box(f'FrameRail_{sx}', (0.16, 8.2, 0.28), (sx * 0.55, 0.0, FR_Z - 0.14), DARK, CH, bev=0.01)
for y in (-3.5, -1.0, 0.8, 2.4, 3.8):
    box(f'CrossMember_{y}', (1.1, 0.12, 0.14), (0, y, FR_Z - 0.2), DARK, CH, bev=0.01)
# front bumper with tow hooks, the bell bracket and step
box('Bumper', (2.56, 0.32, 0.34), (0, CAB_Y0 - 0.22, 0.72), CHROME, CH, bev=0.05)
box('BumperDeck', (2.3, 0.4, 0.05), (0, CAB_Y0 - 0.26, 0.9), PLATE, CH, bev=0.01)
for sx in (-1, 1):
    torus(f'TowHook_{sx}', 0.07, 0.025, (sx * 0.85, CAB_Y0 - 0.42, 0.62), RED, CH, rot=(0, PI / 2, 0), seg=16, rseg=8)
# side skirts, fuel tank, battery box and the steps between the axles
for sx in (-1, 1):
    cyl(f'FuelTank_{sx}', 0.24, 0.9, (sx * 0.98, -1.25, 0.62), ALU, CH, rot=(PI / 2, 0, 0), seg=28)
    for k in (-0.35, 0.35):
        torus(f'TankStrap_{sx}_{k}', 0.25, 0.018, (sx * 0.98, -1.25 + k, 0.62), DARK, CH, rot=(PI / 2, 0, 0), seg=28, rseg=6)
    cyl(f'TankCap_{sx}', 0.06, 0.05, (sx * 0.98, -1.55, 0.88), CHROME, CH, seg=16)
    box(f'BatteryBox_{sx}', (0.3, 0.6, 0.36), (sx * 1.0, 0.25, 0.6), PLATE, CH, bev=0.02)
    for y0, y1 in ((-4.0, -3.4), (2.45, 2.35)):
        pass
# exhaust stack behind the cab (right side) with a heat shield
cyl('Exhaust', 0.07, 1.6, (1.08, -1.78, 2.1), CHROME, CH, seg=20)
cyl('ExhaustShield', 0.1, 0.7, (1.08, -1.78, 1.9), ALU, CH, seg=20)
EXH = empty('Exhaust_Tip', (1.08, -1.78, 2.92), CH)

# ---------------------------------------------------------------- wheels
def wheel(name, parent, sx):
    W = empty(name, (0, 0, 0), parent, tap='wheel')
    # tyre: a torus-like profile with tread lugs
    prof = [(0.33, -WW / 2), (0.47, -WW / 2 - 0.01), (WR - 0.02, -WW / 2 + 0.02), (WR, -WW / 2 + 0.06), (WR, WW / 2 - 0.06),
            (WR - 0.02, WW / 2 - 0.02), (0.47, WW / 2 + 0.01), (0.33, WW / 2)]
    lathe(f'{name}_Tyre', prof, (0, 0, 0), BLACK, W, rot=(0, PI / 2, 0), seg=48)
    for k in range(28):
        a = 2 * PI * k / 28
        for side in (-1, 1):
            box(f'{name}_Lug_{k}_{side}', (0.12, 0.06, 0.035), (side * 0.09, math.sin(a) * (WR + 0.012), math.cos(a) * (WR + 0.012)),
                BLACK, W, rot=(-a, 0, side * 0.35), bev=0.0)
    # rim: dish, hub, lug nuts, a red ring
    o = sx * 0.12
    lathe(f'{name}_Rim', [(0.0, 0.0), (0.16, 0.0), (0.3, -0.03), (0.33, -0.12), (0.33, -0.17)], (o, 0, 0), CHROME, W, rot=(0, sx * PI / 2, 0), seg=40)
    cyl(f'{name}_Hub', 0.13, 0.12, (o + sx * 0.03, 0, 0), RED, W, rot=(0, PI / 2, 0), seg=24, bev=0.01)
    cyl(f'{name}_HubCap', 0.07, 0.06, (o + sx * 0.1, 0, 0), CHROME, W, rot=(0, PI / 2, 0), seg=20)
    for k in range(8):
        a = 2 * PI * k / 8
        cyl(f'{name}_Nut_{k}', 0.018, 0.04, (o + sx * 0.08, math.sin(a) * 0.1, math.cos(a) * 0.1), CHROME, W, rot=(0, PI / 2, 0), seg=6)
    torus(f'{name}_RimRing', 0.26, 0.012, (o + sx * 0.01, 0, 0), RED, W, rot=(0, PI / 2, 0), seg=40, rseg=6)
    return W

WHEELS = []
for i, y in enumerate(AX):
    for sx, sn in ((1, 'L'), (-1, 'R')):
        if i == 0:
            st = empty(f'Steer_F{sn}', (sx * TRACK, y, WR), CH)
            WHEELS.append(wheel(f'Wheel_F{sn}', st, sx))
        else:
            ax = empty(f'Axle_{i}{sn}', (sx * TRACK, y, WR), CH)
            WHEELS.append(wheel(f'Wheel_R{i}{sn}', ax, sx))
for y in AX:
    cyl(f'AxleBar_{y}', 0.08, 1.7, (0, y, WR), DARK, CH, rot=(0, PI / 2, 0), seg=16)
# wheel arches and mud flaps
for sx in (-1, 1):
    for y, w in ((AX[0], 1.25), ((AX[1] + AX[2]) / 2, 2.55)):
        torus(f'Arch_{sx}_{y}', WR + 0.12, 0.05, (sx * 1.2, y, WR), CHROME, CH, rot=(PI / 2, 0, PI / 2), seg=40, rseg=8, arc=PI)
    box(f'MudFlap_{sx}', (0.36, 0.03, 0.42), (sx * TRACK, AX[2] + 0.7, 0.45), BLACK, CH, bev=0.0)

# ---------------------------------------------------------------- cab
CAB = empty('Cab', parent=ROOT)
cy = (CAB_Y0 + CAB_Y1) / 2
box('CabLower', (2 * W2, CAB_Y1 - CAB_Y0, 1.1), (0, cy, 1.35), RED, CAB, bev=0.08)
box('CabUpperRear', (2 * W2, 0.9, 1.15), (0, CAB_Y1 - 0.45, 2.45), RED, CAB, bev=0.08)
box('CabRoof', (2 * W2 - 0.02, CAB_Y1 - CAB_Y0 - 0.05, 0.16), (0, cy + 0.02, 3.0), RED, CAB, bev=0.06)
box('CabRoofWhite', (2 * W2 - 0.2, CAB_Y1 - CAB_Y0 - 0.25, 0.04), (0, cy + 0.05, 3.09), WHITE, CAB, bev=0.02)
# pillars around the big windscreen and the side windows
for sx in (-1, 1):
    box(f'APillar_{sx}', (0.1, 0.12, 1.1), (sx * (W2 - 0.05), CAB_Y0 + 0.06, 2.45), RED, CAB, bev=0.03)
box('ScreenHeader', (2 * W2, 0.14, 0.16), (0, CAB_Y0 + 0.06, 2.92), RED, CAB, bev=0.04)
box('ScreenSill', (2 * W2, 0.14, 0.1), (0, CAB_Y0 + 0.04, 1.9), RED, CAB, bev=0.03)
box('Windscreen', (2 * W2 - 0.2, 0.03, 0.98), (0, CAB_Y0 + 0.07, 2.42), GLASS, CAB, bev=0.0, static=False)
box('ScreenDivider', (0.05, 0.05, 0.98), (0, CAB_Y0 + 0.05, 2.42), DARK, CAB, bev=0.0)
# white band across the front, grille, chrome surround
box('FrontBand', (2 * W2 + 0.01, 0.04, 0.2), (0, CAB_Y0 - 0.0, 1.62), WHITE, CAB, bev=0.01)
box('GrilleFrame', (1.5, 0.08, 0.62), (0, CAB_Y0 - 0.02, 1.15), CHROME, CAB, bev=0.03)
box('GrilleBack', (1.36, 0.05, 0.5), (0, CAB_Y0 - 0.04, 1.15), DARK, CAB, bev=0.0)
for k in range(9):
    box(f'GrilleBar_{k}', (1.32, 0.04, 0.025), (0, CAB_Y0 - 0.07, 0.93 + k * 0.055), CHROME, CAB, bev=0.0)
box('GrilleBadgePlate', (0.5, 0.03, 0.14), (0, CAB_Y0 - 0.1, 1.16), RED, CAB, bev=0.01)
empty('Decal_Front119', (0, CAB_Y0 - 0.12, 1.16), CAB)
# headlights: chrome bezels, lenses; turn signals; fog lights
for sx in (-1, 1):
    x = sx * 0.95
    cyl(f'HeadBezel_{sx}', 0.17, 0.08, (x, CAB_Y0 - 0.03, 1.15), CHROME, CAB, rot=(PI / 2, 0, 0), seg=32)
    sph(f'HeadLens_{sx}', 0.14, (x, CAB_Y0 - 0.07, 1.15), L_HEAD, CAB, scale=(1, 0.45, 1), seg=24)
    box(f'Turn_{sx}', (0.18, 0.05, 0.1), (x, CAB_Y0 - 0.03, 0.92), L_AMBER, CAB, bev=0.02)
    cyl(f'FogLight_{sx}', 0.07, 0.06, (sx * 0.7, CAB_Y0 - 0.39, 0.74), L_HEAD, CAB, rot=(PI / 2, 0, 0), seg=20)
    box(f'Marker_{sx}', (0.04, 0.1, 0.05), (sx * (W2 + 0.01), CAB_Y0 + 0.2, 2.98), L_AMBER, CAB, bev=0.01)
# bumper bell (博文 rings it) — brass, on a bracket, with a red pull cord
BELLARM = empty('BellMount', (-0.7, CAB_Y0 - 0.36, 1.15), CAB)
box('BellBracket', (0.05, 0.05, 0.25), (0, 0, 0.12), CHROME, BELLARM, bev=0.0)
BELL = empty('Bell', (0, 0, 0.32), BELLARM, tap='bell')
lathe('BellBody', [(0.0, 0.0), (0.04, -0.005), (0.075, -0.05), (0.085, -0.12), (0.11, -0.19), (0.125, -0.21), (0.0, -0.21)], (0, 0, 0), BRASS, BELL, seg=28)
sph('BellClapper', 0.03, (0, 0, -0.2), BRASS, BELL, seg=12)
# horns and siren speakers on the bumper; air horns on the roof
for sx in (-1, 1):
    cyl(f'Siren_{sx}', 0.13, 0.12, (sx * 0.35, CAB_Y0 - 0.4, 0.73), DARK, CAB, rot=(PI / 2, 0, 0), seg=24, bev=0.01)
    cyl(f'SirenGrille_{sx}', 0.1, 0.02, (sx * 0.35, CAB_Y0 - 0.47, 0.73), CHROME, CAB, rot=(PI / 2, 0, 0), seg=24)
    for k, L in enumerate((0.55, 0.42)):
        cyl(f'AirHorn_{sx}_{k}', 0.035, L, (sx * (0.3 + k * 0.12), CAB_Y0 + 0.45 - L / 2, 3.14), CHROME, CAB, rot=(PI / 2, 0, 0), seg=16, r2=0.07)
# wipers (animated)
for sx, sn in ((1, 'L'), (-1, 'R')):
    wp = empty(f'Wiper_{sn}', (sx * 0.55 - 0.25, CAB_Y0 + 0.02, 1.95), CAB)
    box(f'WiperArm_{sn}', (0.02, 0.02, 0.62), (0, 0, 0.31), DARK, wp, bev=0.0, static=False)
    box(f'WiperBlade_{sn}', (0.025, 0.03, 0.6), (0.02, -0.01, 0.33), BLACK, wp, rot=(0, 0.1, 0), bev=0.0, static=False)
# the light bar: red/blue beacons, white takedowns, the spot in the middle
LB = empty('LightBar', (0, CAB_Y0 + 0.75, 3.12), CAB, tap='lights')
box('LightBarBase', (2.1, 0.36, 0.08), (0, 0, 0.0), DARK, LB, bev=0.02)
for k in range(8):
    x = -0.91 + k * 0.26
    m = L_RED if (k % 2 == 0) == (x < 0) else L_BLUE
    if k in (3, 4): m = L_WORK
    box(f'Beacon_{k}', (0.22, 0.3, 0.16), (x, 0, 0.12), m, LB, bev=0.04, static=False)
for sx in (-1, 1):
    cyl(f'RoofSpot_{sx}', 0.11, 0.14, (sx * 0.95, CAB_Y1 - 0.5, 3.2), L_WORK, CAB, rot=(PI / 2, 0, 0), seg=20, static=False)
    cyl(f'RoofSpotBody_{sx}', 0.12, 0.12, (sx * 0.95, CAB_Y1 - 0.38, 3.2), CHROME, CAB, rot=(PI / 2, 0, 0), seg=20)
    box(f'RoofSpotPost_{sx}', (0.05, 0.05, 0.12), (sx * 0.95, CAB_Y1 - 0.4, 3.1), DARK, CAB, bev=0.0)
cyl('Antenna', 0.008, 0.8, (-0.9, CAB_Y1 - 0.2, 3.5), DARK, CAB, seg=6)
# mirrors: two big west-coast mirrors on chrome arms, plus a convex spot mirror
for sx, sn in ((1, 'L'), (-1, 'R')):
    x0 = sx * (W2 + 0.02)
    tube(f'MirrorArm_{sn}', [(x0, CAB_Y0 + 0.25, 2.0), (x0 + sx * 0.35, CAB_Y0 + 0.1, 2.0), (x0 + sx * 0.35, CAB_Y0 + 0.1, 2.75), (x0, CAB_Y0 + 0.25, 2.75)], 0.02, CHROME, CAB)
    box(f'MirrorHead_{sn}', (0.08, 0.2, 0.55), (x0 + sx * 0.4, CAB_Y0 + 0.12, 2.38), DARK, CAB, bev=0.03)
    box(f'MirrorGlass_{sn}', (0.01, 0.17, 0.5), (x0 + sx * 0.4, CAB_Y0 + 0.12 - 0.105, 2.38), CHROME, CAB, rot=(0, 0, PI / 2), bev=0.0)
    sph(f'SpotMirror_{sn}', 0.09, (x0 + sx * 0.4, CAB_Y0 + 0.05, 1.98), CHROME, CAB, scale=(1, 0.5, 1), seg=16)
# cab interior: dash, steering wheel, seats, gauges (seen through the open doors)
box('Dash', (2.2, 0.5, 0.5), (0, CAB_Y0 + 0.4, 1.75), DARK, CAB, bev=0.04)
for k, x in enumerate((0.75, 0.45)):
    cyl(f'DashGauge_{k}', 0.07, 0.02, (x, CAB_Y0 + 0.6, 2.02), GAUGE, CAB, rot=(PI / 2 - 0.5, 0, 0), seg=20, static=False)
SW = empty('SteeringWheel', (0.6, CAB_Y0 + 0.75, 1.95), CAB, rot=(-1.0, 0, 0))
torus('SteerRim', 0.2, 0.025, (0, 0, 0), DARK, SW, seg=32, rseg=8)
for a in (0, 2.1, 4.2):
    box(f'SteerSpoke_{a}', (0.2, 0.03, 0.02), (math.cos(a) * 0.1, math.sin(a) * 0.1, 0), DARK, SW, rot=(0, 0, a), bev=0.0)
cyl('SteerColumn', 0.03, 0.5, (0.6, CAB_Y0 + 0.62, 1.75), DARK, CAB, rot=(1.0, 0, 0), seg=10)
for row, y in enumerate((CAB_Y0 + 1.25, CAB_Y1 - 0.5)):
    for sx in (-1, 1):
        box(f'SeatBase_{row}_{sx}', (0.62, 0.55, 0.18), (sx * 0.55, y, 1.25), SEAT, CAB, bev=0.04)
        box(f'SeatBack_{row}_{sx}', (0.62, 0.14, 0.75), (sx * 0.55, y + 0.3, 1.68), SEAT, CAB, rot=(-0.12, 0, 0), bev=0.05)
        box(f'Headrest_{row}_{sx}', (0.34, 0.12, 0.2), (sx * 0.55, y + 0.36, 2.15), SEAT, CAB, bev=0.04)
box('CabFloor', (2.2, 2.3, 0.05), (0, cy, 0.95), PLATE, CAB, bev=0.0)
box('CabInnerRear', (2.3, 0.05, 1.9), (0, CAB_Y1 - 0.05, 1.95), INNER, CAB, bev=0.0)
box('Radio', (0.3, 0.2, 0.12), (-0.1, CAB_Y0 + 0.62, 2.0), GREY, CAB, bev=0.01)
# doors: front pair and crew pair, hinged at their front edge; window glass, handle, white stripe, step-well
DOORS = {}
for sx, sn in ((1, 'L'), (-1, 'R')):
    for fr, y0, y1 in (('F', CAB_Y0 + 0.18, CAB_Y0 + 1.25), ('R', CAB_Y0 + 1.3, CAB_Y1 - 0.08)):
        hinge = empty(f'Door_{fr}{sn}', (sx * W2, y0, 1.0), CAB, tap='door')
        L = y1 - y0
        D = hinge
        box(f'DoorPanel_{fr}{sn}', (0.08, L, 0.95), (sx * 0.0, L / 2, 0.5), RED, D, bev=0.04, static=False)
        box(f'DoorUpperFrame_{fr}{sn}', (0.06, L, 0.12), (0, L / 2, 1.88), RED, D, bev=0.03, static=False)
        box(f'DoorPostA_{fr}{sn}', (0.06, 0.08, 0.95), (0, 0.04, 1.42), RED, D, bev=0.02, static=False)
        box(f'DoorPostB_{fr}{sn}', (0.06, 0.08, 0.95), (0, L - 0.04, 1.42), RED, D, bev=0.02, static=False)
        box(f'DoorGlass_{fr}{sn}', (0.02, L - 0.12, 0.84), (0, L / 2, 1.42), GLASS, D, bev=0.0, static=False)
        box(f'DoorStripe_{fr}{sn}', (0.09, L, 0.16), (0, L / 2, 0.62), WHITE, D, bev=0.01, static=False)
        box(f'DoorHandle_{fr}{sn}', (0.05, 0.22, 0.05), (sx * 0.05, L - 0.2, 0.86), CHROME, D, bev=0.015, static=False)
        if fr == 'F': empty(f'Decal_Door_{sn}', (sx * 0.05, L / 2, 0.25), D)
        DOORS[f'{fr}{sn}'] = D
    # two-tier steps below the doors (diamond plate) and the grab rails
    for k, z in enumerate((0.55, 0.85)):
        box(f'CabStep_{sn}_{k}', (0.3, 0.9, 0.05), (sx * (W2 - 0.12 + 0.1 * (1 - k)), CAB_Y0 + 0.75, z), PLATE, CAB, bev=0.01)
    tube(f'GrabRail_{sn}', [(sx * (W2 + 0.04), CAB_Y0 + 0.22, 1.2), (sx * (W2 + 0.09), CAB_Y0 + 0.22, 1.25), (sx * (W2 + 0.09), CAB_Y0 + 0.22, 2.2), (sx * (W2 + 0.04), CAB_Y0 + 0.22, 2.25)], 0.022, CHROME, CAB)

# ---------------------------------------------------------------- the two firefighters in the cab (佳文 drives, 博文 rides)
def kid(name, parent, loc, helmet_mat, helmet_scale=1.0, waving_side=1):
    K = empty(f'Kid_{name}', loc, parent, tap='kid')
    box(f'{name}_Torso', (0.38, 0.28, 0.42), (0, 0, 0.22), NAVY, K, bev=0.1)
    box(f'{name}_Band', (0.39, 0.29, 0.05), (0, 0, 0.12), REFLECT, K, bev=0.02)
    box(f'{name}_Band2', (0.39, 0.29, 0.05), (0, 0, 0.32), REFLECT, K, bev=0.02)
    sph(f'{name}_Head', 0.2, (0, 0, 0.62), SKIN, K, seg=24)
    for ex in (-1, 1):
        sph(f'{name}_Eye_{ex}', 0.025, (ex * 0.075, -0.18, 0.66), EYE, K, seg=10)
        sph(f'{name}_Cheek_{ex}', 0.03, (ex * 0.12, -0.15, 0.6), CHEEK, K, scale=(1, 0.5, 0.7), seg=10)
    torus(f'{name}_Smile', 0.06, 0.012, (0, -0.18, 0.6), EYE, K, rot=(PI / 2, 0, PI), seg=12, rseg=6, arc=PI * 0.8)
    sph(f'{name}_Hair', 0.205, (0, 0.02, 0.66), HAIR, K, scale=(1, 1, 0.8), seg=20)
    # the helmet: dome, wide brim with the long back tail, a front shield
    H = empty(f'{name}_Helmet', (0, 0, 0.7), K)
    H.scale = (helmet_scale, helmet_scale, helmet_scale)
    sph(f'{name}_HelmetDome', 0.23, (0, 0.01, 0.02), helmet_mat, H, scale=(1, 1.08, 0.82), seg=24)
    cyl(f'{name}_HelmetBrim', 0.3, 0.025, (0, 0.06, -0.06), helmet_mat, H, seg=28)
    box(f'{name}_HelmetShield', (0.14, 0.03, 0.12), (0, -0.24, 0.07), WHITE, H, bev=0.02)
    box(f'{name}_HelmetRidge', (0.04, 0.4, 0.06), (0, 0.02, 0.2), helmet_mat, H, bev=0.015)
    # arms; the waving one has its own pivot at the shoulder
    for ax in (-1, 1):
        if ax == waving_side:
            A = empty(f'Kid_{name}_Arm', (ax * 0.23, 0, 0.36), K)
            box(f'{name}_ArmW', (0.11, 0.11, 0.32), (0, 0, -0.14), NAVY, A, bev=0.05, static=False)
            sph(f'{name}_HandW', 0.06, (0, 0, -0.32), SKIN, A, seg=12, static=False)
        else:
            box(f'{name}_Arm_{ax}', (0.11, 0.3, 0.11), (ax * 0.23, -0.12, 0.3), NAVY, K, bev=0.05)
            sph(f'{name}_Hand_{ax}', 0.06, (ax * 0.23, -0.28, 0.3), SKIN, K, seg=12)
    return K

kid('Jiawen', CAB, (0.55, CAB_Y0 + 1.15, 1.42), RED, 1.0, waving_side=1)          # 佳文: red helmet, driver (left-hand drive)
kid('Bowen', CAB, (-0.55, CAB_Y0 + 1.15, 1.38), YELLOW, 1.25, waving_side=-1)     # 博文: big yellow helmet, passenger

# ---------------------------------------------------------------- body (the rescue box) with roll-up shutters
BODY = empty('Body', parent=ROOT)
by = (BODY_Y0 + BODY_Y1) / 2
box('BodyCore', (2 * W2 - 1.3, BODY_Y1 - BODY_Y0, BODY_Z1 - BODY_Z0 - 0.1), (0, by, (BODY_Z0 + BODY_Z1) / 2 - 0.05), INNER, BODY, bev=0.0)
box('BodyTopDeck', (2 * W2, BODY_Y1 - BODY_Y0, 0.08), (0, by, BODY_Z1 + 0.0), PLATE, BODY, bev=0.02)
box('BodyBottomSkirt', (2 * W2, BODY_Y1 - BODY_Y0, 0.14), (0, by, BODY_Z0 + 0.05), RED, BODY, bev=0.03)
box('BodyFrontWall', (2 * W2, 0.12, BODY_Z1 - BODY_Z0), (0, BODY_Y0 + 0.06, (BODY_Z0 + BODY_Z1) / 2), RED, BODY, bev=0.03)
box('BodyRearWall', (2 * W2, 0.1, BODY_Z1 - BODY_Z0), (0, BODY_Y1 - 0.05, (BODY_Z0 + BODY_Z1) / 2), RED, BODY, bev=0.03)
# bays: (name, y0, y1, z0, z1)
BAYS = [('A', -1.62, -0.28, 1.0, 2.42), ('B', -0.18, 1.08, 1.0, 2.42), ('C', 1.18, 3.62, 1.32, 2.42), ('D', 3.72, 4.02, 1.0, 2.42)]
SHUTTERS = {}
for sx, sn in ((1, 'L'), (-1, 'R')):
    xo = sx * W2
    # vertical red posts between bays, the sill and the top rail
    for y in (-1.7, -0.23, 1.13, 3.67, 4.08):
        box(f'Post_{sn}_{y}', (0.08, 0.1, BODY_Z1 - BODY_Z0), (xo, y, (BODY_Z0 + BODY_Z1) / 2), RED, BODY, bev=0.02)
    box(f'TopRail_{sn}', (0.1, BODY_Y1 - BODY_Y0, 0.14), (xo, by, BODY_Z1 - 0.07), RED, BODY, bev=0.03)
    box(f'WhiteStripe_{sn}', (0.03, BODY_Y1 - BODY_Y0 + 0.02, 0.12), (xo + sx * 0.04, by, 0.98), STRIPE, BODY, bev=0.0)
    box(f'Sill_{sn}', (0.12, BODY_Y1 - BODY_Y0, 0.1), (xo, by, 0.92), CHROME, BODY, bev=0.02)
    # the panel above the rear wheels (below bay C), with the arch
    box(f'WheelPanel_{sn}', (0.08, 2.44, 0.3), (xo, 2.4, 1.15), RED, BODY, bev=0.02)
    empty(f'Decal_Side_{sn}', (xo + sx * 0.05, 2.4, 1.15), BODY)
    for bn, y0, y1, z0, z1 in BAYS:
        if sn == 'R' and bn == 'A': continue     # the pump panel lives here (kerb side)
        h = z1 - z0; L = y1 - y0; yc = (y0 + y1) / 2
        # the open bay: lit back wall and shelves
        box(f'BayBack_{sn}{bn}', (0.02, L, h), (xo - sx * 0.6, yc, (z0 + z1) / 2), INNER, BODY, bev=0.0)
        box(f'BayLight_{sn}{bn}', (0.03, L - 0.1, 0.03), (xo - sx * 0.05, yc, z1 - 0.04), L_BAY, BODY, bev=0.0, static=False)
        box(f'BayFloor_{sn}{bn}', (0.62, L, 0.03), (xo - sx * 0.3, yc, z0 + 0.01), PLATE, BODY, bev=0.0)
        box(f'BayCeil_{sn}{bn}', (0.62, L, 0.03), (xo - sx * 0.3, yc, z1 - 0.01), INNER, BODY, bev=0.0)
        for yy in (y0 - 0.02, y1 + 0.02):
            box(f'BayDivider_{sn}{bn}_{yy}', (0.62, 0.04, h), (xo - sx * 0.3, yy, (z0 + z1) / 2), INNER, BODY, bev=0.0)
        if z0 > 1.1:
            box(f'BayUnder_{sn}{bn}', (0.62, L, z0 - 0.95), (xo - sx * 0.3, yc, (z0 + 0.95) / 2), RED_D, BODY, bev=0.0)
        if h > 1.2:
            box(f'BayShelf_{sn}{bn}', (0.6, L, 0.03), (xo - sx * 0.3, yc, z0 + h * 0.5), ALU, BODY, bev=0.0)
        # the shutter: slats under a pivot at the top edge (the page scales Z to roll it up)
        S = empty(f'Shutter_{sn}_{bn}', (xo + sx * 0.02, yc, z1), BODY, tap='shutter')
        n = max(4, int(h / 0.07))
        for k in range(n):
            box(f'Slat_{sn}{bn}_{k}', (0.03, L, h / n - 0.006), (0, 0, -(k + 0.5) * h / n), ALU, S, bev=0.004, static=True)
        box(f'ShutterBar_{sn}{bn}', (0.06, L, 0.06), (sx * 0.02, 0, -h + 0.04), CHROME, S, bev=0.015, static=True)
        box(f'ShutterHandle_{sn}{bn}', (0.05, 0.3, 0.04), (sx * 0.05, 0, -h + 0.09), DARK, S, bev=0.01, static=True)
        box(f'ShutterHousing_{sn}{bn}', (0.12, L + 0.02, 0.1), (xo + sx * 0.0, yc, z1 + 0.03), RED, BODY, bev=0.03)
        SHUTTERS[f'{sn}{bn}'] = S

# ---------------------------------------------------------------- what is inside the bays (tappable tools)
def tool(name, kind, parent, loc):
    return empty(f'Tool_{name}', loc, parent, tap='tool:' + kind)

def extinguisher(name, parent, loc, s=1.0):
    T = tool(name, 'extinguisher', parent, loc)
    cyl(f'{name}_Can', 0.11 * s, 0.55 * s, (0, 0, 0.3 * s), RED, T, seg=24, bev=0.0)
    sph(f'{name}_Top', 0.11 * s, (0, 0, 0.57 * s), RED, T, scale=(1, 1, 0.5), seg=20)
    cyl(f'{name}_Valve', 0.03 * s, 0.1 * s, (0, 0, 0.66 * s), CHROME, T, seg=12)
    box(f'{name}_Lever', (0.03 * s, 0.18 * s, 0.02 * s), (0, -0.06 * s, 0.72 * s), DARK, T, rot=(0.3, 0, 0), bev=0.0)
    tube(f'{name}_Hose', [(0, 0.02 * s, 0.68 * s), (0, 0.12 * s, 0.62 * s), (0, 0.14 * s, 0.4 * s), (0, 0.13 * s, 0.25 * s)], 0.015 * s, BLACK, T)
    box(f'{name}_Label', (0.16 * s, 0.01, 0.16 * s), (0, -0.11 * s, 0.32 * s), WHITE, T, bev=0.0)
    return T

def hose_roll(name, parent, loc, m, rot=(0, PI / 2, 0)):
    T = tool(name, 'hose', parent, loc)
    for k in range(4):
        torus(f'{name}_Coil_{k}', 0.1 + k * 0.035, 0.022, (0, 0, 0), m, T, rot=rot, seg=28, rseg=8)
    cyl(f'{name}_Coupling', 0.04, 0.08, (0, 0.27, 0), BRASS, T, rot=(PI / 2, 0, 0), seg=16)
    return T

def helmet_tool(name, parent, loc, m):
    T = tool(name, 'helmet', parent, loc)
    sph(f'{name}_Dome', 0.15, (0, 0, 0.06), m, T, scale=(1, 1.1, 0.8), seg=20)
    cyl(f'{name}_Brim', 0.2, 0.02, (0, 0.04, 0.0), m, T, seg=24)
    box(f'{name}_Shield', (0.1, 0.02, 0.08), (0, -0.15, 0.1), WHITE, T, bev=0.01)
    return T

def axe(name, parent, loc, rot=(0, 0, 0)):
    T = tool(name, 'axe', parent, loc)
    T.rotation_euler = rot
    cyl(f'{name}_Handle', 0.02, 0.8, (0, 0, 0), YELLOW, T, seg=12)
    box(f'{name}_Head', (0.03, 0.24, 0.12), (0, -0.07, 0.36), RED, T, bev=0.01)
    box(f'{name}_Blade', (0.025, 0.05, 0.14), (0, -0.2, 0.36), CHROME, T, bev=0.0)
    box(f'{name}_Pick', (0.025, 0.12, 0.03), (0, 0.1, 0.36), CHROME, T, bev=0.0)
    return T

def cone_tool(name, parent, loc):
    T = tool(name, 'cone', parent, loc)
    box(f'{name}_Base', (0.3, 0.3, 0.03), (0, 0, 0.015), BLACK, T, bev=0.01)
    cyl(f'{name}_Body', 0.12, 0.42, (0, 0, 0.24), CONE_O, T, seg=20, r2=0.025)
    cyl(f'{name}_Band', 0.085, 0.08, (0, 0, 0.24), WHITE, T, seg=20, r2=0.07)
    return T

def first_aid(name, parent, loc):
    T = tool(name, 'firstaid', parent, loc)
    box(f'{name}_Box', (0.24, 0.4, 0.28), (0, 0, 0.14), WHITE, T, bev=0.03)
    box(f'{name}_CrossH', (0.25, 0.2, 0.06), (0, 0, 0.16), RED, T, bev=0.0)
    box(f'{name}_CrossV', (0.25, 0.06, 0.2), (0, 0, 0.16), RED, T, bev=0.0)
    box(f'{name}_Handle', (0.04, 0.16, 0.03), (0, 0, 0.3), DARK, T, bev=0.01)
    return T

def flashlight(name, parent, loc):
    T = tool(name, 'flashlight', parent, loc)
    cyl(f'{name}_Body', 0.035, 0.24, (0, 0, 0), YELLOW, T, rot=(PI / 2, 0, 0), seg=16)
    cyl(f'{name}_Head', 0.055, 0.08, (0, -0.15, 0), DARK, T, rot=(PI / 2, 0, 0), seg=16)
    cyl(f'{name}_Lens', 0.045, 0.01, (0, -0.19, 0), L_WORK, T, rot=(PI / 2, 0, 0), seg=16, static=False)
    return T

def boots(name, parent, loc):
    T = tool(name, 'boots', parent, loc)
    for k in (-1, 1):
        box(f'{name}_Shaft_{k}', (0.12, 0.13, 0.32), (k * 0.08, 0.03, 0.2), BLACK, T, bev=0.03)
        box(f'{name}_Foot_{k}', (0.12, 0.26, 0.09), (k * 0.08, -0.04, 0.045), BLACK, T, bev=0.03)
        box(f'{name}_Band_{k}', (0.125, 0.135, 0.04), (k * 0.08, 0.03, 0.28), REFLECT, T, bev=0.01)
    return T

def rope(name, parent, loc):
    T = tool(name, 'rope', parent, loc)
    for k in range(5):
        torus(f'{name}_Loop_{k}', 0.13, 0.02, (0, 0, 0.03 + k * 0.035), HOSE_Y, T, seg=24, rseg=6)
    return T

def bay_floor(sn, bn):
    for b in BAYS:
        if b[0] == bn:
            sx = 1 if sn == 'L' else -1
            return b, sx

def inside(sn, bn, ox, y, z):
    (_, y0, y1, z0, z1), sx = bay_floor(sn, bn)
    return (sx * (W2 - ox), y, z)

# right A: extinguishers + first aid
extinguisher('ExtA', BODY, inside('L', 'A', 0.32, -1.3, 1.02))
extinguisher('ExtB', BODY, inside('L', 'A', 0.32, -0.98, 1.02), 0.85)
first_aid('FirstAid', BODY, inside('L', 'A', 0.32, -0.55, 1.02))
helmet_tool('HelmetSpareR', BODY, inside('L', 'A', 0.3, -1.1, 1.75), RED)
flashlight('FlashR', BODY, inside('L', 'A', 0.3, -0.6, 1.78))
# B both sides: hose rolls on the floor and the shelf, a nozzle
for sn in ('L', 'R'):
    for k, y in enumerate((0.05, 0.42, 0.8)):
        hose_roll(f'Hose{sn}{k}', BODY, inside(sn, 'B', 0.32, y, 1.24), (HOSE_W, HOSE_Y, HOSE_R)[k])
    for k, y in enumerate((0.15, 0.7)):
        hose_roll(f'HoseUp{sn}{k}', BODY, inside(sn, 'B', 0.32, y, 1.95), (HOSE_Y, HOSE_W)[k])
# C both sides (over the wheels): helmets, boots, axe, cones, rope
for sn in ('L', 'R'):
    helmet_tool(f'Helmet{sn}1', BODY, inside(sn, 'C', 0.3, 1.45, 1.35), YELLOW)
    helmet_tool(f'Helmet{sn}2', BODY, inside(sn, 'C', 0.3, 1.85, 1.35), RED)
    boots(f'Boots{sn}', BODY, inside(sn, 'C', 0.3, 2.3, 1.34))
    cone_tool(f'Cone{sn}1', BODY, inside(sn, 'C', 0.3, 2.85, 1.34))
    cone_tool(f'Cone{sn}2', BODY, inside(sn, 'C', 0.3, 3.3, 1.34))
    axe(f'Axe{sn}', BODY, inside(sn, 'C', 0.12, 2.6, 1.95), rot=(PI / 2, 0, 0))
    rope(f'Rope{sn}', BODY, inside(sn, 'C', 0.3, 1.55, 1.95))
# D (narrow rear bays): a pike pole and a big flashlight on the left, an extinguisher on the right
for sn in ('L', 'R'):
    if sn == 'L':
        flashlight('FlashL', BODY, inside('L', 'D', 0.3, 3.87, 2.0))
        T = tool('PikePole', 'pole', BODY, inside('L', 'D', 0.3, 3.87, 1.05))
        cyl('PikeShaft', 0.02, 1.2, (0, 0, 0.6), YELLOW, T, seg=10); box('PikeHook', (0.03, 0.12, 0.03), (0, -0.05, 1.2), CHROME, T, bev=0.0)
    else:
        extinguisher('ExtD', BODY, inside('R', 'D', 0.3, 3.87, 1.02), 0.8)

# ---------------------------------------------------------------- pump panel (left, bay A): gauges and four colourful valves
PP = empty('PumpPanel', (-W2, -0.95, 1.7), BODY)
box('PumpPanelPlate', (0.04, 1.3, 1.36), (0.0, 0, 0), ALU, PP, bev=0.02)
box('PumpPanelFrame', (0.06, 1.38, 1.44), (0.01, 0, 0), CHROME, PP, bev=0.02)
for k, (z, y) in enumerate(((0.38, -0.35), (0.38, 0.0), (0.38, 0.35))):
    cyl(f'GaugeRim_{k}', 0.12 - 0.02 * (k == 1), 0.04, (-0.04, y, z), CHROME, PP, rot=(0, PI / 2, 0), seg=28)
    cyl(f'GaugeFace_{k}', 0.1 - 0.02 * (k == 1), 0.02, (-0.06, y, z), GAUGE, PP, rot=(0, PI / 2, 0), seg=28, static=False)
    G = empty(f'Gauge_{k}_Needle', (-0.075, y, z), PP)
    box(f'Needle_{k}', (0.005, 0.012, 0.08), (0, 0, 0.03), RED, G, bev=0.0, static=False)
empty('Decal_Pump', (-0.04, 0, 0.58), PP)
VCOLS = [V_RED, V_BLUE, V_GREEN, V_YELLOW]
for k in range(4):
    y = -0.45 + k * 0.3
    # outlet below, valve handle above it
    cyl(f'Outlet_{k}', 0.07, 0.16, (-0.1, y, -0.42), BRASS, PP, rot=(0, PI / 2, 0), seg=20)
    cyl(f'OutletCap_{k}', 0.08, 0.05, (-0.2, y, -0.42), VCOLS[k], PP, rot=(0, PI / 2, 0), seg=8)
    empty(f'Valve_{k + 1}_Out', (-0.24, y, -0.42), PP)
    V = empty(f'Valve_{k + 1}', (-0.08, y, -0.08), PP, tap='valve')
    cyl(f'ValveStem_{k}', 0.025, 0.1, (-0.03, 0, 0), CHROME, V, rot=(0, PI / 2, 0), seg=12, static=False)
    box(f'ValveHandle_{k}', (0.04, 0.05, 0.26), (-0.08, 0, 0.08), VCOLS[k], V, bev=0.015, static=False)
    sph(f'ValveKnob_{k}', 0.04, (-0.08, 0, 0.22), VCOLS[k], V, seg=12, static=False)

# ---------------------------------------------------------------- roof: hose bed, hard suction hoses, ladder rack
for sx in (-1, 1):
    cyl(f'Suction_{sx}', 0.1, 4.6, (sx * 1.02, 1.0, BODY_Z1 + 0.16), BLACK, BODY, rot=(PI / 2, 0, 0), seg=20)
    for k in range(23):
        torus(f'SuctionRib_{sx}_{k}', 0.1, 0.012, (sx * 1.02, -1.2 + k * 0.2, BODY_Z1 + 0.16), DARK, BODY, rot=(PI / 2, 0, 0), seg=20, rseg=5)
    for y in (-1.4, 3.4):
        cyl(f'SuctionCoupling_{sx}_{y}', 0.12, 0.12, (sx * 1.02, y, BODY_Z1 + 0.16), BRASS, BODY, rot=(PI / 2, 0, 0), seg=20)
    tube(f'RoofRail_{sx}', [(sx * 1.18, -1.6, BODY_Z1 + 0.05), (sx * 1.18, -1.55, BODY_Z1 + 0.35), (sx * 1.18, 4.0, BODY_Z1 + 0.35), (sx * 1.18, 4.05, BODY_Z1 + 0.05)], 0.025, CHROME, BODY)
# a hose bed at the rear top: folded hose layers
for k in range(5):
    box(f'HoseBed_{k}', (1.6, 1.2, 0.07), (0, 3.45, BODY_Z1 + 0.08 + k * 0.075), (HOSE_W if k % 2 else HOSE_Y), BODY, bev=0.03)

# ---------------------------------------------------------------- rear: hose reel, steps, lights, ladder up to the roof
REAR = empty('Rear', parent=ROOT)
box('RearStep', (2.3, 0.45, 0.07), (0, BODY_Y1 + 0.25, 0.75), PLATE, REAR, bev=0.01)
for sx in (-1, 1):
    box(f'RearStepBracket_{sx}', (0.06, 0.45, 0.2), (sx * 1.0, BODY_Y1 + 0.25, 0.65), DARK, REAR, bev=0.0)
    box(f'TailHousing_{sx}', (0.3, 0.06, 0.55), (sx * 0.98, BODY_Y1 + 0.03, 1.25), DARK, REAR, bev=0.02)
    for k, (m, z) in enumerate(((L_TAIL, 1.42), (L_AMBER, 1.25), (L_HEAD, 1.08))):
        cyl(f'TailLamp_{sx}_{k}', 0.09, 0.03, (sx * 0.98, BODY_Y1 + 0.07, z), m, REAR, rot=(PI / 2, 0, 0), seg=20, static=False)
    box(f'RearBeacon_{sx}', (0.18, 0.12, 0.14), (sx * 1.0, BODY_Y1 - 0.05, BODY_Z1 + 0.1), (L_RED if sx < 0 else L_BLUE), REAR, bev=0.03, static=False)
    tube(f'RearGrab_{sx}', [(sx * 0.75, BODY_Y1 + 0.02, 1.05), (sx * 0.75, BODY_Y1 + 0.09, 1.1), (sx * 0.75, BODY_Y1 + 0.09, 2.2), (sx * 0.75, BODY_Y1 + 0.02, 2.25)], 0.022, CHROME, REAR)
# chevron panel (the page draws red/yellow chevrons on it)
box('ChevronPanel', (1.2, 0.02, 0.5), (0, BODY_Y1 + 0.01, 1.15), CHEVRON, REAR, bev=0.0)
empty('Decal_Chevron', (0, BODY_Y1 + 0.03, 1.15), REAR)
# the hose reel above the step
HR = empty('Hose_Reel', (0, BODY_Y1 + 0.32, 1.9), REAR, tap='reel')
for sx in (-1, 1):
    cyl(f'ReelFlange_{sx}', 0.38, 0.03, (sx * 0.42, 0, 0), RED, HR, rot=(0, PI / 2, 0), seg=36, static=False)
cyl('ReelDrum', 0.18, 0.84, (0, 0, 0), DARK, HR, rot=(0, PI / 2, 0), seg=24, static=False)
for k in range(5):
    cyl(f'ReelHose_{k}', 0.2 + k * 0.03, 0.8 - k * 0.02, (0, 0, 0), HOSE_R, HR, rot=(0, PI / 2, 0), seg=32, static=False)
for k in range(6):
    box(f'ReelSpoke_{k}', (0.03, 0.62, 0.04), (0.44, 0, 0), CHROME, HR, rot=(2 * PI * k / 6, 0, 0), bev=0.0, static=False)
for sx in (-1, 1):
    box(f'ReelBracket_{sx}', (0.05, 0.12, 0.6), (sx * 0.48, BODY_Y1 + 0.28, 1.65), DARK, REAR, bev=0.01)
box('ReelHandle', (0.04, 0.04, 0.25), (0.52, BODY_Y1 + 0.32, 2.15), YELLOW, REAR, bev=0.01)
# a ladder up the rear right corner to the roof
for sx in (0.4, 0.75):
    box(f'RearLadderRail_{sx}', (0.04, 0.04, 1.7), (sx, BODY_Y1 + 0.06, 1.75), CHROME, REAR, bev=0.0)
for k in range(6):
    cyl(f'RearLadderRung_{k}', 0.018, 0.35, (0.575, BODY_Y1 + 0.06, 1.05 + k * 0.28), PLATE, REAR, rot=(0, PI / 2, 0), seg=10)

# ---------------------------------------------------------------- outriggers (stabilizer legs), four corners
for pos, y in (('F', -1.55), ('R', 3.85)):
    for sx, sn in ((1, 'L'), (-1, 'R')):
        box(f'OutriggerBox_{pos}{sn}', (0.3, 0.26, 0.24), (sx * 1.0, y, 0.78), DARK, BODY, bev=0.02)
        O = empty(f'Outrigger_{pos}{sn}', (sx * 1.0, y, 0.78), BODY, tap='outrigger')
        box(f'OutriggerBeam_{pos}{sn}', (0.9, 0.2, 0.18), (sx * -0.2, 0, 0), YELLOW, O, bev=0.02, static=False)
        box(f'OutriggerStripe_{pos}{sn}', (0.12, 0.205, 0.185), (sx * 0.0, 0, 0), BLACK, O, bev=0.0, static=False)
        box(f'OutriggerJackBody_{pos}{sn}', (0.2, 0.2, 0.36), (sx * 0.2, 0, 0.0), YELLOW, O, bev=0.02, static=False)
        J = empty(f'Outrigger_{pos}{sn}_Jack', (sx * 0.2, 0, 0.155), O)
        cyl(f'JackRod_{pos}{sn}', 0.06, 0.5, (0, 0, -0.1), CHROME, J, seg=16, static=False)
        box(f'JackFoot_{pos}{sn}', (0.36, 0.36, 0.05), (0, 0, -0.36), DARK, J, bev=0.01, static=False)

# ---------------------------------------------------------------- the aerial ladder: turntable, boom, two fly sections, the monitor
TT_Y, TT_Z = 3.0, BODY_Z1 + 0.06
TT = empty('Ladder_Turntable', (0, TT_Y, TT_Z), BODY, tap='ladder')
cyl('TurntableBase', 0.75, 0.16, (0, 0, 0.08), DARK, TT, seg=40, bev=0.01)
cyl('TurntableRing', 0.78, 0.04, (0, 0, 0.04), CHROME, TT, seg=40)
box('TurretTower', (0.9, 0.9, 0.42), (0, 0, 0.36), RED, TT, bev=0.06)
box('ControlPedestal', (0.25, 0.2, 0.5), (0.62, 0.25, 0.4), ALU, TT, bev=0.03)
for k, m in enumerate((V_RED, V_GREEN, V_YELLOW)):
    sph(f'ControlKnob_{k}', 0.035, (0.62, 0.15, 0.68 + 0 * k), m, TT, seg=10) if k == 0 else cyl(f'ControlStick_{k}', 0.015, 0.12, (0.58 + 0.08 * (k - 1), 0.25, 0.7), m, TT, seg=8)
for sx in (-1, 1):
    box(f'BoomCheek_{sx}', (0.1, 0.55, 0.5), (sx * 0.38, -0.05, 0.75), RED, TT, bev=0.03)
cyl('BoomPin', 0.08, 0.9, (0, -0.15, 0.85), CHROME, TT, rot=(0, PI / 2, 0), seg=20)
# the lift cylinder: barrel on the turntable, rod on the boom (the page aims it)
LC = empty('Ladder_LiftCyl', (0, 0.35, 0.5), TT)
cyl('LiftBarrel', 0.09, 0.9, (0, 0, 0.45), YELLOW, LC, seg=20, static=False)
BOOM = empty('Ladder_Boom', (0, -0.15, 0.85), TT, rot=(math.radians(-1.0), 0, 0))
LAD_L = 6.3


def ladder_section(name, parent, L, w, h, m_rail, y0=0.0, z0=0.0):
    """rails and rungs pointing along -Y from the parent's origin"""
    for sx in (-1, 1):
        box(f'{name}_RailTop_{sx}', (0.07, L, 0.07), (sx * w / 2, y0 - L / 2, z0 + h), m_rail, parent, bev=0.012, static=False)
        box(f'{name}_RailBot_{sx}', (0.07, L, 0.1), (sx * w / 2, y0 - L / 2, z0), m_rail, parent, bev=0.012, static=False)
        n = int(L / 0.45)
        for k in range(n + 1):
            yy = y0 - k * L / n
            box(f'{name}_Truss_{sx}_{k}', (0.03, 0.03, h), (sx * w / 2, yy, z0 + h / 2), m_rail, parent, bev=0.0, static=False)
            if k < n:
                box(f'{name}_Diag_{sx}_{k}', (0.025, 0.025, math.hypot(h, L / n)), (sx * w / 2, yy - L / n / 2, z0 + h / 2), m_rail, parent,
                    rot=(math.atan2(L / n, h), 0, 0), bev=0.0, static=False)
    n = int(L / 0.35)
    for k in range(n):
        cyl(f'{name}_Rung_{k}', 0.022, w, (0, y0 - 0.15 - k * (L - 0.3) / (n - 1), z0 + 0.02), ALU, parent, rot=(0, PI / 2, 0), seg=10, static=False)

ladder_section('LadBase', BOOM, LAD_L, 0.86, 0.38, RED)
box('LadBaseFoot', (0.86, 0.3, 0.22), (0, 0.05, 0.1), RED, BOOM, bev=0.03, static=False)
F1 = empty('Ladder_Fly1', (0, 0, 0.06), BOOM)
ladder_section('LadFly1', F1, LAD_L - 0.4, 0.7, 0.3, WHITE)
F2 = empty('Ladder_Fly2', (0, 0, 0.05), F1)
ladder_section('LadFly2', F2, LAD_L - 0.8, 0.56, 0.24, RED)
# the tip: the water monitor (a nozzle that turns), a little platform and a tip light
TIP = empty('Ladder_Tip', (0, -(LAD_L - 0.8), 0.0), F2)
box('TipPlate', (0.6, 0.3, 0.05), (0, -0.1, 0.0), PLATE, TIP, bev=0.01, static=False)
NZ = empty('Ladder_Nozzle', (0, -0.15, 0.15), TIP, tap='nozzle')
cyl('MonitorBase', 0.08, 0.15, (0, 0, 0.05), RED, NZ, seg=16, static=False)
cyl('MonitorBarrel', 0.06, 0.5, (0, -0.25, 0.15), BRASS, NZ, rot=(PI / 2, 0, 0), seg=16, r2=0.035, static=False)
cyl('MonitorTip', 0.045, 0.08, (0, -0.52, 0.15), CHROME, NZ, rot=(PI / 2, 0, 0), seg=16, static=False)
empty('Nozzle_Tip', (0, -0.58, 0.15), NZ)
cyl('TipLight', 0.05, 0.06, (0.22, -0.2, 0.08), L_WORK, TIP, rot=(PI / 2, 0, 0), seg=12, static=False)
# a water pipe along the base section
cyl('LadderPipe', 0.04, LAD_L - 0.3, (0, -(LAD_L - 0.3) / 2, -0.06), ALU, BOOM, rot=(PI / 2, 0, 0), seg=12, static=False)
# the cradle that holds the ladder over the cab
box('CradlePost', (0.12, 0.12, 0.55), (0, CAB_Y1 - 0.15, 3.15), DARK, CAB, bev=0.02)
box('CradleArms', (1.0, 0.14, 0.08), (0, CAB_Y1 - 0.15, 3.42), YELLOW, CAB, bev=0.02)

# ---------------------------------------------------------------- tidy up: merge static parts per (parent, material)
def merge_static():
    groups = {}
    for o in [x for x in bpy.data.objects if x.type == 'MESH']:
        if 'tap' in o.keys(): continue
        groups.setdefault((o.parent.name if o.parent else '', o.data.materials[0].name if o.data.materials else ''), []).append(o)
    for (pn, mn), objs in groups.items():
        if len(objs) < 2: continue
        # apply bevel modifiers first, then join into the first
        for o in objs:
            bpy.context.view_layer.objects.active = o
            for md in list(o.modifiers):
                with bpy.context.temp_override(object=o, active_object=o):
                    bpy.ops.object.modifier_apply(modifier=md.name)
        with bpy.context.temp_override(active_object=objs[0], selected_editable_objects=objs, object=objs[0]):
            bpy.ops.object.join()
        objs[0].name = f'M_{pn}_{mn}'

bpy.ops.wm.save_as_mainfile(filepath=os.path.join(os.path.dirname(os.path.abspath(__file__)), "fire_truck.blend"), compress=True)   # editable copy, parts still separate
merge_static()
tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in bpy.data.objects if o.type == 'MESH')
print('objects', len([o for o in bpy.data.objects if o.type == 'MESH']), 'empties', len([o for o in bpy.data.objects if o.type == 'EMPTY']), 'tris (before bevels)', tris)

# ---------------------------------------------------------------- export
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_apply=True, export_yup=True, export_extras=True,
                          export_materials='EXPORT', export_cameras=False, export_lights=False)
print('exported', OUT, os.path.getsize(OUT) // 1024, 'KB')

# ---------------------------------------------------------------- optional preview render (Eevee), for a quick look from Blender
if PREVIEW:
    cam = bpy.data.objects.new('Cam', bpy.data.cameras.new('Cam')); COL.objects.link(cam)
    SCN.camera = cam; cam.data.lens = 40
    def aim(loc, tgt=(0, 0, 1.5)):
        cam.location = loc; d = Vector(tgt) - Vector(loc); cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    sun = bpy.data.objects.new('Sun', bpy.data.lights.new('Sun', 'SUN')); COL.objects.link(sun)
    sun.rotation_euler = Euler((math.radians(50), 0, math.radians(-30)), 'XYZ'); sun.data.energy = 4
    w = bpy.data.worlds.new('W'); SCN.world = w; w.use_nodes = True
    w.node_tree.nodes['Background'].inputs['Color'].default_value = (0.75, 0.82, 0.9, 1); w.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.9
    SCN.render.engine = 'BLENDER_EEVEE_NEXT'
    SCN.render.resolution_x, SCN.render.resolution_y = 1280, 800
    for k, loc in enumerate(((-11.5, -12.5, 6.0), (10.5, 12.5, 7.0))):
        aim(loc); SCN.render.filepath = PREVIEW.replace('.png', f'_{k}.png')
        bpy.ops.render.render(write_still=True)
    print('preview', PREVIEW)
