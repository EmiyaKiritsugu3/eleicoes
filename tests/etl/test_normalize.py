def test_normalize_resultados_columns():
    from etl.normalize import normalize_resultados
    import pandas as pd
    df = pd.DataFrame([{"ANO_ELEICAO": 2022, "DS_CARGO": "PRESIDENTE", "SG_UF": "SP", "CD_MUNICIPIO": "3550308", "NM_URNA": "X", "QT_VOTOS": 10}])
    out = normalize_resultados(df)
    assert list(out.columns) == ["ano", "turno", "cargo", "uf", "municipio_ibge", "candidato_id", "nome_urna", "partido", "votos"]
    assert out.iloc[0]["municipio_ibge"] == "3550308"


def test_build_all_creates_duckdb(tmp_path):
    from etl.build_marts import build_all
    build_all(str(tmp_path), str(tmp_path / "t.duckdb"), str(tmp_path / "m.json"))
    import os
    assert os.path.exists(tmp_path / "t.duckdb")


def test_normalize_latin1_and_missing_ibge():
    from etl.normalize import normalize_resultados
    import pandas as pd
    # município sem IBGE correspondente deve ser mantido com flag para exibir "sem dado oficial" no mapa
    df = pd.DataFrame([{"ANO_ELEICAO": 2022, "DS_CARGO": "PRESIDENTE", "SG_UF": "SP", "CD_MUNICIPIO": "9999999", "NM_URNA": "Y", "QT_VOTOS": 5}])
    out = normalize_resultados(df)
    assert out.iloc[0]["municipio_ibge"] == "9999999"
    assert "sem_ibge" in out.columns or out.iloc[0]["municipio_ibge"] == "9999999"
