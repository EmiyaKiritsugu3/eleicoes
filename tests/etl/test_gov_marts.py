"""Task 5: wiring gov+fin+cgu (build_all estendido + check_monetario)."""

import json

import duckdb
import pandas as pd
import pytest

from etl.build_marts import build_all


def gov_fixture() -> pd.DataFrame:
    from etl.siconfi import normalize_siconfi

    return normalize_siconfi(pd.DataFrame([
        {"ANO": 2022, "ENTE": "UNIAO", "RECEITA": 100.0,
         "EMPENHADO": 80.0, "LIQUIDADO": 70.0, "PAGO": 60.0},
        {"ANO": 2022, "ENTE": "UF-SP", "RECEITA": 200.0,
         "EMPENHADO": 150.0, "LIQUIDADO": 140.0, "PAGO": 130.0},
    ]))


def fin_fixture() -> pd.DataFrame:
    from etl.prestacao import normalize_prestacao

    return normalize_prestacao(pd.DataFrame([
        {"ANO_ELEICAO": 2022, "DS_CARGO": "presidente",
         "SQ_CANDIDATO": "123", "VR_RECEITA": 500.0, "VR_DESPESA": 400.0},
    ]))


def _build_com_gov_fin(tmp_path):
    """Build de sucesso com gov+fin; devolve (db, manifest, webdata)."""
    curated = tmp_path / "curated"
    curated.mkdir()
    # Voto V1 cujo SQ_CANDIDATO casa com o fin_fixture: dim_candidato
    # cobre o fato_fin e o gate de órfãos fin (0,1%) passa.
    (curated / "votos.csv").write_text(
        "ANO_ELEICAO;NUM_TURNO;DS_CARGO;SG_UF;CD_MUNICIPIO;SQ_CANDIDATO;"
        "NM_URNA_CANDIDATO;SG_PARTIDO;QT_VOTOS\n"
        "2022;1;PRESIDENTE;SP;3550308;123;CANDIDATO EXEMPLO;PART;100\n",
        encoding="utf-8",
    )
    manifest = tmp_path / "m.json"
    build_all(curated, tmp_path / "t.duckdb", manifest,
              web_data_dir=tmp_path / "webdata",
              gov_df=gov_fixture(), fin_df=fin_fixture())
    return tmp_path / "t.duckdb", manifest, tmp_path / "webdata"


def test_build_all_com_gov_e_fin(tmp_path):
    db, _manifest, webdata = _build_com_gov_fin(tmp_path)
    con = duckdb.connect(str(db))
    try:
        assert con.execute("SELECT COUNT(*) FROM fato_gov").fetchone()[0] == 2
        assert con.execute("SELECT COUNT(*) FROM fato_fin").fetchone()[0] == 1
    finally:
        con.close()
    assert (webdata / "gov_serie.json").is_file()


def test_check_monetario_reprova_negativo():
    from etl.validate import check_monetario

    df = pd.DataFrame([{"despesa_empenhada": -1.0}])
    assert any("monetario" in e for e in check_monetario(df, ["despesa_empenhada"]))


def test_build_all_reprova_gov_negativo(tmp_path):
    """Quadro gov com negativo reprova o build (fail-closed, nada publica)."""
    from etl.siconfi import SICONFI_CANONICAL

    curated = tmp_path / "curated"
    curated.mkdir()
    gov_ruim = pd.DataFrame([{
        "ano": 2022, "ente_id": "UNIAO", "esfera": "uniao",
        "receita_total": 100.0, "despesa_empenhada": -1.0,
        "despesa_liquidada": 70.0, "despesa_paga": 60.0,
    }])[SICONFI_CANONICAL]
    with pytest.raises(RuntimeError, match="gates reprovados"):
        build_all(curated, tmp_path / "t.duckdb", tmp_path / "m.json",
                  web_data_dir=tmp_path / "webdata", gov_df=gov_ruim)
    assert not (tmp_path / "t.duckdb").exists()
    assert not (tmp_path / "m.json").exists()
    assert not (tmp_path / "webdata" / "gov_serie.json").exists()


def test_gov_jsons_tem_hash_e_gate_bytes(tmp_path):
    """gov/fin servidos com fonte+hash: entries `artifact` + gate bytes-aware."""
    from etl.validate import run_gates

    db, _manifest, webdata = _build_com_gov_fin(tmp_path)
    manifest = json.loads((tmp_path / "m.json").read_text(encoding="utf-8"))
    arquivos = {e.get("arquivo") for e in manifest.get("artifacts", [])
                if isinstance(e, dict)}
    assert {"gov_serie.json", "gov_por_ente.json",
            "fin_por_candidato.json"} <= arquivos
    # Bytes-aware: gov_serie.json confere com o mirror servido.
    mirror = webdata / "manifest.json"
    assert run_gates(db, manifest_path=mirror,
                     fato_paths=[webdata / "gov_serie.json"]) == []
