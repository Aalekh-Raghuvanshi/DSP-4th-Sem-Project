# NeuralGate v3 · Face Authentication

## Quick Start

### Step 1 — Add your face photos

```
backend/faces/
├── yourname/
│   ├── photo1.jpg
│   ├── photo2.jpg   ← more photos = better accuracy
│   └── photo3.jpg
└── anotherperson/
    └── photo.jpg
```

Use clear, well-lit, **frontal face** photos. JPG/PNG/BMP/WEBP all work.

---

### Step 2 — Train the model

```bash
cd backend
python train_model.py
```

Output:
```
✅  Training complete!
    Samples  : 3
    People   : 1 — ['yourname']
    Saved to : trained_model/face_embeddings_insightface.pkl
```

Re-run this whenever you add or change photos.

---

### Step 3 — Start the backend

```bash
uvicorn main:app --reload --port 8000
```

First run downloads the InsightFace `buffalo_l` model (~300 MB).

---

### Step 4 — Start the frontend

```bash
cd frontend
npm install
npm run dev
# Opens at http://localhost:3000
```

---

## How it works

Training (`train_model.py`):
- Loads each image with OpenCV
- Runs InsightFace `app.get(img)` → takes `faces[0]`
- Stores `face.normed_embedding` (512-d, L2-normalised ArcFace)
- Saves all embeddings + names to a `.pkl` file

Authentication (`main.py`):
- Receives webcam frame
- Tries original + horizontally-flipped (handles webcam mirror)
- Extracts `normed_embedding` the exact same way as training
- Computes `dot(probe, all_stored)` = cosine similarity
- Returns best match if score ≥ 0.25

---

## Tuning the threshold

Edit `SIMILARITY_THRESHOLD` in `backend/main.py`:

| Value | Effect |
|---|---|
| `0.20` | Easier — good if same-person scores are low |
| `0.25` | Default — balanced |
| `0.35` | Stricter — fewer false positives |

When you click "Scan Face" and it fails, the UI shows the exact similarity score per enrolled person. Use that to decide if you need to lower the threshold or retrain with better photos.

---

## Tips for better recognition

- Use **3–5 photos per person** taken in different lighting/angles
- Photos should be **at least 200×200px** with the face clearly visible
- Avoid sunglasses, heavy shadows, or extreme angles in training photos
- Good webcam lighting matters most — face the light source# DSP-4th-Sem-Project
