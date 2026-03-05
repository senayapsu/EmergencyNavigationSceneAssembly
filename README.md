# Dynamic 3D Scene Reconstruction for Emergency Scenarios


This system converts natural language descriptions of emergency scenes into interactive 3D environment. Using an LLM-powered parsing pipeline combined with a spatial inference knowledge, the system places objects in a 3D scene and computes evacuation routes for first responders.

**Core pipeline:**
```
Natural Language Input
        ↓
  LLM JSON Parsing (Qwen2.5-Coder-7B)
        ↓
  Spatial Inference
        ↓
  3D Scene Assembly (Three.js / WebGL)
        ↓
  Evacuation Route Visualization (BFS Pathfinding)
```

---

## Architecture

```
project/
├── backend/
│   ├── main.py                  # FastAPI server & session/log management
│   ├── parser_module.py         # LLM integration 
│   ├── batch_test_spatial.py    # Batch evaluation with spatial inference
│   ├── batch_test.py            # Batch evaluation without spatial inference
│   ├── eval_compare.py          # Evaluation pipeline
│   ├── reference_outputs.json   # Ground truth for evaluation
│   └── logs/                    # Session log files
│ 
├── objects/                     # GLTF/GLB 3D model assets
├── index.html                   # Frontend
├── main.js                      # main project file
```

---

##  Getting Started

### Prerequisites
- Python 3.10+
- Node.js 
- Ollama (or any other system to run Qwen qwen2.5-coder:7b )

### 1. Clone the repository
```bash
git clone "repo-url"
cd "project-folder"
```

### 2. Set up the Python virtual environment
```bash
python3 -m venv graf_llm_venv
source graf_llm_venv/bin/activate      # Linux/Mac

pip install -r backend/requirements.txt
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
Open `http://localhost:8000` in the browser.

---

| Layer | Technology |
|-------|-----------|
| LLM | Qwen2.5-Coder-7B-Instruct  |
| Backend | Python, FastAPI, Pydantic, Uvicorn |
| Frontend | JavaScript, Three.js (WebGL) |
| Pathfinding | BFS |
| Evaluation | Python |

