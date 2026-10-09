"""Manifest core: registra cada ingestão com fonte + hash (offline-first, custo zero)."""

import json

REQUIRED_KEYS = ("source_url", "sha256")


def load_manifest(path) -> dict:
    """Load manifest JSON from path. Raises on missing/invalid file."""
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def write_manifest(path, entry: dict) -> dict:
    """Append entry to manifest at path, creating {"ingestions": [...]} if needed.

    Returns the full manifest dict.
    """
    try:
        manifest = load_manifest(path)
        if not isinstance(manifest, dict) or "ingestions" not in manifest:
            manifest = {"ingestions": []}
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        manifest = {"ingestions": []}
    manifest["ingestions"].append(entry)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
    return manifest


def verify_manifest(path) -> bool:
    """Return True iff manifest is valid JSON with ingestions carrying source_url+sha256."""
    try:
        manifest = load_manifest(path)
    except (FileNotFoundError, json.JSONDecodeError, OSError, UnicodeDecodeError):
        return False
    if not isinstance(manifest, dict):
        return False
    ingestions = manifest.get("ingestions")
    if not isinstance(ingestions, list) or not ingestions:
        return False
    for entry in ingestions:
        if not isinstance(entry, dict):
            return False
        for key in REQUIRED_KEYS:
            if not entry.get(key):
                return False
    return True
