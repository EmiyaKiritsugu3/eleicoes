"""Manifest core: registra cada ingestão com fonte + hash (offline-first, custo zero)."""

import hashlib
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


def _validate_artifact_entry(entry: dict) -> None:
    """Fail-closed: artifact exige entry válida + arquivo + tamanho.

    `source_url` truthy e `sha256` 64-hex (via `_validate_entry`),
    `arquivo` nome simples não-vazio (sem `/` ou `..` — traversal
    nunca resolve) e `size_bytes` inteiro >= 0.
    """
    _validate_entry(entry)
    arquivo = entry.get("arquivo")
    if (
        not isinstance(arquivo, str)
        or not arquivo
        or "/" in arquivo
        or "\\" in arquivo
        or arquivo in (".", "..")
        or ".." in Path(arquivo).parts
    ):
        raise ValueError(f"manifest artifact sem arquivo válido: {arquivo!r}")
    size = entry.get("size_bytes")
    if not isinstance(size, int) or isinstance(size, bool) or size < 0:
        raise ValueError(f"manifest artifact com size_bytes inválido: {size!r}")


def _artifacts_ok(manifest: dict, path) -> bool:
    """True iff a chave `artifacts` prova os bytes servidos.

    DECISÃO (EVOLVE-2 Task 1): manifest legado SEM a chave `artifacts`
    continua válido quando as ingestões estão ok — o pipeline interno
    (registro do Censo, standalone `build_fato`, gates `run_gates`)
    produz manifests de ingestão antes de existirem bytes servidos, e
    reprovar aqui bricaria a ingestão em vez de proteger o servido.
    Seed/CI sempre escrevem artifacts (`build_all` não-vazio via
    `register_served_artifacts` + recalc do seed após o `build_fato`),
    então todo manifest SERVIDO carrega a chave; a /auditoria mostra
    nota honesta quando ela falta.

    Chave PRESENTE é promessa de cobertura: exige lista não-vazia onde
    cada entry é estruturalmente válida e resolve para um arquivo irmão
    do manifest (contenção estrita — symlink p/ fora reprova) com
    sha256 E tamanho conferindo byte a byte. Qualquer divergência
    (adulteração, arquivo ausente, entry malformada) reprova.
    """
    if "artifacts" not in manifest:
        return True  # legado só-ingestions: ver decisão acima
    artifacts = manifest.get("artifacts")
    if not isinstance(artifacts, list) or not artifacts:
        return False
    base = Path(path).resolve().parent
    for entry in artifacts:
        if not isinstance(entry, dict):
            return False
        try:
            _validate_artifact_entry(entry)
        except ValueError:
            return False
        try:
            candidate = (base / entry["arquivo"]).resolve()
        except (OSError, ValueError):
            return False
        if candidate.parent != base or not candidate.is_file():
            return False
        try:
            raw = candidate.read_bytes()
        except OSError:
            return False
        if len(raw) != entry["size_bytes"]:
            return False
        if hashlib.sha256(raw).hexdigest() != entry["sha256"].lower():
            return False
    return True


def verify_manifest(path) -> bool:
    """Return True iff manifest is valid JSON with ingestions carrying source_url+sha256.

    Com chave `artifacts` presente, cada entry precisa provar os bytes
    servidos (arquivo irmão do manifest com sha256+tamanho conferindo);
    sem a chave, vale o contrato legado só-ingestions (ver `_artifacts_ok`).
    """
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
    return _artifacts_ok(manifest, path)
