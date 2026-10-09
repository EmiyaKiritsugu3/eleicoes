"""Fetches TSE com retry + SHA (RED: etl.fetch ainda não existe)."""

import hashlib


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


def test_download_retries_and_sha(tmp_path, monkeypatch):
    import requests

    from etl import fetch

    payload = b"tse-votos-fake-12345"
    expected = hashlib.sha256(payload).hexdigest()
    calls = {"n": 0}

    def fake_get(url, stream=True, timeout=None):
        calls["n"] += 1
        if calls["n"] == 1:
            raise requests.ConnectionError("boom")
        return _FakeResponse(payload)

    monkeypatch.setattr(fetch.requests, "get", fake_get)
    dest = tmp_path / "raw" / "votacao_2022.zip"
    sha = fetch.download_dataset("https://x/votacao_2022.zip", str(dest))
    assert sha == expected
    assert dest.read_bytes() == payload
    assert calls["n"] == 2


def test_sha_mismatch_raises_and_cleans(tmp_path, monkeypatch):
    from etl import fetch

    payload = b"outro-conteudo"

    def fake_get(url, stream=True, timeout=None):
        return _FakeResponse(payload)

    monkeypatch.setattr(fetch.requests, "get", fake_get)
    dest = tmp_path / "votacao_2022.zip"
    try:
        fetch.download_dataset("https://x/v.zip", str(dest), expected_sha256="0" * 64)
    except ValueError:
        pass
    else:
        raise AssertionError("expected ValueError on sha mismatch")
    assert not dest.exists()


def test_exhausted_retries_reraise(tmp_path, monkeypatch):
    import requests

    from etl import fetch

    calls = {"n": 0}

    def fake_get(url, stream=True, timeout=None):
        calls["n"] += 1
        raise requests.ConnectionError("sempre falha")

    monkeypatch.setattr(fetch.requests, "get", fake_get)
    try:
        fetch.download_dataset("https://x/v.zip", str(tmp_path / "v.zip"), retries=3)
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


def test_midstream_failure_leaves_no_partial(tmp_path, monkeypatch):
    import requests

    from etl import fetch

    def fake_get(url, stream=True, timeout=None):
        return _FlakyResponse(b"parcial-xyz")

    monkeypatch.setattr(fetch.requests, "get", fake_get)
    dest = tmp_path / "v.zip"
    try:
        fetch.download_dataset("https://x/v.zip", str(dest), retries=2)
    except requests.ConnectionError:
        pass
    else:
        raise AssertionError("expected ConnectionError after retries")
    assert not dest.exists()
    assert not dest.with_name(dest.name + ".part").exists()


def test_retries_zero_raises_valueerror(tmp_path, monkeypatch):
    from etl import fetch

    calls = {"n": 0}

    def fake_get(url, stream=True, timeout=None):
        calls["n"] += 1
        raise AssertionError("must not attempt any request")

    monkeypatch.setattr(fetch.requests, "get", fake_get)
    try:
        fetch.download_dataset("https://x/v.zip", str(tmp_path / "v.zip"), retries=0)
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
