"""EVOLVE-3 Task 2 (RED-first): manifest do <db dir> com upsert + crash-entre-passos.

Contrato sob teste:
- `build_fato` 2x (mesmo triple) -> manifest do <db dir> com 1 ingestion
  (upsert pelo predicado do mirror `_ingestion_dedupe_key`, sem fork) e
  `sha256` igual ao dos bytes do fato; rerun com dado novo ATUALIZA o
  sha sem duplicar; triples distintos preservam o histórico.
- Crash entre passos (fato reescrito, manifest ainda velho) -> o
  predicado `verificar_fato_manifest` retorna False (fail-closed, nunca
  verde falso — `verify_manifest` sozinho continua True, só vê forma);
  o rerun seguinte repara (reescreve fato + upsert) e o predicado
  volta a True.
"""

import hashlib
import json

import duckdb
import pytest

from etl.build_fato import build_fato, verificar_fato_manifest
from etl.manifest import verify_manifest


def _seed_db(db_path):
    """DuckDB mínimo: 2 munis x 2 anos (2022/2018), Censo com par."""
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
            "(2022, 1, 'PRESIDENTE', 'RJ', '3304557', '22', 5), "
            "(2018, 1, 'PRESIDENTE', 'SP', '3550308', '13', 7), "
            "(2018, 1, 'PRESIDENTE', 'RJ', '3304557', '22', 3)"
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


def _db_ingestions(tmp_path):
    return json.loads((tmp_path / "manifest.json").read_text(encoding="utf-8"))[
        "ingestions"
    ]


def _sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def test_db_manifest_upsert_idempotente(tmp_path):
    """build_fato 2x no mesmo triple -> 1 ingestion, sha dos bytes atuais."""
    db = tmp_path / "t.duckdb"
    _seed_db(db)
    out_dir = tmp_path / "out"

    out1 = build_fato(str(db), str(out_dir), 2022, 1, "PRESIDENTE")
    build_fato(str(db), str(out_dir), 2022, 1, "PRESIDENTE")

    ings = _db_ingestions(tmp_path)
    assert len(ings) == 1
    assert ings[0]["sha256"] == _sha(out_dir / "fato_2022_1_presidente.json")
    assert out1 == str(out_dir / "fato_2022_1_presidente.json")


def test_db_manifest_upsert_atualiza_sha(tmp_path):
    """Rerun com votos novos -> ainda 1 ingestion, sha acompanha os bytes."""
    db = tmp_path / "t.duckdb"
    _seed_db(db)
    out_dir = tmp_path / "out"
    fato = out_dir / "fato_2022_1_presidente.json"

    build_fato(str(db), str(out_dir), 2022, 1, "PRESIDENTE")
    sha_antes = _sha(fato)

    con = duckdb.connect(str(db))
    try:
        con.execute("UPDATE fato_voto SET votos = 11 WHERE candidato_id = '13'")
    finally:
        con.close()
    build_fato(str(db), str(out_dir), 2022, 1, "PRESIDENTE")

    assert _sha(fato) != sha_antes
    ings = _db_ingestions(tmp_path)
    assert len(ings) == 1  # atualizado, nunca duplicado
    assert ings[0]["sha256"] == _sha(fato)
    assert verify_manifest(str(tmp_path / "manifest.json")) is True


def test_db_upsert_preserva_triples_distintos(tmp_path):
    """Upsert só colapsa a mesma chave: outro ano segue no histórico."""
    db = tmp_path / "t.duckdb"
    _seed_db(db)
    out_dir = tmp_path / "out"

    build_fato(str(db), str(out_dir), 2022, 1, "PRESIDENTE")
    build_fato(str(db), str(out_dir), 2018, 1, "PRESIDENTE")
    antes_2018 = [
        e for e in _db_ingestions(tmp_path) if e["ano"] == 2018
    ][0]
    build_fato(str(db), str(out_dir), 2022, 1, "PRESIDENTE")  # rerun 2022

    ings = _db_ingestions(tmp_path)
    assert len(ings) == 2
    depois_2018 = [e for e in ings if e["ano"] == 2018][0]
    assert depois_2018 == antes_2018  # triple alheio intacto
    atual_2022 = [e for e in ings if e["ano"] == 2022][0]
    assert atual_2022["sha256"] == _sha(out_dir / "fato_2022_1_presidente.json")


def test_crash_entre_passos_detecta_e_repara(tmp_path):
    """Fato novo + manifest velho (crash após fato, antes do manifest).

    O predicado de consistência reprova (fail-closed); o `verify_manifest`
    sozinho continua True (só vê forma — é o buraco que este predicado
    fecha, fixado aqui como documentação). O rerun repara e o predicado
    volta a True, com 1 ingestion e sha atualizado.
    """
    db = tmp_path / "t.duckdb"
    _seed_db(db)
    out_dir = tmp_path / "out"
    fato = out_dir / "fato_2022_1_presidente.json"
    db_manifest = tmp_path / "manifest.json"

    build_fato(str(db), str(out_dir), 2022, 1, "PRESIDENTE")
    assert verificar_fato_manifest(str(db_manifest), str(fato)) is True

    # Simula o crash: bytes do fato avançam, manifest fica no sha velho.
    payload = json.loads(fato.read_text(encoding="utf-8"))
    payload["municipios"][0]["votos"][0] += 1
    fato.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    with pytest.warns(UserWarning, match="sem chave 'artifacts'"):
        assert verify_manifest(str(db_manifest)) is True  # forma ok: verde falso
    assert verificar_fato_manifest(str(db_manifest), str(fato)) is False

    # Rerun repara: fato regenerado do banco + upsert do manifest.
    build_fato(str(db), str(out_dir), 2022, 1, "PRESIDENTE")
    assert verificar_fato_manifest(str(db_manifest), str(fato)) is True
    ings = _db_ingestions(tmp_path)
    assert len(ings) == 1
    assert ings[0]["sha256"] == _sha(fato)
    assert verify_manifest(str(out_dir / "manifest.json")) is True
