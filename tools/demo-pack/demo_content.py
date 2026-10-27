"""
The demo campaign's scenarios, written with a small builder in the pack's scenario format (jime-scenario):
game objects with components (Adventure, MapBuilder, SectionBuilder, ThreatEvent, GameNode) and PlayMaker-like FSMs
(states, actions with params, transitions by event, global events).

Adventure 9101 "The Grey Ford": find three clues (search and person events), the bandits' camp appears, storm it.
Adventure 9102 "The Shade's Lair": two omens open the way to the altar in the ruins; the campaign ends there.
"""

CAMPAIGN = 9001
ADV1, ADV2 = 9101, 9102


def k(key):
    """A text key as a parameter value"""
    return f"«{key}»"


def act(name, **params):
    return {"action": name, "enabled": True, "params": params}


def go(pid, kind="GameObject"):
    return {"ref": "go", "go": pid, "kind": kind}


def msg_with(key, insert):
    """A message whose {0} is another text key"""
    return {"key": key, "inserts": [{"LocalizationKey": k(insert), "filter": 8}]}


class Fsm:
    def __init__(self, start, variables=None, glob=None, name="FSM"):
        self.d = {"name": name, "start": start, "variables": variables or {}, "global": glob or {}, "states": []}

    def state(self, name, actions=(), **transitions):
        # transitions by event; events that are not identifiers ("NODE CLICKED", "0") go in a dict
        tr = dict(transitions.pop("on", {}))
        tr.update(transitions)
        self.d["states"].append({"name": name, "transitions": tr, "actions": list(actions)})
        return self


def prefab(kind, pid, root, objects, fsms, model=None):
    p = {"format": "jime-scenario", "formatVersion": 1, "kind": kind, "id": pid, "source": "jime-demo", "root": root}
    if model is not None:
        p["model"] = model
    p["gameObjects"] = {str(o): v for o, v in objects.items()}
    p["fsms"] = [dict(f.d) for f in fsms]
    # each FSM's owner: the game object that lists it in PlayMakerFSM
    for oid, o in objects.items():
        for i in o["components"].get("PlayMakerFSM", []):
            p["fsms"][i]["go"] = oid
    assert all("go" in f for f in p["fsms"]), f"{kind} {pid}: an FSM without owner"
    return p


def obj(name, parent, **components):
    return {"name": name, "parent": parent, "components": components}


def enc_model(eid, name, etype, node_type=None):
    m = {"m_Name": f"{eid}_{name}", "_id": eid, "Prefab": {"Path": f"jime-demo/encounters/{eid}"}, "Type": etype}
    if node_type is not None:
        m["NodeType"] = node_type
    return m


TOKEN = {"search": 2, "threat": 3, "person": 7}
PLACE = {"search": "PLACE_SEARCH", "threat": "PLACE_THREAT", "person": "PLACE_PERSON"}


def encounter(eid, name, etype, token, fsm):
    root = 1
    objects = {root: obj(f"{eid}_{name}", None, GameNode={"Token3DType": TOKEN[token], "EncounterId": -1, "TerrainId": -1, "UniqueTokenId": -1}, PlayMakerFSM=[0])}
    return {"id": eid, "model": enc_model(eid, name, etype), "prefab": prefab("encounter", eid, root, objects, [fsm])}


def reveal_states(f, token, key):
    """REVEALED: say where the token goes, then wait for a click"""
    f.state("On Revealed", [act("DisplayMessage", Message=msg_with(PLACE[token], key))], FINISHED="Finish Processing")
    f.state("Finish Processing", [act("FinishProcessingEvent")], FINISHED="Wait for Click")
    f.state("Wait for Click", on={"NODE CLICKED": "Confirm"})


def search_event(eid, name, base, lore=1, send=None, etype=3, item=None):
    """Search token: confirm, a test (1 success), pass -> lore (+ event / item), fail -> try again later"""
    f = Fsm("Wait for Click", glob={"REVEALED": "On Revealed"})
    reveal_states(f, "search", f"{base}_SEARCH")
    f.state("Confirm", [act("DisplayMessageCancelConfirm", ConfirmLabel=k("UI_SEARCH"), CancelLabel=k("UI_CANCEL"), Message=k(f"{base}_SEARCH"))],
            CONFIRM="Test", CANCEL="Wait for Click")
    f.state("Test", [act("DisplayMessageChallenge", ResultPairs=[{"Event": "0"}, {"Sum": 1, "Event": "1"}], Message=k(f"{base}_TEST"))],
            on={"0": "Fail", "1": "Pass"})
    passed = [act("DisplayMessage", Message=k(f"{base}_PASS")), act("AddLore", Lore=lore)]
    if item:
        passed.append(act("AddItemToInventory", Item={"ref": "ItemModel", "name": f"{item}_item", "id": item}))
    if send:
        passed.append(act("SendEventByName", eventTarget={"target": 4}, sendEvent=send))
    f.state("Pass", passed, FINISHED="Done")
    f.state("Fail", [act("DisplayMessage", Message=k(f"{base}_FAIL"))], FINISHED="Wait for Click")
    f.state("Done", [act("HideThisNode"), act("FinishFSM")])
    return encounter(eid, name, etype, "search", f)


def person_event(eid, name, base, send):
    """Person token: ask (a test) or pay (lore); either way the clue"""
    f = Fsm("Wait for Click", glob={"REVEALED": "On Revealed"})
    reveal_states(f, "person", f"{base}_INTRO")
    f.state("Confirm", [act("DisplayMessageMultipleChoice", Choices=[{"Localization": k(f"{base}_ASK"), "Event": "ASK"}, {"Localization": k(f"{base}_PAY"), "Event": "PAY"}],
                            CancelChoice={"Localization": k("UI_CANCEL"), "Event": "CANCEL"}, Message=k(f"{base}_CHOICE"))],
            ASK="Ask", PAY="Pay", CANCEL="Wait for Click")
    f.state("Ask", [act("DisplayMessageChallenge", ResultPairs=[{"Event": "0"}, {"Sum": 2, "Event": "1"}], Message=k(f"{base}_ASK_TEST"))],
            on={"0": "Ask Fail", "1": "Clue"})
    f.state("Ask Fail", [act("DisplayMessage", Message=k(f"{base}_ASK_FAIL"))], FINISHED="Wait for Click")
    f.state("Pay", [act("DisplayMessage", Message=k(f"{base}_PAY_RESULT")), act("AddLore", Lore=-1)], FINISHED="Clue")
    f.state("Clue", [act("DisplayMessage", Message=k(f"{base}_CLUE")), act("SendEventByName", eventTarget={"target": 4}, sendEvent=send)], FINISHED="Done")
    f.state("Done", [act("HideThisNode"), act("FinishFSM")])
    return encounter(eid, name, 3, "person", f)


def final_event(eid, name, base, successes, reinforce):
    """Threat token: the final test; pass ends the adventure with a victory, fail brings enemies"""
    f = Fsm("Wait for Click", glob={"REVEALED": "On Revealed"})
    reveal_states(f, "threat", f"{base}_INTRO")
    f.state("Confirm", [act("DisplayMessageCancelConfirm", ConfirmLabel=k("UI_CONFIRM"), CancelLabel=k("UI_CANCEL"), Message=k(f"{base}_CONFIRM"))],
            CONFIRM="Test", CANCEL="Wait for Click")
    f.state("Test", [act("DisplayMessageChallenge", ResultPairs=[{"Event": "0"}, {"Sum": successes, "Event": "1"}], Message=k(f"{base}_TEST"))],
            on={"0": "Fail", "1": "Victory"})
    f.state("Fail", [act("SpawnRandomEnemyGroups", Message=k(f"{base}_FAIL"), MessageLocation=4, Points=reinforce)], FINISHED="Wait for Click")
    f.state("Victory", [act("DisplayMessage", Message=k(f"{base}_PASS")), act("EndGame", Success=1)])
    return encounter(eid, name, 3, "threat", f)


# ------------------------------------------------------------------ events (encounters)
E1_TRACKS, E1_FERRYMAN, E1_CART, E1_CAMP = 910101, 910102, 910103, 910104
E2_OMEN1, E2_OMEN2, E2_ALTAR = 910201, 910202, 910203
ENCOUNTERS = [
    search_event(E1_TRACKS, "Tracks", "D1_TRACKS", send="DEMO_CLUE"),
    person_event(E1_FERRYMAN, "Ferryman", "D1_FERRYMAN", send="DEMO_CLUE"),
    search_event(E1_CART, "Overturned Cart", "D1_CART", send="DEMO_CLUE", item=9131),
    final_event(E1_CAMP, "Bandit Camp", "D1_CAMP", successes=2, reinforce=7),
    search_event(E2_OMEN1, "Raven Stone", "D2_OMEN1", lore=1, send="DEMO_OMEN"),
    search_event(E2_OMEN2, "Cold Spring", "D2_OMEN2", lore=1, send="DEMO_OMEN"),
    final_event(E2_ALTAR, "Altar", "D2_ALTAR", successes=3, reinforce=10),
    # the random pool (Type 0): the map fills free spaces with these
    search_event(919001, "Old Well", "R_WELL", lore=1, etype=0),
    search_event(919002, "Hollow Tree", "R_TREE", lore=1, etype=0),
    search_event(919003, "Abandoned Camp", "R_CAMPFIRE", lore=2, etype=0),
    search_event(919004, "Waystone", "R_WAYSTONE", lore=1, etype=0),
    search_event(919005, "Bramble Thicket", "R_BRAMBLE", lore=1, etype=0),
    # encounter groups (Type 1): every map gets one group of the owned products
    search_event(919101, "Peddler's Pack", "G_PEDDLER", lore=1, etype=1),
    search_event(919102, "Shepherd's Hut", "G_HUT", lore=1, etype=1),
    search_event(919103, "Fallen Shrine", "G_SHRINE", lore=2, etype=1),
]


def enc_ref(eid):
    m = next(e for e in ENCOUNTERS if e["id"] == eid)["model"]
    return {"ref": "EncounterModel", "name": m["m_Name"], "id": eid}


# ------------------------------------------------------------------ adventures
def section(name, parent, lo, hi, start=None, required=None, encounters=(), fill=0.5):
    sb = {"AllowedTileSets": 1, "MinimumSpaces": lo, "MaximumSpaces": hi, "IgnorePlayerScaling": 1,
          "TileClumpFactor": 0.5, "SectionClumpFactor": 0.5, "RelativeSizeFactor": 0.5}
    if start:
        sb["StartTileInfo"] = {"SpecifyStartTile": 1, "Tile": {"IsStandard": 1, "TileCode": start}}
    if required:
        sb["RequiredTiles"] = [{"IsStandard": 1, "TileCode": c} for c in required]
    sb["RandomFillPercent"] = fill
    if encounters:
        sb["SectionEncounters"] = [enc_ref(e) for e in encounters]
    sb["LastAttachedTileId"] = -1
    return obj(name, parent, SectionBuilder=sb)


def threat_fsm(points, message):
    f = Fsm("Waiting", variables={"EP": points}, glob={"THREAT_EVENT_START": "Spawn"})
    f.state("Waiting")
    f.state("Spawn", [act("SpawnRandomEnemyGroups", Message=k(message), MessageLocation=4, Points="@EP")], FINISHED="Finished")
    f.state("Finished", [act("HideThisNode"), act("FinishFSM")])
    return f


def opening(f, base, start_tile, threats, objective):
    """SCENARIO_BEGIN: threats, intro, start tile, heroes, first section, objective"""
    f.state("Set Threats", [act("AddThreatEvent", ThreatEvent=go(t)) for t in threats], FINISHED="Intro")
    f.state("Intro", [act("DisplayMessage", Message=k(f"{base}_INTRO"))], FINISHED="Place Start Tile")
    f.state("Place Start Tile", [act("GetStartTileId", storeValue="@StartTileId"), act("RevealTile", FocusCamera=1, TileId="@StartTileId"),
                                 act("DisplayMessage", Message=msg_with("PLACE_TILE_NO_FLAVOR", start_tile))], FINISHED="Hero Placement")
    f.state("Hero Placement", [act("DisplayMessage", Message=k(f"{base}_HEROES")),
                               act("HighlightTileSpace", FocusCamera=1, SpecifyIndex=1, IndexSpace=0, TileId="@StartTileId")], FINISHED="Explore Start")
    f.state("Explore Start", [act("ExploreTile", TileId="@StartTileId", MessageOverride=k(f"{base}_START_TILE"), SkipIntro=1, NoInspiration=1, SkipOutro=1)],
            FINISHED="Section 0")
    f.state("Section 0", [act("SetSectionVisibility", SectionId=0, IsVisible=1)], FINISHED="Objective")
    f.state("Objective", [act("SetObjective", Message=k(objective))], FINISHED="Finished")
    f.state("Finished", [act("FinishProcessingEvent")])


def adventure1():
    root, mb, s0, s1, t1, t2 = 1, 2, 10, 11, 20, 21
    model = {"m_Name": f"{ADV1}_Grey Ford", "_id": ADV1, "Prefab": {"Path": f"jime-demo/adventures/{ADV1}"}, "NameKey": "D1_TITLE", "LocationKey": "D1_LOCATION", "RestStoryKey": "D1_DESC",
             "BonusPref": 1.0, "FigurePref": 1.0, "ThreatLimit": 18, "CanFail": 1, "StartingEnemyReserveList": []}
    objects = {
        root: obj(f"{ADV1}_Grey Ford", None, Adventure={"Model": {"ref": "AdventureModel", "name": model["m_Name"], "id": ADV1}}, PlayMakerFSM=[0]),
        mb: obj("Map_Builder", root, MapBuilder={"RandomSeed": 1, "Seed": 0, "RequiredConnections": [{"Section1": go(s0, "SectionBuilder"), "Section2": go(s1, "SectionBuilder")}],
                                                  "InvalidConnections": [], "Sections": [go(s0, "SectionBuilder"), go(s1, "SectionBuilder")], "PlayerCount": 1}),
        s0: section("Section_Builder_0", mb, 6, 7, start="D01A", encounters=(E1_TRACKS, E1_FERRYMAN, E1_CART), fill=0.5),
        s1: section("Section_Builder_1", mb, 3, 4, required=("D05B",), encounters=(E1_CAMP,), fill=0.3),
        t1: obj("ThreatEvent_1", root, PlayMakerFSM=[1], ThreatEvent={"Threshold": 6, "InfoKey": "D1_THREAT_1_INFO"}),
        t2: obj("ThreatEvent_2", root, PlayMakerFSM=[2], ThreatEvent={"Threshold": 12, "InfoKey": "D1_THREAT_2_INFO"}),
    }
    f = Fsm("Idle", variables={"StartTileId": 0, "Clues": 3},
            glob={"SCENARIO_BEGIN": "Set Threats", "ADVENTURE_END_VICTORY": "Win", "ADVENTURE_END_FAILURE": "Loss", "DEMO_CLUE": "Clue Found"})
    f.state("Idle")
    opening(f, "D1", "D01A", (t1, t2), "D1_OBJECTIVE_1")
    f.state("Clue Found", [act("IntAdd", intVariable="@Clues", add=-1)], FINISHED="Clues Left")
    f.state("Clues Left", [act("IntCompare", integer1="@Clues", integer2=0, equal="TRUE", lessThan="TRUE", greaterThan="FALSE")],
            TRUE="Camp Found", FALSE="More Clues")
    f.state("More Clues", [act("DisplayMessage", Message=k("D1_CLUE_MORE"))], FINISHED="Finished")
    f.state("Camp Found", [act("DisplayMessage", Message=k("D1_CAMP_FOUND")), act("SetSectionVisibility", SectionId=1, IsVisible=1)], FINISHED="Camp Objective")
    f.state("Camp Objective", [act("SetObjective", Message=k("D1_OBJECTIVE_2"))], FINISHED="Finished")
    f.state("Win", [act("DisplayMessage", Message=k("D1_WIN")), act("AwardXP", XP=3), act("AddLore", Lore=2)], FINISHED="Next")
    f.state("Loss", [act("DisplayMessage", Message=k("D1_LOSS")), act("AwardXP", XP=1)], FINISHED="Next")
    f.state("Next", [act("SetNextAdventure", Adventure={"ref": "AdventureModel", "name": f"{ADV2}_Shade's Lair", "id": ADV2}), act("ProceedToNextGame")],
            FINISHED="Fin")
    f.state("Fin", [act("FinishFSM")])
    fsms = [f, threat_fsm(7, "D1_THREAT_1"), threat_fsm(11, "D1_THREAT_2")]
    return {"id": ADV1, "model": model, "prefab": prefab("adventure", ADV1, root, objects, fsms, model)}


def adventure2():
    root, mb, s0, s1, s2, t1, t2 = 1, 2, 10, 11, 12, 20, 21
    model = {"m_Name": f"{ADV2}_Shade's Lair", "_id": ADV2, "Prefab": {"Path": f"jime-demo/adventures/{ADV2}"}, "NameKey": "D2_TITLE", "LocationKey": "D2_LOCATION", "RestStoryKey": "D2_DESC",
             "BonusPref": 1.0, "FigurePref": 1.0, "ThreatLimit": 20, "CanFail": 1, "IsFinale": 1, "StartingEnemyReserveList": []}
    sb = lambda p: go(p, "SectionBuilder")  # noqa: E731
    objects = {
        root: obj(f"{ADV2}_Shade's Lair", None, Adventure={"Model": {"ref": "AdventureModel", "name": model["m_Name"], "id": ADV2}}, PlayMakerFSM=[0]),
        mb: obj("Map_Builder", root, MapBuilder={"RandomSeed": 1, "Seed": 0,
                                                  "RequiredConnections": [{"Section1": sb(s0), "Section2": sb(s1)}, {"Section1": sb(s1), "Section2": sb(s2)}],
                                                  "InvalidConnections": [{"Section1": sb(s0), "Section2": sb(s2)}], "Sections": [sb(s0), sb(s1), sb(s2)], "PlayerCount": 1}),
        s0: section("Section_Builder_0", mb, 4, 5, start="D09A", encounters=(E2_OMEN1,), fill=0.5),
        s1: section("Section_Builder_1", mb, 4, 5, encounters=(E2_OMEN2,), fill=0.5),
        s2: section("Section_Builder_2", mb, 3, 4, required=("D04B",), encounters=(E2_ALTAR,), fill=0.2),
        t1: obj("ThreatEvent_1", root, PlayMakerFSM=[1], ThreatEvent={"Threshold": 7, "InfoKey": "D2_THREAT_1_INFO"}),
        t2: obj("ThreatEvent_2", root, PlayMakerFSM=[2], ThreatEvent={"Threshold": 14, "InfoKey": "D2_THREAT_2_INFO"}),
    }
    f = Fsm("Idle", variables={"StartTileId": 0, "Omens": 0},
            glob={"SCENARIO_BEGIN": "Set Threats", "ADVENTURE_END_VICTORY": "Win", "ADVENTURE_END_FAILURE": "Loss", "DEMO_OMEN": "Omen Found"})
    f.state("Idle")
    opening(f, "D2", "D09A", (t1, t2), "D2_OBJECTIVE_1")
    f.state("Omen Found", [act("IntAdd", intVariable="@Omens", add=1)], FINISHED="Which Omen")
    f.state("Which Omen", [act("IntCompare", integer1="@Omens", integer2=1, equal="FIRST", lessThan="FIRST", greaterThan="SECOND")],
            FIRST="Open Section 1", SECOND="Open Section 2")
    f.state("Open Section 1", [act("DisplayMessage", Message=k("D2_OMEN_FIRST")), act("SetSectionVisibility", SectionId=1, IsVisible=1)], FINISHED="Finished")
    f.state("Open Section 2", [act("DisplayMessage", Message=k("D2_OMEN_SECOND")), act("SetSectionVisibility", SectionId=2, IsVisible=1)], FINISHED="Altar Objective")
    f.state("Altar Objective", [act("SetObjective", Message=k("D2_OBJECTIVE_2"))], FINISHED="Finished")
    f.state("Win", [act("DisplayMessage", Message=k("D2_WIN")), act("AwardXP", XP=4), act("AddLore", Lore=3)], FINISHED="Campaign Won")
    f.state("Loss", [act("DisplayMessage", Message=k("D2_LOSS"))], FINISHED="Campaign Lost")
    f.state("Campaign Won", [act("EndCampaign", Victory=1)], FINISHED="Fin")
    f.state("Campaign Lost", [act("EndCampaign", Victory=0)], FINISHED="Fin")
    f.state("Fin", [act("FinishFSM")])
    fsms = [f, threat_fsm(8, "D2_THREAT_1"), threat_fsm(12, "D2_THREAT_2")]
    return {"id": ADV2, "model": model, "prefab": prefab("adventure", ADV2, root, objects, fsms, model)}


ADVENTURES = [adventure1(), adventure2()]


def _group(gid, name, encs):
    return {"m_Name": f"{gid}_{name}", "_id": gid, "RequiredEncounters": [enc_ref(e) for e in encs], "IsRepeatable": 1}


GROUPS = [_group(9001, "Roadside Rumours", (919101, 919102)), _group(9002, "Old Shrine", (919103,))]
