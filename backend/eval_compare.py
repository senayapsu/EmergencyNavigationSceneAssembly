"""
eval_compare.py
Kodu çalistirmak için:    python eval_compare.py --reference reference_outputs.json --actual session_log.txt

Çikti:
    - Terminalde her senaryo için skorlar
    - eval_results.csv

Değerlendirilen metrikler:
    OEA  - Object Extraction Accuracy  : Doğru çıkarılan nesne sayısı / toplam beklenen nesne
    RA   - Relation Accuracy            : Doğru eşleşen ilişki sayısı / toplam beklenen ilişki
    PTA  - Placement Type Accuracy      : Doğru placement_type sayısı / toplam beklenen
    TRA  - Traversability Accuracy      : Doğru traversability sayısı / toplam beklenen
    SCA  - Scale Modifier Accuracy      : Doğru scale_modifier sayısı / toplam beklenen
"""

import json
import re
import csv
import argparse
from pathlib import Path
import os

# İlişkileri normalize etmek için alias sözlükleri
RELATION_ALIASES = {
    "behind":           "on_back_wall",
    "back_wall":        "on_back_wall",
    "on_back":          "on_back_wall",
    "front_wall":       "on_front_wall",
    "on_front":         "on_front_wall",
    "left_wall":        "on_left_wall",
    "on_left":          "on_left_wall",
    "right_wall":       "on_right_wall",
    "on_right":         "on_right_wall",
    "center":           "in_center",
    "in_the_center":    "in_center",
    "left":             "left_of",
    "to_left":          "left_of",
    "right":            "right_of",
    "to_right":         "right_of",
    "front":            "in_front_of",
    "in_front":         "in_front_of",
    "beside":           "next_to",
    "adjacent":         "next_to",
    "on_top_of":        "on",
    "on_top":           "on",
    "placed_on":        "on",
}

TYPE_ALIASES = {
    "first_aid_kit":    "first_aid",
    "first aid kit":    "first_aid",
    "fire extinguisher":"fire_extinguisher",
    "fire_extinguisher":"fire_extinguisher",
    "broken wall":      "broken_wall",
    "oxygen tank":      "oxygen_tank",
    "oxygen_tank":      "oxygen_tank",
    "couch":            "sofa",
    "person":           "injured",
    "victim":           "injured",
    "tv":               "tv",
    "television":       "tv",
}

def normalize_relation(rel: str) -> str:
    r = rel.lower().strip().replace(" ", "_")
    return RELATION_ALIASES.get(r, r)

def normalize_type(t: str) -> str:
    t2 = t.lower().strip()
    return TYPE_ALIASES.get(t2, t2)

# LOG PARSER: session_XXXXXXXX.txt dosyasından JSON'ları çıkar
def parse_log_file(log_path: str) -> list:
    """
    Log dosyasından Input-> json çiftlerini çikarir.
    """
    text = Path(log_path).read_text(encoding="utf-8")

    input_pattern = re.compile(r'INPUT\s*[:\-–]\s*"([^"]+)"')
    json_pattern  = re.compile(r'LLM JSON OUTPUT[:\s]*\n-{3,}\n(\{.*?\})\n-{3,}', re.DOTALL)

    inputs = [(m.start(), m.group(1).strip()) for m in input_pattern.finditer(text)]
    jsons  = [(m.start(), m.group(1))         for m in json_pattern.finditer(text)]

    results = []
    for inp_pos, inp_text in inputs:
        # Bu INPUT'tan sonra gelen ilk json'u bul
        next_json = next(((jp, jt) for jp, jt in jsons if jp > inp_pos), None)
        if not next_json:
            continue
        try:
            inp = inp_text.lower().strip()
            # Çift input düzeltme
            mid = len(inp) // 2
            fh_norm = re.sub(r'[^a-z0-9 ]', '', inp[:mid].strip())
            sh_norm = re.sub(r'[^a-z0-9 ]', '', inp[mid:].strip())
            if fh_norm and fh_norm == sh_norm:
                inp = inp[:mid].strip()
            results.append({'input': inp, 'data': json.loads(next_json[1])})
        except json.JSONDecodeError:
            print(f"  !  JSON parse hatası: {inp_text[:50]}...")

    return results


# KARŞILAŞTIRMA: Tek senaryo için referans ve actual'ı karşılaştırıp metrikleri hesaplar
def compare_scenario(ref: dict, actual: dict) -> dict:
    """
    ref    : reference_outputs.json'dan bir senaryo
    actual : log dosyasindan parse edilen LLM çiktisi
    return: metrik sözlüğü
    """
    ref_assets    = ref.get("assets", [])
    actual_assets = actual.get("assets", [])
    ref_rels      = ref.get("relations", [])
    actual_rels   = actual.get("relations", [])

    # OEA: Nesne Çıkarım Doğruluğu
    ref_types    = [normalize_type(a["type"]) for a in ref_assets]
    actual_types = [normalize_type(a["type"]) for a in actual_assets]
    
    oea_correct = 0
    matched_actual = []
    for rt in ref_types:
        found = False
        for i, at in enumerate(actual_types):
            if i not in matched_actual and (rt in at or at in rt):
                oea_correct += 1
                matched_actual.append(i)
                found = True
                break
    
    oea_total   = len(ref_types)
    oea_score   = oea_correct / oea_total if oea_total > 0 else 0.0

    # PTA: Placement Type Doğruluğu 
    pta_correct = 0
    for ref_a in ref_assets:
        ref_t = normalize_type(ref_a["type"])
        ref_pt = ref_a.get("placement_type", "")
        for act_a in actual_assets:
            act_t = normalize_type(act_a["type"])
            if ref_t in act_t or act_t in ref_t:
                if act_a.get("placement_type", "") == ref_pt:
                    pta_correct += 1
                break
    
    pta_total = len(ref_assets)
    pta_score = pta_correct / pta_total if pta_total > 0 else 0.0

    # TRA: Traversability Doğruluğu
    tra_correct = 0
    for ref_a in ref_assets:
        ref_t   = normalize_type(ref_a["type"])
        ref_tr  = ref_a.get("traversability", "blocked")
        for act_a in actual_assets:
            act_t = normalize_type(act_a["type"])
            if ref_t in act_t or act_t in ref_t:
                if act_a.get("traversability", "blocked") == ref_tr:
                    tra_correct += 1
                break
    
    tra_total = len(ref_assets)
    tra_score = tra_correct / tra_total if tra_total > 0 else 0.0

    # SCA: Scale Modifier Doğruluğu
    sca_correct = 0
    for ref_a in ref_assets:
        ref_t  = normalize_type(ref_a["type"])
        ref_sm = ref_a.get("scale_modifier", 1.0)
        for act_a in actual_assets:
            act_t = normalize_type(act_a["type"])
            if ref_t in act_t or act_t in ref_t:
                act_sm = act_a.get("scale_modifier", 1.0)
                if abs(act_sm - ref_sm) < 0.15:   # ±0.15 tolerans
                    sca_correct += 1
                break
    
    sca_total = len(ref_assets)
    sca_score = sca_correct / sca_total if sca_total > 0 else 0.0

    # RA: İlişki Doğruluğu
    # İlişkileri tip bazında eşleştirir
    def rel_key(r, assets):
        #source_type + relation + target_type
        src_type = ""
        tgt_type = ""
        for a in assets:
            if a["id"] == r["source_id"]:
                src_type = normalize_type(a["type"])
            if a["id"] == r["target_id"]:
                tgt_type = normalize_type(a["type"])
        rel = normalize_relation(r["relation"])
        tgt = tgt_type if tgt_type else r["target_id"] 
        return (src_type, rel, tgt)

    ref_rel_keys    = [rel_key(r, ref_assets) for r in ref_rels]
    actual_rel_keys = [rel_key(r, actual_assets) for r in actual_rels]

    ra_correct = 0
    matched_ra = []
    for rk in ref_rel_keys:
        for i, ak in enumerate(actual_rel_keys):
            if i in matched_ra:
                continue
            # Kaynak tipi ve ilişki eşleşmeli.
            src_match = (rk[0] in ak[0] or ak[0] in rk[0])
            rel_match = (rk[1] == ak[1])
            tgt_match = (rk[2] == ak[2]) or (rk[2] in ak[2]) or (ak[2] in rk[2])
            if src_match and rel_match and tgt_match:
                ra_correct += 1
                matched_ra.append(i)
                break

    ra_total = len(ref_rel_keys)
    ra_score = ra_correct / ra_total if ra_total > 0 else 0.0

    return {
        "oea_correct": oea_correct,  "oea_total": oea_total,  "oea": round(oea_score, 3),
        "pta_correct": pta_correct,  "pta_total": pta_total,  "pta": round(pta_score, 3),
        "tra_correct": tra_correct,  "tra_total": tra_total,  "tra": round(tra_score, 3),
        "sca_correct": sca_correct,  "sca_total": sca_total,  "sca": round(sca_score, 3),
        "ra_correct":  ra_correct,   "ra_total":  ra_total,   "ra":  round(ra_score,  3),
        "overall": round((oea_score + pta_score + tra_score + ra_score) / 4, 3)
    }


# ANA FONKSİYON
def main():
    parser = argparse.ArgumentParser(description="LLM Parsing Evaluation Tool")
    parser.add_argument("--reference", default="reference_outputs.json",
                        help="Referans JSON dosyası")
    parser.add_argument("--actual",    required=True,
                        help="Backend log dosyası (session_XXXXXXXX.txt)")
    parser.add_argument("--output",    default="eval_results.csv",
                        help="CSV çıktı dosyası")
    args = parser.parse_args()

    # 1. Dosya adı temizlenir. Uzanti ve path kaldırılır. 
    base_name = os.path.splitext(os.path.basename(args.actual))[0]

    # 2. Eğer kullanıcı özel bir --output vermediyse ismi güncelle
    if args.output == "eval_results.csv":
        args.output = f"eval_results_{base_name}.csv"
        
    # Dosyaları yükle
    with open(args.reference, encoding="utf-8") as f:
        reference = json.load(f)
    
    actual_list = parse_log_file(args.actual)
    print(f"\n Log dosyasında {len(actual_list)} senaryo bulundu.\n")

    # Sonuçları topla
    all_results = []
    summary = {"oea":[], "pta":[], "tra":[], "sca":[], "ra":[], "overall":[]}

    SEP = "=" * 75
    print(SEP)
    print(f"{'ID':<6} {'OEA':>6} {'PTA':>6} {'TRA':>6} {'SCA':>6} {'RA':>6} {'Overall':>8}  Status")
    print(SEP)

    for scenario_id, ref_data in reference.items():
        input_text = ref_data["input"].lower()
        
        # Log'da input bulunur
        actual_data = None
        ref_norm = re.sub(r'[^a-z0-9 ]', ' ', input_text).strip()
        ref_words = set(input_text.split())

        for entry in actual_list:
            log_inp  = entry['input']
            log_data = entry['data']

            # 1. Tam eşleştirme
            if log_inp == input_text.strip():
                actual_data = log_data
                break

            # 2. Noktalama normalize
            log_norm = re.sub(r'[^a-z0-9 ]', ' ', log_inp).strip()
            if ref_norm == log_norm:
                actual_data = log_data
                break

            # 3. Kelime örtüşmesi ≥ 90%
            log_words = set(log_inp.split())
            if len(ref_words) > 0:
                overlap = len(ref_words & log_words) / len(ref_words)
                if overlap >= 0.90:
                    actual_data = log_data
                    break
        
        if actual_data is None:
            print(f"{scenario_id:<6} {'—':>6} {'—':>6} {'—':>6} {'—':>6} {'—':>6} {'—':>8}  !  LOG'DA YOK")
            all_results.append({
                "id": scenario_id, "input": ref_data["input"],
                "oea": "", "pta": "", "tra": "", "sca": "", "ra": "", "overall": "",
                "note": "not found in log"
            })
            continue

        m = compare_scenario(ref_data, actual_data)
        
        status = "✓" if m["overall"] >= 0.8 else ("⚠" if m["overall"] >= 0.5 else "✗")
        print(f"{scenario_id:<6} {m['oea']:>6.1%} {m['pta']:>6.1%} {m['tra']:>6.1%} "
              f"{m['sca']:>6.1%} {m['ra']:>6.1%} {m['overall']:>8.1%}  {status}")

        for k in summary:
            summary[k].append(m[k])

        all_results.append({
            "id": scenario_id,
            "input": ref_data["input"],
            "oea": f"{m['oea']:.1%}",
            "oea_detail": f"{m['oea_correct']}/{m['oea_total']}",
            "pta": f"{m['pta']:.1%}",
            "pta_detail": f"{m['pta_correct']}/{m['pta_total']}",
            "tra": f"{m['tra']:.1%}",
            "tra_detail": f"{m['tra_correct']}/{m['tra_total']}",
            "sca": f"{m['sca']:.1%}",
            "sca_detail": f"{m['sca_correct']}/{m['sca_total']}",
            "ra": f"{m['ra']:.1%}",
            "ra_detail": f"{m['ra_correct']}/{m['ra_total']}",
            "overall": f"{m['overall']:.1%}",
        })

    # Özet satırı
    def avg(lst): return sum(lst)/len(lst) if lst else 0
    print(SEP)
    print(f"{'AVG':<6} {avg(summary['oea']):>6.1%} {avg(summary['pta']):>6.1%} "
          f"{avg(summary['tra']):>6.1%} {avg(summary['sca']):>6.1%} "
          f"{avg(summary['ra']):>6.1%} {avg(summary['overall']):>8.1%}")
    print(SEP)
    print(f"\n Toplam: {len([r for r in all_results if r.get('overall')])} / {len(reference)} senaryo değerlendirildi\n")

    # CSV'e yaz
    if all_results:
        fieldnames = ["id", "input", "oea", "oea_detail", "pta", "pta_detail",
                      "tra", "tra_detail", "sca", "sca_detail", "ra", "ra_detail", "overall"]
        with open(args.output, "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
            writer.writeheader()
            writer.writerows(all_results)
        print(f"√ CSV kaydedildi: {args.output}\n")

if __name__ == "__main__":
    main()
