"""IBGE DV compartilhado (EVOLVE-1): fonte única em etl.ibge_dv.

Garante que normalize.py e censo.py usam o mesmo objeto-função
(duplicação Sonar 4.2% > 3%) e que a regra mod-10 é byte-idêntica.
"""

from etl import ibge_dv
from etl import censo
from etl import normalize


def test_dv_compartilhado_mesmo_objeto():
    assert normalize._dv_ok is ibge_dv.dv_ok
    assert censo._dv_ok is ibge_dv.dv_ok


def test_dv_ok_vetores_conhecidos():
    assert ibge_dv.dv_ok("3550308") is True  # São Paulo
    assert ibge_dv.dv_ok("3304557") is True  # Rio de Janeiro
    assert ibge_dv.dv_ok("5300108") is True  # Brasília
    assert ibge_dv.dv_ok("5350308") is False  # transposto
    assert ibge_dv.dv_ok("0123456") is False  # DV 5≠6
    assert ibge_dv.dv_ok("9999999") is False  # sentinela fictício
    assert ibge_dv.dv_ok("123") is False
    assert ibge_dv.dv_ok("") is False
    assert ibge_dv.dv_ok(None) is False


def test_calcular_dv_confere_com_dv_ok():
    assert ibge_dv.calcular_dv("355030") == "8"
    assert ibge_dv.calcular_dv("330455") == "7"
    assert ibge_dv.calcular_dv("530010") == "8"
    for base in ("355030", "330455", "530010"):
        assert ibge_dv.dv_ok(base + ibge_dv.calcular_dv(base)) is True


# Exceções oficiais ao mod-10 (IBGE API 2026-10-10, 5571 municípios):
# estes 9 códigos reais falham no DV calculado e devem ser aceites.
_EXCECOES_OFICIAIS = (
    "2201919",  # Bom Princípio do Piauí/PI
    "2201988",  # Brejo do Piauí/PI
    "2202251",  # Canavieira/PI
    "2611533",  # Quixaba/PE
    "3117836",  # Cônego Marinho/MG
    "3152131",  # Ponto Chique/MG
    "4305871",  # Coronel Barros/RS
    "5203939",  # Buriti de Goiás/GO
    "5203962",  # Buritinópolis/GO
)


def test_dv_ok_aceita_excecoes_oficiais():
    for code in _EXCECOES_OFICIAIS:
        assert ibge_dv.dv_ok(code) is True
    # Fail-closed mantido: sentinela fictícia continua rejeitada.
    assert ibge_dv.dv_ok("9999999") is False


def test_validar_serie_preserva_excecoes_sem_warn():
    import warnings

    import pandas as pd

    digits = pd.Series(list(_EXCECOES_OFICIAIS) + ["3550308"])
    with warnings.catch_warnings():
        warnings.simplefilter("error")
        invalidas = ibge_dv.validar_serie_ibge(digits, "teste-excecoes")
    assert bool(invalidas.any()) is False
