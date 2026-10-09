"""Task 9 (E8): marts de prefeito restritos às 27 capitais."""

import json
import re
from pathlib import Path

import duckdb
import pandas as pd
import pytest

from etl.build_marts import _load_canonical, _load_capitais, build_all
from etl.normalize import CANONICAL_COLUMNS

CAPITAIS_PATH = Path(__file__).resolve().parents[2] / "etl" / "capitais_ibge.json"

EXPECTED_CAPITAIS = [
    "1100205", "1200401", "1302603", "1400100", "1501402", "1600303",
    "1721000", "2111300", "2211001", "2304400", "2408102", "2507507",
    "2611606", "2704302", "2800308", "2927408", "3106200", "3205309",
    "3304557", "3550308", "4106902", "4205407", "4314902", "5002704",
    "5103403", "5208707", "5300108",
]


def test_capitais_list_has_27_unique_valid_codes():
    codes = json.loads(CAPITAIS_PATH.read_text(encoding="utf-8"))
    assert len(codes) == 27 and len(set(codes)) == 27
    assert all(re.fullmatch(r"\d{7}", c) for c in codes)
    assert "3550308" in codes and "3304557" in codes  # SP e RJ


def test_capitais_list_exact_values():
    codes = json.loads(CAPITAIS_PATH.read_text(encoding="utf-8"))
    assert codes == EXPECTED_CAPITAIS


def _row(ano, cargo, uf, ibge, cand_id, nome, partido, votos):
    return {
        "ano": ano,
        "turno": 1,
        "cargo": cargo,
        "uf": uf,
        "municipio_ibge": ibge,
        "candidato_id": cand_id,
        "nome_urna": nome,
        "partido": partido,
        "votos": votos,
    }


def test_prefeito_filtered_to_capitais_others_kept(tmp_path):
    df = pd.DataFrame(
        [
            _row(2024, "PREFEITO", "SP", "3550308", "1", "CAP", "P1", 100),
            _row(2024, "PREFEITO", "SP", "3509502", "2", "INT", "P2", 50),
            _row(2022, "PRESIDENTE", "SP", "3509502", "3", "PRES", "P3", 30),
        ]
    )
    for col in ("ano", "turno", "votos"):
        df[col] = df[col].astype("int64")
    for col in ("cargo", "uf", "municipio_ibge", "candidato_id",
                "nome_urna", "partido"):
        df[col] = df[col].astype("string")
    df = df[CANONICAL_COLUMNS]

    curated = tmp_path / "curated"
    curated.mkdir()
    df.to_parquet(curated / "mix.parquet", index=False)
    webdata = tmp_path / "webdata"
    db = tmp_path / "t.duckdb"
    manifest = tmp_path / "m.json"
    build_all(curated, db, manifest, web_data_dir=webdata)

    con = duckdb.connect(str(db))
    try:
        rows = con.execute(
            "SELECT cargo, municipio_ibge, votos FROM fato_voto"
        ).fetchall()
    finally:
        con.close()
    assert ("PREFEITO", "3550308", 100) in rows  # prefeito capital mantido
    assert not any(
        r[0] == "PREFEITO" and r[1] == "3509502" for r in rows
    )  # prefeito interior removido
    assert ("PRESIDENTE", "3509502", 30) in rows  # demais cargos intactos


def test_load_capitais_missing_scope_raises(monkeypatch, tmp_path):
    import etl.build_marts as bm

    monkeypatch.setattr(bm, "_CAPITAIS_PATH", tmp_path / "ausente.json")
    with pytest.raises(FileNotFoundError):
        _load_capitais()


def test_load_capitais_corrupt_scope_raises(monkeypatch, tmp_path):
    import etl.build_marts as bm

    bad = tmp_path / "capitais_ibge.json"
    bad.write_text("{nao-json", encoding="utf-8")
    monkeypatch.setattr(bm, "_CAPITAIS_PATH", bad)
    with pytest.raises(ValueError, match="capitais"):
        _load_capitais()


def test_build_all_missing_scope_fails_closed(monkeypatch, tmp_path):
    """Sem o arquivo de escopo, nenhum prefeito entra: build falha em vez
    de deixar interior-prefeito vazar para os marts (E8)."""
    import etl.build_marts as bm

    monkeypatch.setattr(bm, "_CAPITAIS_PATH", tmp_path / "ausente.json")
    curated = tmp_path / "curated"
    curated.mkdir()
    df = pd.DataFrame(
        [_row(2024, "PREFEITO", "SP", "3509502", "2", "INT", "P2", 50)]
    )
    for col in ("ano", "turno", "votos"):
        df[col] = df[col].astype("int64")
    for col in ("cargo", "uf", "municipio_ibge", "candidato_id",
                "nome_urna", "partido"):
        df[col] = df[col].astype("string")
    df[CANONICAL_COLUMNS].to_parquet(curated / "mix.parquet", index=False)
    with pytest.raises(FileNotFoundError):
        _load_canonical(curated)
    with pytest.raises(FileNotFoundError):
        build_all(curated, tmp_path / "t.duckdb", tmp_path / "m.json",
                  web_data_dir=tmp_path / "webdata")
