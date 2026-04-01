import cv2
import os
import numpy as np
import pickle
from insightface.app import FaceAnalysis


def train_face_recognizer():
    """Train the face recognition model using InsightFace normed_embedding."""

    print("Initializing InsightFace (this may take a moment on first run)...")
    app = FaceAnalysis(name='buffalo_l', providers=['CPUExecutionProvider'])
    app.prepare(ctx_id=0, det_size=(640, 640))

    training_data_path = 'faces'

    if not os.path.isdir(training_data_path):
        print(f"ERROR: '{training_data_path}/' folder not found.")
        print("Create it and add subfolders named after each person, containing their photos.")
        return

    known_embeddings = []
    known_names = []

    print("\nStarting training process with InsightFace...\n")

    for person_name in sorted(os.listdir(training_data_path)):
        person_path = os.path.join(training_data_path, person_name)

        if not os.path.isdir(person_path):
            continue

        print(f"Processing: {person_name}")
        image_count = 0

        for image_name in sorted(os.listdir(person_path)):
            image_path = os.path.join(person_path, image_name)
            ext = os.path.splitext(image_name)[1].lower()
            if ext not in {'.jpg', '.jpeg', '.png', '.bmp', '.webp'}:
                continue

            try:
                img = cv2.imread(image_path)
                if img is None:
                    print(f"  ⚠  Could not read: {image_name}")
                    continue

                faces = app.get(img)

                if len(faces) > 0:
                    face = faces[0]
                    embedding = face.normed_embedding   # ← 512-d, already L2-normalised
                    known_embeddings.append(embedding)
                    known_names.append(person_name)
                    image_count += 1
                    print(f"  ✓  {image_name}  (det_score={face.det_score:.3f})")
                else:
                    print(f"  ⚠  No face detected in: {image_name}")

            except Exception as e:
                print(f"  ✗  Error on {image_path}: {e}")

        print(f"  → {image_count} image(s) enrolled for '{person_name}'\n")

    if len(known_embeddings) == 0:
        print("ERROR: No faces were detected in any training image.")
        print("Make sure your images contain clear, well-lit, frontal faces.")
        return

    os.makedirs('trained_model', exist_ok=True)
    model_path = 'trained_model/face_embeddings_insightface.pkl'

    data = {
        'embeddings': np.array(known_embeddings),  # shape: (N, 512)
        'names': known_names,                       # list of N strings
    }

    with open(model_path, 'wb') as f:
        pickle.dump(data, f)

    unique = list(set(known_names))
    print(f"✅  Training complete!")
    print(f"    Samples  : {len(known_embeddings)}")
    print(f"    People   : {len(unique)} — {unique}")
    print(f"    Saved to : {model_path}")
    print(f"\nNow start the server:  uvicorn main:app --reload --port 8000")


if __name__ == "__main__":
    train_face_recognizer()