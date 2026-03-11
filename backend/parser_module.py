'''
Texti alip parse eden modüldür. Qwen modelini çağirarak ona komut verip parse eder. Sonucu json objesi halinde döner. parser_module.py
'''
import os
import json
import requests 
from typing import List, Literal
from pydantic import BaseModel, Field


QWEN_MODEL = "qwen2.5-coder:7b" 

# --- PERFORMANCE / REQUEST TUNING ---
OLLAMA_NUM_PREDICT = int(os.getenv("OLLAMA_NUM_PREDICT", "1000"))
OLLAMA_REQUEST_TIMEOUT = int(os.getenv("OLLAMA_REQUEST_TIMEOUT", "60"))

# --- PYDANTIC SCHEMAS ---
class Asset(BaseModel):
    id: str = Field(description="Unique identifier (e.g., 'obj_1', 'wall_1')")
    type: str = Field(description="General object category for retrieval (e.g., 'sofa', 'window', 'door', 'rubble')")
    placement_type: Literal['floor', 'wall', 'ceiling'] = Field(
        description="Crucial for 3D snapping. 'floor' for furniture/debris, 'wall' for windows/doors/pictures."
    )
    attributes: List[str] = Field(
        description="Visual adjectives affecting geometry or texture (e.g., 'broken', 'open', 'wooden', 'large')"
    )

    scale_modifier: float = Field(
        default=1.0,
        description="Size multiplier from adjectives. 'large'->1.5, 'huge'->2.0, 'small'->0.7, 'tiny'->0.5. Default 1.0."
    )
    traversability: Literal['blocked', 'walkable_over', 'passable'] = Field(
        default='blocked',
        description="'blocked': cannot pass (table, closet, wall). 'walkable_over': can walk on top, height<1.6m (bed, sofa, low debris). 'passable': freely walkable through (small chair, thin object)."
    )

class Relation(BaseModel):
    source_id: str = Field(description="ID of the object being placed")
    relation: str = Field(description="Spatial relation (e.g., 'left_of', 'next_to', 'on_wall', 'in_center')")
    target_id: str = Field(description="ID of the reference object (or 'room' if absolute position)")

class SceneGraph(BaseModel):
    assets: List[Asset]
    relations: List[Relation]

# --- INFERENCE CLIENT --- 

def call_qwen_api(input_text, max_retries=3):
    """
    Qwen modelini Ollama API üzerinden çağırır.
    """
    
    # JSON Schema
    schema_json = json.dumps(SceneGraph.model_json_schema(), indent=2)
    
    system_message = f"""You are a 3D Scene Architect expert in Emergency Scenarios.
    Your task is to parse the scene description into a valid JSON SceneGraph.

    CRITICAL RULES:
    1. **EXHAUSTIVENESS:** You MUST extract EVERY single object mentioned. Do not skip small objects like tables or lamps.
    2. **ATTRIBUTES:** Extract visual adjectives (e.g., 'broken', 'wooden', 'large') into the 'attributes' list. This is vital for damage assessment.
    3. **RELATIONS:** - Use ONLY these exact keys: 
    - 'left_of', 'right_of', 'in_front_of', 'behind', 'next_to', 'in_center'
    - For wall objects (windows/doors): use 'on_left_wall', 'on_right_wall', 
        'on_back_wall', 'on_front_wall' — NEVER just 'on_wall' without direction.
    - 'on_wall' is only allowed when NO direction is mentioned.
    - If an object is ON another object (like a lamp on a table), use 'on_top_of' if supported, otherwise use 'in_center' relative to the target object.
    4. **VALIDITY:** - Never reference a 'target_id' that does not exist in the 'assets' list.
    - If a wall is referenced but not described as an object, map it to target_id: 'room' with relation 'on_wall'.

    STEPS:
    1. Identify all objects and their states (broken, open, etc.).
    2. Determine their spatial relationships.
    3. Generate the JSON.
    """

    # USER MESSAGE (Görev)
    user_message = f"""Parse this emergency scene into JSON following this exact schema:

    {schema_json}

    Scene: "{input_text}"

    Output (JSON only):"""

    import time
    for attempt in range(max_retries):
        try:
            print(f" Calling Local {QWEN_MODEL} (attempt {attempt + 1}/{max_retries})...")
            
            # Ollama API Çağrısı
            t0 = time.time()
            response = requests.post(
                "http://localhost:11434/api/chat",
                json={
                    "model": QWEN_MODEL,
                    "messages": [
                        {"role": "system", "content": system_message},
                        {"role": "user", "content": user_message}
                    ],
                    "stream": False,
                    "format": "json",
                    "keep_alive": "30m", 
                    "options": {
                        "temperature": 0.1,
                        "num_predict": OLLAMA_NUM_PREDICT   
                    }
                },
                timeout=OLLAMA_REQUEST_TIMEOUT,
            )
            response.raise_for_status()
            response_text = response.json()['message']['content']
            elapsed = time.time() - t0
            print(f" Response received: {len(response_text)} chars (in {elapsed:.2f}s)")
            return response_text
            
        except Exception as e:
            error_msg = str(e)
            
            # Local bağlantı hatası
            if "connection" in error_msg.lower():
                print(f" Ollama'ya bağlanılamıyor! Uygulamanın açık olduğundan emin olun... ({attempt + 1}/{max_retries})")
                import time
                time.sleep(10)
                continue
            
            # Diğer hatalar
            else:
                print(f" API Error: {error_msg}")
                if attempt == max_retries - 1:
                    raise Exception(f"Local API call failed after {max_retries} attempts: {error_msg}")
                import time
                time.sleep(5)
    
    raise Exception("Max retries reached")

def parse_scene_text(input_text):
    """
    Metni SceneGraph formatına çevirir
    """
    
    try:
        # API çağır
        response_text = call_qwen_api(input_text)
        
        # JSON'u temizle
        cleaned_text = response_text.strip()
        
        if cleaned_text.startswith("```"):
            if cleaned_text.startswith("```json"):
                cleaned_text = cleaned_text[7:]
            else:
                cleaned_text = cleaned_text[3:]
            
            if cleaned_text.endswith("```"):
                cleaned_text = cleaned_text[:-3]
        
        # JSON'u bul
        json_start = cleaned_text.find('{')
        json_end = cleaned_text.rfind('}') + 1
        
        if json_start == -1 or json_end == 0:
            print(f"JSON bulunamadı!")
            print(f"Raw response:\n{response_text[:500]}")
            return f"JSON parsing failed: No JSON found in response"
        
        cleaned_json = cleaned_text[json_start:json_end]
        
        # Parse ve validate
        parsed_data = json.loads(cleaned_json)
        scene_graph = SceneGraph(**parsed_data)
        
        print(f"√ Scene parsed successfully!")
        print(f"   - Objects: {len(scene_graph.assets)}")
        print(f"   - Relations: {len(scene_graph.relations)}")
        
        return scene_graph
        
    except json.JSONDecodeError as e:
        print(f"x JSON Parse Error: {e}")
        print(f"Attempted to parse:\n{cleaned_json[:500]}")
        return f"JSON parsing failed: {str(e)}"
    
    except Exception as e:
        print(f"x Error: {type(e).__name__}: {e}")
        return f"Error: {str(e)}"
