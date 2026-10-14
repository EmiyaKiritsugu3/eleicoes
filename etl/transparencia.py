"""Normalização CGU federal para o fato_transp_federal (Transparência de Gastos, Task 4).

Schema canônico (ordem exata):
    ["ano", "orgao", "funcao", "valor"]

- Sem rede aqui (fetch vive no `__main__` da Task 5); só normaliza
  `records: list[dict]` já baixados.
- Entrada vazia → DataFrame vazio canônico (skip honesto, não erro).
- Alias-mapping case-insensitive (espelha `etl/siconfi.py:_pick_column`).
- `valor` via `pd.to_numeric`; não-numérico/negativo/não-finito descarta
  a linha com `UserWarning`, nunca coagido a 0 (fail-closed).
- `ano` inválido descarta a linha com `UserWarning`.
"""

from __future__ import annotations

import math
import numbers
import warnings

import pandas as pd

from etl.normalize import _fix_text

CGU_CANONICAL: list[str] = ["ano", "orgao", "funcao", "valor"]

_COLUMN_ALIASES: dict[str, tuple[str, ...]] = {
    "ano": ("ANO", "ANO_EXERCICIO"),
    "orgao": ("ORGAO", "NM_ORGAO", "ORGAO_SUPERIOR"),
    "funcao": ("FUNCAO", "NM_FUNCAO", "FUNCAO_GOVERNO"),
    "valor": ("VALOR", "VL_PAGO", "VALOR_PAGO"),
}


def normalize_cgu(records: list[dict]) -> pd.DataFrame:
    """Normaliza registros brutos CGU para o schema canônico."""
    if not records:
        return pd.DataFrame({c: pd.Series(dtype="float64" if c == "valor" else "object") for c in CGU_CANONICAL})[CGU_CANONICAL]

    df = pd.DataFrame(records)
    # Mapeamento sobre as colunas do DataFrame (case-insensitive).
    normalized_cols = {str(c).strip().upper(): c for c in df.columns}

    def _col(field: str):
        for alias in _COLUMN_ALIASES[field]:
            if alias in normalized_cols:
                return normalized_cols[alias]
        if field in normalized_cols:
            return normalized_cols[field]
        return None

    col_ano = _col("ano")
    col_orgao = _col("orgao")
    col_funcao = _col("funcao")
    col_valor = _col("valor")
    ausentes = [f for f, c in (("ano", col_ano), ("orgao", col_orgao), ("funcao", col_funcao), ("valor", col_valor)) if c is None]
    if ausentes:
        raise ValueError(f"input sem campo(s): {ausentes}")

    ano = pd.to_numeric(df[col_ano], errors="coerce")
    valor = pd.to_numeric(df[col_valor], errors="coerce")
    orgao = df[col_orgao].astype("string").fillna("").map(_fix_text).str.strip()
    funcao = df[col_funcao].astype("string").fillna("").map(_fix_text).str.strip()

    ano_ok = ano.notna() & (ano != 0)
    finita = valor.apply(
        lambda v: isinstance(v, numbers.Real) and math.isfinite(float(v))
        if pd.notna(v)
        else False
    )
    valor_ok = valor.notna() & finita & (valor >= 0)

    n_valor_invalido = int((~valor_ok).sum())
    if n_valor_invalido:
        warnings.warn(
            f"cgu: {n_valor_invalido} linha(s) com valor "
            "inválido (não-numérico/negativo/não-finito) descartada(s)",
            UserWarning,
            stacklevel=2,
        )
    n_ano_invalido = int(((~ano_ok) & valor_ok).sum())
    if n_ano_invalido:
        warnings.warn(
            f"cgu: {n_ano_invalido} linha(s) com ano inválido descartada(s)",
            UserWarning,
            stacklevel=2,
        )

    mantidas = ano_ok & valor_ok
    out = pd.DataFrame(index=df.index[mantidas])
    out["ano"] = ano[mantidas].astype("int64").values
    out["orgao"] = orgao[mantidas].values
    out["funcao"] = funcao[mantidas].values
    out["valor"] = valor[mantidas].astype(float).values
    return out[CGU_CANONICAL].reset_index(drop=True)
