# NeuralGate

Face authentication system built with FastAPI, InsightFace, React, and MediaPipe blink-based liveness detection.

## Features

- Face recognition using InsightFace ArcFace embeddings
- Blink-based liveness check before authentication
- Audit log for granted and denied attempts
- React frontend with webcam capture and dashboard
- FastAPI backend for model loading, matching, and session creation

## Project Structure

```text
backend/
  app/
    config.py
    controllers/
    routes/
    utils/
  faces/
  trained_model/
  main.py
  requirements.txt

frontend/
  public/
    mediapipe/
    models/
  src/
  package.json
```

## Requirements

- Python 3.10+
- Node.js 18+
- npm

## Setup

### 1. Add training images

Store training images like this:

```text
backend/faces/
├── yourname/
│   ├── photo1.jpg
│   ├── photo2.jpg
│   └── photo3.jpg
└── anotherperson/
    └── photo1.jpg
```

Tips:

- Use clear, front-facing photos
- Add 3 to 5 images per person when possible
- Vary lighting and angle slightly
- Avoid heavy shadows or sunglasses

### 2. Install backend dependencies

```bash
cd backend
pip install -r requirements.txt
```

### 3. Train the face model

```bash
cd backend
python train_model.py
```

Expected output looks similar to:

```text
✅  Training complete!
    Samples  : 6
    People   : 2 — ['alice', 'bob']
    Saved to : trained_model/face_embeddings_insightface.pkl
```

Re-run training whenever you add or replace images in `backend/faces/`.

### 4. Install frontend dependencies

```bash
cd frontend
npm install
```

### 5. Start the backend

```bash
cd backend
uvicorn main:app --reload --port 8000
```

Notes:

- The first backend run may download the InsightFace `buffalo_l` model.
- The backend listens on `http://localhost:8000`.

### 6. Start the frontend

```bash
cd frontend
npm run dev
```

The frontend runs through Vite, usually at `http://localhost:5173`.

## Authentication Flow

1. Open the frontend.
2. Start authentication.
3. Allow camera access.
4. Hold your face in frame while the blink detector calibrates.
5. Blink once.
6. The app immediately captures a frame, sends it to the backend, and opens the dashboard on success.

## How It Works

### Training

`backend/train_model.py`:

- Loads images from `backend/faces/<person>/`
- Detects faces with InsightFace
- Extracts normalized face embeddings
- Saves embeddings and labels into `backend/trained_model/face_embeddings_insightface.pkl`

### Liveness Check

Frontend liveness:

- Uses MediaPipe face landmarks
- Tracks both eyes from the live webcam stream
- Calibrates against the user’s open-eye baseline
- Requires a real blink before authentication starts

MediaPipe assets are served locally from:

- `frontend/public/mediapipe/`
- `frontend/public/models/face_landmarker.task`

### Authentication

Backend authentication:

- Accepts the captured webcam frame
- Rejects the request if blink liveness did not pass
- Detects the face from the uploaded image
- Computes cosine similarity against enrolled embeddings
- Applies a similarity threshold and match margin check
- Creates a session token on success

## Configuration

Main backend settings are in `backend/app/config.py`:

- `SIMILARITY_THRESHOLD`
- `MARGIN_REQUIRED`
- `MIN_BLINKS_REQUIRED`
- `SESSION_TTL_MINUTES`

Current defaults:

```python
SIMILARITY_THRESHOLD = 0.75
MARGIN_REQUIRED = 0.10
MIN_BLINKS_REQUIRED = 1
SESSION_TTL_MINUTES = 30
```

## Audit Log

Authentication events are written to:

```text
backend/audit_log.csv
```

Typical outcomes include:

- `GRANTED`
- `DENIED_MISMATCH`
- `DENIED_AMBIGUOUS`
- `DENIED_LIVENESS`
- `NO_FACE`

## Development

Run frontend production build:

```bash
cd frontend
npm run build
```

Run both apps together from the repository root:

```bash
npm run dev
```

## Troubleshooting

### Blink is not detected

- Keep your face centered and well lit
- Wait for calibration to finish before blinking
- Remove glare from glasses if possible
- Refresh the frontend after code or asset changes

### No face detected

- Move closer to the camera
- Improve lighting on your face
- Look directly at the webcam

### Authentication mismatch

- Retrain with more images
- Use clearer reference images
- Lower `SIMILARITY_THRESHOLD` slightly if genuine users are rejected too often

## Tech Stack

- FastAPI
- InsightFace
- OpenCV
- React
- Vite
- MediaPipe Tasks Vision
- Framer Motion

