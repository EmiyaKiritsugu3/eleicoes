"""Task 7: seed de fixture via build_all real gera JSONs + manifest coerentes.

Cobre o passo de dados do CI pelo caminho real do ETL (sem rede):
curated sintético -> build_all -> agregados + manifest auditável.
"""

import json
from pathlib import Path

from etl.build_marts import build_all

_CSV = (
    "ANO_ELEICAO;DS_CARGO;SG_UF;CD_MUNICIPIO;NM_URNA;QT_VOTOS\n"
    "2022;PRESIDENTE;SP;3550308;CANDIDATO EXEMPLO A;10\n"
    "2022;PRESIDENTE;RJ;3304557;CANDIDATO EXEMPLO B;5\n"
)


def test_seed_fixture_builds_coherent_data_path(tmp_path):
    curated = tmp_path / "curated"
    curated.mkdir()
    (curated / "fixture.csv").write_text(_CSV, encoding="utf-8")
    webdata = tmp_path / "webdata"
    manifest_path = tmp_path / "manifest.json"
    build_all(curated, tmp_path / "seed.duckdb", manifest_path,
              web_data_dir=webdata)

    resumo = json.loads((webdata / "resumo.json").read_text(encoding="utf-8"))
    assert resumo["total_votos"] == 15
    assert resumo["total_linhas"] == 2
    assert resumo["anos"] == [2022]

    por_uf = json.loads((webdata / "por_uf.json").read_text(encoding="utf-8"))
    assert len(por_uf) == 2
    assert sum(r["votos"] for r in por_uf) == 15

    canonical = json.loads(manifest_path.read_text(encoding="utf-8"))
    mirrored = json.loads((webdata / "manifest.json").read_text(encoding="utf-8"))
    assert mirrored == canonical
    assert len(canonical["ingestions"]) > 0
    for entry in canonical["ingestions"]:
        assert entry["source_url"] and entry["sha256"]


def _load_seed():
    """Carrega scripts/seed_fixture_data.py sem exigir pacote `scripts`."""
    import importlib.util

    repo_root = Path(__file__).resolve().parents[2]
    spec = importlib.util.spec_from_file_location(
        "seed_fixture_data", repo_root / "scripts" / "seed_fixture_data.py")
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_seed_com_falha_restaura_jsons_publicos(tmp_path, monkeypatch):
    """Falha após o build_all não deixa saídas misturadas no web_data_dir."""
    import etl.build_fato

    module = _load_seed()

    manifest_path = tmp_path / "manifest.json"
    webdata = tmp_path / "webdata"
    webdata.mkdir()
    sentinelas = {
        "resumo.json": '{"sentinela": true}',
        "por_uf.json": "[]",
        "manifest.json": '{"ingestions": []}',
    }
    for nome, conteudo in sentinelas.items():
        (webdata / nome).write_text(conteudo, encoding="utf-8")

    def _falhar(*args, **kwargs):
        raise RuntimeError("falha sintética após build_all")

    monkeypatch.setattr(etl.build_fato, "build_fato", _falhar)

    try:
        module.seed(manifest_path, webdata, force=True)
    except RuntimeError:
        pass
    else:
        raise AssertionError("seed deveria propagar a falha do build_fato")

    assert {p.name for p in webdata.iterdir()} == set(sentinelas)
    for nome, conteudo in sentinelas.items():
        assert (webdata / nome).read_text(encoding="utf-8") == conteudo
    assert not manifest_path.exists()
    assert not (tmp_path / "webdata.bak").exists()


def test_seed_remove_fato_obsoleto_antes_do_register(tmp_path):
    """#22: fato_*.json não-fixture pré-existente não é registrado nem
    marcado fixture:true — só artefatos gerados pelo seed levam a flag."""
    module = _load_seed()

    manifest_path = tmp_path / "manifest.json"
    webdata = tmp_path / "webdata"
    webdata.mkdir()
    (webdata / "fato_2018_2_governador.json").write_text(
        '{"obsoleto": true}', encoding="utf-8")
    module.seed(manifest_path, webdata)

    assert not (webdata / "fato_2018_2_governador.json").exists()
    assert (webdata / "fato_2022_1_presidente.json").exists()
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    arquivos = {a.get("arquivo") for a in manifest.get("artifacts", [])}
    assert "fato_2018_2_governador.json" not in arquivos
    assert "fato_2022_1_presidente.json" in arquivos


def test_remover_fatos_nao_fixture_unidade(tmp_path):
    """Filtro do seed em isolamento: mantém só o fato do triple fixture."""
    module = _load_seed()

    webdata = tmp_path / "webdata"
    webdata.mkdir()
    (webdata / "fato_2018_2_governador.json").write_text("{}", encoding="utf-8")
    (webdata / "fato_2022_1_presidente.json").write_text("{}", encoding="utf-8")
    module._remover_fatos_nao_fixture(webdata, "fato_2022_1_presidente.json")
    assert not (webdata / "fato_2018_2_governador.json").exists()
    assert (webdata / "fato_2022_1_presidente.json").exists()


def test_seed_emite_censo_servido_atestado(tmp_path):
    """EVOLVE-7 T1 fix (seam seed/fresh-deploy): o seed emite o artefato
    fixture `{ibge7: pop}` direto no web_data_dir antes do recalc — sem
    passo manual, o deploy fresco serve pop (não SEM_DADO)."""
    import hashlib

    module = _load_seed()

    manifest_path = tmp_path / "manifest.json"
    webdata = tmp_path / "webdata"
    module.seed(manifest_path, webdata)
    raw = (webdata / "censo_municipios.json").read_bytes()
    assert json.loads(raw.decode("utf-8")) == {
        "3550308": 10000, "3304557": 12000}
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    entries = [a for a in manifest.get("artifacts", [])
               if a.get("arquivo") == "censo_municipios.json"]
    assert len(entries) == 1
    assert entries[0]["sha256"] == hashlib.sha256(raw).hexdigest()
    assert entries[0]["size_bytes"] == len(raw)
    assert entries[0].get("fixture") is True
    mirrored = json.loads((webdata / "manifest.json").read_text(encoding="utf-8"))
    assert mirrored == manifest
