"""Fix-round tests para etl/build_marts.py (Task 3).

(a) re-ingestão no mesmo dir não duplica votos;
(b) `web_data_dir=` redireciona os JSONs (build hermético);
(c) arquivo corrompido emite warning com o nome do arquivo e não derruba o build.
"""

import importlib.util
import json
from pathlib import Path

import duckdb
import pytest

from etl.build_marts import build_all

_CSV = (
    "ANO_ELEICAO;DS_CARGO;SG_UF;CD_MUNICIPIO;NM_URNA;QT_VOTOS\n"
    "2022;PRESIDENTE;SP;3550308;X;10\n"
    "2022;PRESIDENTE;RJ;3304557;Y;5\n"
)


def _seed(curated):
    (curated / "raw.csv").write_text(_CSV, encoding="utf-8")


def _total_votos(db_path):
    con = duckdb.connect(str(db_path))
    try:
        return con.execute("SELECT SUM(votos) FROM fato_voto").fetchone()[0]
    finally:
        con.close()


def test_double_build_same_dir_does_not_double_votes(tmp_path):
    curated = tmp_path / "curated"
    curated.mkdir()
    _seed(curated)
    webdata = tmp_path / "webdata"
    db = tmp_path / "t.duckdb"
    manifest = tmp_path / "m.json"
    build_all(curated, db, manifest, web_data_dir=webdata)
    first = _total_votos(db)
    resumo1 = json.loads((webdata / "resumo.json").read_text(encoding="utf-8"))
    build_all(curated, db, manifest, web_data_dir=webdata)
    second = _total_votos(db)
    resumo2 = json.loads((webdata / "resumo.json").read_text(encoding="utf-8"))
    assert first == 15
    assert second == first
    assert resumo2["total_votos"] == resumo1["total_votos"] == 15


def test_web_data_dir_override(tmp_path):
    curated = tmp_path / "curated"
    curated.mkdir()
    _seed(curated)
    webdata = tmp_path / "public"
    build_all(curated, tmp_path / "t.duckdb", tmp_path / "m.json", web_data_dir=webdata)
    for name in ("resumo.json", "por_uf.json", "por_candidato.json"):
        assert (webdata / name).exists()


def test_corrupt_file_warns_with_filename(tmp_path):
    curated = tmp_path / "curated"
    curated.mkdir()
    _seed(curated)
    (curated / "bad.parquet").write_bytes(b"\x00\x01\x02not-a-parquet-file")
    webdata = tmp_path / "webdata"
    with pytest.warns(UserWarning, match="bad.parquet"):
        build_all(curated, tmp_path / "t.duckdb", tmp_path / "m.json", web_data_dir=webdata)
    assert _total_votos(tmp_path / "t.duckdb") == 15


_BAD_VOTOS_CSV = (
    "ANO_ELEICAO;DS_CARGO;SG_UF;CD_MUNICIPIO;NM_URNA;QT_VOTOS\n"
    "2022;PRESIDENTE;SP;3550308;X;abc\n"
    "2022;PRESIDENTE;RJ;3304557;Y;5\n"
)


def test_build_all_raises_when_gates_fail_and_keeps_public_outputs(tmp_path):
    """Votos nulos (QT_VOTOS=abc -> Int64 nulo, Task 2) reprovam os gates.

    build_all levanta RuntimeError ANTES dos JSONs/manifest: saídas
    públicas anteriores seguem intactas (C2-contrato).
    """
    curated = tmp_path / "curated"
    curated.mkdir()
    (curated / "raw.csv").write_text(_BAD_VOTOS_CSV, encoding="utf-8")
    webdata = tmp_path / "webdata"
    webdata.mkdir()
    (webdata / "manifest.json").write_text('{"ingestions": []}', encoding="utf-8")
    (webdata / "resumo.json").write_text('{"total_votos": 0}', encoding="utf-8")
    with pytest.raises(RuntimeError, match="gates reprovados") as excinfo:
        build_all(curated, tmp_path / "t.duckdb", tmp_path / "m.json",
                  web_data_dir=webdata)
    assert "soma" in str(excinfo.value)  # gate de nulos, não manifest/órfãos
    assert json.loads((webdata / "manifest.json").read_text(encoding="utf-8")) == {
        "ingestions": []}
    assert json.loads((webdata / "resumo.json").read_text(encoding="utf-8")) == {
        "total_votos": 0}
    assert not (webdata / "por_uf.json").exists()
    assert not (webdata / "por_candidato.json").exists()


def _load_seed_module():
    repo_root = Path(__file__).resolve().parents[2]
    spec = importlib.util.spec_from_file_location(
        "seed_fixture_data", repo_root / "scripts" / "seed_fixture_data.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_seed_backs_up_manifest_on_failure(tmp_path, monkeypatch):
    """Manifest oficial + build que falha -> .bak criado e original restaurado."""
    mod = _load_seed_module()
    manifest_path = tmp_path / "manifest.json"
    official = {"ingestions": [
        {"source_url": "https://example/tse.zip", "sha256": "abc123"}]}
    manifest_path.write_text(json.dumps(official), encoding="utf-8")
    webdata = tmp_path / "webdata"

    def _boom(*args, **kwargs):
        raise RuntimeError("build explodiu após unlink")

    monkeypatch.setattr("etl.build_marts.build_all", _boom)
    with pytest.raises(RuntimeError, match="build explodiu"):
        mod.seed(manifest_path, webdata, force=True)
    bak = tmp_path / "manifest.json.bak"
    assert json.loads(bak.read_text(encoding="utf-8")) == official
    assert json.loads(manifest_path.read_text(encoding="utf-8")) == official


# --- Task 7 (E6): idempotência ---

def _ingestions(manifest):
    return json.loads(Path(manifest).read_text(encoding="utf-8"))["ingestions"]


def test_rebuild_does_not_duplicate_entries(tmp_path):
    curated = tmp_path / "curated"
    curated.mkdir()
    _seed(curated)
    webdata = tmp_path / "webdata"
    db = tmp_path / "t.duckdb"
    manifest = tmp_path / "m.json"
    build_all(curated, db, manifest, web_data_dir=webdata)
    first_entries = _ingestions(manifest)
    first_votos = _total_votos(db)
    build_all(curated, db, manifest, web_data_dir=webdata)
    second_entries = _ingestions(manifest)
    second_votos = _total_votos(db)
    assert len(second_entries) == len(first_entries) == 1
    assert second_votos == first_votos == 15


_SP_ONLY_CSV = (
    "ANO_ELEICAO;DS_CARGO;SG_UF;CD_MUNICIPIO;NM_URNA;QT_VOTOS\n"
    "2022;PRESIDENTE;SP;3550308;X;10\n"
)


def test_shrunk_source_drops_partitions(tmp_path):
    curated = tmp_path / "curated"
    curated.mkdir()
    _seed(curated)  # SP + RJ
    webdata = tmp_path / "webdata"
    db = tmp_path / "t.duckdb"
    manifest = tmp_path / "m.json"
    build_all(curated, db, manifest, web_data_dir=webdata)
    assert _total_votos(db) == 15
    (curated / "raw.csv").write_text(_SP_ONLY_CSV, encoding="utf-8")
    build_all(curated, db, manifest, web_data_dir=webdata)
    leftovers = [p for p in curated.rglob("*.parquet") if "uf=RJ" in p.parts]
    assert leftovers == []
    assert _total_votos(db) == 10


def test_build_500k_rows_counts(tmp_path):
    import pandas as pd

    from etl.normalize import CANONICAL_COLUMNS

    n = 500_000
    ufs = ["SP", "RJ", "MG"]
    uf_col = [ufs[i % 3] for i in range(n)]
    votos_col = [(i % 100) + 1 for i in range(n)]  # 1..100, sem nulos
    df = pd.DataFrame({
        "ano": pd.Series([2022] * n, dtype="int64"),
        "turno": pd.Series([1] * n, dtype="int64"),
        "cargo": pd.Series(["PRESIDENTE"] * n, dtype="string"),
        "uf": pd.Series(uf_col, dtype="string"),
        "municipio_ibge": pd.Series(
            [f"{3550308 + (i % 1000):07d}" for i in range(n)], dtype="string"),
        "candidato_id": pd.Series([str(10 + (i % 5)) for i in range(n)],
                                  dtype="string"),
        "nome_urna": pd.Series([f"CAND{i % 5}" for i in range(n)],
                               dtype="string"),
        "partido": pd.Series([f"P{i % 5}" for i in range(n)], dtype="string"),
        "votos": pd.Series(votos_col, dtype="int64"),
    })[CANONICAL_COLUMNS]
    expected_total = int(df["votos"].sum())
    expected_by_uf = {
        uf: int(df.loc[df["uf"] == uf, "votos"].sum()) for uf in ufs
    }
    curated = tmp_path / "curated"
    curated.mkdir()
    df.to_parquet(curated / "big.parquet", index=False)
    webdata = tmp_path / "webdata"
    db = tmp_path / "t.duckdb"
    manifest = tmp_path / "m.json"
    build_all(curated, db, manifest, web_data_dir=webdata)
    assert _total_votos(db) == expected_total
    por_uf = json.loads((webdata / "por_uf.json").read_text(encoding="utf-8"))
    got_by_uf = {r["uf"]: r["votos"] for r in por_uf}
    assert got_by_uf == expected_by_uf
    for uf in ufs:
        assert (curated / "ano=2022" / "cargo=PRESIDENTE" / f"uf={uf}"
                / "data.parquet").exists()
