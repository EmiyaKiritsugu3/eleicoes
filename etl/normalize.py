"""Normalização dos resultados TSE para o schema canônico (offline-first, custo zero).

Schema canônico (ordem exata):
    [ano, turno, cargo, uf, municipio_ibge, candidato_id, nome_urna, partido, votos]

- Aceita variações de nome de coluna do TSE entre anos (case-insensitive).
- Repara mojibake latin1/utf-8 em colunas de texto.
- `municipio_ibge` é string de 7 dígitos (zero-padded); municípios sem IBGE
  oficial (ex.: código fictício 9999999) são MANTIDOS na linha — a camada do
  mapa deriva a flag `sem_ibge` por join (exibe "sem dado oficial").
"""

from __future__ import annotations

import warnings

import pandas as pd

CANONICAL_COLUMNS = [
    "ano",
    "turno",
    "cargo",
    "uf",
    "municipio_ibge",
    "candidato_id",
    "nome_urna",
    "partido",
    "votos",
]

# Variantes TSE por ano -> campo canônico (comparação upper + strip).
_COLUMN_ALIASES: dict[str, tuple[str, ...]] = {
    "ano": ("ANO_ELEICAO", "ANO"),
    "turno": ("NUM_TURNO", "TURNO"),
    "cargo": ("DS_CARGO", "CARGO"),
    "uf": ("SG_UF", "UF"),
    "municipio_ibge": ("CD_MUNICIPIO", "COD_MUNICIPIO_IBGE", "CD_MUNICIPIO_IBGE"),
    "candidato_id": ("SQ_CANDIDATO", "NR_CANDIDATO", "NR_VOTAVEL"),
    "nome_urna": ("NM_URNA_CANDIDATO", "NM_URNA", "NM_VOTAVEL"),
    "partido": ("SG_PARTIDO", "PARTIDO"),
    "votos": ("QT_VOTOS_NOMINAIS", "QT_VOTOS", "VOTOS"),
}


def _fix_text(value):
    """Repara texto lido com encoding errado (bytes UTF-8 decodificados como latin1).

    Devolve o valor intacto quando já está correto ou não é string.
    Aplica o reparo quando ele NÃO AUMENTA o número de marcadores de
    mojibake (reduz ou mantém) — a forma correta pode conter Ã/Â
    (ex.: SÃO, JOÃO, AÇÃO), então exigir eliminação total (`<` estrito)
    nunca repararia esses casos: "SÃ\x83O" e "SÃO" têm 1 marcador cada.
    Texto correto passa intacto pela via de exceção (o re-decode falha)
    ou porque o reparo é identidade.
    """
    if not isinstance(value, str):
        return value
    try:
        fixed = value.encode("latin1").decode("utf-8")
    except (UnicodeEncodeError, UnicodeDecodeError):
        return value
    # Heurística: troca se o reparo não aumentar marcadores de mojibake.
    mojibake = ("Ã", "Â", "�", "ƒ")
    if sum(fixed.count(m) for m in mojibake) <= sum(value.count(m) for m in mojibake):
        return fixed
    return value


def _pick_column(df: pd.DataFrame, field: str):
    """Devolve a coluna de `df` que corresponde ao campo canônico, ou None."""
    normalized = {str(c).strip().upper(): c for c in df.columns}
    for alias in _COLUMN_ALIASES[field]:
        if alias in normalized:
            return normalized[alias]
    if field in normalized:
        return normalized[field]
    return None


def normalize_resultados(df: pd.DataFrame) -> pd.DataFrame:
    """Normaliza um DataFrame bruto do TSE para o schema canônico.

    Levanta `ValueError` se não houver coluna de ano (impossível particionar)
    ou coluna de votos (zero silencioso é pior que falhar: E2).
    Votos não-numéricos viram nulos (`Int64` anulável), nunca 0 (E3);
    os quality gates reprovam nulos em vez de somar lixo.
    `turno` ausente/não-numérico vira 1 (M7).
    Linhas de município sem IBGE oficial são mantidas (ver módulo docstring).
    """
    if not isinstance(df, pd.DataFrame):
        raise TypeError(f"df must be a pandas DataFrame, got {type(df).__name__}")
    if _pick_column(df, "ano") is None:
        raise ValueError("input sem coluna de ano (ANO_ELEICAO)")

    out = pd.DataFrame(index=df.index)

    col = _pick_column(df, "ano")
    out["ano"] = pd.to_numeric(df[col], errors="coerce").fillna(0).astype("int64")

    col = _pick_column(df, "turno")
    if col is None:
        out["turno"] = 1
    else:
        out["turno"] = pd.to_numeric(df[col], errors="coerce").fillna(0).astype("int64")
    # turno ausente nas linhas como 0 -> 1º turno.
    out["turno"] = out["turno"].replace(0, 1)

    col = _pick_column(df, "votos")
    if col is None:
        raise ValueError("input sem coluna de votos (QT_VOTOS)")
    out["votos"] = pd.to_numeric(df[col], errors="coerce").astype("Int64")

    for field in ("cargo", "uf"):
        col = _pick_column(df, field)
        out[field] = df[col].astype("string").fillna("") if col is not None else ""
    out["cargo"] = out["cargo"].map(_fix_text).str.strip().str.upper()
    out["uf"] = out["uf"].map(_fix_text).str.strip().str.upper()

    col = _pick_column(df, "municipio_ibge")
    ibge_raw = df[col].astype("string").fillna("") if col is not None else pd.Series("", index=df.index)
    digits = ibge_raw.map(_fix_text).str.strip().str.replace(r"\D", "", regex=True)
    # M1: só 7 dígitos é IBGE válido; valida os dígitos crus (antes do
    # zfill, que mascararia "123" como "0000123") e descarta o resto p/ "".
    bad = ~digits.str.fullmatch(r"\d{7}").fillna(False)
    n_bad = int(bad.sum())
    if n_bad:
        warnings.warn(
            f"normalize_resultados: {n_bad} codigo(s) IBGE fora do padrao "
            "de 7 digitos descartados (vazio)",
            UserWarning,
            stacklevel=2,
        )
    ibge = digits.where(~bad, "").str.zfill(7)
    out["municipio_ibge"] = ibge.replace("0000000", "")

    col = _pick_column(df, "candidato_id")
    if col is not None:
        out["candidato_id"] = df[col].astype("string").fillna("").map(_fix_text).str.strip()
    else:  # fallback estável quando o ano não traz id de candidato
        nome_col = _pick_column(df, "nome_urna")
        part_col = _pick_column(df, "partido")
        nome = df[nome_col].astype("string").fillna("") if nome_col is not None else ""
        part = df[part_col].astype("string").fillna("") if part_col is not None else ""
        out["candidato_id"] = (
            pd.Series(nome, index=df.index).map(_fix_text).str.strip()
            + "|"
            + pd.Series(part, index=df.index).map(_fix_text).str.strip()
        )

    for field in ("nome_urna", "partido"):
        col = _pick_column(df, field)
        out[field] = (
            df[col].astype("string").fillna("").map(_fix_text).str.strip()
            if col is not None
            else ""
        )

    return out[CANONICAL_COLUMNS].reset_index(drop=True)
