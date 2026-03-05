'''
FastAPI'i çaliştırır. parser_module.py kodundaki fonskiyonları kullanarak, metni parse eder. 
Metinden çıkardığı anlamlı jsonı dictionary olarak return eder.
Backend tarafının amacı parser'ımızın çalıştırılmasıdır. 
Kalan işlemler main.js kodunda yapılır
'''

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import json
import os
from datetime import datetime
from pathlib import Path
from parser_module import parse_scene_text, SceneGraph

app = FastAPI()


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # Tüm kaynaklara izin ver (Test için)
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- VERİ MODELİ ---
class SceneRequest(BaseModel):
    text: str

# --- LOG / SESSION YÖNETİMİ ---

# Logların kaydedileceği klasör
LOGS_DIR = Path("logs")
LOGS_DIR.mkdir(exist_ok=True)


current_log_file: Path | None = None

current_spatial_log_file = None


def get_log_file() -> Path:
    """Aktif log dosyasını döner. Eğer session başlatılmamışsa otomatik başlatır."""
    global current_log_file
    if current_log_file is None:
        _create_new_session()
    return current_log_file

def _create_new_session():
    """Yeni bir log dosyası oluşturur ve current_log_file'ı günceller."""
    global current_log_file
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    current_log_file = LOGS_DIR / f"session_{timestamp}.txt"
    
    # Dosyayı başlık ile oluştur
    with open(current_log_file, "w", encoding="utf-8") as f:
        f.write("=" * 70 + "\n")
        f.write(f"  3D EMERGENCY SCENE GENERATOR — SESSION LOG\n")
        f.write(f"  Başlangıç: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
        f.write("=" * 70 + "\n\n")
    
    print(f" Yeni session log dosyası: {current_log_file}")

def append_to_log(text: str):
    """Aktif log dosyasına metin ekler."""
    log_file = get_log_file()
    with open(log_file, "a", encoding="utf-8") as f:
        f.write(text + "\n")


#Spatial log için fonksiyonlar 
def _create_spatial_log_file():
    global current_spatial_log_file
    logs_dir = Path("logs")
    logs_dir.mkdir(exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    current_spatial_log_file = logs_dir / f"session_spatial_{timestamp}.txt"
    header = (
        f"{'=' * 70}\n"
        f"  3D EMERGENCY SCENE GENERATOR — SPATIAL SESSION LOG\n"
        f"  Başlangıç: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n"
        f"{'=' * 70}\n\n"
    )
    current_spatial_log_file.write_text(header, encoding="utf-8")


def append_to_spatial_log(text: str):
    global current_spatial_log_file
    if current_spatial_log_file is None:
        _create_spatial_log_file()
    with open(current_spatial_log_file, "a", encoding="utf-8") as f:
        f.write(text)     

# --- API ENDPOINTS ---

@app.post("/api/new-session")
async def new_session():
    _create_new_session()
    _create_spatial_log_file()
    return {"status": "new session started", "log_file": str(current_log_file)}

@app.post("/api/generate-scene")
async def generate_scene(request: SceneRequest):
    print(f" Mesaj Geldi: {request.text}")
    
    try:
        result = parse_scene_text(request.text)
        
        if isinstance(result, SceneGraph):
            result_dict = result.model_dump()
            
            # --- Terminale Bas ---
            print("\n" + "="*40)
            print(" LLM JSON:")
            print("="*40)
            print(json.dumps(result_dict, indent=2, ensure_ascii=False)) 
            print("="*40 + "\n")

            # --- Log Dosyasına Yaz ---
            sep = "-" * 70
            log_entry = (
                f"\n{'=' * 70}\n"
                f"    INPUT  : \"{request.text}\"\n"
                f"    Zaman  : {datetime.now().strftime('%H:%M:%S')}\n"
                f"{'=' * 70}\n"
                f"   LLM JSON OUTPUT:\n"
                f"{sep}\n"
                f"{json.dumps(result_dict, indent=2, ensure_ascii=False)}\n"
                f"{sep}\n"
            )
            append_to_log(log_entry)

            return result_dict
        else:
            append_to_log(f"\n[HATA] INPUT: \"{request.text}\" → {str(result)}\n")
            return {"error": str(result)}
            
    except Exception as e:
        print(f"Hata: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/log-result")
async def log_result(data: dict):
    """Evaluation verisi — log dosyasına yazılmıyor, sadece terminal."""
    input_text = data.get('input', '')
    path_icon = "✓ FOUND" if data.get("pathFound") else "✗ NOT FOUND"
    
    print(f"  PATH: {path_icon}  dist={data.get('pathDist')}  exits={data.get('exitCount')}")
    
    return {"status": "logged"}

# Spatial inference testi için 
@app.post("/api/log-spatial")
async def log_spatial(data: dict):
    """LLM+Spatial inference sonrası sahne verisini ayrı log dosyasına yazar."""
    sep = "-" * 70
    log_entry = (
        f"\n{'=' * 70}\n"
        f"    INPUT  : \"{data.get('text', '')}\"\n"
        f"    Zaman  : {datetime.now().strftime('%H:%M:%S')}\n"
        f"{'=' * 70}\n"
        f"   LLM JSON OUTPUT:\n"
        f"{sep}\n"
        f"{json.dumps(data.get('scene', {}), indent=2, ensure_ascii=False)}\n"
        f"{sep}\n"
    )
    append_to_spatial_log(log_entry)
    return {"status": "logged"}


@app.get("/")
def read_root():
    return {"status": "Backend Çalışıyor"}