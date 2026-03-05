"""
batch_test.py
Test cümlelerini txt dosyasindan okuyarak LLM'e gönderir ve
main.py'deki session log formatiyla ayni sekilde txt dosyasina yazar.

Kodu calistirmak icin: python batch_test.py --input test_sentences.txt --delay 3
Bu kodun çiktisini eval_compare.py kodunu çaliştirarak referans outputlarla karsilastirilir. 
"""

import json
import time
import argparse
from datetime import datetime
from pathlib import Path

# parser_module.py ile aynı klasörde çalıştırılmalı
from parser_module import parse_scene_text, SceneGraph


# AYARLAR
DEFAULT_INPUT  = "test_sentences.txt"
DEFAULT_DELAY  = 3   # Her istek arasında bekleme süresi (saniye)
LOGS_DIR       = Path("logs")

# LOG YAZMA
def create_log_file() -> Path:
    LOGS_DIR.mkdir(exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    log_path  = LOGS_DIR / f"session_{timestamp}.txt"

    with open(log_path, "w", encoding="utf-8") as f:
        f.write("=" * 70 + "\n")
        f.write("  3D EMERGENCY SCENE GENERATOR — SESSION LOG\n")
        f.write(f"  Başlangıç: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
        f.write("=" * 70 + "\n\n")

    print(f" Log dosyası: {log_path}")
    return log_path


def append_entry(log_path: Path, sentence: str, result_dict: dict):
    sep = "-" * 70
    entry = (
        f"\n{'=' * 70}\n"
        f"    INPUT  : \"{sentence}\"\n"
        f"    Zaman  : {datetime.now().strftime('%H:%M:%S')}\n"
        f"{'=' * 70}\n"
        f"   LLM JSON OUTPUT:\n"
        f"{sep}\n"
        f"{json.dumps(result_dict, indent=2, ensure_ascii=False)}\n"
        f"{sep}\n"
    )
    with open(log_path, "a", encoding="utf-8") as f:
        f.write(entry)


def append_error(log_path: Path, sentence: str, error: str):
    entry = (
        f"\n{'=' * 70}\n"
        f"    INPUT  : \"{sentence}\"\n"
        f"    Zaman  : {datetime.now().strftime('%H:%M:%S')}\n"
        f"{'=' * 70}\n"
        f"  x HATA: {error}\n"
        f"{'-' * 70}\n"
    )
    with open(log_path, "a", encoding="utf-8") as f:
        f.write(entry)

# CÜMLE OKUMA
def load_sentences(path: str) -> list:
    sentences = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            sentences.append(line)
    return sentences

# ANA FONKSİYON
def main():
    parser = argparse.ArgumentParser(description="Batch LLM Test Runner")
    parser.add_argument("--input",  default=DEFAULT_INPUT,  help="Test cümlelerinin dosyası")
    parser.add_argument("--delay",  default=DEFAULT_DELAY,  type=float, help="İstekler arası bekleme (saniye)")
    args = parser.parse_args()

    # Cümleleri yükle
    sentences = load_sentences(args.input)
    print(f"\n {len(sentences)} test cümlesi yüklendi.\n")

    # Log dosyasını oluştur
    log_path = create_log_file()

    success = 0
    fail    = 0

    for i, sentence in enumerate(sentences, 1):
        print(f"[{i:02d}/{len(sentences)}] {sentence[:70]}...")

        try:
            result = parse_scene_text(sentence)

            if isinstance(result, SceneGraph):
                result_dict = result.model_dump()
                append_entry(log_path, sentence, result_dict)
                n_assets = len(result_dict.get("assets", []))
                print(f"         √ {n_assets} obje çıkarıldı")
                success += 1
            else:
                # SceneGraph değil, hata mesajı
                append_error(log_path, sentence, str(result))
                print(f"           Parse hatası: {str(result)[:60]}")
                fail += 1

        except Exception as e:
            append_error(log_path, sentence, str(e))
            print(f"         x Exception: {str(e)[:80]}")
            fail += 1

        # Son cümle değilse bekle
        if i < len(sentences):
            time.sleep(args.delay)

    # Özet
    print(f"\n{'=' * 50}")
    print(f"√  Başarılı : {success}")
    print(f"x  Başarısız: {fail}")
    print(f"  Log      : {log_path}")
    print(f"{'=' * 50}\n")
    print("eval_compare.py ile kıyaslamak için:")
    print(f"  python eval_compare.py --reference reference_outputs.json --actual {log_path}\n")


if __name__ == "__main__":
    main()
