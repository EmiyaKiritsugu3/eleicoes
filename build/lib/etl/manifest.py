"""Manifest core: registra cada ingestão com fonte + hash (offline-first, custo zero)."""

import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path

REQUIRED_KEYS = ("source_url", "sha256")


def load_manifest(path) -> dict:
    """Load manifest JSON from path. Raises on missing/invalid file."""
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def _validate_entry(entry: dict) -> None:
    """Fail-closed: entry precisa de source_url truthy e sha256 64-hex."""
    if not isinstance(entry, dict):
        raise ValueError(f"manifest entry inválida (não é dict): {entry!r}")
    if not entry.get("source_url"):
        raise ValueError("manifest entry sem source_url")
    sha = entry.get("sha256")
    if (
        not isinstance(sha, str)
        or not sha
        or not re.fullmatch(r"[0-9a-f]{64}", sha.lower())
    ):
        raise ValueError(f"manifest entry com sha256 inválido: {sha!r}")


def write_manifest(path, entry: dict) -> dict:
    """Append entry to manifest at path, creating {"ingestions": [...]} if needed.

    Valida a entry antes do append (ValueError em entry inválida).
    Arquivo corrompido é preservado como `<path>.corrupt.<UTC-ts>` antes
    de recomeçar; a escrita é atômica (tmp + os.replace).

    Returns the full manifest dict.
    """
    _validate_entry(entry)
    try:
        manifest = load_manifest(path)
        if not isinstance(manifest, dict) or not isinstance(manifest.get("ingestions"), list):
            manifest = {"ingestions": []}
    except FileNotFoundError:
        manifest = {"ingestions": []}
    except (json.JSONDecodeError, OSError, UnicodeDecodeError):
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S")
        Path(path).rename(f"{path}.corrupt.{stamp}")
        manifest = {"ingestions": []}
    manifest["ingestions"].append(entry)
    tmp_path = f"{path}.tmp"
    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
    os.replace(tmp_path, path)
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
