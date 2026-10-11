"""Normalização dos resultados TSE para o schema canônico (offline-first, custo zero).

Schema canônico (ordem exata):
    [ano, turno, cargo, uf, municipio_ibge, candidato_id, nome_urna, partido, votos]

- Aceita variações de nome de coluna do TSE entre anos (case-insensitive).
- Repara mojibake latin1/utf-8 em colunas de texto.
- `municipio_ibge` é string de 7 dígitos (zero-padded) com dígito
  verificador mod-10 válido no 7º dígito; inválido (shape ou DV) vira
  `""` + `UserWarning` com contagem. O sentinela fictício "9999999"
  (DV inválido) é rejeitado como os demais — a camada do mapa deriva
  a flag `sem_ibge` por join (exibe "sem dado oficial").
"""

from __future__ import annotations

import pandas as pd

from etl.ibge_dv import validar_serie_ibge

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


def _aplicar_depara(digits, depara):
    """Traduz códigos não-IBGE7 pelo de-para oficial (EVOLVE-15).

    Só o que não é IBGE7 consulta o mapa (IBGE7 direto nunca é
    remapeado); chave canônica zfill(5) — votos sem padding ("3018")
    casam com o oficial com padding ("03018"). Sem par → "" (o
    chamador valida e avisa fail-closed como antes).
    """
    mapa = dict(depara)
    precisa = ~digits.str.fullmatch(r"\d{7}")
    traduzidos = digits.str.zfill(5).map(mapa).fillna("")
    return digits.where(~precisa, traduzidos)


def _col_ano(df: pd.DataFrame) -> pd.Series:
    """Coluna `ano` numérica (levanta sem coluna de ano)."""
    col = _pick_column(df, "ano")
    if col is None:
        raise ValueError("input sem coluna de ano (ANO_ELEICAO)")
    return pd.to_numeric(df[col], errors="coerce").fillna(0).astype("int64")


def _col_turno(df: pd.DataFrame) -> pd.Series:
    """Coluna `turno` (ausente/não-numérico/0 vira 1 — M7)."""
    col = _pick_column(df, "turno")
    if col is None:
        return pd.Series(1, index=df.index)
    turno = pd.to_numeric(df[col], errors="coerce").fillna(0).astype("int64")
    return turno.replace(0, 1)


def _col_votos(df: pd.DataFrame) -> pd.Series:
    """Coluna `votos` anulável (levanta sem coluna — E2; nulo nunca 0 — E3)."""
    col = _pick_column(df, "votos")
    if col is None:
        raise ValueError("input sem coluna de votos (QT_VOTOS)")
    return pd.to_numeric(df[col], errors="coerce").astype("Int64")


def _col_texto(df: pd.DataFrame, field: str) -> pd.Series:
    """Coluna de texto (cargo/uf) normalizada p/ comparação."""
    col = _pick_column(df, field)
    base = df[col].astype("string").fillna("") if col is not None else ""
    return pd.Series(base, index=df.index).map(_fix_text).str.strip().str.upper()


def _col_municipio(df: pd.DataFrame, depara=None) -> pd.Series:
    """Coluna `municipio_ibge` (7 dígitos com DV; inválido vira `""`).

    Com `depara` (EVOLVE-15), códigos não-IBGE7 são traduzidos antes de
    validar (`_aplicar_depara`); sem par, `""` + warning (fail-closed).
    """
    col = _pick_column(df, "municipio_ibge")
    ibge_raw = df[col].astype("string").fillna("") if col is not None else pd.Series("", index=df.index)
    digits = ibge_raw.map(_fix_text).str.strip().str.replace(r"\D", "", regex=True)
    if depara is not None:
        # Traduzido herda a validação abaixo (fonte única).
        digits = _aplicar_depara(digits, depara)
    # M1: só 7 dígitos é IBGE válido; valida os dígitos crus (antes do
    # zfill, que mascararia "123" como "0000123") e descarta o resto p/ "".
    # DV (ver etl/ibge_dv.py — fonte única; regra mod-10 no 7º dígito).
    bad = validar_serie_ibge(digits, "normalize_resultados")
    ibge = digits.where(~bad, "").str.zfill(7)
    return ibge.replace("0000000", "")


def _col_candidato(df: pd.DataFrame) -> pd.Series:
    """Coluna `candidato_id` (fallback estável nome|partido sem id)."""
    col = _pick_column(df, "candidato_id")
    if col is not None:
        return df[col].astype("string").fillna("").map(_fix_text).str.strip()
    nome_col = _pick_column(df, "nome_urna")
    part_col = _pick_column(df, "partido")
    nome = df[nome_col].astype("string").fillna("") if nome_col is not None else ""
    part = df[part_col].astype("string").fillna("") if part_col is not None else ""
    return (
        pd.Series(nome, index=df.index).map(_fix_text).str.strip()
        + "|"
        + pd.Series(part, index=df.index).map(_fix_text).str.strip()
    )


def _col_rotulo(df: pd.DataFrame, field: str) -> pd.Series:
    """Coluna de rótulo (nome_urna/partido, vazia quando ausente)."""
    col = _pick_column(df, field)
    if col is None:
        return pd.Series("", index=df.index)
    return df[col].astype("string").fillna("").map(_fix_text).str.strip()


def normalize_resultados(df: pd.DataFrame, depara=None) -> pd.DataFrame:
    """Normaliza um DataFrame bruto do TSE para o schema canônico.

    Montagem fina sobre os builders `_col_*` (S3776): o contrato é
    byte-idêntico ao legado — ver docstrings dos builders (E2/E3/M7/M1,
    DV em `etl.ibge_dv`, `depara` EVOLVE-15).
    """
    if not isinstance(df, pd.DataFrame):
        raise TypeError(f"df must be a pandas DataFrame, got {type(df).__name__}")
    out = pd.DataFrame(index=df.index)
    out["ano"] = _col_ano(df)
    out["turno"] = _col_turno(df)
    out["votos"] = _col_votos(df)
    out["cargo"] = _col_texto(df, "cargo")
    out["uf"] = _col_texto(df, "uf")
    out["municipio_ibge"] = _col_municipio(df, depara)
    out["candidato_id"] = _col_candidato(df)
    out["nome_urna"] = _col_rotulo(df, "nome_urna")
    out["partido"] = _col_rotulo(df, "partido")
    return out[CANONICAL_COLUMNS].reset_index(drop=True)
