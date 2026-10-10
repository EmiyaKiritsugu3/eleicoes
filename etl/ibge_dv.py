"""Dígito verificador IBGE mod-10 (fonte única da verdade).

Extraído de `etl/normalize.py` + `etl/censo.py` (EVOLVE-1: o bloco
`_dv_ok` + shape/DV + `warnings.warn` estava duplicado em ~14 linhas e
bloqueava o Quality Gate do SonarCloud — duplicação 4.2% > 3%).

Regra (byte-idêntica à original): o 7º dígito é verificador mod-10 da
base (6 primeiros): pesos 1,2,1,2,1,2 esq->dir, soma os dígitos dos
produtos, DV=(10-soma%10)%10. Ex.: "3550308" DV 8 ok; transposto
"5350308" (DV 1≠8) rejeitado. Fail-closed: shape ou DV inválido vira
`""` + `UserWarning` com contagem (ver `validar_serie_ibge`).
"""

from __future__ import annotations

import warnings

_PESOS = (1, 2, 1, 2, 1, 2)

# Exceções oficiais ao DV mod-10 (9 reais, o resto rejeita).
# Fonte: IBGE API servicodados.ibge.gov.br/api/v1/localidades/municipios.
# Método: 5571 municípios baixados em 2026-10-10; DV recalculado pela regra.
_EXCECOES_OFICIAIS = frozenset({
    "2201919", "2201988", "2202251", "2611533", "3117836",
    "3152131", "4305871", "5203939", "5203962",
})


def calcular_dv(base6: str) -> str:
    """Devolve o DV mod-10 da base de 6 dígitos (string de 1 dígito)."""
    total = sum(
        (int(d) * w) // 10 + (int(d) * w) % 10
        for d, w in zip(base6, _PESOS)
    )
    return str((10 - total % 10) % 10)


def dv_ok(code) -> bool:
    """Verdadeiro se `code` é IBGE7 com DV mod-10 válido ou uma das 9 exceções oficiais; resto é falso."""
    if not isinstance(code, str) or len(code) != 7 or not code.isdigit():
        return False
    if code in _EXCECOES_OFICIAIS:
        return True
    return calcular_dv(code[:6]) == code[6]


def validar_serie_ibge(digits, origem: str):
    """Devolve máscara booleana dos inválidos (shape ou DV), com warns.

    `digits` é a Series só-dígitos (pré-zfill); `origem` é o nome da
    função chamadora p/ a mensagem (ex.: "normalize_resultados").
    Emite até 2 `UserWarning` contados — um p/ shape, um p/ DV — com o
    texto original de cada chamadora (testes casam em "IBGE"). O shape
    check roda antes do DV, como antes.
    """
    bad_shape = ~digits.str.fullmatch(r"\d{7}").fillna(False)
    n_bad = int(bad_shape.sum())
    if n_bad:
        warnings.warn(
            f"{origem}: {n_bad} codigo(s) IBGE fora do padrao "
            "de 7 digitos descartados (vazio)",
            UserWarning,
            stacklevel=3,
        )
    dv_bad = ~bad_shape & ~digits.map(dv_ok)
    n_dv = int(dv_bad.sum())
    if n_dv:
        warnings.warn(
            f"{origem}: {n_dv} codigo(s) IBGE com digito "
            "verificador invalido descartados (vazio)",
            UserWarning,
            stacklevel=3,
        )
    return bad_shape | dv_bad
