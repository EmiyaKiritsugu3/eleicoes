"""Task 2: SICONFI DCA -> fato_gov."""

import pandas as pd

from etl.siconfi import normalize_siconfi


def test_normalize_siconfi_alias_e_orfao():
    df = normalize_siconfi(pd.DataFrame([
        {"ANO": "2022", "ENTE": "UNIAO", "RECEITA": "100.50", "EMPENHADO": "80", "LIQUIDADO": "70", "PAGO": "60"},
        {"ANO": "2022", "ENTE": "XX-INVALIDO", "RECEITA": "1", "EMPENHADO": "1", "LIQUIDADO": "1", "PAGO": "1"},
    ]))
    assert len(df) == 1
    assert float(df.iloc[0]["despesa_empenhada"]) == 80.0
    assert int(df.iloc[0]["ano"]) == 2022
