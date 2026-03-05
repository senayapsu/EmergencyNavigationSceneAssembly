# 🚨 Dynamic 3D Scene Reconstruction for Emergency Scenarios


This system converts natural language descriptions of emergency scenes into real-time, interactive 3D environments. Using an LLM-powered parsing pipeline combined with a spatial inference engine, the system places objects in a physically plausible 3D scene and computes evacuation routes for first responders.

**Core pipeline:**
```
Natural Language Input
        ↓
  LLM JSON Parsing (Qwen2.5-Coder-32B)
        ↓
  Spatial Inference Engine (SceneSeer-inspired)
        ↓
  3D Scene Assembly (Three.js / WebGL)
        ↓
  Evacuation Route Visualization (BFS Pathfinding)
```

---

## 🏗️ Architecture

```
project/
├── backend/
│   ├── main.py                  # FastAPI server & session/log management
│   ├── parser_module.py         # LLM integration (Qwen via HuggingFace)
│   ├── batch_test_spatial.py    # Batch evaluation with spatial inference
│   ├── eval_compare.py          # Evaluation pipeline (metrics calculation)
│   ├── reference_outputs.json   # Ground truth for evaluation
│   └── logs/                    # Session log files (auto-generated)
│       ├── session_YYYYMMDD_HHMMSS.txt
│       └── session_spatial_YYYYMMDD_HHMMSS.txt
├── objects/                     # GLTF/GLB 3D model assets
│   ├── window_1/
│   ├── door_1/
│   ├── standing_person/
│   └── lying_person/
├── index.html                   # Frontend entry point
├── main.js                      # Three.js scene logic & spatial inference
└── .gitignore
```

---

## 🧠 Key Components

### Backend — `parser_module.py`
- Sends natural language text to **Qwen2.5-Coder-32B-Instruct** via HuggingFace `InferenceClient`
- Returns a structured `SceneGraph` (Pydantic model) with `assets` and `relations`
- Each asset includes: `type`, `placement_type`, `traversability`, `scale_modifier`

### Backend — `main.py`
- FastAPI server with CORS enabled
- Session-based logging: each browser refresh creates a new timestamped log file
- Endpoints:
  - `POST /api/new-session` — starts a new log session
  - `POST /api/generate-scene` — parses input and returns scene JSON
  - `POST /api/log-spatial` — logs post-inference scene data
  - `POST /api/log-result` — logs evaluation results

### Frontend — `main.js`
- **Three.js** WebGL rendering with hybrid asset library (GLTF models + procedural boxes)
- **Spatial Inference Engine** (`applySpatialInference`) — post-processing layer that corrects LLM errors using a knowledge base inspired by SceneSeer:
  - Rule 1: Support hierarchy (lamps must be on tables, etc.)
  - Rule 2: Correct spatial relations (chairs in front of tables, not behind)
  - Rule 3: Preferred wall placement (beds/sofas avoid center)
  - Rule 4: Forbidden neighbors (rubble ≠ next to bed)
  - Rule 5: Traversability correction map
  - Rule 6: Placement type correction map
- **BFS Pathfinding** for evacuation route calculation with distance, time, and complexity metrics
- **OrbitControls** for 3D camera navigation; drag-and-drop object manipulation
- Emergency Analysis Dashboard (exit points, spatial relations, path metrics)

### Evaluation — `eval_compare.py`
Compares LLM output against ground-truth reference using 5 metrics:

| Metric | Description |
|--------|-------------|
| **OEA** | Object Extraction Accuracy — correct objects / expected objects |
| **PTA** | Placement Type Accuracy — floor/wall/ceiling placement correctness |
| **TRA** | Traversability Accuracy — blocked/passable classification |
| **SCA** | Scale Coefficient Accuracy — scale modifier correctness |
| **RA** | Relation Accuracy — spatial relation correctness |

---

## 🚀 Getting Started

### Prerequisites
- Python 3.10+
- Node.js (optional, for a local static server)
- HuggingFace account with access to `Qwen/Qwen2.5-Coder-32B-Instruct`

### 1. Clone the repository
```bash
git clone <repo-url>
cd <project-folder>
```

### 2. Set up the Python virtual environment
```bash
python3 -m venv graf_llm_venv
source graf_llm_venv/bin/activate      # Linux/Mac
# graf_llm_venv\Scripts\activate       # Windows

pip install -r backend/requirements.txt
```

### 3. Configure your HuggingFace API key
Create a `.env` file in the `backend/` directory:
```env
HF_TOKEN=hf_your_token_here
```

### 4. Start the backend
```bash
source graf_llm_venv/bin/activate
cd backend
uvicorn main:app --reload
```
Backend runs at: `http://127.0.0.1:8000`

### 5. Start the frontend
```bash
# From the project root
python3 -m http.server
```
Open `http://localhost:8000` in your browser.

---

## 📊 Running Evaluation

### Batch test (generates a spatial log file)
```bash
cd backend
python batch_test_spatial.py --input test_sentences.txt --delay 2
```

### Evaluate against ground truth
```bash
python eval_compare.py \
  --reference reference_outputs.json \
  --actual logs/session_spatial_YYYYMMDD_HHMMSS.txt
```

Output: terminal summary + `eval_results_<session>.csv`

---

## 📈 Results Summary

Applying the spatial inference post-processing layer improved overall accuracy from **~85.8%** to **~91.1%** on a 100-case test dataset (Simple / Medium / Complex tiers). The largest gain was observed in **Traversability Accuracy (TRA)**.

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| LLM | Qwen2.5-Coder-32B-Instruct (HuggingFace) |
| Backend | Python, FastAPI, Pydantic, Uvicorn |
| Frontend | JavaScript, Three.js (WebGL) |
| Pathfinding | BFS (custom implementation) |
| 3D Models | GLTF/GLB assets |
| Evaluation | Python, CSV output |

