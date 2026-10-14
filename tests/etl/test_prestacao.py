"""Task 3: TSE prestação -> fato_fin."""

import pandas as pd

from etl.prestacao import normalize_prestacao


def test_normalize_prestacao_basico():
    df = normalize_prestacao(pd.DataFrame([
        {"ANO_ELEICAO": "2022", "DS_CARGO": "presidente", "SQ_CANDIDATO": "123", "VR_RECEITA": "500", "VR_DESPESA": "400"},
    ]))
    assert df.iloc[0]["candidato_id"] == "123"
    assert float(df.iloc[0]["despesa_total"]) == 400.0
    assert float(df.iloc[0]["fefc"]) == 0.0
