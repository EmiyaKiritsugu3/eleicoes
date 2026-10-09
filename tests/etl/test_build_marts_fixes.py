"""Fix-round tests para etl/build_marts.py (Task 3).

(a) re-ingestão no mesmo dir não duplica votos;
(b) `web_data_dir=` redireciona os JSONs (build hermético);
(c) arquivo corrompido emite warning com o nome do arquivo e não derruba o build.
"""

import json

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
