"""Durable JSON storage for app state (strategies, universes, ranking systems, settings).

Cloud Run instances have ephemeral, per-instance filesystems: writing JSON files to the
container disk loses data on cold starts and diverges between instances (the source of the
duplicated/vanishing entries). When the GCS_BUCKET env var is set, state lives in a GCS
bucket instead; locally (no GCS_BUCKET) it falls back to files next to this module.
"""

import json
import os
import threading
from pathlib import Path
from typing import Any

_LOCAL_DIR = Path(__file__).parent
_LOCK = threading.Lock()

_GCS_BUCKET = os.environ.get("GCS_BUCKET", "")
_gcs_bucket_handle = None


def _bucket():
    global _gcs_bucket_handle
    if _gcs_bucket_handle is None:
        from google.cloud import storage as gcs

        _gcs_bucket_handle = gcs.Client().bucket(_GCS_BUCKET)
    return _gcs_bucket_handle


def load_json(name: str, default: Any) -> Any:
    """Load `<name>.json` from GCS (if configured) or the local backend directory."""
    with _LOCK:
        try:
            if _GCS_BUCKET:
                blob = _bucket().blob(f"{name}.json")
                if not blob.exists():
                    return default
                return json.loads(blob.download_as_text())
            path = _LOCAL_DIR / f"{name}.json"
            if not path.is_file():
                return default
            with open(path) as f:
                return json.load(f)
        except Exception:
            return default


def save_json(name: str, data: Any) -> None:
    with _LOCK:
        if _GCS_BUCKET:
            blob = _bucket().blob(f"{name}.json")
            blob.upload_from_string(json.dumps(data, indent=2), content_type="application/json")
        else:
            path = _LOCAL_DIR / f"{name}.json"
            tmp = path.with_suffix(".json.tmp")
            with open(tmp, "w") as f:
                json.dump(data, f, indent=2)
            tmp.replace(path)
