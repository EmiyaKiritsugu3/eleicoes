"""Manifest core: registra cada ingestão com fonte + hash (offline-first, custo zero)."""

import hashlib
import json
import os
import re
import warnings
from datetime import datetime, timezone
from pathlib import Path

REQUIRED_KEYS = ("source_url", "sha256")  # compat: kept for external importers (internal check uses _validate_entry)


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


def _dedupe_key(entry: dict) -> tuple:
    """Chave única de idempotência das ingestões (EVOLVE-4 T2, sem fork).

    `(dataset, ano, turno, CARGO_MAIÚSCULO, source_url)`: generaliza a
    antiga chave TSE `(ano, cargo, source_url)` de `build_marts` e a
    `_ingestion_dedupe_key` de `build_fato` — ambos os fluxos importam
    ESTA função. Os campos extras são load-bearing no fluxo fato
    (`turno`/`dataset` distinguem triples; colapsar p/ o 3-tuple
    fundiria turnos do mesmo par — rejeitado): no fluxo TSE `turno` é
    sempre None e `dataset` é 1:1 com `(ano, cargo)` no V1, de modo que
    o dedupe ali é idêntico ao antigo.
    """
    return (
        entry.get("dataset"),
        entry.get("ano"),
        entry.get("turno"),
        str(entry.get("cargo", "")).upper(),
        entry.get("source_url"),
    )


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
        # Hardening (review Task 1): o True legado não é silencioso —
        # avisa alto para o chamador distinguir de manifest com cobertura
        # total de artifacts. Contrato mantido: retorna True (test-pinned).
        warnings.warn(
            "manifest sem chave 'artifacts': validado só por ingestões, "
            "sem prova dos bytes servidos",
            UserWarning,
            stacklevel=3,
        )
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
    """Return True iff manifest is valid JSON with strict ingestions.

    Cada ingestão passa por `_validate_entry` (`source_url` truthy +
    `sha256` 64-hex — paridade com `isAudited` do front); sha frouxo
    (`"abc123"`) reprova mesmo sem a chave `artifacts`.

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
        try:
            _validate_entry(entry)
        except ValueError:
            return False
    return _artifacts_ok(manifest, path)


def verificar_fato_manifest(db_manifest_path, fato_path) -> bool:
    """True iff a ingestão do `<db dir>` confere com os bytes do fato.

    Predicado anti-crash-entre-passos (EVOLVE-3 Task 2; movido p/ este
    módulo-folha na EVOLVE-4 T2 para que `etl.validate` delegue sem
    importar `etl.build_fato` — DAG manifest ← validate ← build_marts
    ← build_fato preservado): compara o `sha256` da entry (última com
    `dataset` == stem do fato — tolera histórico append-only legado com
    duplicatas) com o sha dos bytes atuais do arquivo. Fato novo +
    manifest velho (crash após o fato, antes do manifest) REPROVA;
    ausência, corrupção ou divergência qualquer também reprova
    (fail-closed, nunca verde falso). Estrito (CodeRabbit PR#5 F1): a
    lista inteira precisa ser válida — item não-dict ou entry
    malformada reprova mesmo com match válido adiante. O writer
    preserva o legado sem apagar; o VERIFICADOR nunca dá verde no
    malformado (coerente com `verify_manifest`, que também reprova ali).
    """
    try:
        raw = Path(fato_path).read_bytes()
    except OSError:
        return False
    try:
        manifest = json.loads(Path(db_manifest_path).read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError, OSError,
            UnicodeDecodeError):
        return False
    if not isinstance(manifest, dict):
        return False
    ingestions = manifest.get("ingestions")
    if not isinstance(ingestions, list):
        return False
    for e in ingestions:
        try:
            _validate_entry(e)  # não-dict e malformada reprovam aqui
        except ValueError:
            return False
    stem = Path(fato_path).stem
    match = None
    for e in ingestions:
        if isinstance(e, dict) and e.get("dataset") == stem:
            match = e  # última vence (legado append-only duplicava)
    if match is None:
        return False
    sha = match.get("sha256")
    if not isinstance(sha, str) or not sha:
        return False
    return hashlib.sha256(raw).hexdigest() == sha.lower()
