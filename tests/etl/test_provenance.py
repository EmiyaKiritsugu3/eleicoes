"""Task 4 (E4+E5+M15+M16): per-cargo provenance, source-sha threading, fail-closed empty.

RED-first: estes testes devem FALHAR contra o build_marts pré-Task 4
(fan-out por ano, sem `sha_origin`/`data`, entry falsa no vazio, sem raise).
"""

import json
from datetime import date, datetime, timezone

import pytest

from etl import ETL_VERSION
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
    assert date.fromisoformat(entries[0]["data"]) <= datetime.now(timezone.utc).date()
    assert entries[0]["etl_version"] == "1.1.0"


def _load_seed_module():
    """Carrega scripts/seed_fixture_data.py sem exigir pacote `scripts`."""
    import importlib.util
    from pathlib import Path

    repo_root = Path(__file__).resolve().parents[2]
    spec = importlib.util.spec_from_file_location(
        "seed_fixture_data", repo_root / "scripts" / "seed_fixture_data.py")
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_served_artifacts_have_hash_entries(tmp_path):
    """build_all registra 1 entry `sha_origin: "artifact"` por JSON servido.

    Cada entry carrega o sha256 dos BYTES do arquivo + `size_bytes`, com
    `source_url` da mesma fonte do dataset; o espelho público inclui as
    entries e o rebuild não as duplica.
    """
    import hashlib

    curated = tmp_path / "curated"
    _seed(curated)
    manifest = tmp_path / "m.json"
    webdata = tmp_path / "webdata"
    build_all(curated, tmp_path / "t.duckdb", manifest,
              web_data_dir=webdata)
    canonical = json.loads(manifest.read_text(encoding="utf-8"))
    artifacts = canonical.get("artifacts", [])
    served = ["resumo.json", "por_uf.json", "por_candidato.json"]
    assert len(artifacts) == len(served)
    by_file = {a["arquivo"]: a for a in artifacts}
    assert sorted(by_file) == sorted(served)
    source_url = _manifest_entries(manifest)[0]["source_url"]
    for name in served:
        raw = (webdata / name).read_bytes()
        entry = by_file[name]
        assert entry["sha_origin"] == "artifact"
        assert entry["sha256"] == hashlib.sha256(raw).hexdigest()
        assert entry["size_bytes"] == len(raw)
        assert entry["source_url"] == source_url
        assert date.fromisoformat(entry["data"]) <= datetime.now(timezone.utc).date()
        assert entry["etl_version"] == ETL_VERSION
    # Ingestões de origem intactas (artifact vive em chave própria).
    assert len(canonical["ingestions"]) == 1
    # Espelho público idêntico ao canônico (com artifacts).
    mirrored = json.loads((webdata / "manifest.json").read_text(encoding="utf-8"))
    assert mirrored == canonical
    # Rebuild idempotente: artifacts reescritos, nunca duplicados.
    build_all(curated, tmp_path / "t.duckdb", manifest,
              web_data_dir=webdata)
    again = json.loads(manifest.read_text(encoding="utf-8"))
    assert again["artifacts"] == artifacts
    assert len(again["ingestions"]) == 1


def test_seed_artifact_entries(tmp_path):
    """seed() registra artifacts do trio + fato_*, todos fixture:true."""
    import hashlib

    mod = _load_seed_module()
    manifest_path = tmp_path / "manifest.json"
    webdata = tmp_path / "webdata"
    mod.seed(manifest_path, webdata)
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    artifacts = manifest.get("artifacts", [])
    names = sorted(a["arquivo"] for a in artifacts)
    assert names == ["fato_2022_1_presidente.json", "por_candidato.json",
                     "por_uf.json", "resumo.json"]
    for entry in artifacts:
        assert entry.get("fixture") is True
        assert entry["sha_origin"] == "artifact"
        raw = (webdata / entry["arquivo"]).read_bytes()
        assert entry["sha256"] == hashlib.sha256(raw).hexdigest()
        assert entry["size_bytes"] == len(raw)
