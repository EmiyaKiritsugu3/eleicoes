"""Download de datasets TSE com retry + validação SHA256 (offline-first, custo zero)."""

from __future__ import annotations

import hashlib
import os
import threading
from pathlib import Path

import requests

CHUNK_SIZE = 1024 * 64
TIMEOUT_S = 60


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
    dest = Path(dest)
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
