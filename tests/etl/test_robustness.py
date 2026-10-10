"""ETL robustness bundle (Task 8: M1+M2+M4+M5+M6+M8+M10+M11).

RED step (TDD): cada teste falha antes do fix do seu item.
M6 (remoção de código morto) não tem teste; M10 (BOM) é coberto via
ingestão do arquivo válido com BOM dentro do teste M5.
"""

import duckdb

from etl.normalize import CANONICAL_COLUMNS

COLS = CANONICAL_COLUMNS


def _fato_row(ano=2022, turno=1, cargo="PRESIDENTE", uf="SP", ibge="3550308",
              cid="1", nome="X", partido="P", votos=10):
    return (ano, turno, cargo, uf, ibge, cid, nome, partido, votos)


def _make_db(path, fato_rows, dim_rows):
    con = duckdb.connect(str(path))
    try:
        placeholders = ",".join(["?"] * len(COLS))
        con.execute(f"CREATE TABLE fato_voto ({', '.join(c + ' VARCHAR' for c in COLS)})")
        con.execute("CREATE TABLE dim_candidato (candidato_id VARCHAR, nome_urna VARCHAR, partido VARCHAR)")
        if fato_rows:
            con.executemany(f"INSERT INTO fato_voto VALUES ({placeholders})", fato_rows)
        if dim_rows:
            con.executemany("INSERT INTO dim_candidato VALUES (?,?,?)", dim_rows)
    finally:
        con.close()


def _make_manifest(path):
    import json

    payload = {"ingestions": [{"source_url": "https://cdn.tse.jus.br/x.zip", "sha256": "ab" * 32}]}
    path.write_text(json.dumps(payload), encoding="utf-8")
    return path


def test_ibge_not_seven_digits_becomes_empty():  # "123" e "12345678" -> "" (M1)
    import pandas as pd
    import pytest

    from etl.normalize import normalize_resultados

    df = pd.DataFrame([
        {"ANO_ELEICAO": 2022, "QT_VOTOS": 10, "CD_MUNICIPIO": "123"},
        {"ANO_ELEICAO": 2022, "QT_VOTOS": 5, "CD_MUNICIPIO": "12345678"},
    ])
    with pytest.warns(UserWarning, match="IBGE"):
        out = normalize_resultados(df)
    assert out["municipio_ibge"].tolist() == ["", ""]


def test_invalid_totais_return_error_not_raise():  # {"SP": "abc"} -> item "soma:" (M2)
    import tempfile
    from pathlib import Path

    from etl.validate import run_gates

    tmp = Path(tempfile.mkdtemp())
    db = tmp / "t.duckdb"
    _make_db(db, [_fato_row(uf="SP", votos=100)], [("1", "X", "P")])
    manifest = _make_manifest(tmp / "m.json")
    errors = run_gates(db, manifest_path=manifest, totais_oficiais={"SP": "abc"})
    assert any("soma:" in e for e in errors), f"esperava item 'soma:', veio: {errors}"


def test_concurrent_same_dest_downloads(tmp_path, monkeypatch):  # 2 threads, mesmo dest (M4)
    import hashlib
    import threading

    from etl import fetch

    payload = b"payload-concorrente-" * 50  # < CHUNK_SIZE: escrita em 1 chunk
    expected = hashlib.sha256(payload).hexdigest()
    closes = {"n": 0}
    lock = threading.Lock()

    class _Resp:
        def __enter__(self):
            return self

        def __exit__(self, *exc):
            self.close()
            return False

        def close(self):
            with lock:
                closes["n"] += 1

        def raise_for_status(self):
            return None

        def iter_content(self, chunk_size=1):
            for i in range(0, len(payload), chunk_size):
                yield payload[i:i + chunk_size]

    def fake_get(url, stream=True, timeout=None, **kwargs):
        return _Resp()

    monkeypatch.setattr(fetch.requests, "get", fake_get)
    monkeypatch.setattr(fetch, "RAW_ROOT", tmp_path)  # sandbox hermético p/ o teste
    dest = tmp_path / "ds.zip"
    results, errors = {}, []

    def worker(i):
        try:
            results[i] = fetch.download_dataset(
                "https://cdn.tse.jus.br/ds.zip", str(dest), expected_sha256=expected)
        except Exception as exc:  # noqa: BLE001
            errors.append(exc)

    threads = [threading.Thread(target=worker, args=(i,)) for i in range(2)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert not errors, f"threads falharam: {errors}"
    assert set(results.values()) == {expected}
    assert dest.read_bytes() == payload
    assert list(tmp_path.glob("ds.zip.part*")) == []
    assert closes["n"] >= 2, f"responses nao fechados (close={closes['n']})"


def test_drifted_header_warns_or_normalizes(tmp_path):  # header desvia -> build não crasha (M5+M10)
    import warnings

    import duckdb

    from etl.build_marts import build_all

    curated = tmp_path / "curated"
    curated.mkdir()
    # Válido com BOM (M10): utf-8-sig deve ser ingerido, não quarentenado/ignorado.
    (curated / "ok.csv").write_text(
        "ano;turno;cargo;uf;municipio_ibge;candidato_id;nome_urna;partido;votos\n"
        "2022;1;PRESIDENTE;SP;3550308;1;X;P;10\n",
        encoding="utf-8-sig",
    )
    (curated / "drift.csv").write_text("FOO;BAR;BAZ\n1;2;3\n", encoding="utf-8")
    db = tmp_path / "t.duckdb"
    manifest = tmp_path / "m.json"
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        build_all(str(curated), str(db), str(manifest), web_data_dir=str(tmp_path / "webdata"))
    assert any("drift" in str(w.message) for w in caught), \
        f"esperava warn de drift, veio: {[str(w.message) for w in caught]}"
    con = duckdb.connect(str(db), read_only=True)
    try:
        total = con.execute("SELECT SUM(TRY_CAST(votos AS BIGINT)) FROM fato_voto").fetchone()[0]
    finally:
        con.close()
    assert total == 10, f"arquivo BOM deveria somar 10, veio: {total}"


def test_quarantine_case_insensitive_and_unique_names(tmp_path):  # .CSV move; colisão única (M11)
    import pytest

    from etl.validate import quarantine_invalid_csvs

    raw = tmp_path / "raw"
    raw.mkdir()
    q = raw / "quarentena"
    q.mkdir()
    (q / "x.csv").write_text("seed", encoding="utf-8")  # colisão pré-existente
    (raw / "x.csv").write_text("FOO\n1\n", encoding="utf-8")
    (raw / "Y.CSV").write_text("BAR\n2\n", encoding="utf-8")
    moved = quarantine_invalid_csvs(raw)
    assert len(moved) == 2, f"esperava 2 movidos (.csv + .CSV), veio: {moved}"
    assert (q / "x.csv").read_text(encoding="utf-8") == "seed", "colisao sobrescreveu o existente"
    names = sorted(p.name for p in q.iterdir())
    assert len(names) == 3 and len(set(names)) == 3, f"nomes nao unicos: {names}"
    assert not (raw / "x.csv").exists() and not (raw / "Y.CSV").exists()
    with pytest.raises(ValueError, match="uarentena|quarantine|raw"):
        quarantine_invalid_csvs(raw, quarantine_dir=raw)


def test_dv_rejects_short_and_padded():  # DV mod-10 do 7º dígito (EVOLVE-1 T3)
    import warnings

    import pandas as pd
    import pytest

    from etl.censo import normalize_censo
    from etl.normalize import normalize_resultados

    # "3550308" (São Paulo, DV válido) com os 2 primeiros dígitos
    # transpostos -> "5350308": DV da base "535030" é 1, não 8 -> inválido.
    # ("0123456": DV da base "012345" é 5, não 6 -> inválido; "123" cai no
    # shape check anterior ao DV.)
    bad_codes = ["123", "0123456", "5350308"]
    tse_df = pd.DataFrame([
        {"ANO_ELEICAO": 2022, "QT_VOTOS": 10, "CD_MUNICIPIO": c}
        for c in bad_codes
    ])
    with pytest.warns(UserWarning, match="IBGE"):
        tse_out = normalize_resultados(tse_df)
    assert tse_out["municipio_ibge"].tolist() == ["", "", ""]
    with pytest.warns(UserWarning, match="IBGE"):
        censo_out = normalize_censo(pd.DataFrame({"CD_MUN": bad_codes}))
    assert censo_out["ibge7"].tolist() == ["", "", ""]

    # Válidos passam sem warn (São Paulo + Rio de Janeiro, DVs reais).
    good_df = pd.DataFrame([
        {"ANO_ELEICAO": 2022, "QT_VOTOS": 10, "CD_MUNICIPIO": "3550308"},
        {"ANO_ELEICAO": 2022, "QT_VOTOS": 5, "CD_MUNICIPIO": "3304557"},
    ])
    with warnings.catch_warnings():
        warnings.simplefilter("error", UserWarning)
        good_out = normalize_resultados(good_df)
        good_censo = normalize_censo(
            pd.DataFrame({"CD_MUN": ["3550308", "3304557"]}))
    assert good_out["municipio_ibge"].tolist() == ["3550308", "3304557"]
    assert good_censo["ibge7"].tolist() == ["3550308", "3304557"]


def test_orphan_boundary_integer_math():  # exatos 0,1% passa sem float (M8, via DB construído)
    import inspect
    import tempfile
    from pathlib import Path

    from etl import validate
    from etl.validate import run_gates

    tmp = Path(tempfile.mkdtemp())
    db = tmp / "t.duckdb"
    rows = [_fato_row(cid="1", votos=1) for _ in range(999)]
    rows += [_fato_row(cid="fantasma", votos=1)]
    _make_db(db, rows, [("1", "X", "P")])
    manifest = _make_manifest(tmp / "m.json")
    assert run_gates(db, manifest_path=manifest) == []
    src = inspect.getsource(validate._gate_orphans)
    assert "* 1000" in src, "gate de orfaos deve usar matematica inteira (orphans * 1000)"
