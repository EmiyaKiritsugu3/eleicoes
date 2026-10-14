"""Task 5: wiring gov+fin+cgu (build_all estendido + check_monetario)."""

import duckdb
import pandas as pd

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


def test_build_all_com_gov_e_fin(tmp_path):
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
    con = duckdb.connect(str(tmp_path / "t.duckdb"))
    try:
        assert con.execute("SELECT COUNT(*) FROM fato_gov").fetchone()[0] == 2
        assert con.execute("SELECT COUNT(*) FROM fato_fin").fetchone()[0] == 1
    finally:
        con.close()
    assert (tmp_path / "webdata" / "gov_serie.json").is_file()


def test_check_monetario_reprova_negativo():
    from etl.validate import check_monetario

    df = pd.DataFrame([{"despesa_empenhada": -1.0}])
    assert any("monetario" in e for e in check_monetario(df, ["despesa_empenhada"]))
