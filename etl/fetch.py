"""Download de datasets TSE com retry + validação SHA256 (offline-first, custo zero)."""

from __future__ import annotations

import hashlib
from pathlib import Path

import requests

CHUNK_SIZE = 1024 * 64
TIMEOUT_S = 60


def download_dataset(url, dest, expected_sha256=None, retries=3) -> str:
    """Baixa `url` para `dest` com até `retries` tentativas; retorna o SHA256 real.

    Calcula o hash durante a escrita (streaming). Se `expected_sha256` for
    dado e divergir, remove o arquivo parcial e levanta `ValueError`.
    Se todas as tentativas falharem, relança a última exceção de rede.
    """
    dest = Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    last_exc: Exception | None = None
    for _ in range(retries):
        try:
            resp = requests.get(url, stream=True, timeout=TIMEOUT_S)
            resp.raise_for_status()
            digest = hashlib.sha256()
            with open(dest, "wb") as f:
                for chunk in resp.iter_content(chunk_size=CHUNK_SIZE):
                    if not chunk:
                        continue
                    f.write(chunk)
                    digest.update(chunk)
            sha = digest.hexdigest()
            if expected_sha256 is not None and sha != expected_sha256.lower():
                dest.unlink(missing_ok=True)
                raise ValueError(f"sha256 mismatch for {url}: got {sha}")
            return sha
        except ValueError:
            raise
        except requests.RequestException as exc:
            last_exc = exc
            continue
    raise last_exc  # type: ignore[misc]
