from typing import Optional, List, Dict
import numpy as np

known_embeddings: Optional[np.ndarray] = None
known_names: List[str] = []
session_store: Dict[str, dict] = {}