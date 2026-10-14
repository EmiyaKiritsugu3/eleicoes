"""dim_ente foundation (Transparência de Gastos, Task 1).

`load_entes() -> pd.DataFrame` com colunas
`["ente_id", "esfera", "uf", "cod_ibge", "nome"]`: 1 União + 27 estados
+ 27 capitais. Consome `etl/capitais_ibge.json` (lista de 27 strings
IBGE7) com o mesmo fail-closed de `build_marts._load_capitais`
(ausente/inválido levanta, nunca chute). Nomes de capitais são
`CAPITAL-{ibge7}` no V1 (nomes bonitos fase 2).
"""

from __future__ import annotations

import json
from pathlib import Path

import pandas as pd

_CAPITAIS_PATH = Path(__file__).resolve().parent / "capitais_ibge.json"

# 27 UFs fixas: (sigla, cod IBGE 2 dígitos, capital IBGE7). Dados oficiais
# IBGE; o conjunto de capitais é confrontado com o arquivo de escopo
# (fail-closed em caso de divergência).
_UFS: tuple[tuple[str, str, str], ...] = (
    ("RO", "11", "1100205"),
    ("AC", "12", "1200401"),
    ("AM", "13", "1302603"),
    ("RR", "14", "1400100"),
    ("PA", "15", "1501402"),
    ("AP", "16", "1600303"),
    ("TO", "17", "1721000"),
    ("MA", "21", "2111300"),
    ("PI", "22", "2211001"),
    ("CE", "23", "2304400"),
    ("RN", "24", "2408102"),
    ("PB", "25", "2507507"),
    ("PE", "26", "2611606"),
    ("AL", "27", "2704302"),
    ("SE", "28", "2800308"),
    ("BA", "29", "2927408"),
    ("MG", "31", "3106200"),
    ("ES", "32", "3205309"),
    ("RJ", "33", "3304557"),
    ("SP", "35", "3550308"),
    ("PR", "41", "4106902"),
    ("SC", "42", "4205407"),
    ("RS", "43", "4314902"),
    ("MS", "50", "5002704"),
    ("MT", "51", "5103403"),
    ("GO", "52", "5208707"),
    ("DF", "53", "5300108"),
)

_COLUNAS = ["ente_id", "esfera", "uf", "cod_ibge", "nome"]


def _load_capitais() -> list[str]:
    """Lista das 27 capitais IBGE7, fail-closed como `build_marts._load_capitais`."""
    try:
        codes = json.loads(_CAPITAIS_PATH.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise FileNotFoundError(
            "entes: arquivo de escopo ausente "
            f"({_CAPITAIS_PATH}); dim_ente exige as 27 capitais"
        )
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(
            "entes: escopo de capitais ilegível "
            f"({_CAPITAIS_PATH}): {exc}"
        ) from exc
    if (
        not isinstance(codes, list)
        or len(codes) != 27
        or len(set(map(str, codes))) != 27
        or not all(
            isinstance(c, str) and len(c) == 7 and c.isdigit() for c in codes
        )
    ):
        raise ValueError(
            "entes: escopo de capitais inválido "
            f"({_CAPITAIS_PATH}): esperada lista de 27 strings IBGE "
            "de 7 dígitos únicas"
        )
    return codes


def load_entes() -> pd.DataFrame:
    """DataFrame da dim_ente: 1 União + 27 estados + 27 capitais."""
    codes = _load_capitais()
    esperadas = {cap for _, _, cap in _UFS}
    if set(codes) != esperadas:
        raise ValueError(
            "entes: escopo de capitais divergente do mapeamento oficial "
            f"({_CAPITAIS_PATH}): esperadas as 27 capitais IBGE"
        )
    por_capital = {cap: uf for uf, _, cap in _UFS}
    linhas: list[dict[str, str]] = [
        {"ente_id": "UNIAO", "esfera": "uniao", "uf": "",
         "cod_ibge": "", "nome": "União"},
    ]
    for uf, cod2, _cap in _UFS:
        linhas.append({"ente_id": f"UF-{uf}", "esfera": "estado",
                       "uf": uf, "cod_ibge": cod2, "nome": uf})
    for cap in codes:
        linhas.append({"ente_id": f"MUN-{cap}", "esfera": "municipio",
                       "uf": por_capital[cap], "cod_ibge": cap,
                       "nome": f"CAPITAL-{cap}"})
    return pd.DataFrame(linhas, columns=_COLUNAS)
