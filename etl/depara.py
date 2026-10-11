"""De-para oficial TSE→IBGE7 (EVOLVE-15, desbloqueio do fato real).

Fonte oficial (verificada 2026-10-11): dataset
`codigos-oficiais-de-uf-e-municipios-segundo-o-tse-e-o-ibge` (org TSE/SMG,
CC-BY no Portal de Dados Abertos), recurso `municipio_tse_ibge.zip` —
CSV Latin-1 `;`-quoted com `CD_MUNICIPIO_TSE` (4–5 dígitos, = formato do
`CD_MUNICIPIO` dos votos reais que `normalize_resultados` rejeitava
fail-closed) ↔ `CD_MUNICIPIO_IBGE` (IBGE7). Verificado: 5571 linhas,
bijeção 5571↔5571, DT_GERACAO 04/10/2026, `leiame.pdf` documentando o
layout (mesmas convenções dos votos: Latin-1, `;`, quoted).

Gates fail-closed (nunca chute de mapeamento):
- colunas `CD_MUNICIPIO_TSE`/`CD_MUNICIPIO_IBGE` ausentes → `ValueError`;
- vazio (só header) → `ValueError`;
- TSE fora de `^\\d{4,5}$` → `ValueError` (shape do voto real);
- IBGE7 com DV mod-10 inválido → `ValueError` (`dv_ok` de
  `etl.ibge_dv`, que inclui as 9 exceções oficiais);
- chave TSE ou IBGE duplicada → `ValueError` (bijection quebrada).
"""

from __future__ import annotations

import io
from datetime import date, datetime, timezone
from pathlib import Path

import pandas as pd

from etl.ibge_dv import dv_ok
from etl.sources import DEPARA_DATASET

# Re-export p/ conveniência (fonte única em `etl.sources`, sem fork).
DEPARA_CATALOG = DEPARA_DATASET["dataset"]
DEPARA_URL = DEPARA_DATASET["url"]

_COL_TSE = "CD_MUNICIPIO_TSE"
_COL_IBGE = "CD_MUNICIPIO_IBGE"


def _read_depara_frame(content):
    """Lê o CSV oficial p/ DataFrame (fail-closed em ilegível/vazio)."""
    if isinstance(content, str):
        try:
            return pd.read_csv(io.StringIO(content), sep=";", dtype="string")
        except pd.errors.EmptyDataError:
            raise ValueError("de-para: CSV vazio (sem dado oficial)")
        except pd.errors.ParserError as exc:
            raise ValueError(f"de-para: CSV ilegível ({exc}) (sem dado oficial)")
    if not isinstance(content, (bytes, bytearray)):
        raise TypeError(
            f"de-para: esperado bytes ou str, veio {type(content).__name__}")
    bruto = bytes(content)
    # utf-8-sig primeiro (BOM-aware; falha fail-fast em bytes latin1) —
    # latin1 decodifica tudo e nunca pode vir antes (cubic R3: BOM grudaria
    # no nome da 1ª coluna). Mesma ordem do leitor do Censo (`__main__`).
    for encoding in ("utf-8-sig", "utf-8", "latin1"):
        try:
            return pd.read_csv(io.BytesIO(bruto), sep=";", encoding=encoding,
                               dtype="string")
        except pd.errors.EmptyDataError:
            raise ValueError("de-para: CSV vazio (sem dado oficial)")
        except (UnicodeDecodeError, pd.errors.ParserError):
            continue
    raise ValueError("de-para: CSV ilegível (sem dado oficial)")


def _colunas_depara(df):
    """Extrai as séries TSE/IBGE validadas em shape (fail-closed)."""
    for exigida in (_COL_TSE, _COL_IBGE):
        if exigida not in set(df.columns):
            raise ValueError(f"de-para: coluna {exigida} ausente (sem dado oficial)")
    tse = df[_COL_TSE].astype("string").fillna("").str.strip()
    ibge = df[_COL_IBGE].astype("string").fillna("").str.strip()
    if len(df) == 0:
        raise ValueError("de-para: CSV vazio, só header (sem dado oficial)")
    fora_shape = tse[~tse.str.fullmatch(r"\d{4,5}")]
    if len(fora_shape) > 0:
        raise ValueError(
            f"de-para: {len(fora_shape)} código(s) TSE fora do padrão 4–5 "
            "dígitos (sem dado oficial)"
        )
    return tse, ibge


def parse_depara_csv(content) -> dict[str, str]:
    """Lê o CSV oficial e devolve `{tse5: ibge7}` validado (fail-closed).

    Aceita bytes (qualquer encoding entre latin1 — o oficial — utf-8-sig
    e utf-8) ou str. Chaves TSE canônicas zfill(5) nos dois lados do join
    (votos sem padding casam com o oficial). Valores IBGE7 com DV
    conferido um a um; duplicata em qualquer lado quebra a bijection.
    """
    df = _read_depara_frame(content)
    tse, ibge = _colunas_depara(df)
    # Chave canônica: zfill(5) nos dois lados do join — os votos reais
    # trazem o código sem padding ("3018"), o oficial pada ("03018").
    chaves = tse.str.zfill(5)
    ruins = ibge[~ibge.map(dv_ok)]
    if len(ruins) > 0:
        exemplos = ", ".join(ruins.tolist()[:3])
        raise ValueError(
            f"de-para: {len(ruins)} IBGE7 com DV inválido "
            f"(ex.: {exemplos}) (sem dado oficial)"
        )
    if chaves.duplicated().any() or ibge.duplicated().any():
        raise ValueError("de-para: chave TSE ou IBGE duplicada, bijection quebrada")
    return dict(zip(chaves.tolist(), ibge.tolist()))


def load_depara_csv(path) -> dict[str, str]:
    """Lê o CSV do disco (bytes) e devolve o mapeamento validado."""
    return parse_depara_csv(Path(path).read_bytes())


def register_depara_ingest(manifest_path, rows=None, sha256=None,
                           dataset=None, data=None, membro_csv=None) -> dict:
    """Registra a ingestão do de-para no manifest; devolve a entry.

    Espelha `register_censo_ingest` (mesmo contrato mínimo que o
    `_validate_entry` exige: `source_url` + `sha256` 64-hex; `data`
    injetável p/ testes determinísticos). URL ausente ou sha inválido
    levantam `ValueError` — nunca se registra proveniência sem fonte.
    `membro_csv` (cubic R3): o sha cobre o CSV EXTRAÍDO, não o zip da
    `source_url` — o basename do membro é gravado (`sha_origin`) p/ o
    hash ser reproduzível (extrair → hashear → comparar). Cria o parent
    do manifest (cubic R3: CLI registra antes do build criar o dir).
    """
    from etl.manifest import write_manifest

    entry_meta = dataset if isinstance(dataset, dict) else DEPARA_DATASET
    url = entry_meta.get("url")
    if not url:
        raise ValueError(
            "de-para dataset sem url (None/vazia); ingestão bloqueada — "
            "sem dado oficial"
        )
    if data is None:
        data_iso = datetime.now(timezone.utc).date().isoformat()
    elif isinstance(data, datetime):
        data_iso = (
            data.astimezone(timezone.utc).date().isoformat()
            if data.tzinfo is not None
            else data.date().isoformat()
        )
    elif isinstance(data, date):
        data_iso = data.isoformat()
    elif isinstance(data, str):
        try:
            data_iso = date.fromisoformat(data.strip()).isoformat()
        except ValueError:
            raise ValueError(
                f"register_depara_ingest: data inválida ({data!r}) — "
                "esperado ISO yyyy-mm-dd, date ou datetime (sem dado oficial)"
            )
    else:
        raise ValueError(
            f"register_depara_ingest: data inválida ({data!r}) (sem dado oficial)"
        )
    entry = {
        "source_url": url,
        "sha256": sha256,
        "sha_origin": "csv_extraido",
        "data": data_iso,
        "dataset": entry_meta.get("nome", "municipio_tse_ibge"),
        "tipo": "depara_tse_ibge",
        "rows": rows,
    }
    if membro_csv is not None:
        entry["membro_csv"] = str(membro_csv)
    Path(manifest_path).parent.mkdir(parents=True, exist_ok=True)
    write_manifest(str(manifest_path), entry)  # valida sha fail-closed
    return entry
