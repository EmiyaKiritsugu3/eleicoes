"""Fetches TSE com retry + SHA (RED: etl.fetch ainda não existe)."""

import hashlib
import os
import shutil
import uuid
from pathlib import Path

import pytest


@pytest.fixture
def sandbox_tmp(tmp_path, monkeypatch):
    """Redireciona o sandbox data/raw para tmp_path (isolamento hermético).

    Os testes de retry/SHA abaixo exercitam lógica de rede/hash, não o
    sandbox — o sandbox real é coberto pelos testes M3 no fim do arquivo.
    """
    from etl import fetch

    monkeypatch.setattr(fetch, "RAW_ROOT", tmp_path)
    return tmp_path


class _FakeResponse:
    def __init__(self, payload: bytes):
        self._payload = payload

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()
        return False

    def close(self):
        return None

    def raise_for_status(self):
        return None

    def iter_content(self, chunk_size=1):
        for i in range(0, len(self._payload), chunk_size):
            yield self._payload[i : i + chunk_size]


def test_download_retries_and_sha(sandbox_tmp, monkeypatch):
    import requests

    from etl import fetch

    payload = b"tse-votos-fake-12345"
    expected = hashlib.sha256(payload).hexdigest()
    calls = {"n": 0}

    def fake_get(url, stream=True, timeout=None, **kwargs):
        calls["n"] += 1
        if calls["n"] == 1:
            raise requests.ConnectionError("boom")
        return _FakeResponse(payload)

    monkeypatch.setattr(fetch.requests, "get", fake_get)
    dest = sandbox_tmp / "raw" / "votacao_2022.zip"
    sha = fetch.download_dataset("https://cdn.tse.jus.br/votacao_2022.zip", str(dest))
    assert sha == expected
    assert dest.read_bytes() == payload
    assert calls["n"] == 2


def test_sha_mismatch_raises_and_cleans(sandbox_tmp, monkeypatch):
    from etl import fetch

    payload = b"outro-conteudo"

    def fake_get(url, stream=True, timeout=None, **kwargs):
        return _FakeResponse(payload)

    monkeypatch.setattr(fetch.requests, "get", fake_get)
    dest = sandbox_tmp / "votacao_2022.zip"
    try:
        fetch.download_dataset("https://cdn.tse.jus.br/v.zip", str(dest), expected_sha256="0" * 64)
    except ValueError:
        pass
    else:
        raise AssertionError("expected ValueError on sha mismatch")
    assert not dest.exists()


def test_exhausted_retries_reraise(sandbox_tmp, monkeypatch):
    import requests

    from etl import fetch

    calls = {"n": 0}

    def fake_get(url, stream=True, timeout=None, **kwargs):
        calls["n"] += 1
        raise requests.ConnectionError("sempre falha")

    monkeypatch.setattr(fetch.requests, "get", fake_get)
    try:
        fetch.download_dataset("https://cdn.tse.jus.br/v.zip", str(sandbox_tmp / "v.zip"), retries=3)
    except requests.ConnectionError:
        pass
    else:
        raise AssertionError("expected ConnectionError after retries")
    assert calls["n"] == 3


class _FlakyResponse(_FakeResponse):
    def iter_content(self, chunk_size=1):
        yield self._payload[:4]
        import requests

        raise requests.ConnectionError("caiu no meio")


def test_midstream_failure_leaves_no_partial(sandbox_tmp, monkeypatch):
    import requests

    from etl import fetch

    def fake_get(url, stream=True, timeout=None, **kwargs):
        return _FlakyResponse(b"parcial-xyz")

    monkeypatch.setattr(fetch.requests, "get", fake_get)
    dest = sandbox_tmp / "v.zip"
    try:
        fetch.download_dataset("https://cdn.tse.jus.br/v.zip", str(dest), retries=2)
    except requests.ConnectionError:
        pass
    else:
        raise AssertionError("expected ConnectionError after retries")
    assert not dest.exists()
    assert not dest.with_name(dest.name + ".part").exists()


def test_retries_zero_raises_valueerror(sandbox_tmp, monkeypatch):
    from etl import fetch

    calls = {"n": 0}

    def fake_get(url, stream=True, timeout=None, **kwargs):
        calls["n"] += 1
        raise AssertionError("must not attempt any request")

    monkeypatch.setattr(fetch.requests, "get", fake_get)
    try:
        fetch.download_dataset("https://cdn.tse.jus.br/v.zip", str(sandbox_tmp / "v.zip"), retries=0)
    except ValueError:
        pass
    else:
        raise AssertionError("expected ValueError for retries=0")
    assert calls["n"] == 0


def test_v1_datasets_table_shape():
    from etl.sources import V1_DATASETS

    assert isinstance(V1_DATASETS, list) and V1_DATASETS
    for entry in V1_DATASETS:
        for key in ("url", "ano", "cargo", "tipo"):
            assert entry.get(key), f"missing {key} in {entry}"
    cargos = {(e["cargo"], e["ano"]) for e in V1_DATASETS}
    for ano in (2014, 2018, 2022):
        assert ("presidente", ano) in cargos
        assert ("governador", ano) in cargos
    for ano in (2016, 2020, 2024):
        assert ("prefeito", ano) in cargos


# --- M3: sandbox de dest + allowlist de host (final fix wave) ---

def _no_http(monkeypatch, calls):
    from etl import fetch

    def fake_get(url, stream=True, timeout=None, **kwargs):
        calls["n"] += 1
        raise AssertionError("must not attempt any request")

    monkeypatch.setattr(fetch.requests, "get", fake_get)


def test_dest_outside_sandbox_rejected_without_io(tmp_path, monkeypatch):
    from etl import fetch

    calls = {"n": 0}
    _no_http(monkeypatch, calls)
    outside = tmp_path / "evil.zip"  # /tmp/... — fora de data/raw do repo
    with pytest.raises(ValueError, match="sandbox"):
        fetch.download_dataset("https://cdn.tse.jus.br/v.zip", str(outside))
    assert calls["n"] == 0
    assert not outside.exists()


def test_dest_traversal_rejected_without_io(tmp_path, monkeypatch):
    from etl import fetch

    calls = {"n": 0}
    _no_http(monkeypatch, calls)
    traversal = fetch.RAW_ROOT / ".." / "evil.zip"  # resolve -> data/evil.zip
    with pytest.raises(ValueError, match="sandbox"):
        fetch.download_dataset("https://cdn.tse.jus.br/v.zip", str(traversal))
    assert calls["n"] == 0
    assert not (fetch.RAW_ROOT.parent / "evil.zip").exists()


def test_non_tse_url_rejected_without_http(monkeypatch):
    from etl import fetch

    calls = {"n": 0}
    _no_http(monkeypatch, calls)
    in_root = fetch.RAW_ROOT / "v.zip"  # dest válido: isola o teste no host
    for url in (
        "https://evil.example.com/v.zip",
        "http://cdn.tse.jus.br.evil.com/v.zip",
        "https://x/v.zip",
    ):
        with pytest.raises(ValueError, match="allowlist"):
            fetch.download_dataset(url, str(in_root))
    assert calls["n"] == 0
    assert not in_root.exists()


def test_in_root_download_works(monkeypatch):
    from etl import fetch

    payload = b"tse-real-root-ok"
    expected = hashlib.sha256(payload).hexdigest()

    def fake_get(url, stream=True, timeout=None, **kwargs):
        return _FakeResponse(payload)

    monkeypatch.setattr(fetch.requests, "get", fake_get)
    workdir = fetch.RAW_ROOT / f".pytest-{os.getpid()}-{uuid.uuid4().hex[:8]}"
    workdir.mkdir(parents=True, exist_ok=True)
    try:
        dest = workdir / "v.zip"
        sha = fetch.download_dataset("https://cdn.tse.jus.br/v.zip", str(dest))
        assert sha == expected
        assert dest.read_bytes() == payload
    finally:
        shutil.rmtree(workdir, ignore_errors=True)
    assert not workdir.exists()


def test_v1_datasets_urls_allowlisted():
    from urllib.parse import urlparse

    from etl.fetch import ALLOWED_HOSTS
    from etl.sources import V1_DATASETS

    for entry in V1_DATASETS:
        host = (urlparse(entry["url"]).hostname or "").lower()
        assert host in ALLOWED_HOSTS, f"V1 url fora da allowlist: {entry['url']}"


# --- EVOLVE-2 Task 3: backoff com jitter + UA + resume + teto de tamanho ---

class _RangedResponse(_FakeResponse):
    def __init__(self, payload: bytes, status_code: int = 200, headers=None):
        super().__init__(payload)
        self.status_code = status_code
        self.headers = dict(headers or {})


def test_transient_recovers_with_jittered_backoff_and_ua(sandbox_tmp, monkeypatch):
    import requests

    from etl import fetch

    payload = b"tse-backoff-ok-12345"
    expected = hashlib.sha256(payload).hexdigest()
    seen_headers = []
    sleeps = []
    uniform_calls = []
    real_uniform = fetch.random.uniform

    def spy_uniform(a, b):
        uniform_calls.append((a, b))
        return real_uniform(a, b)

    calls = {"n": 0}

    def fake_get(url, stream=True, timeout=None, **kwargs):
        calls["n"] += 1
        seen_headers.append(dict(kwargs.get("headers") or {}))
        if calls["n"] <= 2:
            raise requests.ConnectionError("falha transitória")
        return _FakeResponse(payload)

    monkeypatch.setattr(fetch.requests, "get", fake_get)
    monkeypatch.setattr(fetch.time, "sleep", lambda s: sleeps.append(s))
    monkeypatch.setattr(fetch.random, "uniform", spy_uniform)
    dest = sandbox_tmp / "backoff.zip"
    sha = fetch.download_dataset("https://cdn.tse.jus.br/backoff.zip", str(dest))
    assert sha == expected
    assert dest.read_bytes() == payload
    assert calls["n"] == 3
    # User-Agent identificando o projeto em TODAS as tentativas.
    assert seen_headers and all(
        "analise-eleicoes" in (h.get("User-Agent") or "").lower() for h in seen_headers
    )
    # Backoff exponencial com jitter: bandas dobram, sorteio via uniform —
    # nunca um sleep fixo.
    assert uniform_calls == [(0, fetch.BACKOFF_BASE_S), (0, 2 * fetch.BACKOFF_BASE_S)]
    assert len(sleeps) == 2
    assert 0 <= sleeps[0] <= fetch.BACKOFF_BASE_S
    assert 0 <= sleeps[1] <= 2 * fetch.BACKOFF_BASE_S


def test_size_cap_aborts_stream_and_deletes_partial(sandbox_tmp, monkeypatch):
    from etl import fetch

    payload = b"x" * 4096

    def fake_get(url, stream=True, timeout=None, **kwargs):
        return _FakeResponse(payload)

    monkeypatch.setattr(fetch.requests, "get", fake_get)
    dest = sandbox_tmp / "grande.zip"
    with pytest.raises(ValueError, match="limite|tamanho"):
        fetch.download_dataset(
            "https://cdn.tse.jus.br/grande.zip", str(dest), max_bytes=100
        )
    assert not dest.exists()
    assert list(sandbox_tmp.glob("grande.zip.part*")) == []


def test_size_cap_failfast_on_content_length(sandbox_tmp, monkeypatch):
    from etl import fetch

    streamed = {"n": 0}

    class _Big(_FakeResponse):
        def __init__(self):
            super().__init__(b"y" * 10)
            self.status_code = 200
            self.headers = {"Content-Length": str(1024**3)}

        def iter_content(self, chunk_size=1):
            streamed["n"] += 1
            yield from super().iter_content(chunk_size)

    def fake_get(url, stream=True, timeout=None, **kwargs):
        return _Big()

    monkeypatch.setattr(fetch.requests, "get", fake_get)
    dest = sandbox_tmp / "anunciado.zip"
    with pytest.raises(ValueError, match="limite|tamanho"):
        fetch.download_dataset(
            "https://cdn.tse.jus.br/anunciado.zip", str(dest), max_bytes=100
        )
    assert streamed["n"] == 0, "corpo não deveria ser lido após fail-fast"
    assert not dest.exists()
    assert list(sandbox_tmp.glob("anunciado.zip.part*")) == []


def test_resume_with_range_when_server_supports(sandbox_tmp, monkeypatch):
    import requests

    from etl import fetch

    full = b"0123456789abcdef" * 4  # 64 bytes
    expected = hashlib.sha256(full).hexdigest()
    seen = []
    calls = {"n": 0}

    class _Flaky(_FakeResponse):
        def iter_content(self, chunk_size=1):
            yield full[:10]
            raise requests.ConnectionError("caiu no meio")

    def fake_get(url, stream=True, timeout=None, **kwargs):
        calls["n"] += 1
        headers = dict(kwargs.get("headers") or {})
        seen.append(headers)
        if calls["n"] == 1:
            return _Flaky(full)
        assert headers.get("Range") == "bytes=10-", f"sem Range no retry: {headers}"
        rest = full[10:]
        return _RangedResponse(rest, status_code=206, headers={"Content-Length": str(len(rest))})

    monkeypatch.setattr(fetch.requests, "get", fake_get)
    monkeypatch.setattr(fetch.time, "sleep", lambda s: None)
    dest = sandbox_tmp / "resume.zip"
    sha = fetch.download_dataset("https://cdn.tse.jus.br/resume.zip", str(dest))
    assert sha == expected
    assert dest.read_bytes() == full


def test_restart_clean_when_server_ignores_range(sandbox_tmp, monkeypatch):
    import requests

    from etl import fetch

    full = b"fedcba9876543210" * 4  # 64 bytes
    expected = hashlib.sha256(full).hexdigest()
    calls = {"n": 0}

    class _Flaky(_FakeResponse):
        def iter_content(self, chunk_size=1):
            yield full[:10]
            raise requests.ConnectionError("caiu no meio")

    def fake_get(url, stream=True, timeout=None, **kwargs):
        calls["n"] += 1
        if calls["n"] == 1:
            return _Flaky(full)
        # Servidor sem suporte a Range: responde 200 com o conteúdo completo.
        return _RangedResponse(full, status_code=200)

    monkeypatch.setattr(fetch.requests, "get", fake_get)
    monkeypatch.setattr(fetch.time, "sleep", lambda s: None)
    dest = sandbox_tmp / "restart.zip"
    sha = fetch.download_dataset("https://cdn.tse.jus.br/restart.zip", str(dest))
    assert sha == expected
    assert dest.read_bytes() == full
