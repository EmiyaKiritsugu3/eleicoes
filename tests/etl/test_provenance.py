"""Task 4 (E4+E5+M15+M16): per-cargo provenance, source-sha threading, fail-closed empty.

RED-first: estes testes devem FALHAR contra o build_marts pré-Task 4
(fan-out por ano, sem `sha_origin`/`data`, entry falsa no vazio, sem raise).
"""

import json
from datetime import date

import pytest

from etl.build_marts import build_all
from etl.manifest import verify_manifest

_PRES_2022 = (
    "ANO_ELEICAO;DS_CARGO;SG_UF;CD_MUNICIPIO;NM_URNA;QT_VOTOS\n"
    "2022;PRESIDENTE;SP;3550308;X;10\n"
    "2022;PRESIDENTE;RJ;3304557;Y;5\n"
)

_ANO_2010 = (
    "ANO_ELEICAO;DS_CARGO;SG_UF;CD_MUNICIPIO;NM_URNA;QT_VOTOS\n"
    "2010;PRESIDENTE;SP;3550308;X;10\n"
)


def _seed(curated, csv=_PRES_2022, name="raw.csv"):
    curated.mkdir(parents=True, exist_ok=True)
    (curated / name).write_text(csv, encoding="utf-8")


def _manifest_entries(manifest_path):
    return json.loads(manifest_path.read_text(encoding="utf-8"))["ingestions"]


def test_entries_match_ano_and_cargo(tmp_path):
    # df só-presidente 2022 -> exatamente 1 ingestion (presidente), rows == len(df)
    curated = tmp_path / "curated"
    _seed(curated)
    manifest = tmp_path / "m.json"
    build_all(curated, tmp_path / "t.duckdb", manifest,
              web_data_dir=tmp_path / "webdata")
    entries = _manifest_entries(manifest)
    assert len(entries) == 1
    assert entries[0]["ano"] == 2022
    assert entries[0]["cargo"] == "presidente"
    assert entries[0]["rows"] == 2


def test_source_sha_threading(tmp_path):
    # source_shas={(2022, "PRESIDENTE"): "ab"*32} -> sha256 + sha_origin "source"
    # sem source_shas -> sha_origin == "derived"
    sha = "ab" * 32
    curated_a = tmp_path / "a" / "curated"
    _seed(curated_a)
    manifest_a = tmp_path / "a" / "m.json"
    build_all(curated_a, tmp_path / "a" / "t.duckdb", manifest_a,
              web_data_dir=tmp_path / "a" / "webdata",
              source_shas={(2022, "PRESIDENTE"): sha})
    entries_a = _manifest_entries(manifest_a)
    assert len(entries_a) == 1
    assert entries_a[0]["sha256"] == sha
    assert entries_a[0]["sha_origin"] == "source"

    curated_b = tmp_path / "b" / "curated"
    _seed(curated_b)
    manifest_b = tmp_path / "b" / "m.json"
    build_all(curated_b, tmp_path / "b" / "t.duckdb", manifest_b,
              web_data_dir=tmp_path / "b" / "webdata")
    entries_b = _manifest_entries(manifest_b)
    assert len(entries_b) == 1
    assert entries_b[0]["sha_origin"] == "derived"
    assert entries_b[0]["sha256"] and entries_b[0]["sha256"] != sha


def test_empty_build_writes_no_provenance(tmp_path):
    # curated vazio -> manifest {"ingestions": []}, verify_manifest False,
    # JSONs vazios existem (espelho idêntico ao canônico).
    curated = tmp_path / "curated"
    curated.mkdir()
    manifest = tmp_path / "m.json"
    webdata = tmp_path / "webdata"
    build_all(curated, tmp_path / "t.duckdb", manifest, web_data_dir=webdata)
    canonical = json.loads(manifest.read_text(encoding="utf-8"))
    assert canonical == {"ingestions": []}
    mirrored = json.loads((webdata / "manifest.json").read_text(encoding="utf-8"))
    assert mirrored == canonical
    assert verify_manifest(manifest) is False
    for name in ("resumo.json", "por_uf.json", "por_candidato.json"):
        assert (webdata / name).exists()
    resumo = json.loads((webdata / "resumo.json").read_text(encoding="utf-8"))
    assert resumo["total_votos"] == 0
    assert resumo["total_linhas"] == 0


def test_unmatched_ano_cargo_raises_before_writes(tmp_path):
    # df ano 2010 -> ValueError e NENHUM artefato criado (db/jsons/manifest ausentes)
    curated = tmp_path / "curated"
    _seed(curated, csv=_ANO_2010)
    db = tmp_path / "t.duckdb"
    manifest = tmp_path / "m.json"
    webdata = tmp_path / "webdata"
    with pytest.raises(ValueError):
        build_all(curated, db, manifest, web_data_dir=webdata)
    assert not db.exists()
    assert not manifest.exists()
    assert not (webdata / "resumo.json").exists()
    assert not (webdata / "manifest.json").exists()
    assert list(curated.glob("ano=*")) == []


def test_manifest_carries_date_and_version(tmp_path):
    # entry tem data ISO válida e etl_version == "1.1.0"
    curated = tmp_path / "curated"
    _seed(curated)
    manifest = tmp_path / "m.json"
    build_all(curated, tmp_path / "t.duckdb", manifest,
              web_data_dir=tmp_path / "webdata")
    entries = _manifest_entries(manifest)
    assert len(entries) == 1
    assert date.fromisoformat(entries[0]["data"]) <= date.today()
    assert entries[0]["etl_version"] == "1.1.0"
