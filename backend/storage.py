"""Durable JSON storage for app state (strategies, universes, ranking systems, settings,
perturbation jobs).

Cloud Run instances have ephemeral, per-instance filesystems: writing JSON files to the
container disk loses data on cold starts and diverges between instances. Resolution order:

  1. GCS_BUCKET set   → state lives as `<name>.json` objects in that bucket (Cloud Run).
  2. STATE_DIR set    → state lives as files in that directory (docker-compose volume).
  3. otherwise        → files next to this module (local development; gitignored).
"""

import json
import logging
import os
import threading
from pathlib import Path
from typing import Any

log = logging.getLogger(__name__)

_LOCAL_DIR = Path(os.environ.get("STATE_DIR") or Path(__file__).parent)
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
    """Load `<name>.json` from GCS (if configured) or the local state directory.

    A *missing* object/file returns `default`. A read/parse *failure* on GCS is raised
    rather than swallowed: returning `default` there would let the next save silently
    overwrite the real state with an empty list.
    """
    with _LOCK:
        if _GCS_BUCKET:
            blob = _bucket().blob(f"{name}.json")
            if not blob.exists():
                return default
            return json.loads(blob.download_as_text())
        path = _LOCAL_DIR / f"{name}.json"
        if not path.is_file():
            return default
        try:
            with open(path) as f:
                return json.load(f)
        except (OSError, ValueError):
            log.exception("Failed to read local state file %s; using default", path)
            return default


def save_json(name: str, data: Any) -> None:
    with _LOCK:
        if _GCS_BUCKET:
            blob = _bucket().blob(f"{name}.json")
            blob.upload_from_string(json.dumps(data, indent=2), content_type="application/json")
        else:
            _LOCAL_DIR.mkdir(parents=True, exist_ok=True)
            path = _LOCAL_DIR / f"{name}.json"
            tmp = path.with_suffix(".json.tmp")
            with open(tmp, "w") as f:
                json.dump(data, f, indent=2)
            tmp.replace(path)
