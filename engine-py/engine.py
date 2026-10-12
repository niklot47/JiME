# Prototype interpreter for exported JiME scenario data (PlayMaker FSM semantics + simplified board/enemies)
import json, os, random, re, collections, copy

EXPORT = os.path.join(os.environ.get("JIME_WORK", os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")), "export")
_DB = None
def db():
    global _DB
    if _DB is None:
        _DB = json.load(open(os.path.join(EXPORT, "db.json"), encoding="utf-8"))
    return _DB

def load_adventure(adv_id):
    return json.load(open(os.path.join(EXPORT, "adventures", f"{adv_id}.json"), encoding="utf-8"))

_ENC_CACHE = {}
def load_encounter(enc_id):
    if enc_id not in _ENC_CACHE:
        p = os.path.join(EXPORT, "encounters", f"{enc_id}.json")
        _ENC_CACHE[enc_id] = json.load(open(p, encoding="utf-8")) if os.path.exists(p) else None
    return _ENC_CACHE[enc_id]

KEY_RE = re.compile(r"^«(.+)»$")
def key_of(v):
    """Extract localization key from a compacted packet value."""
    if isinstance(v, str):
        m = KEY_RE.match(v); return m.group(1) if m else None
    if isinstance(v, dict):
        if "key" in v: return v["key"]
        if v.get("options"): return v["options"][0]
    return None

class EndGame(Exception):
    pass

# ---------------------------------------------------------------- FSM instance
class Fsm:
    _ids = 0
    def __init__(self, game, data, owner):
        Fsm._ids += 1
        self.id = Fsm._ids
        self.game, self.data, self.owner = game, data, owner      # owner: Obj
        self.name = data.get("name", "FSM")
        self.vars = copy.deepcopy(data.get("variables", {}))
        self.states = {s["name"]: s for s in data["states"]}
        self.state = None
        self.finished = False
        self.started = False
        self.processing = False
        self.events = set(data.get("global", {}).keys())
        for s in data["states"]:
            self.events |= set(s["transitions"].keys())

    def uses_event(self, ev):
        return ev in self.events

    def start(self):
        if self.started: return
        self.started = True
        self.goto(self.data["start"])

    def can_handle(self, ev):
        if self.finished: return False
        if ev in self.data.get("global", {}): return True
        st = self.states.get(self.state)
        return st is not None and ev in st["transitions"]

    def send(self, ev):
        """Deliver an event; returns True if a transition happened."""
        if not self.started: self.start()
        if self.finished or not ev: return False
        tgt = None
        if ev in self.data.get("global", {}):
            tgt = self.data["global"][ev]
        else:
            st = self.states.get(self.state)
            if st and ev in st["transitions"]: tgt = st["transitions"][ev]
        if tgt is None: return False
        self.goto(tgt)
        return True

    def goto(self, name):
        g = self.game
        hops = 0
        while name is not None:
            hops += 1
            if hops > 500:
                g.warn(f"loop guard in {self.owner.name}/{self.name} at {name}"); return
            if name not in self.states:
                g.warn(f"missing state {name}"); return
            self.state = name
            g.coverage[(self.owner.src, self.name, name)] += 1
            st = self.states[name]
            nxt = None
            for a in st["actions"]:
                if not a.get("enabled", True): continue
                g.action_count[a["action"]] += 1
                before = (self.state, g.transition_serial.get(self.id, 0))
                ev = g.exec_action(self, a)
                if self.finished: return
                if (self.state, g.transition_serial.get(self.id, 0)) != before:
                    return  # a nested event already moved this FSM
                if ev:
                    if ev in self.data.get("global", {}):
                        nxt = self.data["global"][ev]
                    elif ev in st["transitions"]:
                        nxt = st["transitions"][ev]
                    else:
                        nxt = None
                        g.warn(f"unhandled event '{ev}' in {self.owner.name}/{name}")
                        return
                    break
            else:
                nxt = st["transitions"].get("FINISHED")
            g.transition_serial[self.id] = g.transition_serial.get(self.id, 0) + 1
            name = nxt

# ---------------------------------------------------------------- scene objects
class Obj:
    """A GameObject from an exported prefab (adventure or encounter instance)."""
    def __init__(self, game, src, pid, go, prefab):
        self.game, self.src, self.pid, self.go, self.prefab = game, src, pid, go, prefab
        self.name = go["name"]
        self.components = go["components"]
        self.fsms = []
        self.visible = False
        self.node = None   # Node if this object is a game node

class Tile:
    def __init__(self, code, hash_id, spaces, section, custom_obj=None):
        self.code, self.id, self.section = code, hash_id, section
        self.spaces = [{"traits": s["traits"], "encounter": None, "node": None} for s in spaces]
        self.visible = False
        self.explored = False
        self.explore_token = True
        self.custom = custom_obj
        self.adjacent_sections = set()

class Node:
    def __init__(self, game, obj, tile=None, space=0, kind="Encounter", enc_id=None):
        self.game, self.obj, self.tile, self.space, self.kind, self.enc_id = game, obj, tile, space, kind, enc_id
        self.visible = False
        obj.node = self

class EnemyGroup:
    _uid = 0
    def __init__(self, model, size, logic=None):
        EnemyGroup._uid += 1
        self.uid = EnemyGroup._uid
        self.model, self.size, self.logic = model, size, logic
        self.unit_hp = int(model.get("Health") or 3)
        self.damage = 0
        self.exhausted = False
        self.activation_override = None

# ---------------------------------------------------------------- game
class Game:
    def __init__(self, adv_id, seed=0, players=2, difficulty="adventure", bot=None, campaign_state=None, log_round_prefix=1):
        self.rng = random.Random(seed)
        self.seed = seed
        self.D = db()
        self.adv = load_adventure(adv_id)
        self.adv_id = adv_id
        self.model = self.adv["model"]
        self.players = players
        self.difficulty = difficulty
        self.bot = bot or Bot(self.rng)
        self.log = []
        self.warnings = collections.Counter()
        self.coverage = collections.Counter()
        self.action_count = collections.Counter()
        self.unimpl = collections.Counter()
        self.transition_serial = {}
        self.round = 1
        self.adv_index = log_round_prefix
        self.campaign = campaign_state if campaign_state is not None else {"lore": 0, "xp": 0, "items": [], "titles": [], "flags": {}, "unlocked_chain": [], "used_encounters": [], "next_adventure": None, "result": None}
        # globals
        self.globals = {k: copy.deepcopy(v["value"]) for k, v in self.D["globals"].items()}
        for k, v in self.campaign["flags"].items(): self.globals[k] = v
        self.globals["PlayerCount"] = players
        self.globals["Round"] = 1
        self.globals["Threat"] = 0
        self.globals["IsDarkness"] = False
        self.threat_max = (self.model.get("ThreatLimitPerPlayer", 0) * players) if self.model.get("ThreatLimitScaledPerPlayer") else self.model.get("ThreatLimit", 0)
        self.active_threat_events = []
        self.enemies = []
        self.reserve = []
        for q in self.model.get("StartingEnemyReserveList") or []:
            em = self.enemy_model(q.get("Enemy"))
            for _ in range(q.get("Quantity", 0)):
                if em: self.reserve.append(em["_id"])
        self.ended = None
        self.objective = None
        self.heroes = [{"damage": 0, "fear": 0, "defeated": False} for _ in range(players)]
        # scene
        self.objs = {}            # (src, pid) -> Obj
        self.all_fsms = []
        self.build_adventure_scene()
        self.build_map()

    # ------------------------------------------------------------ helpers
    def warn(self, msg):
        self.warnings[msg] += 1

    def emit(self, key, *inserts):
        if key is None: return
        self.log.append((self.adv_index, self.round, key, tuple(str(i) for i in inserts)))

    def enemy_model(self, ref):
        if not ref: return None
        if isinstance(ref, dict): ref = ref.get("id")
        return self.D["models"]["EnemyModel"].get(str(ref))

    def model_by(self, typ, ref):
        if not ref: return None
        if isinstance(ref, dict): ref = ref.get("id")
        return self.D["models"].get(typ, {}).get(str(ref))

    def instantiate(self, prefab, src):
        objs = {}
        for pid, go in prefab["gameObjects"].items():
            o = Obj(self, src, int(pid), go, prefab)
            objs[int(pid)] = o
            self.objs[(src, int(pid))] = o
        for fd in prefab["fsms"]:
            o = objs[fd["go"]]
            f = Fsm(self, fd, o)
            o.fsms.append(f)
            self.all_fsms.append(f)
        return objs

    def obj_ref(self, src, ref):
        if isinstance(ref, dict) and ref.get("ref") == "go":
            return self.objs.get((src, ref["go"]))
        return None

    # ------------------------------------------------------------ variables
    def get(self, fsm, v):
        if isinstance(v, str) and v.startswith("@"):
            n = v[1:]
            if n in fsm.vars: return fsm.vars[n]
            if n in self.globals: return self.globals[n]
            if n == "Round": return self.round
            self.warn(f"unknown var {n}")
            return 0
        return v

    def set(self, fsm, v, value):
        if not (isinstance(v, str) and v.startswith("@")): return
        n = v[1:]
        if n in fsm.vars: fsm.vars[n] = value
        elif n in self.globals: self.globals[n] = value
        else: fsm.vars[n] = value

    def num(self, fsm, v, default=0):
        x = self.get(fsm, v)
        if x is None or x == "": return default
        try: return int(x)
        except (TypeError, ValueError):
            try: return int(float(x))
            except Exception: return default

    def boolean(self, fsm, v):
        return bool(self.get(fsm, v))

    # ------------------------------------------------------------ scene construction
    def build_adventure_scene(self):
        self.adv_objs = self.instantiate(self.adv, "adv")
        root = self.adv_objs[self.adv["root"]]
        self.root = root
        self.adv_fsm = root.fsms[0] if root.fsms else None
        comp = root.components.get("Adventure", {})
        self.timers = [self.obj_ref("adv", t) for t in comp.get("Timers") or []]
        self.threat_event_objs = {pid: o for pid, o in self.adv_objs.items() if "ThreatEvent" in o.components}

    def tile_model_by_code(self, code):
        return self.D["models"]["TileModel"].get(code)

    def build_map(self):
        """Simplified map generation following SectionBuilder constraints (no hex geometry)."""
        self.sections = []
        self.tiles = {}
        self.nodes = []
        self.start_tile_id = -1
        mb = None; sec_objs = []
        for pid, o in self.adv_objs.items():
            if "MapBuilder" in o.components: mb = o.components["MapBuilder"]
        self.adv_nodes = []
        for pid, o in self.adv_objs.items():
            gn = o.components.get("GameNode")
            if gn is not None and o.node is None:
                kind = ["Encounter", "Explore", "Threat", "Terrain", "Darkness", "Difficult", "Fortified"][gn.get("NodeType", 0) or 0]
                self.adv_nodes.append(Node(self, o, None, 0, kind, gn.get("EncounterId")))
        if mb is None:
            return
        sec_pids = [s["go"] for s in mb.get("Sections") or []]
        custom = {}
        for pid, o in self.adv_objs.items():
            if "Tile" in o.components:
                tm = o.components["Tile"].get("Model") or {}
                code = tm.get("id") or o.name
                custom[code] = o
        used = set()
        std_codes = list(self.D["standardTiles"].keys())
        self.rng.shuffle(std_codes)
        extra = (self.players - 1) * 2
        for idx, spid in enumerate(sec_pids):
            sb = self.adv_objs[spid].components["SectionBuilder"]
            target = self.rng.randint(sb.get("MinimumSpaces", 1), max(sb.get("MinimumSpaces", 1), sb.get("MaximumSpaces", 1)))
            if not sb.get("IgnorePlayerScaling"):
                target += extra // max(1, len(sec_pids)) + (1 if idx < extra % max(1, len(sec_pids)) else 0)
            tiles = []
            def add_tile(code):
                tm = self.tile_model_by_code(code)
                if code in custom:
                    co = custom[code]
                    spaces = []
                    for sp in co.components["Tile"].get("Spaces") or []:
                        so = self.adv_objs.get(sp["go"])
                        spaces.append({"traits": (so.components.get("TileSpace") or {}).get("Traits", 0) if so else 0})
                    t = Tile(code, (tm or {}).get("HashId", hash(code)), spaces or [{"traits": 0}], idx, co)
                else:
                    st = self.D["standardTiles"].get(code)
                    if st is None: return None
                    t = Tile(code, (tm or {}).get("HashId", hash(code)), st["spaces"], idx)
                used.add(code)
                if tm and tm.get("OtherSideId"): used.add(tm["OtherSideId"])
                tiles.append(t)
                self.tiles[t.id] = t
                return t
            sti = sb.get("StartTileInfo") or {}
            if sti.get("SpecifyStartTile") and (sti.get("Tile") or {}).get("TileCode"):
                self.start_tile_id = add_tile(sti["Tile"]["TileCode"]).id
            for rt in sb.get("RequiredTiles") or []:
                if rt.get("TileCode") and rt["TileCode"] not in used: add_tile(rt["TileCode"])
            allowed = sb.get("AllowedTileSets", 0)
            # satisfy trait requirements first
            for req in sb.get("SpaceTraitRequirements") or []:
                have = sum(1 for t in tiles for s in t.spaces if s["traits"] & req["Trait"])
                for code in std_codes:
                    if have >= req.get("Count", 1): break
                    tm = self.tile_model_by_code(code)
                    if code in used or not tm or not (tm.get("Set", 0) & allowed): continue
                    st = self.D["standardTiles"][code]
                    if any(s["traits"] & req["Trait"] for s in st["spaces"]):
                        add_tile(code); have = sum(1 for t in tiles for s in t.spaces if s["traits"] & req["Trait"])
            for code in std_codes:
                if sum(len(t.spaces) for t in tiles) >= target: break
                tm = self.tile_model_by_code(code)
                if code in used or not tm or not (tm.get("Set", 0) & allowed): continue
                add_tile(code)
            self.sections.append({"id": idx, "builder": sb, "tiles": tiles, "visible": False})
        if not hasattr(self, "start_tile_id") and self.sections and self.sections[0]["tiles"]:
            self.start_tile_id = self.sections[0]["tiles"][0].id
        # connections -> border tiles
        pid2idx = {p: i for i, p in enumerate(sec_pids)}
        for c in mb.get("RequiredConnections") or []:
            a, b = pid2idx.get(c["Section1"]["go"]), pid2idx.get(c["Section2"]["go"])
            if a is None or b is None: continue
            if self.sections[a]["tiles"]: self.rng.choice(self.sections[a]["tiles"]).adjacent_sections.add(b)
            if self.sections[b]["tiles"]: self.rng.choice(self.sections[b]["tiles"]).adjacent_sections.add(a)
        self.place_encounters(mb)

    def ensure_space_for(self, s, enc_ref):
        """Add a standard tile to section s if no free space can host the encounter."""
        enc = self.model_by("EncounterModel", enc_ref)
        if enc is None or enc.get("SpecificTile"): return
        if any(self.space_ok(t, i, enc) for t in s["tiles"] for i in range(len(t.spaces))): return
        used = {t.code for t in self.tiles.values()}
        allowed = s["builder"].get("AllowedTileSets", 0)
        codes = list(self.D["standardTiles"].keys()); self.rng.shuffle(codes)
        for code in codes:
            tm = self.tile_model_by_code(code)
            if code in used or not tm or (tm.get("OtherSideId") in used) or not (tm.get("Set", 0) & allowed): continue
            st = self.D["standardTiles"][code]
            t = Tile(code, tm.get("HashId", hash(code)), st["spaces"], s["id"])
            if any(self.space_ok(t, i, enc) for i in range(len(t.spaces))):
                s["tiles"].append(t); self.tiles[t.id] = t; return

    def add_any_tile(self, s):
        used = {t.code for t in self.tiles.values()}
        allowed = s["builder"].get("AllowedTileSets", 0)
        for code in self.D["standardTiles"]:
            tm = self.tile_model_by_code(code)
            if code in used or not tm or tm.get("OtherSideId") in used or not (tm.get("Set", 0) & allowed): continue
            t = Tile(code, tm.get("HashId", hash(code)), self.D["standardTiles"][code]["spaces"], s["id"])
            s["tiles"].append(t); self.tiles[t.id] = t; return t

    def space_ok(self, tile, si, enc):
        sp = tile.spaces[si]
        if sp["encounter"] is not None: return False
        st = enc.get("SpecificTile")
        if st:
            return st.get("id") == tile.code and enc.get("SpecificSpaceIndex", 0) == si
        req, exc = enc.get("RequiredTraits", 0), enc.get("ExcludedTraits", 0)
        if req and (sp["traits"] & req) != req: return False
        if exc and (sp["traits"] & exc): return False
        return True

    def seed_encounter(self, enc_ref, tiles, section=None):
        enc = self.model_by("EncounterModel", enc_ref)
        if enc is None: return False
        cands = [(t, i) for t in tiles for i in range(len(t.spaces)) if self.space_ok(t, i, enc)]
        if not cands and section is not None:
            self.ensure_space_for(section, enc_ref)
            tiles = section["tiles"]
            cands = [(t, i) for t in tiles for i in range(len(t.spaces)) if self.space_ok(t, i, enc)]
        if not cands:
            cands = [(t, i) for t in tiles for i in range(len(t.spaces)) if t.spaces[i]["encounter"] is None]
            if not cands and section is not None:
                self.add_any_tile(section)
                cands = [(t, i) for t in section["tiles"] for i in range(len(t.spaces)) if t.spaces[i]["encounter"] is None]
            if not cands:
                self.warn(f"could not place {enc.get('m_Name')}"); return False
            self.warn(f"trait mismatch placing {enc.get('m_Name')}")
        t, i = self.rng.choice(cands)
        t.spaces[i]["encounter"] = enc["_id"]
        return True

    def traits_filter_ok(self, enc, flt):
        tr = enc.get("Traits", 0)
        if flt.get("ExcludeIfAny") and tr & flt["ExcludeIfAny"]: return False
        if flt.get("MustHaveAll") and (tr & flt["MustHaveAll"]) != flt["MustHaveAll"]: return False
        if flt.get("MustHaveAny") and not (tr & flt["MustHaveAny"]): return False
        return True

    def place_encounters(self, mb):
        all_tiles = [t for s in self.sections for t in s["tiles"]]
        flt = self.model.get("EncounterTraitsFilter") or {}
        for s in self.sections:
            sb = s["builder"]
            for se in sb.get("SectionEncounters") or []:
                self.ensure_space_for(s, se)
            for te in sb.get("TileEncounters") or []:
                tl = [t for t in s["tiles"] if t.code == te.get("TileCode")] or s["tiles"]
                self.seed_encounter(te.get("Encounter"), tl)
            for se in sb.get("SectionEncounters") or []:
                self.seed_encounter(se, s["tiles"], s)
        for ae in mb.get("AdventureEncounters") or []:
            self.seed_encounter(ae, all_tiles)
        # encounter group
        free = sum(1 for t in all_tiles for sp in t.spaces if sp["encounter"] is None)
        groups = []
        spec = mb.get("SpecifiedEncounterGroup")
        if spec:
            groups = [x for x in [self.model_by("EncounterGroupModel", spec)] if x]
        else:
            for g in self.D["models"]["EncounterGroupModel"].values():
                req = [self.model_by("EncounterModel", r) for r in g.get("RequiredEncounters") or []]
                opt = [self.model_by("EncounterModel", r) for r in g.get("OptionalEncounters") or []]
                if any(e is None for e in req + opt): continue
                if len(req) + g.get("RequiredNumberOfOptionalEncounters", 0) > free: continue
                if all(self.traits_filter_ok(e, flt) for e in req + opt):
                    groups.append(g)
            unused = [g for g in groups if g["_id"] not in self.campaign.get("used_groups", [])]
            groups = unused or groups
        if groups:
            g = self.rng.choice(groups)
            self.encounter_group = g.get("m_Name")
            for r in g.get("RequiredEncounters") or []: self.seed_encounter(r, all_tiles)
            opts = list(g.get("OptionalEncounters") or []); self.rng.shuffle(opts)
            for r in opts[:g.get("RequiredNumberOfOptionalEncounters", 0)]: self.seed_encounter(r, all_tiles)
        # one item encounter whose items the party does not own yet
        items = [e for e in self.D["models"]["EncounterModel"].values() if e.get("Type") == 4
                 and not any((it or {}).get("id") in self.campaign["items"] for it in e.get("Items") or [])]
        self.rng.shuffle(items)
        for e in items:
            cands = [(t, i) for t in all_tiles for i in range(len(t.spaces)) if self.space_ok(t, i, e)]
            if cands:
                t, i = self.rng.choice(cands); t.spaces[i]["encounter"] = e["_id"]; break
        # random fill
        pool = [e for e in self.D["models"]["EncounterModel"].values()
                if (e.get("Type") or 0) == 0 and self.traits_filter_ok(e, flt)
                and (e.get("IsRepeatable") or e["_id"] not in self.campaign["used_encounters"])]
        pool += [e for e in self.D["models"]["EncounterModel"].values() if e.get("Type") == 2 and e["_id"] in self.campaign["unlocked_chain"]]
        self.rng.shuffle(pool)
        placed = {sp["encounter"] for t in all_tiles for sp in t.spaces}
        for s in self.sections:
            spaces = sum(len(t.spaces) for t in s["tiles"])
            want = s["builder"].get("RandomFillPercent", 0) * spaces
            for e in list(pool):
                have = sum(1 for t in s["tiles"] for sp in t.spaces if sp["encounter"] is not None)
                if have >= want: break
                if e["_id"] in placed: continue
                cands = [(t, i) for t in s["tiles"] for i in range(len(t.spaces)) if self.space_ok(t, i, e)]
                if not cands: continue
                t, i = self.rng.choice(cands)
                t.spaces[i]["encounter"] = e["_id"]; placed.add(e["_id"]); pool.remove(e)
        # spawn encounter instances (tiles may have been added during placement)
        all_tiles = [t for s in self.sections for t in s["tiles"]]
        self.nodes = []
        for t in all_tiles:
            for i, sp in enumerate(t.spaces):
                if sp["encounter"] is None: continue
                pf = load_encounter(sp["encounter"])
                if pf is None:
                    self.warn(f"no prefab for encounter {sp['encounter']}"); continue
                src = f"enc{sp['encounter']}"
                objs = self.instantiate(pf, src)
                root = objs[pf["root"]]
                nd = Node(self, root, t, i, "Encounter", sp["encounter"])
                sp["node"] = nd
                self.nodes.append(nd)
                self.campaign["used_encounters"].append(sp["encounter"])

    # ------------------------------------------------------------ event routing
    def owner_target(self, fsm, owner_default):
        """Resolve FsmOwnerDefault -> Obj."""
        if not owner_default or not owner_default.get("ownerOption"):
            return fsm.owner
        return self.obj_ref(fsm.owner.src, owner_default.get("gameObject"))

    def deliver(self, target_fsms, ev):
        for f in target_fsms:
            f.send(ev)

    def broadcast(self, ev, exclude=None):
        for f in list(self.all_fsms):
            if f is exclude: continue
            if f.uses_event(ev) and not f.finished:
                self.deliver_guarded(f, ev)

    def deliver_guarded(self, f, ev):
        """Deliver synchronously like PlayMaker, but defer when nesting gets too deep (cyclic broadcasts)."""
        self.depth = getattr(self, "depth", 0)
        if self.depth > 30:
            self.pending = getattr(self, "pending", [])
            self.pending.append((f, ev)); self.warn("deferred deep event"); return
        self.depth += 1
        try:
            f.send(ev)
        finally:
            self.depth -= 1
        if self.depth == 0:
            while getattr(self, "pending", None):
                pf, pe = self.pending.pop(0)
                self.depth += 1
                try: pf.send(pe)
                finally: self.depth -= 1

    def send_event_target(self, fsm, et, ev):
        t = (et or {}).get("target", 0)
        if t == 0:      # Self
            return ev
        if t == 4:      # BroadcastAll
            self.broadcast(ev, exclude=fsm if (et or {}).get("excludeSelf") else None)
            if not (et or {}).get("excludeSelf") and fsm.uses_event(ev) and fsm.can_handle(ev):
                return None
            return None
        if t in (1, 2, 3):
            o = self.owner_target(fsm, (et or {}).get("gameObject"))
            if o is None: self.warn("send target missing"); return None
            fname = (et or {}).get("fsmName")
            for f in o.fsms:
                if t != 2 or not fname or f.name == fname: self.deliver_guarded(f, ev)
            return None
        self.warn(f"event target {t} unsupported"); return None

    # ------------------------------------------------------------ action execution
    def exec_action(self, fsm, a):
        name, p = a["action"], a["params"]
        h = getattr(self, "a_" + name, None)
        if h is None:
            self.unimpl[name] += 1
            return None
        return h(fsm, p)

    # --- messages / dialogs
    def msg_key(self, fsm, msg):
        k = key_of(msg)
        if isinstance(msg, dict) and msg.get("inserts"):
            ins = []
            for i in msg["inserts"]:
                v = i.get("LocalizationKey")
                ins.append(key_of(v) or i.get("RawText") or self.get(fsm, i.get("VariableString")) or self.get(fsm, i.get("VariableInt")) or "")
            return k, ins
        return k, []

    def show(self, fsm, msg):
        k, ins = self.msg_key(fsm, msg)
        if k: self.emit(k, *ins)
        return k

    def a_DisplayMessage(self, f, p):
        if not p.get("IgnoreLog"): self.show(f, p.get("Message"))
    def a_DisplayMessageAndReveal(self, f, p):
        o = self.obj_ref(f.owner.src, p.get("MessageSource"))
        if o is not None:
            o.visible = True
            if o.node: o.node.visible = True
        if not p.get("IgnoreLog"): self.show(f, p.get("Message"))
    def a_DisplayTutorialMessage(self, f, p): pass
    def a_DisplayMessageChallenge(self, f, p):
        self.show(f, p.get("Message"))
        pairs = p.get("ResultPairs") or []
        top = max([self.num(f, x.get("Sum", 0)) for x in pairs] + [0])
        s = self.bot.successes(self, top, self.show_key(p))
        self.set(f, p.get("Sum"), s)
        for x in pairs:
            if s <= self.num(f, x.get("Sum", 0)): return x.get("Event")
        return pairs[-1].get("Event") if pairs else None
    def show_key(self, p): return key_of(p.get("Message"))
    def a_DisplayMessageCancelConfirm(self, f, p):
        k = self.show_key(p)
        ok = self.bot.confirm(self, k)
        if ok:
            self.show(f, p.get("Message"))
            self.emit(key_of(p.get("ConfirmLabel")) or "UI_CONFIRM")
            return "CONFIRM"
        return "CANCEL"
    def a_DisplayMessageMultipleChoice(self, f, p):
        choices = [c for c in (p.get("Choices") or []) if not c.get("HasDependencies") or self.boolean(f, c.get("Requirement"))]
        cancel = p.get("CancelChoice") or {}
        c = self.bot.choose(self, self.show_key(p), choices, bool(cancel.get("Event")))
        if c is None:
            return cancel.get("Event")
        self.show(f, p.get("Message"))
        self.emit(key_of(c.get("Localization")))
        return c.get("Event")
    def a_DisplayMessagePlayerChoice(self, f, p):
        self.show(f, p.get("Message"))
        self.set(f, p.get("PlayerIndex"), self.rng.randrange(self.players))
        if p.get("CanSkip") and self.rng.random() < 0.2: return p.get("SkipEvent")
    def a_DisplayMessageSelectHighlight(self, f, p):
        self.show(f, p.get("Message"))
    def a_SetObjective(self, f, p):
        self.objective = key_of(p.get("Message"))
    def a_StoreKey(self, f, p):
        self.set(f, p.get("StoreResult"), key_of(p.get("Key")))
    def a_AddAdventureRule(self, f, p): self.emit("RULE:" + str(key_of(p.get("AdventureRule"))))
    def a_RemoveAdventureRule(self, f, p): pass
    def a_SetDarknessMessageOverride(self, f, p): self.globals["DarknessMessageOverride"] = key_of(p.get("Message"))

    # --- flow / variables
    def a_FinishProcessingEvent(self, f, p): f.processing = False
    def a_FinishFSM(self, f, p): f.finished = True
    def a_SetBoolValue(self, f, p): self.set(f, p.get("boolVariable"), self.boolean(f, p.get("boolValue")))
    a_SetFlag = a_SetBoolValue
    def a_SetIntValue(self, f, p): self.set(f, p.get("intVariable"), self.num(f, p.get("intValue")))
    def a_SetStringValue(self, f, p): self.set(f, p.get("stringVariable"), self.get(f, p.get("stringValue")))
    def a_IntAdd(self, f, p): self.set(f, p.get("intVariable"), self.num(f, p.get("intVariable")) + self.num(f, p.get("add")))
    def a_IntClamp(self, f, p):
        v = self.num(f, p.get("intVariable")); v = max(self.num(f, p.get("minValue")), min(v, self.num(f, p.get("maxValue"), v)))
        self.set(f, p.get("intVariable"), v)
    def a_IntOperator(self, f, p):
        a, b, op = self.num(f, p.get("integer1")), self.num(f, p.get("integer2")), p.get("operation", 0)
        r = [a + b, a - b, a * b, (a // b if b else 0), max(a, b), min(a, b)][op] if op < 6 else a
        self.set(f, p.get("storeResult"), r)
    def a_FloatMultiply(self, f, p): self.set(f, p.get("floatVariable"), (self.get(f, p.get("floatVariable")) or 0) * (p.get("multiplyBy") or 0))
    def a_FloatDivide(self, f, p):
        d = p.get("divideBy") or 1; self.set(f, p.get("floatVariable"), (self.get(f, p.get("floatVariable")) or 0) / d)
    def a_BoolFlip(self, f, p): self.set(f, p.get("boolVariable"), not self.boolean(f, p.get("boolVariable")))
    def a_BoolTest(self, f, p): return p.get("isTrue") if self.boolean(f, p.get("boolVariable")) else p.get("isFalse")
    a_CheckBool = a_BoolTest
    a_GetFlag = a_BoolTest
    def a_IntSwitch(self, f, p):
        v = self.num(f, p.get("intVariable"))
        for c, e in zip(p.get("compareTo") or [], p.get("sendEvent") or []):
            if v == self.num(f, c): return e
    def a_IntCompare(self, f, p):
        a, b = self.num(f, p.get("integer1")), self.num(f, p.get("integer2"))
        return p.get("equal") if a == b else (p.get("lessThan") if a < b else p.get("greaterThan"))
    def _bools(self, f, p): return [self.boolean(f, v) for v in p.get("boolVariables") or []]
    def a_BoolAllTrue(self, f, p):
        r = all(self._bools(f, p)); self.set(f, p.get("storeResult"), r)
        return p.get("sendEvent") if r else None
    a_CheckAllTrue = a_BoolAllTrue
    def a_BoolAnyTrue(self, f, p):
        r = any(self._bools(f, p)); self.set(f, p.get("storeResult"), r)
        return p.get("sendEvent") if r else None
    a_CheckAnyTrue = a_BoolAnyTrue
    def a_BoolNoneTrue(self, f, p):
        r = not any(self._bools(f, p)); self.set(f, p.get("storeResult"), r)
        return p.get("sendEvent") if r else None
    def a_RandomInt(self, f, p):
        lo, hi = self.num(f, p.get("min")), self.num(f, p.get("max"))
        if p.get("inclusiveMax"): hi += 1
        self.set(f, p.get("storeResult"), self.rng.randrange(lo, max(lo + 1, hi)))
    def a_SendRandomEvent(self, f, p):
        evs = p.get("events") or []
        if not evs: return None
        w = [float(self.get(f, x) or 0) for x in (p.get("weights") or [1] * len(evs))]
        return self.rng.choices(evs, weights=w if sum(w) > 0 else None)[0]
    def a_SendRandomEventGrabbag(self, f, p):
        evs = p.get("Events") or []
        return self.rng.choice(evs) if evs else None
    def a_SendEventByName(self, f, p): return self.send_event_target(f, p.get("eventTarget"), self.get(f, p.get("sendEvent")))
    a_SendEvent = a_SendEventByName
    def a_DifficultySwitch(self, f, p):
        return p.get({"normal": "Normal", "hard": "Hard", "adventure": "Adventure"}[self.difficulty])
    def a_OwnsProducts(self, f, p): return p.get("EventOwnAll")
    def a_Wait(self, f, p): return p.get("finishEvent")
    def a_Delay(self, f, p): pass
    def a_WaitForFSM(self, f, p): pass
    def a_WaitForFlag(self, f, p):
        if bool(self.get(f, p.get("boolVariable"))) == bool(p.get("Value")): return p.get("EventToFire")
    def _other_fsm(self, f, p):
        o = self.owner_target(f, p.get("gameObject"))
        if o is None: return None
        for x in o.fsms:
            if not p.get("fsmName") or x.name == p.get("fsmName"): return x
    def a_GetFsmInt(self, f, p):
        x = self._other_fsm(f, p)
        if x: self.set(f, p.get("storeValue"), x.vars.get(p.get("variableName"), 0))
    def a_SetBool(self, f, p):
        x = self._other_fsm(f, p)
        if x: x.vars[p.get("variableName")] = bool(p.get("setValue"))
    def a_SetFsmBool(self, f, p): self.a_SetBool(f, p)
    def a_ArrayGet(self, f, p): pass
    def a_ArraySet(self, f, p): pass
    # cosmetic / camera
    for _n in ["FocusCameraOnObjects", "FocusCameraOnWorldPositions", "HighlightLocations", "ClearLocationHighlights", "HighlightTileSpace",
               "Translate", "SetPosition", "GetPosition", "SetVector3XYZ", "TransformPoint", "SetGameObject", "SetTerrainIsUnique",
               "SetWeatherEffect", "SetBoardVisibility", "SetTokenType", "SaveGame", "SetNextCutsceneId", "SetTileSepiaValue",
               "ClearHeroHighlights", "SetHeroHighlights", "ShowTutorialArrow", "HideTutorialArrows", "SetLockedUI", "SetForcedUI", "ClearForcedUI"]:
        exec(f"def a_{_n}(self, f, p): pass")

    # --- campaign / rewards
    def a_AddLore(self, f, p): self.campaign["lore"] += self.num(f, p.get("Lore"))
    def a_AwardXP(self, f, p): self.campaign["xp"] += self.num(f, p.get("XP"))
    def a_AwardTitle(self, f, p): self.campaign["titles"].append((p.get("Title") or {}).get("id"))
    def a_IsTitleEarned(self, f, p): return p.get("AlreadyEarned") if (p.get("Title") or {}).get("id") in self.campaign["titles"] else p.get("NotEarned")
    def a_AddItemToInventory(self, f, p): self.campaign["items"].append((p.get("Item") or {}).get("id"))
    def a_IsItemInInventory(self, f, p): return p.get("InInventory") if (p.get("Item") or {}).get("id") in self.campaign["items"] else p.get("NotInInventory")
    def a_RemoveItemFromInventory(self, f, p):
        i = (p.get("Item") or {}).get("id")
        if i in self.campaign["items"]: self.campaign["items"].remove(i)
    def a_ModifyCorruption(self, f, p): pass
    def a_CheckHero(self, f, p): return p.get("HeroNotInPlayEvent")
    def a_StoreRandomHero(self, f, p): self.set(f, p.get("PlayerIndexVariable"), self.rng.randrange(self.players))
    def a_LockUnlockEncounter(self, f, p):
        e = (p.get("Encounter") or {}).get("id")
        if p.get("Unlock"):
            if e not in self.campaign["unlocked_chain"]: self.campaign["unlocked_chain"].append(e)
        elif e in self.campaign["unlocked_chain"]: self.campaign["unlocked_chain"].remove(e)
    def a_SetNextAdventure(self, f, p): self.campaign["next_adventure"] = (p.get("Adventure") or {}).get("id")
    def a_AddAlternativeAdventure(self, f, p): self.campaign.setdefault("alternatives", []).append((p.get("Adventure") or {}).get("id"))
    def a_ProceedToNextGame(self, f, p):
        self.ended = self.ended or "proceed"; raise EndGame()
    def a_EndCampaign(self, f, p):
        self.campaign["result"] = "campaign_victory" if p.get("Victory") else "campaign_defeat"; self.ended = "campaign_end"; raise EndGame()
    def a_EndGame(self, f, p): self.signal_end(bool(p.get("Success")))

    def signal_end(self, victory):
        if getattr(self, "_ending", False): return
        self._ending = True
        self.result = "victory" if victory else "defeat"
        if self.adv_fsm: self.adv_fsm.send("ADVENTURE_END_VICTORY" if victory else "ADVENTURE_END_FAILURE")
        if not self.ended: self.ended = "end_signalled"
        raise EndGame()

    # --- threat
    def a_AddThreatEvent(self, f, p):
        o = self.obj_ref(f.owner.src, p.get("ThreatEvent"))
        if o is None: return
        if p.get("OverrideDefaultThreat"): o.components["ThreatEvent"]["Threshold"] = self.num(f, p.get("ThreatValue"))
        if o not in self.active_threat_events: self.active_threat_events.append(o)
    def a_RemoveThreatEvent(self, f, p):
        o = self.obj_ref(f.owner.src, p.get("ThreatEvent"))
        if o in self.active_threat_events: self.active_threat_events.remove(o)
    def a_SetMaxThreat(self, f, p): self.threat_max = self.num(f, p.get("MaxThreat"))

    # --- tiles / map
    def tile_by(self, f, p):
        if p.get("SpecifyGameObject"):
            o = self.obj_ref(f.owner.src, p.get("Tile"))
            if o is None: return None
            for t in self.tiles.values():
                if t.custom is o: return t
            code = ((o.components.get("Tile") or {}).get("Model") or {}).get("id")
            for t in self.tiles.values():
                if t.code == code: return t
            return None
        return self.tiles.get(self.num(f, p.get("TileId"), -1))
    def a_GetStartTileId(self, f, p): self.set(f, p.get("storeValue"), self.start_tile_id)
    def a_GetTileId(self, f, p):
        nd = f.owner.node if p.get("Self") else (self.obj_ref(f.owner.src, p.get("Node")) or f.owner).node
        if nd is None:
            # explore node of a custom tile or object placed on a tile
            for t in self.tiles.values():
                if t.custom is not None and f.owner.go.get("parent") in (t.custom.pid,): self.set(f, p.get("storeValue"), t.id); return
            self.warn("GetTileId without node"); return
        self.set(f, p.get("storeValue"), nd.tile.id if nd.tile else -1)
    def a_GetTileSpaceIndex(self, f, p):
        nd = f.owner.node
        self.set(f, p.get("storeValue"), nd.space if nd else 0)
    def a_RevealTile(self, f, p):
        t = self.tile_by(f, p)
        if t and not t.visible:
            t.visible = True
    def a_HideTile(self, f, p):
        t = self.tile_by(f, p)
        if t: t.visible = False
    def a_SetTileState(self, f, p):
        t = self.tile_by(f, {"SpecifyGameObject": 1, "Tile": p.get("Tile")})
        if t: t.visible, t.explored = bool(p.get("IsVisible")), bool(p.get("IsExplored"))
    def a_IsTileExplored(self, f, p):
        t = self.tile_by(f, p)
        return p.get("TrueEvent") if t and t.explored else p.get("FalseEvent")
    def a_IsTileRevealed(self, f, p):
        t = self.tile_by(f, p)
        return p.get("TrueEvent") if t and t.visible else p.get("FalseEvent")
    def a_SetSectionVisibility(self, f, p):
        sid = self.num(f, p.get("SectionId"))
        if sid >= len(self.sections): self.warn(f"no section {sid}"); return
        s = self.sections[sid]
        ignore = {self.num(f, x) for x in p.get("TileIdsToIgnore") or []}
        if not p.get("IsVisible"):
            for t in s["tiles"]: t.visible = False
            return
        new = [t for t in s["tiles"] if not t.visible and t.id not in ignore]
        for t in new:
            t.visible = True
            self.emit("UI_SECTION_REVEAL_PLACE_TILE_FORMATTED", t.code)
        tokens = sum(1 for t in new if not t.explored)
        if tokens == 1: self.emit("UI_PLACE_EXPLORE_TOKEN")
        elif tokens > 1: self.emit("UI_PLACE_EXPLORE_TOKENS")
    def a_ExploreTile(self, f, p):
        t = self.tiles.get(self.num(f, p.get("TileId"), -1))
        if t is None: self.warn("ExploreTile: no tile"); return
        msg = None
        if not p.get("SkipIntro"):
            if p.get("OverrideDefaultIntro"): flav = key_of(p.get("MessageOverride"))
            else: flav = self.flavor(t)
            noinsp = self.difficulty == "hard" or p.get("NoInspiration")
            self.emit("UI_EXPLORE_TILE_WITH_INTRO_FORMATTED", flav, "UI_DISCARD_EXPLORE_TOKEN" if noinsp else "UI_DISCARD_EXPLORE_TOKEN_WITH_INSPIRATION")
        self.explore(t, skip_adjacent=p.get("SkipAdjacentSectionEvent"))
    def flavor(self, t):
        opts = []
        for sp in t.spaces:
            if sp["encounter"] is not None:
                e = self.D["models"]["EncounterModel"].get(str(sp["encounter"])) or {}
                if e.get("TileExploreOverrideKey"): opts.append(e["TileExploreOverrideKey"])
        if opts: return self.rng.choice(opts)
        tm = self.tile_model_by_code(t.code) or {}
        keys = tm.get("DefaultExploreKeys") or [f"TILE_{t.code}"]
        return self.rng.choice(keys)
    def explore(self, t, skip_adjacent=False):
        t.visible = True; t.explored = True; t.explore_token = False
        for sp in t.spaces:
            nd = sp["node"]
            if nd is None: continue
            for fs in nd.obj.fsms:
                if fs.uses_event("PRE_REVEAL"): fs.send("PRE_REVEAL")
            nd.visible = True
            for fs in nd.obj.fsms:
                if fs.uses_event("REVEALED"): fs.send("REVEALED")
        if not skip_adjacent and t.adjacent_sections and self.adv_fsm and self.adv_fsm.uses_event("ADJACENT_TILE_EXPLORED"):
            for sid in sorted(t.adjacent_sections):
                self.adv_fsm.vars["AdjacentSectionId"] = sid
                self.adv_fsm.send("ADJACENT_TILE_EXPLORED")

    # --- nodes
    def node_target(self, f, p):
        o = self.owner_target(f, p.get("Node"))
        return o
    def a_HideThisNode(self, f, p):
        if f.owner.node: f.owner.node.visible = False
        f.owner.visible = False
    def a_HideNode(self, f, p):
        o = self.node_target(f, p)
        if o:
            o.visible = False
            if o.node: o.node.visible = False
    def a_RevealNode(self, f, p):
        o = self.node_target(f, p)
        if o:
            o.visible = True
            if o.node: o.node.visible = True
            elif o.fsms: Node(self, o, None, 0, "Scripted").visible = True
    def a_IsNodeVisible(self, f, p):
        o = self.node_target(f, p)
        vis = bool(o and (o.node.visible if o.node else o.visible))
        return p.get("TrueEvent") if vis else p.get("FalseEvent")
    def a_MoveNode(self, f, p): pass
    def a_SetGameNodeType(self, f, p):
        o = self.node_target(f, p)
        if o and o.node: o.node.kind = ["Encounter", "Explore", "Threat", "Terrain", "Darkness", "Difficult", "Fortified"][p.get("Type", 0)]
    def a_MoveGameObjectToRandomSpace(self, f, p): pass
    def a_RevealTerrainNodes(self, f, p):
        n = len(p.get("TerrainNodes") or [])
        if n: self.emit("UI_REVEAL_TERRAIN", n)
    def a_RevealRandomEncounters(self, f, p): self.warn("RevealRandomEncounters simplified")

    # --- enemies
    def enemy_name(self, m, size):
        return m.get("KeyPlural" if size > 1 else "KeySingular") or m.get("m_Name")
    def unit_cost(self, m, n):
        costs = m.get("Costs") or [{"Num": 1, "Cost": 1}]
        best = None
        for c in costs:
            if c.get("Num", 1) == n: best = c.get("Cost", 0)
        if best is None:
            c1 = costs[0]; best = c1.get("Cost", 1) * n
        return best
    def spawn_group(self, m, size, logic=None, msg_fsm=None, msg=None):
        g = EnemyGroup(m, size, logic)
        self.enemies.append(g)
        self.emit("UI_SPAWN_GROUP_FORMAT", size, self.enemy_name(m, size))
        if logic is not None:
            logic.enemy_group = g
        return g
    def a_SpawnEnemyGroup(self, f, p):
        m = self.enemy_model(p.get("GroupToSpawn"))
        if m is None: return p.get("Failed")
        if p.get("SpecifySize"): size = max(1, self.num(f, p.get("GroupSize"), 1))
        else:
            pts = self.num(f, p.get("AdditionalPoints")); size = 1
            while size < (m.get("MaxUnitCount") or 3) and self.unit_cost(m, size + 1) <= pts: size += 1
        self.show(f, p.get("Message"))
        logic = self.obj_ref(f.owner.src, p.get("Logic"))
        self.spawn_group(m, size, logic)
        return p.get("Succeeded")
    def eligible_enemies(self, pts, flt=None):
        out = []
        for m in self.D["models"]["EnemyModel"].values():
            if m.get("IsNamed") or m.get("IsUnique"): continue
            if self.unit_cost(m, 1) > pts: continue
            tr = m.get("Traits", 0)
            if flt:
                if flt.get("ExcludeIfAny") and tr & flt["ExcludeIfAny"]: continue
                if flt.get("MustHaveAll") and (tr & flt["MustHaveAll"]) != flt["MustHaveAll"]: continue
                if flt.get("MustHaveAny") and not (tr & flt["MustHaveAny"]): continue
            gflt = self.model.get("GlobalEnemyFilter") or {}
            if gflt.get("ExcludeIfAny") and tr & gflt["ExcludeIfAny"]: continue
            if gflt.get("MustHaveAny") and not (tr & gflt["MustHaveAny"]): continue
            out.append(m)
        return out
    def a_SpawnRandomEnemyGroups(self, f, p):
        pts = self.num(f, p.get("Points")) + (0 if p.get("ExcludeGameEnemyPts") else self.num(f, "@EnemyPoints"))
        self.show(f, p.get("Message"))
        reserve = [self.enemy_model(e) for e in self.reserve]
        guard = 0
        while pts > 0 and guard < 10:
            guard += 1
            cands = [m for m in reserve if m and self.unit_cost(m, 1) <= pts] or self.eligible_enemies(pts, p.get("Filter"))
            if not cands: break
            m = self.rng.choice(cands); size = 1
            while size < (m.get("MaxUnitCount") or 3) and self.unit_cost(m, size + 1) <= pts: size += 1
            pts -= self.unit_cost(m, size)
            self.spawn_group(m, size)
        self.globals["EnemyPoints"] = 0
    def a_SpawnEnemyGroupsFromSpawnPoints(self, f, p):
        sps = p.get("SpawnPoints") or []
        per = p.get("SpawnPointsEnemyPoints") or []
        total = self.num(f, p.get("EnemyPoints"))
        for i, sp in enumerate(sps):
            o = self.obj_ref(f.owner.src, sp)
            flt = ((o.components.get("EnemySpawnPoint") if o else None) or {}).get("Filter")
            pts = self.num(f, per[i]) if i < len(per) else total // max(1, len(sps))
            if pts <= 0: continue
            c = self.eligible_enemies(pts, flt)
            if not c: continue
            m = self.rng.choice(c); size = 1
            while size < (m.get("MaxUnitCount") or 3) and self.unit_cost(m, size + 1) <= pts: size += 1
            self.spawn_group(m, size)
    def a_EnemyGroupRemoveFromReserve(self, f, p):
        m = self.enemy_model(p.get("Enemy"))
        for _ in range(self.num(f, p.get("Quantity"), 1)):
            if m and m["_id"] in self.reserve: self.reserve.remove(m["_id"])
    def a_EnemyBannerRemoveFromReserve(self, f, p): pass
    def group_by_logic(self, f, p):
        for key in ("Logic", "Group"):
            o = self.obj_ref(f.owner.src, p.get(key))
            if o is None: continue
            for g in self.enemies:
                if g.logic is o or getattr(g, "obj", None) is o: return g
        return None
    def a_EnemyGroupAddToTracker(self, f, p):
        o = self.obj_ref(f.owner.src, p.get("Group") or p.get("Logic"))
        eg = (o.components.get("EnemyGroup") if o else None) or {}
        m = self.enemy_model(eg.get("Model"))
        if not m: self.warn("EnemyGroupAddToTracker: unknown group"); return
        logic = self.obj_ref(f.owner.src, eg.get("Logic")) or o
        g = self.spawn_group(m, eg.get("_unitStartCount", 1) or 1, logic)
        g.obj = o
        hp = eg.get("_unitHealth") or []
        if hp: g.unit_hp = max(hp)
    def a_EnemyGroupRemoveAll(self, f, p): self.enemies.clear()
    def a_EnemyGroupRemove(self, f, p):
        g = self.group_by_logic(f, p)
        if g in self.enemies: self.enemies.remove(g)
    def a_EnemyGroupDefeat(self, f, p):
        g = self.group_by_logic(f, p)
        if g: self.defeat_group(g)
    def a_EnemyGroupExhaust(self, f, p):
        g = self.group_by_logic(f, p)
        if g: g.exhausted = True
    def a_EnemyGroupActivate(self, f, p):
        g = self.group_by_logic(f, p)
        if g: self.activate(g)
    def a_EnemyGroupHeal(self, f, p):
        g = self.group_by_logic(f, p)
        if g: g.damage = max(0, g.damage - self.num(f, p.get("HealingAmount")))
    def a_EnemyGroupHealAll(self, f, p):
        for g in self.enemies: g.damage = max(0, g.damage - self.num(f, p.get("HealingAmount")))
    def a_EnemyGroupResetStats(self, f, p): pass
    def a_SetEnemyActivationOverride(self, f, p):
        g = self.group_by_logic(f, p)
        if g: g.activation_override = (p.get("Override") or {}).get("id")
    def a_IsEnemyTrackerEmpty(self, f, p): return p.get("IsEmpty") if not self.enemies else p.get("NotEmpty")
    def a_IsEnemyTypeOnTracker(self, f, p):
        m = self.enemy_model(p.get("EnemyType"))
        on = any(g.model is m for g in self.enemies)
        return p.get("OnTracker") if on else p.get("NotOnTracker")
    def a_GetEnemyReadyState(self, f, p):
        g = self.group_by_logic(f, p); self.set(f, p.get("storeValue"), 0 if (g and g.exhausted) else 1)
    def a_SetNamedEnemy(self, f, p): pass

    def defeat_group(self, g):
        if g.logic is not None:
            for fs in g.logic.fsms:
                if fs.uses_event("TRY_DEFEAT"):
                    fs.send("TRY_DEFEAT"); return
        if g in self.enemies: self.enemies.remove(g)
        if g.logic is not None:
            for fs in g.logic.fsms:
                if fs.uses_event("DEFEATED"): fs.send("DEFEATED")

    def activate(self, g):
        acts = [self.D["models"]["EnemyActivationModel"].get(str(a.get("id"))) for a in g.model.get("Activations") or []]
        acts = [a for a in acts if a and a.get("MinGroupSize", 1) <= g.size <= a.get("MaxGroupSize", 99)] or [a for a in acts if a]
        if g.activation_override:
            ov = self.D["models"]["EnemyActivationModel"].get(str(g.activation_override))
            if ov: acts = [ov]
        if not acts: return
        a = self.rng.choice(acts)
        # either a primary attack or an alternate activation, as decided by the bot answering prompts
        if a.get("KeyAltActivation") and self.rng.random() < 0.25:
            self.emit(a["KeyAltActivation"]); return
        self.emit(a.get("KeyAttackFlavor"))
        dmg = (a.get("Damage") or [{}])
        d = next((x for x in dmg if x.get("Size") == g.size), dmg[-1])
        hero = self.rng.randrange(self.players)
        ph, fe = d.get("Physical", 0), d.get("Fear", 0)
        if a.get("KeyAttackAdditionalEffect"): self.emit("UI_DAMAGE_LOG_WITH_EFFECT_FORMATTED", ph, fe, a["KeyAttackAdditionalEffect"])
        else: self.emit("UI_DAMAGE_LOG_FORMATTED", ph, fe)
        h = self.heroes[hero]; h["damage"] += max(0, ph - self.rng.randint(0, 2)); h["fear"] += max(0, fe - self.rng.randint(0, 2))

    # ------------------------------------------------------------ round loop
    def process_root(self, ev):
        if self.adv_fsm and self.adv_fsm.uses_event(ev):
            self.adv_fsm.send(ev)

    def run(self, max_rounds=40):
        try:
            for f in self.all_fsms:
                f.start()
            self.process_root("SCENARIO_BEGIN")
            self.process_root("ROUND_START")
            while self.round <= max_rounds:
                self.emit("UI_PHASE_HERO") if self.round > 1 else None
                self.hero_phase()
                self.end_round()
            self.ended = self.ended or "max_rounds"
        except EndGame:
            pass
        return self

    def clickable_nodes(self):
        out = []
        for nd in self.nodes + self.adv_nodes:
            if nd is None or not nd.visible: continue
            if nd.tile is not None and not nd.tile.visible: continue
            if any(fs.can_handle("NODE CLICKED") for fs in nd.obj.fsms):
                out.append(nd)
        return out

    def explorable_tiles(self):
        return [t for t in self.tiles.values() if t.visible and not t.explored and t.explore_token]

    def hero_phase(self):
        for hero in range(self.players):
            if self.heroes[hero]["defeated"]: continue
            for _ in range(2):
                opts = []
                for nd in self.clickable_nodes(): opts.append(("node", nd))
                for t in self.explorable_tiles(): opts.append(("explore", t))
                for g in self.enemies: opts.append(("attack", g))
                if not opts: break
                kind, x = self.bot.pick_action(self, opts)
                if kind == "node":
                    for fs in x.obj.fsms:
                        if fs.can_handle("NODE CLICKED"): fs.send("NODE CLICKED"); break
                elif kind == "explore":
                    self.emit("UI_CONFIRM_EXPLORE"); self.emit("UI_CONFIRM")
                    flav = self.flavor(x)
                    self.emit("UI_EXPLORE_TILE_WITH_INTRO_FORMATTED", flav, "UI_DISCARD_EXPLORE_TOKEN_WITH_INSPIRATION" if self.difficulty != "hard" else "UI_DISCARD_EXPLORE_TOKEN")
                    self.explore(x)
                elif kind == "attack":
                    dmg = self.rng.randint(1, 4)
                    x.damage += dmg
                    if x.damage >= x.unit_hp:
                        killed = x.damage // x.unit_hp
                        x.size -= killed; x.damage -= killed * x.unit_hp
                        if x.size <= 0: self.defeat_group(x)

    def end_round(self):
        for h in self.heroes:
            if h["defeated"]: return self.signal_end(False)
        if self.globals["Threat"] >= self.threat_max > 0: return self.signal_end(False)
        self.emit("UI_PHASE_SHADOW")
        if self.difficulty == "hard": self.globals["EnemyPoints"] = (self.globals.get("EnemyPoints") or 0) + self.players
        for g in list(self.enemies): g.exhausted = False
        for g in list(self.enemies):
            if g in self.enemies and not g.exhausted:
                self.activate(g); g.exhausted = True
        if not self.model.get("DisableDarkness") and self.globals.get("IsDarkness"):
            self.emit(self.globals.get("DarknessMessageOverride") or "UI_DARKNESS_FEAR")
        for t in self.timers:
            if t:
                for fs in t.fsms:
                    if fs.uses_event("ROUND_END"): fs.send("ROUND_END")
        self.process_root("ROUND_END")
        delta = 2 * self.players + sum(1 for n in self.nodes if n.visible and n.kind == "Threat")
        if self.difficulty != "adventure":
            delta += sum(1 for t in self.tiles.values() if t.visible and not t.explored)
        self.emit("UI_THREAT_INCREASE", delta)
        self.globals["Threat"] += delta
        while True:
            due = sorted([o for o in self.active_threat_events if o.components["ThreatEvent"]["Threshold"] <= self.globals["Threat"]],
                         key=lambda o: o.components["ThreatEvent"]["Threshold"])
            if not due: break
            o = due[0]
            self.active_threat_events.remove(o)
            for fs in o.fsms:
                fs.start(); fs.send("THREAT_EVENT_START")
        if self.globals["Threat"] >= self.threat_max > 0: return self.signal_end(False)
        # last stand checks (simplified: heroes with heavy damage roll a test)
        for i, h in enumerate(self.heroes):
            if h["damage"] + h["fear"] >= 10 and not h["defeated"]:
                phys = h["damage"] >= h["fear"]
                lm = self.D["models"]["LastStandModel"]["1" if phys else "2"]
                self.emit(self.rng.choice(lm["MessageKeys"]), self.rng.randint(1, 3))
                if self.bot.last_stand(self):
                    self.emit("UI_PASS"); self.emit("UI_LAST_STAND_PASSED_PHYSICAL" if phys else "UI_LAST_STAND_PASSED_FEAR")
                    h["damage"] = h["fear"] = 4
                else:
                    self.emit("UI_FAIL"); self.emit("UI_LAST_STAND_FAILED"); h["defeated"] = True
        self.emit("UI_RALLY_PHASE"); self.emit("UI_RALLY_PHASE_INSTRUCTIONS")
        self.round += 1
        self.globals["Round"] = self.round
        self.process_root("ROUND_START")

# ---------------------------------------------------------------- bot
class Bot:
    """Random-but-sensible player: answers dialogs and chooses hero actions."""
    def __init__(self, rng, pass_bias=0.65):
        self.rng, self.pass_bias = rng, pass_bias
    def successes(self, game, top, key):
        if top <= 0: return self.rng.randint(0, 2)
        return self.rng.randint(top - 1, top + 1) if self.rng.random() < self.pass_bias else self.rng.randint(0, max(0, top - 1))
    def last_stand(self, game):
        return self.rng.random() < 0.6
    def confirm(self, game, key):
        return self.rng.random() < 0.9
    def choose(self, game, key, choices, can_cancel):
        if not choices or (can_cancel and self.rng.random() < 0.05): return None
        return self.rng.choice(choices)
    def pick_action(self, game, opts):
        w = []
        for k, x in opts:
            w.append({"node": 5, "explore": 3, "attack": 4}[k])
        return self.rng.choices(opts, weights=w)[0]
