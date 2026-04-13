# NeuralGate

Secure Face Authentication System with anti-spoofing liveness detection.
NeuralGate is a robust, real-time face authentication platform built for secure access control, attendance systems, or identity verification. It combines state-of-the-art deep learning (InsightFace ArcFace) for accurate recognition with MediaPipe-powered blink-based liveness detection to prevent spoofing attacks (photos, videos, or masks).

## Features

- **High-Accuracy Face Recognition** — Powered by InsightFace ArcFace embeddings for robust 1:1 and 1:N matching
- **Anti-Spoofing Liveness Detection** — Blink-based verification using MediaPipe Face Landmarker to ensure a live person is present
- **Comprehensive Audit Logging** — Detailed logging of all authentication attempts (granted/denied) with timestamps and reasons
- **Modern React Frontend** — Responsive dashboard with live webcam feed, real-time feedback, and smooth animations (Framer Motion)
- **FastAPI Backend** — High-performance async API with automatic model loading, cosine similarity matching, and secure session management
- **Easy Enrollment** — Add new users by simply placing photos in a folder and retraining

## Project Structure

```text
neuralgate/
├── backend/
│   ├── app/
│   │   ├── config.py          # Core settings & thresholds
│   │   ├── controllers/       # Business logic
│   │   ├── routes/            # API endpoints
│   │   └── utils/             # Helpers (image processing, similarity, etc.)
│   ├── faces/                 # Enrollment images: faces/<person_name>/*.jpg
│   ├── trained_model/         # face_embeddings_insightface.pkl
│   ├── train_model.py
│   ├── main.py
│   └── requirements.txt
├── frontend/
│   ├── public/
│   │   ├── mediapipe/         # Local MediaPipe assets
│   │   └── models/
│   │       └── face_landmarker.task
│   ├── src/
│   └── package.json
├── audit_log.csv              # Generated automatically
└── README.md
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

1. Open the frontend and click Start Authentication
2. Grant camera permission
3. Hold your face steady in the frame while the system calibrates open-eye baseline
4. Perform one natural blink when prompted
5. The system captures the frame, sends it to the backend, and grants access on success
6. On successful authentication, a session is created and the dashboard opens

## How It Works

### Training Phase (train_model.py)

- Scans backend/faces/<person>/
- Detects and aligns faces using InsightFace
- Extracts 512-dimensional ArcFace embeddings
- Saves normalized embeddings + labels to pickle file

### Liveness Detection (Frontend)

- MediaPipe Face Landmarker tracks eye landmarks in real-time
- Computes Eye Aspect Ratio (EAR) or blendshape-based openness
- Calibrates against user's natural open-eye state
- Requires a confirmed blink (MIN_BLINKS_REQUIRED) before capture

### Authentication (Backend)

- Validates that liveness check passed
- Detects face in uploaded frame
- Extracts embedding
- Computes cosine similarity against enrolled templates
- Applies configurable threshold + margin check
- Creates time-limited session token on success

## Configuration

Main backend settings are in `backend/app/config.py`:

- `SIMILARITY_THRESHOLD`
- `MARGIN_REQUIRED`
- `MIN_BLINKS_REQUIRED`
- `SESSION_TTL_MINUTES`

Current defaults:

```python
SIMILARITY_THRESHOLD = 0.75      # Minimum cosine similarity (0.0–1.0)
MARGIN_REQUIRED = 0.10           # Difference required from second-best match
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

## 🛡️ Security & Best Practices
- **Liveness Protection**: Blink detection helps mitigate photo/video spoofing
- **Server-Side Matching**: Embeddings are never exposed to the client
- **Session Management**: Time-limited tokens (configurable TTL)
- **No Persistent Sensitive Data**: Only embeddings (not raw images) are stored after training
  
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

## 🛠 Tech Stack

- **Backend**: FastAPI, InsightFace (ArcFace), OpenCV, Python 3.10+
- **Frontend**: React + Vite, MediaPipe Tasks Vision, Framer Motion
- **Liveness**: MediaPipe Face Landmarker (blink detection via Eye Aspect Ratio / landmarks)
- **Storage**: Pickle for embeddings, CSV for audit logs
- **Others**: Uvicorn, npm

