"""Task 7: seed de fixture via build_all real gera JSONs + manifest coerentes.

Cobre o passo de dados do CI pelo caminho real do ETL (sem rede):
curated sintético -> build_all -> agregados + manifest auditável.
"""

import json

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
