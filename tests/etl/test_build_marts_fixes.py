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
