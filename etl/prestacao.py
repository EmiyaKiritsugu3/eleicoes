"""Normalização TSE prestação de contas para o fato_fin (Transparência de Gastos, Task 3).

Schema canônico (ordem exata):
    ["ano", "cargo", "candidato_id", "receita_total", "despesa_total",
     "fefc", "fundo_partidario"]

- Alias-mapping case-insensitive (espelha `etl/normalize.py:_pick_column`).
- Texto via `_fix_text` de `etl/normalize.py`; `cargo` upper.
- `ano`/`candidato`/`receita`/`despesa` ausentes → `ValueError` (fail-closed).
- `fefc`/`fundo_partidario` com coluna inexistente → `0.0` (coluna
  inexistente ≠ dado faltante); com coluna presente, valor inválido
  (não-numérico/negativo/não-finito) descarta a linha com `UserWarning`.
- Monetário inválido nunca soma: linha descartada, nunca coagida a 0.
"""

from __future__ import annotations

import math
import numbers
import warnings

import pandas as pd

from etl.normalize import _fix_text

PRESTACAO_CANONICAL: list[str] = [
    "ano",
    "cargo",
    "candidato_id",
    "receita_total",
    "despesa_total",
    "fefc",
    "fundo_partidario",
]

_COLUMN_ALIASES: dict[str, tuple[str, ...]] = {
    "ano": ("ANO_ELEICAO", "ANO"),
    "cargo": ("DS_CARGO", "CARGO"),
    "candidato": ("SQ_CANDIDATO", "NR_CANDIDATO"),
    "receita": ("VR_RECEITA", "RECEITA_TOTAL"),
    "despesa": ("VR_DESPESA", "DESPESA_TOTAL"),
    "fefc": ("VR_FEFC", "FEFC"),
    "fundo": ("VR_FUNDO_PARTIDARIO", "FUNDO_PARTIDARIO"),
}

_MONETARIA_PARA_CANONICO = {
    "receita": "receita_total",
    "despesa": "despesa_total",
    "fefc": "fefc",
    "fundo": "fundo_partidario",
}


def _pick_column(df: pd.DataFrame, field: str):
    """Devolve a coluna de `df` que corresponde ao campo, ou None."""
    normalized = {str(c).strip().upper(): c for c in df.columns}
    for alias in _COLUMN_ALIASES[field]:
        if alias in normalized:
            return normalized[alias]
    if field in normalized:
        return normalized[field]
    return None


def _serie_monetaria_valida(serie: pd.Series) -> pd.Series:
    """True p/ valores finitos e não-negativos (fail-closed, nunca coage)."""
    finita = serie.apply(
        lambda v: isinstance(v, numbers.Real) and math.isfinite(float(v))
        if pd.notna(v)
        else False
    )
    return serie.notna() & finita & (serie >= 0)


def normalize_prestacao(df: pd.DataFrame) -> pd.DataFrame:
    """Normaliza um DataFrame bruto TSE de prestação para o schema canônico."""
    if not isinstance(df, pd.DataFrame):
        raise TypeError(f"df must be a pandas DataFrame, got {type(df).__name__}")

    col_ano = _pick_column(df, "ano")
    if col_ano is None:
        raise ValueError("input sem coluna de ano (ANO_ELEICAO)")
    col_cargo = _pick_column(df, "cargo")
    if col_cargo is None:
        raise ValueError("input sem coluna de cargo (DS_CARGO)")
    col_cand = _pick_column(df, "candidato")
    if col_cand is None:
        raise ValueError("input sem coluna de candidato (SQ_CANDIDATO)")
    col_mon = {campo: _pick_column(df, campo) for campo in ("receita", "despesa")}
    ausentes = [c for c, col in col_mon.items() if col is None]
    if ausentes:
        raise ValueError(f"input sem coluna(s) monetária(s): {ausentes}")

    ano = pd.to_numeric(df[col_ano], errors="coerce")
    cargo = (
        df[col_cargo].astype("string").fillna("").map(_fix_text).str.strip().str.upper()
    )
    candidato_id = (
        df[col_cand].astype("string").fillna("").map(_fix_text).str.strip()
    )
    monetarias = {
        campo: pd.to_numeric(df[col], errors="coerce")
        for campo, col in col_mon.items()
    }
    # fefc/fundo: coluna inexistente vira 0.0; coluna presente com
    # célula inválida participa do gate fail-closed abaixo.
    for campo in ("fefc", "fundo"):
        col = _pick_column(df, campo)
        if col is None:
            monetarias[campo] = pd.Series(0.0, index=df.index)
        else:
            monetarias[campo] = pd.to_numeric(df[col], errors="coerce")

    ano_ok = ano.notna() & (ano != 0)
    mon_ok = pd.Series(True, index=df.index)
    for serie in monetarias.values():
        mon_ok &= _serie_monetaria_valida(serie)
    n_monetaria_invalida = int((~mon_ok).sum())
    if n_monetaria_invalida:
        warnings.warn(
            f"prestacao: {n_monetaria_invalida} linha(s) com valor "
            "monetário inválido (não-numérico/negativo/não-finito) "
            "descartada(s)",
            UserWarning,
            stacklevel=2,
        )

    n_ano_invalido = int(((~ano_ok) & mon_ok).sum())
    if n_ano_invalido:
        warnings.warn(
            f"prestacao: {n_ano_invalido} linha(s) com ano inválido descartada(s)",
            UserWarning,
            stacklevel=2,
        )

    n_id_invalido = int(((candidato_id == "") & ano_ok & mon_ok).sum())
    if n_id_invalido:
        warnings.warn(
            f"prestacao: {n_id_invalido} linha(s) com candidato_id "
            "vazio descartada(s)",
            UserWarning,
            stacklevel=2,
        )

    mantidas = ano_ok & mon_ok & (candidato_id != "")
    out = pd.DataFrame(index=df.index[mantidas])
    out["ano"] = ano[mantidas].astype("int64").values
    out["cargo"] = cargo[mantidas].values
    out["candidato_id"] = candidato_id[mantidas].values
    for campo, serie in monetarias.items():
        out[_MONETARIA_PARA_CANONICO[campo]] = serie[mantidas].astype(float).values
    return out[PRESTACAO_CANONICAL].reset_index(drop=True)
