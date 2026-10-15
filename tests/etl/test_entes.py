"""Task 1: dim_ente foundation — União + 27 UFs + 27 capitais."""

from etl.entes import load_entes


def test_load_entes_tem_uniao_27ufs_27capitais():
    df = load_entes()
    assert len(df) == 1 + 27 + 27
    assert "UNIAO" in set(df["ente_id"])
    assert set(df.columns) == {"ente_id", "esfera", "uf", "cod_ibge", "nome"}


def test_load_entes_linhas_exemplares_do_contrato():
    df = load_entes().set_index("ente_id")
    uniao = df.loc["UNIAO"]
    assert uniao["esfera"] == "uniao"
    assert uniao["uf"] == ""
    assert uniao["cod_ibge"] == ""
    assert df.loc["UF-SP"]["esfera"] == "estado"
    capital = df.loc["MUN-3550308"]
    assert capital["esfera"] == "municipio"
    assert set(df["esfera"]) == {"uniao", "estado", "municipio"}
