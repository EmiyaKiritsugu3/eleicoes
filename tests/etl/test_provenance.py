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
    # Rebuild idempotente: artifacts reescritos, nunca duplicados. A
    # comparação ignora `data` (ISO yyyy-mm-dd UTC): rebuild atravessando
    # a meia-noite mudaria só a data, nunca sha/tamanho (flake EVOLVE-2
    # Task 2); a data segue validada como ISO <= hoje abaixo.
    def _sem_data(entries):
        return [{k: v for k, v in a.items() if k != "data"} for a in entries]
    build_all(curated, tmp_path / "t.duckdb", manifest,
              web_data_dir=webdata)
    again = json.loads(manifest.read_text(encoding="utf-8"))
    assert _sem_data(again["artifacts"]) == _sem_data(artifacts)
    assert len(again["ingestions"]) == 1
    for entry in again["artifacts"]:
        assert date.fromisoformat(entry["data"]) <= datetime.now(timezone.utc).date()


def test_seed_artifact_entries(tmp_path):
    """seed() registra artifacts do trio + fato_* + Censo, todos fixture:true."""
    import hashlib

    mod = _load_seed_module()
    manifest_path = tmp_path / "manifest.json"
    webdata = tmp_path / "webdata"
    mod.seed(manifest_path, webdata)
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    artifacts = manifest.get("artifacts", [])
    names = sorted(a["arquivo"] for a in artifacts)
    # Seed multi-pleito (2018+2022): arquivos não-fato têm 1 entry por fonte
    # V1 (fan-out documentado em `_artifact_entries_for`); fatos têm 1 por triple.
    assert sorted(set(names)) == ["censo_municipios.json", "fato_2018_1_presidente.json", "fato_2022_1_presidente.json",
                     "por_candidato.json", "por_uf.json", "resumo.json"]
    for entry in artifacts:
        assert entry.get("fixture") is True
        assert entry["sha_origin"] == "artifact"
        raw = (webdata / entry["arquivo"]).read_bytes()
        assert entry["sha256"] == hashlib.sha256(raw).hexdigest()
        assert entry["size_bytes"] == len(raw)


def test_registro_manifest_com_dotdot_levanta(tmp_path):
    """register_served_artifacts com `..` no manifest levanta sem escrever (S8707)."""
    from etl.build_marts import register_served_artifacts

    with pytest.raises(ValueError, match="bloqueado"):
        register_served_artifacts(tmp_path / "a" / ".." / "m.json",
                                  tmp_path / "webdata", [])
    assert not (tmp_path / "m.json").exists()
    assert [p for p in tmp_path.rglob("*.tmp")] == []


def test_artefato_symlink_fora_do_web_dir_levanta(tmp_path):
    """fato_*.json com symlink p/ fora do web_data_dir é bloqueado (S8707)."""
    import hashlib

    from etl.build_marts import _artifact_entries_for
    from etl.sources import V1_DATASETS

    webdata = tmp_path / "webdata"
    webdata.mkdir()
    (webdata / "resumo.json").write_text("{}", encoding="utf-8")
    fora = tmp_path / "fora.json"
    fora.write_text("{}", encoding="utf-8")
    (webdata / "fato_2022_1_presidente.json").symlink_to(fora)
    fonte = [e for e in V1_DATASETS
             if e["ano"] == 2022 and str(e["cargo"]).upper() == "PRESIDENTE"]
    assert fonte
    with pytest.raises(ValueError, match="fora da raiz"):
        _artifact_entries_for(webdata, fonte, "2022-01-01")
    assert hashlib.sha256(fora.read_bytes()) is not None  # alvo externo intacto


def _seed_fato_db(db_path):
    """DuckDB mínimo p/ build_fato standalone (2 munis, Censo com par)."""
    import duckdb

    con = duckdb.connect(str(db_path))
    try:
        con.execute(
            "CREATE TABLE fato_voto (ano BIGINT, turno BIGINT, cargo VARCHAR, "
            "uf VARCHAR, municipio_ibge VARCHAR, candidato_id VARCHAR, "
            "votos BIGINT)"
        )
        con.execute(
            "INSERT INTO fato_voto VALUES "
            "(2022, 1, 'PRESIDENTE', 'SP', '3550308', '13', 10), "
            "(2022, 1, 'PRESIDENTE', 'RJ', '3304557', '22', 5)"
        )
        con.execute(
            "CREATE TABLE dim_candidato (candidato_id VARCHAR, "
            "nome_urna VARCHAR, partido VARCHAR)"
        )
        con.execute(
            "INSERT INTO dim_candidato VALUES "
            "('13', 'CANDIDATA EXEMPLO A', 'PA'), "
            "('22', 'CANDIDATO EXEMPLO B', 'PB')"
        )
        con.execute(
            "CREATE TABLE dim_municipio (ibge7 VARCHAR, esc_sup DOUBLE, "
            "esc_med DOUBLE, esc_fund DOUBLE, renda_media DOUBLE, "
            "pobres_pct DOUBLE, idade_mediana DOUBLE, urbanizacao DOUBLE, "
            "pop BIGINT)"
        )
        con.execute(
            "INSERT INTO dim_municipio VALUES "
            "('3550308', 20, 35, 45, 2500, 15, 33, 90, 10000), "
            "('3304557', 25, 35, 40, 2600, 18, 34, 85, 12000)"
        )
    finally:
        con.close()


def test_standalone_build_fato_atualiza_sha_nos_artifacts(tmp_path):
    """build_fato standalone recalcula artifacts no manifest irmão das saídas.

    `out_dir/manifest.json` carrega 1 entry `artifact` do fato com
    sha256+size dos bytes servidos; rerun com conteúdo novo ATUALIZA o
    sha sem duplicar; o manifest do `<db dir>` segue só-ingestions
    (contrato legado preservado, sem chave `artifacts`).
    """
    import hashlib

    import duckdb

    from etl.build_fato import build_fato
    from etl.manifest import verify_manifest

    fato_name = "fato_2022_1_presidente.json"
    db = tmp_path / "t.duckdb"
    _seed_fato_db(db)
    out_dir = tmp_path / "out"

    build_fato(str(db), str(out_dir), 2022, 1, "PRESIDENTE")
    served_path = out_dir / "manifest.json"
    manifest = json.loads(served_path.read_text(encoding="utf-8"))
    entries = [a for a in manifest.get("artifacts", [])
               if a.get("arquivo") == fato_name]
    assert len(entries) == 1
    raw = (out_dir / fato_name).read_bytes()
    assert entries[0]["sha256"] == hashlib.sha256(raw).hexdigest()
    assert entries[0]["size_bytes"] == len(raw)
    assert verify_manifest(str(served_path)) is True
    # EVOLVE-4 T2 (motivo do freeze): o manifest do `<db dir>` segue
    # SÓ-ingestions por contrato legado — a prova dos bytes do standalone
    # vive no mirror servido (`artifacts`) + no gate bytes-aware
    # (`run_gates(..., fato_paths=...)`); registrar `artifacts: []` aqui
    # quebraria `verify_manifest` (`_artifacts_ok` exige lista não-vazia)
    # e os testes de upsert que pinam `verify_manifest(...) is True`.
    db_manifest = json.loads((tmp_path / "manifest.json").read_text(encoding="utf-8"))
    assert "artifacts" not in db_manifest
    assert len(db_manifest["ingestions"]) == 1

    # Rerun com votos alterados: sha do artifact acompanha os bytes novos.
    con = duckdb.connect(str(db))
    try:
        con.execute("UPDATE fato_voto SET votos = 11 WHERE candidato_id = '13'")
    finally:
        con.close()
    build_fato(str(db), str(out_dir), 2022, 1, "PRESIDENTE")
    raw2 = (out_dir / fato_name).read_bytes()
    assert raw2 != raw
    manifest2 = json.loads(served_path.read_text(encoding="utf-8"))
    entries2 = [a for a in manifest2.get("artifacts", [])
                if a.get("arquivo") == fato_name]
    assert len(entries2) == 1  # atualizado, nunca duplicado
    assert entries2[0]["sha256"] == hashlib.sha256(raw2).hexdigest()
    assert entries2[0]["size_bytes"] == len(raw2)
    assert len(manifest2["ingestions"]) == 1  # upsert idempotente
    assert verify_manifest(str(served_path)) is True


def test_dedupe_key_unificada_sem_fork():
    """EVOLVE-4 T2: `_dedupe_key` única vive em `etl.manifest` (sem fork).

    `build_marts` e `build_fato` importam o MESMO objeto — lógicas de
    idempotência divergentes reprovam aqui. `verificar_fato_manifest`
    também vive no módulo-folha (importável de `etl.build_fato` por
    compatibilidade, sem redefinição).
    """
    from etl import build_fato, build_marts, manifest

    assert build_marts._dedupe_key is manifest._dedupe_key
    assert build_fato._dedupe_key is manifest._dedupe_key
    assert manifest.verificar_fato_manifest is build_fato.verificar_fato_manifest
    # Folha do DAG: manifest.py não importa nada de `etl` (sem ciclo
    # validate→build_fato; ver também a checagem de imports no relatório).
    # AST (não substring): comentários/docstrings citando "from etl" não
    # contam como import (fix P3 — o teste antigo era frágil a isso).
    import ast
    import inspect

    tree = ast.parse(inspect.getsource(manifest))
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            assert not any(
                a.name == "etl" or a.name.startswith("etl.")
                for a in node.names
            ), f"manifest importa {node.names!r}"
        elif isinstance(node, ast.ImportFrom):
            assert (node.module or "").split(".")[0] != "etl", (
                f"manifest importa de {node.module!r}"
            )
    # O superset preserva o fluxo TSE (turno None, dataset 1:1) e
    # distingue triples do fluxo fato (turno/dataset load-bearing).
    tse = {"dataset": "votacao_2022", "ano": 2022, "cargo": "presidente",
           "source_url": "https://cdn.tse.jus.br/x.zip"}
    assert manifest._dedupe_key(tse) == (
        "votacao_2022", 2022, None, "PRESIDENTE",
        "https://cdn.tse.jus.br/x.zip")


def test_rebuild_saudavel_com_fato_publicado_passa(tmp_path):
    """EVOLVE-4 T2 fix P1-A: rebuild saudável com fato publicado passa.

    Sequência build_all → build_fato → build_all → build_all. O 2º
    build_all publica o mirror como cópia do canônico (só-ingestions TSE
    + `artifacts`, sem ingestão do fato); o 3º precisa passar pelos bytes
    atestados em `artifacts` — sem isso, rebuilds saudáveis reprovariam
    ("fato inconsistente" sobre bytes corretos). Adulterar o fato depois
    segue reprovando (crash detection não enfraquecido).
    """
    from pathlib import Path

    import duckdb

    from etl.build_fato import build_fato
    from etl.build_marts import build_all

    curated = tmp_path / "curated"
    _seed(curated)
    db = tmp_path / "t.duckdb"
    manifest = tmp_path / "m.json"
    webdata = tmp_path / "webdata"
    build_all(curated, db, manifest, web_data_dir=webdata)

    con = duckdb.connect(str(db))
    try:
        con.execute(
            "CREATE TABLE dim_municipio (ibge7 VARCHAR, esc_sup DOUBLE, "
            "esc_med DOUBLE, esc_fund DOUBLE, renda_media DOUBLE, "
            "pobres_pct DOUBLE, idade_mediana DOUBLE, urbanizacao DOUBLE, "
            "pop BIGINT)"
        )
        con.execute(
            "INSERT INTO dim_municipio VALUES "
            "('3550308', 20, 35, 45, 2500, 15, 33, 90, 10000), "
            "('3304557', 25, 35, 40, 2600, 18, 34, 85, 12000)"
        )
    finally:
        con.close()

    fato = Path(build_fato(str(db), str(webdata), 2022, 1, "PRESIDENTE"))
    build_all(curated, db, manifest, web_data_dir=webdata)
    build_all(curated, db, manifest, web_data_dir=webdata)  # P1-A: saudável passa
    assert verify_manifest(str(webdata / "manifest.json")) is True

    # Crash detection intacta: fato adulterado após o mirror reprova.
    fato.write_bytes(b'{"candidatos": [], "municipios": [{"x": 1}]}')
    with pytest.raises(RuntimeError, match="gates reprovados") as excinfo:
        build_all(curated, db, manifest, web_data_dir=webdata)
    assert "fato" in str(excinfo.value)


def test_legacy_entry_list_valued_preservada_sem_crash(tmp_path):
    """EVOLVE-4 T2 fix P2: entry legada com campo não-hashable não crasha o dedupe.

    `_validate_entry` só cobre `source_url`/`sha256`: `dataset`/`turno`
    como lista passa na forma mas quebrava `by_key[_dedupe_key(item)]`
    (`TypeError: unhashable`). A entry é preservada sem chave de dedupe
    (sem colapso, sem crash) ao lado da ingestão nova.
    """
    curated = tmp_path / "curated"
    _seed(curated)
    manifest = tmp_path / "m.json"
    manifest.write_text(json.dumps({"ingestions": [{
        "source_url": "https://cdn.tse.jus.br/legado.zip",
        "sha256": "cd" * 32,
        "dataset": ["lista", "nao-hashable"],
        "ano": 2022,
        "turno": ["1"],
        "cargo": "presidente",
        "tipo": "legado",
        "rows": 1,
    }]}), encoding="utf-8")
    build_all(curated, tmp_path / "t.duckdb", manifest,
              web_data_dir=tmp_path / "webdata")
    entries = _manifest_entries(manifest)
    legadas = [e for e in entries if e.get("tipo") == "legado"]
    assert len(legadas) == 1
    assert legadas[0]["dataset"] == ["lista", "nao-hashable"]
    assert len(entries) == 2  # legada preservada + ingestão nova


def test_standalone_poda_fato_sem_proveniencia(tmp_path):
    """Standalone nunca serve fato hashless: stray sem fonte atestada é podado.

    Espelha `_prune_fato_sem_proveniencia` do build_all: fato_*.json cujo
    triple não casa com as fontes atestadas no mirror é removido do
    out_dir; não-fato segue intacto; o fato atual segue com artifact.
    """
    from etl.build_fato import build_fato
    from etl.manifest import verify_manifest

    db = tmp_path / "t.duckdb"
    _seed_fato_db(db)
    out_dir = tmp_path / "out"
    build_fato(str(db), str(out_dir), 2022, 1, "PRESIDENTE")

    stray = out_dir / "fato_2010_2_presidente.json"  # parseável, sem fonte V1
    stray.write_text('{"forjado": true}', encoding="utf-8")
    nota = out_dir / "nota.txt"
    nota.write_text("humano", encoding="utf-8")

    build_fato(str(db), str(out_dir), 2022, 1, "PRESIDENTE")
    assert not stray.exists()  # podado: sem proveniência, nunca servido
    assert nota.read_text(encoding="utf-8") == "humano"  # não-fato intacto
    assert (out_dir / "fato_2022_1_presidente.json").is_file()
    assert verify_manifest(str(out_dir / "manifest.json")) is True


def test_standalone_mirror_traversal_bloqueado(tmp_path):
    """S8707: out_dir com `..` levanta ValueError antes de qualquer mutação."""
    from etl.build_fato import _atualizar_manifest_servido
    from etl.sources import V1_DATASETS

    v1 = next(e for e in V1_DATASETS
              if e["ano"] == 2022 and str(e["cargo"]).upper() == "PRESIDENTE")
    ingestion = {
        "source_url": v1["url"],
        "sha256": "ab" * 32,
        "dataset": "fato_2022_1_presidente",
        "ano": 2022,
        "turno": 1,
        "cargo": "presidente",
    }
    with pytest.raises(ValueError, match=r"\.\."):
        _atualizar_manifest_servido(tmp_path / "a" / ".." / "evil",
                                    ingestion, v1)
    assert not (tmp_path / "evil").exists()
    assert not (tmp_path / "a").exists()
    assert [p for p in tmp_path.rglob("*.tmp")] == []
    assert [p for p in tmp_path.rglob("*.corrupt.*")] == []
