"""Quality gates + quarentena (Task 4).

RED step (TDD): estes testes importam `etl.validate`, que ainda não existe,
logo devem FALHAR até a implementação.
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


def _make_manifest(path, valid=True):
    import json

    if valid:
        payload = {"ingestions": [{"source_url": "https://cdn.tse.jus.br/x.zip", "sha256": "ab" * 32}]}
    else:
        payload = {"ingestions": [{"source_url": "", "sha256": ""}]}
    path.write_text(json.dumps(payload), encoding="utf-8")
    return path


def test_gate_sum_mismatch(tmp_path):
    from etl.validate import run_gates

    db = tmp_path / "t.duckdb"
    _make_db(db, [_fato_row(uf="SP", votos=100)], [("1", "X", "P")])
    manifest = _make_manifest(tmp_path / "m.json")
    totais = {(2022, "PRESIDENTE", "SP"): 150}
    errors = run_gates(db, manifest_path=manifest, totais_oficiais=totais)
    assert any("soma" in e for e in errors), f"esperava erro de soma, veio: {errors}"


def test_gate_sum_ok_when_totals_match(tmp_path):
    from etl.validate import run_gates

    db = tmp_path / "t.duckdb"
    _make_db(db, [_fato_row(uf="SP", votos=100)], [("1", "X", "P")])
    manifest = _make_manifest(tmp_path / "m.json")
    totais = {(2022, "PRESIDENTE", "SP"): 100}
    assert run_gates(db, manifest_path=manifest, totais_oficiais=totais) == []


def test_gate_orphan_candidates(tmp_path):
    from etl.validate import run_gates

    db = tmp_path / "t.duckdb"
    # 1000 linhas, 2 órfãs (0.2% > 0.1%) -> erro.
    rows = [_fato_row(cid="1", votos=1) for _ in range(998)]
    rows += [_fato_row(cid="fantasma-A", votos=1), _fato_row(cid="fantasma-B", votos=1)]
    _make_db(db, rows, [("1", "X", "P")])
    manifest = _make_manifest(tmp_path / "m.json")
    errors = run_gates(db, manifest_path=manifest)
    assert any("orf" in e for e in errors), f"esperava erro de orfaos, veio: {errors}"


def test_gate_orphan_boundary_exact_01pct_passes(tmp_path):
    from etl.validate import run_gates

    db = tmp_path / "t.duckdb"
    # 1000 linhas, 1 órfã (0.1% exato, spec reprova só "acima de 0,1%") -> ok.
    rows = [_fato_row(cid="1", votos=1) for _ in range(999)]
    rows += [_fato_row(cid="fantasma", votos=1)]
    _make_db(db, rows, [("1", "X", "P")])
    manifest = _make_manifest(tmp_path / "m.json")
    assert run_gates(db, manifest_path=manifest) == []


def test_gate_invalid_manifest_blocks(tmp_path):
    from etl.validate import run_gates

    db = tmp_path / "t.duckdb"
    _make_db(db, [_fato_row()], [("1", "X", "P")])
    manifest = _make_manifest(tmp_path / "m.json", valid=False)
    errors = run_gates(db, manifest_path=manifest)
    assert any("manifest" in e for e in errors), f"esperava erro de manifest, veio: {errors}"


def test_gate_negative_votes_fail_sum(tmp_path):
    from etl.validate import run_gates

    db = tmp_path / "t.duckdb"
    _make_db(db, [_fato_row(votos=-5)], [("1", "X", "P")])
    manifest = _make_manifest(tmp_path / "m.json")
    errors = run_gates(db, manifest_path=manifest)
    assert any("soma" in e for e in errors), f"esperava erro de soma, veio: {errors}"


def test_gate_empty_db_passes(tmp_path):
    from etl.validate import run_gates

    db = tmp_path / "t.duckdb"
    _make_db(db, [], [])
    manifest = _make_manifest(tmp_path / "m.json")
    assert run_gates(db, manifest_path=manifest) == []


def test_quarantine_moves_csv_with_unexpected_columns(tmp_path):
    from etl.validate import quarantine_invalid_csvs

    raw = tmp_path / "raw"
    raw.mkdir()
    (raw / "bom.csv").write_text("ANO_ELEICAO;DS_CARGO;SG_UF;QT_VOTOS\n2022;X;SP;10\n", encoding="utf-8")
    (raw / "estranho.csv").write_text("FOO;BAR;BAZ\n1;2;3\n", encoding="utf-8")
    moved = quarantine_invalid_csvs(raw)
    assert (raw / "quarentena" / "estranho.csv").exists()
    assert (raw / "bom.csv").exists()
    assert len(moved) == 1
