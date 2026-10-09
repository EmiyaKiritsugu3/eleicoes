"""Download de datasets TSE com retry + validação SHA256 (offline-first, custo zero)."""

from __future__ import annotations

import hashlib
import os
import threading
from pathlib import Path
from urllib.parse import urlparse

import requests

CHUNK_SIZE = 1024 * 64
TIMEOUT_S = 60

REPO_ROOT = Path(__file__).resolve().parent.parent
RAW_ROOT = REPO_ROOT / "data" / "raw"
ALLOWED_HOSTS = frozenset({"cdn.tse.jus.br", "dadosabertos.tse.jus.br", "ftp.ibge.gov.br"})


def download_dataset(url, dest, expected_sha256=None, retries=3) -> str:
    """Baixa `url` para `dest` com até `retries` tentativas; retorna o SHA256 real.

    Calcula o hash durante a escrita (streaming) em um arquivo temporário
    único por processo+thread (`dest` + ".part.<pid>.<thread>") e o move para `dest` com rename atômico — `dest`
    só existe como arquivo completo e verificado. Se `expected_sha256`
    for dado e divergir, remove o parcial e levanta `ValueError`.
    Se todas as tentativas falharem, remove o parcial e relança a última
    exceção de rede. `retries < 1` levanta `ValueError`.
    """
    if retries < 1:
        raise ValueError(f"retries must be >= 1, got {retries}")
    host = (urlparse(url).hostname or "").lower()
    if host not in ALLOWED_HOSTS:
        raise ValueError(
            f"url host not allowlisted: {url!r} "
            f"(allowed: {sorted(ALLOWED_HOSTS)})"
        )
    dest = Path(dest)
    # Sandbox: dest resolvido (.. e symlinks) deve ficar ESTRITAMENTE sob
    # data/raw do repo — antes de qualquer mkdir ou chamada HTTP.
    raw_root = RAW_ROOT.resolve()
    if raw_root not in dest.resolve().parents:
        raise ValueError(f"dest outside data/raw sandbox: {str(dest)!r}")
    dest.parent.mkdir(parents=True, exist_ok=True)
    # Tmp único por processo E thread: só o pid (brief) ainda colide entre
    # threads do mesmo processo (mesmo pid) — FileNotFoundError no rename.
    tmp = dest.with_name(f"{dest.name}.part.{os.getpid()}.{threading.get_ident()}")
    last_exc: Exception | None = None
    for _ in range(retries):
        try:
            with requests.get(url, stream=True, timeout=TIMEOUT_S) as resp:
                resp.raise_for_status()
                digest = hashlib.sha256()
                with open(tmp, "wb") as f:
                    for chunk in resp.iter_content(chunk_size=CHUNK_SIZE):
                        if not chunk:
                            continue
                        f.write(chunk)
                        digest.update(chunk)
            sha = digest.hexdigest()
            if expected_sha256 is not None and sha != expected_sha256.lower():
                tmp.unlink(missing_ok=True)
                raise ValueError(f"sha256 mismatch for {url}: got {sha}")
            tmp.replace(dest)
            return sha
        except ValueError:
            raise
        except requests.RequestException as exc:
            last_exc = exc
            continue
    tmp.unlink(missing_ok=True)
    raise last_exc  # type: ignore[misc]
