"""
batch_test_spatial.py
LLM çiktisina spatial kurallar uygulayan batch test scripti. 
Her cümle için LLM çiktisini alir, spatial inference uygular, ve sonuçlari loglar. 
"""

import json, time, copy, argparse
from datetime import datetime
from pathlib import Path
from parser_module import parse_scene_text, SceneGraph

# SPATIAL KNOWLEDGE BASE
SPATIAL_KNOWLEDGE = {
    "support_hierarchy": {
        "lamp":      {"can_be_on": ["nightstand", "table", "desk"], "must_be_supported": True},
        "book":      {"can_be_on": ["table", "desk", "bookshelf"],  "must_be_supported": False},
        "first_aid": {"can_be_on": ["table", "desk", "nightstand"], "must_be_supported": False},
    },

    "correct_relations": {
        "chair":     {"with": "table", "correct": ["in_front_of", "next_to"], "incorrect": ["behind", "on"]},
        "nightstand":{"with": "bed",   "correct": ["left_of", "right_of"],   "incorrect": ["behind", "in_front_of", "on"]},
    },

    "preferred_placement": {
        "bed":              {"avoid_center": True,  "preferred_wall": "behind"},
        "sofa":             {"avoid_center": True,  "preferred_wall": "behind"},
        "couch":            {"avoid_center": True,  "preferred_wall": "behind"},
        "closet":           {"avoid_center": True,  "preferred_wall": "right"},
        "wardrobe":         {"avoid_center": True,  "preferred_wall": "left"},
        "desk":             {"avoid_center": False, "preferred_wall": "left"},
        "table":            {"avoid_center": False, "preferred_wall": "left"},
        "rubble":           {"avoid_center": False},
        "debris":           {"avoid_center": False},
        "fire_extinguisher":{"avoid_center": False},
    },

    "forbidden_neighbors": {
        "bed":              ["table", "desk", "rubble", "debris"],
        "rubble":           ["bed", "table", "nightstand", "sofa"],
        "debris":           ["bed", "table", "nightstand"],
        "fire_extinguisher":["rubble", "debris"],
    },

    
    "traversability_map": {
        "door":             "blocked",
        "window":           "blocked",
        "wall":             "blocked",
        "broken_wall":      "blocked",
        "concrete":         "blocked",
        "table":            "blocked",
        "desk":             "blocked",
        "closet":           "blocked",
        "wardrobe":         "blocked",
        "bookshelf":        "blocked",
        "tv":               "blocked",
        "nightstand":       "blocked",
        "stretcher":        "blocked",
        "bed":              "walkable_over",
        "sofa":             "walkable_over",
        "couch":            "walkable_over",
        "armchair":         "walkable_over",
        "chair":            "passable",
        "lamp":             "passable",
        "first_aid":        "passable",
        "fire_extinguisher":"passable",
        "oxygen_tank":      "passable",
        "wheelchair":       "passable",
        "injured":          "passable",
        "person":           "passable",
        "victim":           "passable",
        "rubble":           "blocked",
        "debris":           "blocked",
        "obstacle":         "blocked",
    },

    "placement_type_map": {
        "floor": [
            "bed", "sofa", "couch", "chair", "armchair", "table", "desk",
            "closet", "wardrobe", "bookshelf", "nightstand", "tv",
            "rubble", "debris", "concrete", "broken_wall", "obstacle",
            "stretcher", "wheelchair", "first_aid", "fire_extinguisher",
            "extinguisher", "oxygen_tank", "injured", "person", "victim", "lamp",
        ],
        "wall": [
            "door", "window",
        ],
    },
}

# SPATIAL INFERENCE
def apply_spatial_inference(scene_data: dict, input_text: str = "") -> dict:
    data = copy.deepcopy(scene_data)
    assets = data.get("assets", [])
    corrected_relations = data.get("relations", [])

    # KURAL 1: SUPPORT HIERARCHY
    for asset in assets:
        support_info = SPATIAL_KNOWLEDGE["support_hierarchy"].get(asset["type"])
        if not (support_info and support_info["must_be_supported"]):
            continue
        my_rel = next((r for r in corrected_relations if r["source_id"] == asset["id"]), None)
        if my_rel and "on" in my_rel["relation"]:
            continue
        support_obj = next((a for a in assets if a["type"] in support_info["can_be_on"]), None)
        if support_obj:
            print(f"[K1] {asset['type']} → {support_obj['type']} üzerine taşındı")
            corrected_relations = [r for r in corrected_relations if r["source_id"] != asset["id"]]
            corrected_relations.append({"source_id": asset["id"], "relation": "on", "target_id": support_obj["id"]})

    # KURAL 2: PREFERRED PLACEMENT
    for asset in assets:
        pref = SPATIAL_KNOWLEDGE["preferred_placement"].get(asset["type"])
        if not (pref and pref.get("avoid_center")):
            continue
        my_rel = next((r for r in corrected_relations if r["source_id"] == asset["id"] and r["target_id"] == "room"), None)
        if my_rel and "center" in my_rel["relation"]:
            new_rel = pref.get("preferred_wall", "behind")
            print(f"[K2] {asset['type']} merkez → {new_rel} duvarına taşındı")
            my_rel["relation"] = new_rel

    # KURAL 2.5: WINDOW/DOOR YÖN FALLBACK
    inp = input_text.lower()
    for asset in assets:
        if asset["type"] not in ("window", "door"):
            continue
        rel = next((r for r in corrected_relations if r["source_id"] == asset["id"]), None)
        if rel and rel["relation"] == "on_wall":
            if   "left"  in inp:                         rel["relation"] = "on_left_wall"
            elif "right" in inp:                         rel["relation"] = "on_right_wall"
            elif "back"  in inp or "behind" in inp:      rel["relation"] = "on_back_wall"
            elif "front" in inp:                         rel["relation"] = "on_front_wall"
            else:                                        rel["relation"] = "on_back_wall"
            print(f"[K2.5] {asset['type']} on_wall → {rel['relation']}")

    # KURAL 3: CORRECT RELATIONS (SPATIAL RELATIONS)
    for rel in corrected_relations:
        src = next((a for a in assets if a["id"] == rel["source_id"]), None)
        tgt = next((a for a in assets if a["id"] == rel["target_id"]), None)
        if not (src and tgt):
            continue
        if "chair" in src["type"] and "table" in tgt["type"]:
            if "behind" in rel["relation"] or rel["relation"] == "on":
                print(f"[K3] chair-table: {rel['relation']} → next_to")
                rel["relation"] = "next_to"
        rule = SPATIAL_KNOWLEDGE["correct_relations"].get(src["type"])
        if rule and rule["with"] == tgt["type"]:
            if any(w in rel["relation"] for w in rule["incorrect"]):
                print(f"  🔧 [K3] {src['type']}→{tgt['type']}: {rel['relation']} → {rule['correct'][0]}")
                rel["relation"] = rule["correct"][0]

    # FORBIDDEN NEIGHBORS
    for rel in corrected_relations:
        src = next((a for a in assets if a["id"] == rel["source_id"]), None)
        tgt = next((a for a in assets if a["id"] == rel["target_id"]), None)
        if src and tgt:
            if tgt["type"] in SPATIAL_KNOWLEDGE["forbidden_neighbors"].get(src["type"], []):
                print(f"[K4] UYARI: {src['type']} ve {tgt['type']} yan yana olmamalı")

    # KURAL 5: TRAVERSABILITY
    tra_map = SPATIAL_KNOWLEDGE["traversability_map"]
    for asset in assets:
        correct_tra = None
        # Tam eşleşme
        if asset["type"] in tra_map:
            correct_tra = tra_map[asset["type"]]
        else:
            for key, val in tra_map.items():
                if key in asset["type"]:
                    correct_tra = val
                    break
        if correct_tra and asset.get("traversability") != correct_tra:
            print(f"[K5] {asset['type']} traversability: {asset.get('traversability')} → {correct_tra}")
            asset["traversability"] = correct_tra

    # KURAL 6: PLACEMENT TYPE
    floor_types = SPATIAL_KNOWLEDGE["placement_type_map"]["floor"]
    wall_types  = SPATIAL_KNOWLEDGE["placement_type_map"]["wall"]
    for asset in assets:
        correct_pt = None
        atype = asset["type"]
        if any(atype == t or t in atype for t in floor_types):
            correct_pt = "floor"
        elif any(atype == t or t in atype for t in wall_types):
            correct_pt = "wall"
        if correct_pt and asset.get("placement_type") != correct_pt:
            print(f"[K6] {asset['type']} placement_type: {asset.get('placement_type')} → {correct_pt}")
            asset["placement_type"] = correct_pt

    data["relations"] = corrected_relations
    return data

# LOG
def create_log_file() -> Path:
    Path("logs").mkdir(exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    p  = Path("logs") / f"session_spatial_{ts}.txt"
    with open(p, "w", encoding="utf-8") as f:
        f.write("=" * 70 + "\n")
        f.write("  3D EMERGENCY SCENE GENERATOR — SPATIAL SESSION LOG\n")
        f.write(f"  Başlangıç: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
        f.write("=" * 70 + "\n\n")
    print(f" Log dosyası: {p}")
    return p

def append_entry(p, sentence, d):
    sep = "-" * 70
    with open(p, "a", encoding="utf-8") as f:
        f.write(
            f"\n{'=' * 70}\n"
            f" INPUT  : \"{sentence}\"\n"
            f" Zaman  : {datetime.now().strftime('%H:%M:%S')}\n"
            f"{'=' * 70}\n"
            f" LLM JSON OUTPUT:\n"
            f"{sep}\n"
            f"{json.dumps(d, indent=2, ensure_ascii=False)}\n"
            f"{sep}\n"
        )

def append_error(p, sentence, error):
    with open(p, "a", encoding="utf-8") as f:
        f.write(
            f"\n{'=' * 70}\n"
            f" INPUT  : \"{sentence}\"\n"
            f" Zaman  : {datetime.now().strftime('%H:%M:%S')}\n"
            f"{'=' * 70}\n"
            f" HATA: {error}\n"
            f"{'-' * 70}\n"
        )

def load_sentences(path):
    sentences = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            sentences.append(line)
    return sentences


# MAIN
def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input",  default="test_sentences.txt")
    parser.add_argument("--delay",  default=2, type=float)
    args = parser.parse_args()

    sentences = load_sentences(args.input)
    print(f"\n {len(sentences)} test cümlesi yüklendi.\n")
    log_path = create_log_file()
    success = fail = 0

    for i, sentence in enumerate(sentences, 1):
        print(f"\n[{i:02d}/{len(sentences)}] {sentence[:70]}...")
        try:
            result = parse_scene_text(sentence)
            if isinstance(result, SceneGraph):
                llm_dict     = result.model_dump()
                spatial_dict = apply_spatial_inference(llm_dict, input_text=sentence)
                append_entry(log_path, sentence, spatial_dict)
                print(f"         √ {len(spatial_dict.get('assets',[]))} obje")
                success += 1
            else:
                append_error(log_path, sentence, str(result))
                fail += 1
        except Exception as e:
            append_error(log_path, sentence, str(e))
            print(f"         x {str(e)[:80]}")
            fail += 1

        if i < len(sentences):
            time.sleep(args.delay)

    print(f"\n{'=' * 50}")
    print(f"√ Başarılı: {success}  x Başarısız: {fail}")
    print(f" Log: {log_path}")
    print(f"{'=' * 50}")
    print(f"\npython eval_compare.py --reference reference_outputs.json --actual {log_path}\n")

if __name__ == "__main__":
    main()
