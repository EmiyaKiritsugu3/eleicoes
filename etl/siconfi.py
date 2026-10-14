"""Normalização SICONFI DCA para o fato_gov (Transparência de Gastos, Task 2).

Schema canônico (ordem exata):
    ["ano", "ente_id", "esfera", "receita_total", "despesa_empenhada",
     "despesa_liquidada", "despesa_paga"]

- Alias-mapping case-insensitive (espelha `etl/normalize.py:_pick_column`).
- Monetários via `pd.to_numeric` (ponto decimal); vírgula pt-BR
  ("1.234,56") vira NaN → linha descartada com `UserWarning`, nunca
  coagida. Negativo/não-finito também descarta (fail-closed: nunca soma).
- `ente_id` fora de `load_entes()` → órfão descartado com `UserWarning`
  (nunca cria ente).
"""

from __future__ import annotations

import math
import warnings

import pandas as pd

from etl.entes import load_entes

SICONFI_CANONICAL: list[str] = [
    "ano",
    "ente_id",
    "esfera",
    "receita_total",
    "despesa_empenhada",
    "despesa_liquidada",
    "despesa_paga",
]

_COLUMN_ALIASES: dict[str, tuple[str, ...]] = {
    "ano": ("ANO", "ANO_EXERCICIO"),
    "ente": ("ENTE", "ENTE_ID", "COD_IBGE"),
    "receita": ("RECEITA", "RECEITA_TOTAL"),
    "empenhado": ("EMPENHADO", "DESPESA_EMPENHADA"),
    "liquidado": ("LIQUIDADO", "DESPESA_LIQUIDADA"),
    "pago": ("PAGO", "DESPESA_PAGA"),
}

_MONETARIAS = ("receita", "empenhado", "liquidado", "pago")
_MONETARIA_PARA_CANONICO = {
    "receita": "receita_total",
    "empenhado": "despesa_empenhada",
    "liquidado": "despesa_liquidada",
    "pago": "despesa_paga",
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


def normalize_siconfi(df: pd.DataFrame) -> pd.DataFrame:
    """Normaliza um DataFrame bruto SICONFI DCA para o schema canônico."""
    if not isinstance(df, pd.DataFrame):
        raise TypeError(f"df must be a pandas DataFrame, got {type(df).__name__}")

    entes = load_entes()
    validos = set(entes["ente_id"].astype(str).str.strip().str.upper())
    esfera_por_ente = dict(
        zip(
            entes["ente_id"].astype(str).str.strip().str.upper(),
            entes["esfera"].astype(str),
        )
    )
    # Valores crus de IBGE (estado 2 dígitos, município 7) também resolvem
    # para o ente_id oficial — sem criar ente novo (só lookup reverso).
    ibge_para_ente: dict[str, str] = {}
    for _, linha in entes.iterrows():
        cod = str(linha["cod_ibge"]).strip()
        if cod:
            ibge_para_ente.setdefault(
                cod.upper(), str(linha["ente_id"]).strip().upper()
            )

    col_ano = _pick_column(df, "ano")
    if col_ano is None:
        raise ValueError("input sem coluna de ano (ANO)")
    col_ente = _pick_column(df, "ente")
    if col_ente is None:
        raise ValueError("input sem coluna de ente (ENTE)")
    col_mon = {campo: _pick_column(df, campo) for campo in _MONETARIAS}
    ausentes = [c for c, col in col_mon.items() if col is None]
    if ausentes:
        raise ValueError(f"input sem coluna(s) monetária(s): {ausentes}")

    ano = pd.to_numeric(df[col_ano], errors="coerce")
    ente_cru = df[col_ente].astype("string").fillna("").str.strip().str.upper()
    ente_id = ente_cru.where(
        ente_cru.isin(validos), ente_cru.map(ibge_para_ente).fillna(ente_cru)
    )
    monetarias = {
        campo: pd.to_numeric(df[col], errors="coerce")
        for campo, col in col_mon.items()
    }

    ano_ok = ano.notna() & (ano != 0)
    mon_ok = pd.Series(True, index=df.index)
    for serie in monetarias.values():
        finita = serie.apply(
            lambda v: isinstance(v, (int, float)) and math.isfinite(float(v))
            if pd.notna(v)
            else False
        )
        mon_ok &= serie.notna() & finita & (serie >= 0)
    n_monetaria_invalida = int((~mon_ok).sum())
    if n_monetaria_invalida:
        warnings.warn(
            f"siconfi: {n_monetaria_invalida} linha(s) com valor "
            "monetário inválido (não-numérico/negativo/não-finito) "
            "descartada(s)",
            UserWarning,
            stacklevel=2,
        )

    ente_ok = ente_id.isin(validos)
    # Contagem de órfãos entre as linhas que passariam nos demais gates
    # (evita dupla contagem com linhas já descartadas por valor/ano).
    n_orfaos = int((~ente_ok & ano_ok & mon_ok).sum())
    if n_orfaos:
        warnings.warn(
            f"siconfi: {n_orfaos} linha(s) com ente_id fora de "
            "load_entes() descartada(s)",
            UserWarning,
            stacklevel=2,
        )

    n_ano_invalido = int(((~ano_ok) & ente_ok & mon_ok).sum())
    if n_ano_invalido:
        warnings.warn(
            f"siconfi: {n_ano_invalido} linha(s) com ano inválido descartada(s)",
            UserWarning,
            stacklevel=2,
        )

    mantidas = ano_ok & mon_ok & ente_ok
    out = pd.DataFrame(index=df.index[mantidas])
    out["ano"] = ano[mantidas].astype("int64")
    out["ente_id"] = ente_id[mantidas].values
    out["esfera"] = ente_id[mantidas].map(esfera_por_ente).values
    for campo, serie in monetarias.items():
        out[_MONETARIA_PARA_CANONICO[campo]] = serie[mantidas].astype(float).values
    return out[SICONFI_CANONICAL].reset_index(drop=True)
