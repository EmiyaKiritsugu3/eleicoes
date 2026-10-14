"""Task 4: CGU opcional -> fato_transp_federal (normalize_cgu)."""

import warnings

import pandas as pd

from etl.transparencia import CGU_CANONICAL, normalize_cgu


def test_normalize_cgu_vazio_e_basico():
    assert normalize_cgu([]).empty
    df = normalize_cgu([{"ano": 2022, "orgao": "MS", "funcao": "Saude", "valor": "10.5"}])
    assert float(df.iloc[0]["valor"]) == 10.5


def test_normalize_cgu_vazio_e_canonico():
    df = normalize_cgu([])
    assert list(df.columns) == CGU_CANONICAL
    assert df.empty


def test_normalize_cgu_valor_nao_numerico_descarta():
    with warnings.catch_warnings(record=True) as gravadas:
        warnings.simplefilter("always")
        df = normalize_cgu([
            {"ano": 2022, "orgao": "MS", "funcao": "Saude", "valor": "10.5"},
            {"ano": 2022, "orgao": "MS", "funcao": "Saude", "valor": "n/a"},
            {"ano": 2022, "orgao": "MS", "funcao": "Saude", "valor": None},
        ])
    assert len(df) == 1
    assert float(df.iloc[0]["valor"]) == 10.5
    assert any(issubclass(w.category, UserWarning) for w in gravadas)
    assert (df["valor"] != 0).all()


def test_normalize_cgu_ano_invalido_descarta():
    with warnings.catch_warnings(record=True):
        warnings.simplefilter("always")
        df = normalize_cgu([{"ano": "xx", "orgao": "MS", "funcao": "Saude", "valor": "5"}])
    assert df.empty
    assert list(df.columns) == CGU_CANONICAL


def test_normalize_cgu_alias_case_insensitive():
    df = normalize_cgu([{"ANO": "2022", "ORGAO": " MS ", "FUNCAO": "Saude", "VALOR": 7}])
    assert int(df.iloc[0]["ano"]) == 2022
    assert df.iloc[0]["orgao"] == "MS"
    assert float(df.iloc[0]["valor"]) == 7.0
    assert isinstance(df, pd.DataFrame)
