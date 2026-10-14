"""Download de datasets TSE com retry + validação SHA256 (offline-first, custo zero)."""

from __future__ import annotations

import hashlib
import os
import random
import threading
import time
from pathlib import Path
from urllib.parse import urlparse

import requests

CHUNK_SIZE = 1024 * 64
TIMEOUT_S = 60
USER_AGENT = "analise-eleicoes/1.0 (ETL pesquisa eleitoral; +https://cdn.tse.jus.br)"
BACKOFF_BASE_S = 0.5
BACKOFF_MAX_S = 30.0
DEFAULT_MAX_BYTES = 2 * 1024**3  # 2 GiB: teto fail-closed antes de estourar o disco

REPO_ROOT = Path(__file__).resolve().parent.parent
RAW_ROOT = REPO_ROOT / "data" / "raw"
ALLOWED_HOSTS = frozenset({"cdn.tse.jus.br", "dadosabertos.tse.jus.br", "ftp.ibge.gov.br",
                             "apidatalake.tesouro.gov.br", "tesourotransparente.gov.br",
                             "api.portaldatransparencia.gov.br"})


def _validator_of(resp_headers) -> str | None:
    """ETag (preferido) ou Last-Modified dos headers (case-insensitive)."""
    etag = last_mod = None
    for key, value in (resp_headers or {}).items():
        lowered = key.lower()
        if lowered == "etag" and etag is None:
            etag = value
        elif lowered == "last-modified" and last_mod is None:
            last_mod = value
    return etag or last_mod or None


def _content_range_start(resp_headers) -> int | None:
    """Offset inicial de `Content-Range: bytes <start>-<end>/<total>`."""
    raw = None
    for key, value in (resp_headers or {}).items():
        if key.lower() == "content-range":
            raw = value
            break
    if not raw:
        return None
    try:
        return int(raw.split(None, 1)[1].split("-", 1)[0])
    except (IndexError, ValueError):
        return None


def download_dataset(url, dest, expected_sha256=None, retries=3, max_bytes=DEFAULT_MAX_BYTES) -> str:
    """Baixa `url` para `dest` com até `retries` tentativas; retorna o SHA256 real.

    Calcula o hash durante a escrita (streaming) em um arquivo temporário
    único por processo+thread (`dest` + ".part.<pid>.<thread>") e o move para `dest` com rename atômico — `dest`
    só existe como arquivo completo e verificado. Se `expected_sha256`
    for dado e divergir, remove o parcial e levanta `ValueError`.
    Entre tentativas há backoff exponencial com jitter
    (`uniform(0, min(BACKOFF_MAX_S, BACKOFF_BASE_S * 2**tentativa))`) —
    nunca sleep fixo. Toda requisição envia `User-Agent` identificando o
    projeto. Se uma tentativa cair no meio do stream, o retry envia
    `Range: bytes=<já-baixados>-` com `If-Range` (ETag/Last-Modified da
    primeira resposta 200) e continua de onde parou quando o servidor
    responde 206 com `Content-Range` iniciando exatamente no offset do
    parcial; sem validador, com `Content-Range` divergente, ou se o
    servidor ignorar o Range (200), recomeça do zero — nunca mistura bytes
    de versões distintas no mesmo arquivo (prova dos bytes). O download conta bytes em stream e aborta com `ValueError`
    fail-closed antes de estourar o disco quando `max_bytes` é excedido
    (inclusive fail-fast via `Content-Length` quando anunciado) — o parcial
    é removido e `dest` nunca é criado parcial.
    Se todas as tentativas falharem, remove o parcial e relança a última
    exceção de rede. `retries < 1` levanta `ValueError`. URL pendente
    (None/vazia/não-string, i.e. dataset sem path confirmado) levanta
    `ValueError` antes de qualquer IO — fail-closed.
    """
    if retries < 1:
        raise ValueError(f"retries must be >= 1, got {retries}")
    if max_bytes is not None and (
        isinstance(max_bytes, bool) or not isinstance(max_bytes, int) or max_bytes < 1
    ):
        raise ValueError(f"max_bytes deve ser inteiro >= 1 ou None, veio: {max_bytes!r}")
    if not isinstance(url, str) or not url:
        raise ValueError(
            f"url pendente/ausente, download bloqueado (sem dado oficial): {url!r}"
        )
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
    digest = hashlib.sha256()
    downloaded = 0
    validator: str | None = None  # ETag/Last-Modified da versão em curso
    for attempt in range(retries):
        try:
            headers = {"User-Agent": USER_AGENT}
            if downloaded > 0:
                if validator is None:
                    # Sem validador não há como garantir a mesma versão:
                    # recomeça do zero em vez de retomar.
                    downloaded = 0
                    digest = hashlib.sha256()
                    tmp.unlink(missing_ok=True)
                else:
                    headers["Range"] = f"bytes={downloaded}-"
                    headers["If-Range"] = validator
            with requests.get(url, stream=True, timeout=TIMEOUT_S, headers=headers) as resp:
                resp.raise_for_status()
                status = getattr(resp, "status_code", 200)
                resp_headers = getattr(resp, "headers", None) or {}
                if downloaded > 0 and status == 206:
                    try:
                        partial_size = tmp.stat().st_size
                    except FileNotFoundError:
                        partial_size = -1
                    if partial_size != downloaded:
                        # Parcial local divergiu do offset do resume: não há
                        # como continuar com integridade — retry decide.
                        raise requests.ConnectionError(
                            "parcial local divergiu do offset de resume"
                        )
                    if _content_range_start(resp_headers) != downloaded:
                        # 206 fora do offset do parcial (ou sem Content-Range):
                        # anexar misturaria bytes — descarta e recomeça do
                        # zero no retry.
                        downloaded = 0
                        digest = hashlib.sha256()
                        tmp.unlink(missing_ok=True)
                        raise requests.ConnectionError(
                            "offset de resume divergiu do parcial local"
                        )
                    mode = "ab"  # resume: mantém digest e contador
                else:
                    if downloaded > 0:
                        # Servidor ignorou o Range: recomeço limpo.
                        downloaded = 0
                        digest = hashlib.sha256()
                    mode = "wb"
                    if status == 200:
                        validator = _validator_of(resp_headers)
                if max_bytes is not None:
                    announced = resp_headers.get("Content-Length")
                    try:
                        announced_n = int(announced) if announced is not None else None
                    except (TypeError, ValueError):
                        announced_n = None
                    if announced_n is not None and downloaded + announced_n > max_bytes:
                        raise ValueError(
                            f"download abortado: tamanho anunciado ({downloaded + announced_n} bytes) "
                            f"excede o limite de {max_bytes} bytes para {url} "
                            f"(sem dado oficial)"
                        )
                with open(tmp, mode) as f:
                    for chunk in resp.iter_content(chunk_size=CHUNK_SIZE):
                        if not chunk:
                            continue
                        if max_bytes is not None and downloaded + len(chunk) > max_bytes:
                            raise ValueError(
                                f"download abortado: tamanho excede o limite de {max_bytes} bytes "
                                f"para {url} (sem dado oficial)"
                            )
                        f.write(chunk)
                        digest.update(chunk)
                        downloaded += len(chunk)
            sha = digest.hexdigest()
            if expected_sha256 is not None and sha != expected_sha256.lower():
                tmp.unlink(missing_ok=True)
                raise ValueError(f"sha256 mismatch for {url}: got {sha}")
            tmp.replace(dest)
            return sha
        except ValueError:
            tmp.unlink(missing_ok=True)
            raise
        except requests.RequestException as exc:
            last_exc = exc
            if getattr(getattr(exc, "response", None), "status_code", None) == 416:
                # Range além do fim: descarta o parcial e recomeça limpo.
                downloaded = 0
                digest = hashlib.sha256()
                tmp.unlink(missing_ok=True)
            if attempt < retries - 1:
                cap = min(BACKOFF_MAX_S, BACKOFF_BASE_S * (2**attempt))
                time.sleep(random.uniform(0, cap))
            continue
    tmp.unlink(missing_ok=True)
    raise last_exc  # type: ignore[misc]
