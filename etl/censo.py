"""Ingestão do Censo IBGE 2022 por município (offline-first, custo zero).

`normalize_censo(df) -> DataFrame` aceita variações conhecidas/típicas do
header IBGE/SIDRA por município (case-insensitive) e devolve o schema canônico (ordem exata):
    [ibge7, esc_sup, esc_med, esc_fund, renda_media, pobres_pct,
     idade_mediana, urbanizacao, pop]

- `ibge7` é string de 7 dígitos; inválido vira `""` + `UserWarning`
  (padrão de `etl.normalize`).
- Numéricos não-numéricos viram nulos anuláveis (`Float64`/`Int64`),
  nunca 0 — os gates reprovam nulos em vez de somar lixo.
- `check_censo_sum(df, total_oficial) -> list[str]`: compara a soma de
  `pop` com o total IBGE declarado; divergência devolve erro contendo
  "soma" (fail-closed: sem Censo auditado → "sem dado oficial").
- `register_censo_ingest(...)`: registra a ingestão no manifest com URL
  IBGE + SHA + `data` (ISO yyyy-mm-dd UTC) + `etl_version` (Task 4).
- `ingerir_censo(duckdb_path, manifest_path, ...)`: entrypoint da ingestão
  REAL — baixa o zip confirmado via `etl.fetch.download_dataset`
  (backoff/UA/resume/teto, sem reimplementar), extrai o CSV de municípios,
  normaliza, aplica o gate `TOTAL_CENSO_2022` fail-closed ANTES de qualquer
  escrita, grava `dim_municipio` no DuckDB e registra a ingestão.
"""

from __future__ import annotations

import re
import zipfile
from datetime import date, datetime, timezone
from pathlib import Path
from urllib.parse import unquote, urlparse

import duckdb
import pandas as pd

from etl import ETL_VERSION, fetch
from etl.ibge_dv import validar_serie_ibge
from etl.manifest import write_manifest
from etl.sources import CENSO_DATASETS, TOTAL_CENSO_2022

CANONICAL_CENSO_COLUMNS = [
    "ibge7",
    "esc_sup",
    "esc_med",
    "esc_fund",
    "renda_media",
    "pobres_pct",
    "idade_mediana",
    "urbanizacao",
    "pop",
]

# Variações conhecidas/típicas do header IBGE/SIDRA por município ->
# campo canônico (comparação upper + strip).
_COLUMN_ALIASES: dict[str, tuple[str, ...]] = {
    "ibge7": (
        "CD_MUN",
        "COD_MUNICIPIO",
        "CODIGO_MUNICIPIO",
        "CD_MUNICIPIO",
        "COD_MUNICIPIO_IBGE",
        "CD_GEOCODI",
        "GEOCODIGO",
        "IBGE7",
    ),
    "esc_sup": ("P_SUPERIOR", "PERC_SUPERIOR", "TX_ESC_SUP", "ESC_SUP", "SUPERIOR_PCT"),
    "esc_med": ("P_MEDIO", "PERC_MEDIO", "TX_ESC_MED", "ESC_MED", "MEDIO_PCT"),
    "esc_fund": (
        "P_FUNDAMENTAL",
        "PERC_FUNDAMENTAL",
        "TX_ESC_FUND",
        "ESC_FUND",
        "FUNDAMENTAL_PCT",
    ),
    "renda_media": (
        "RENDIMENTO_MEDIO",
        "RENDA_MEDIA",
        "VL_RENDA_MEDIA",
        "RENDA_MEDIA_DOM",
    ),
    "pobres_pct": ("TX_POBREZA", "POBRES_PCT", "POBREZA_PCT", "PROP_POBRES"),
    # IDADE_MEDIA é média aritmética, não mediana: fora do alias de
    # propósito (fail-closed — arquivo só com média gera idade_mediana
    # nula, nunca estatística errada rotulada de mediana).
    "idade_mediana": ("IDADE_MEDIANA", "IDADE_MED"),
    "urbanizacao": ("TX_URBANIZACAO", "URBANIZACAO", "URB_PCT", "GRAU_URBANIZACAO"),
    "pop": (
        "POP_RESIDENTE",
        "POPULACAO_RESIDENTE",
        "POPULACAO",
        "POP",
        "QT_POP",
        # V0001 é código de população em arquivos por setor censitário;
        # só vale aqui em agregados por município que o reutilizem.
        "V0001",
    ),
}

_FLOAT_FIELDS = (
    "esc_sup",
    "esc_med",
    "esc_fund",
    "renda_media",
    "pobres_pct",
    "idade_mediana",
    "urbanizacao",
)


def _pick_column(df: pd.DataFrame, field: str):
    """Devolve a coluna de `df` que corresponde ao campo canônico, ou None."""
    normalized = {str(c).strip().upper(): c for c in df.columns}
    for alias in _COLUMN_ALIASES[field]:
        if alias in normalized:
            return normalized[alias]
    if field.upper() in normalized:
        return normalized[field.upper()]
    return None


def normalize_censo(df: pd.DataFrame) -> pd.DataFrame:
    """Normaliza um DataFrame bruto do Censo IBGE para o schema canônico.

    Levanta `TypeError` se não for DataFrame e `ValueError` se não houver
    coluna de código de município (impossível fazer join com o TSE).
    """
    if not isinstance(df, pd.DataFrame):
        raise TypeError(f"df must be a pandas DataFrame, got {type(df).__name__}")
    if _pick_column(df, "ibge7") is None:
        raise ValueError("input sem coluna de municipio (CD_MUN)")

    out = pd.DataFrame(index=df.index)

    col = _pick_column(df, "ibge7")
    digits = (
        df[col]
        .astype("string")
        .fillna("")
        .str.strip()
        # Coluna float (leitura sem dtype): 3550308.0 -> 3550308 antes de
        # remover não-dígitos (sem isso viram 8 dígitos e são descartados).
        .str.replace(r"\.0$", "", regex=True)
        .str.replace(r"\D", "", regex=True)
    )
    # DV (ver etl/ibge_dv.py — fonte única; regra mod-10 no 7º dígito).
    bad = validar_serie_ibge(digits, "normalize_censo")
    out["ibge7"] = digits.where(~bad, "").str.zfill(7).replace("0000000", "")
    out["ibge7"] = out["ibge7"].astype("string")

    for field in _FLOAT_FIELDS:
        col = _pick_column(df, field)
        out[field] = (
            pd.to_numeric(df[col], errors="coerce").astype("Float64")
            if col is not None
            else pd.Series(pd.NA, index=df.index, dtype="Float64")
        )

    col = _pick_column(df, "pop")
    out["pop"] = (
        pd.to_numeric(df[col], errors="coerce").astype("Int64")
        if col is not None
        else pd.Series(pd.NA, index=df.index, dtype="Int64")
    )

    return out[CANONICAL_CENSO_COLUMNS].reset_index(drop=True)


def check_censo_sum(df: pd.DataFrame, total_oficial) -> list[str]:
    """Compara a soma de `pop` com o total IBGE declarado; vazio = ok.

    Nunca levanta por problema nos dados: qualquer falha vira item da
    lista. `total_oficial` precisa ser int (ou string só-dígitos);
    float/None/outros reprovam fail-closed em vez de truncar silencioso.
    Nulos em `pop` reprovam antes de qualquer soma.
    """
    if isinstance(total_oficial, bool):
        return [f"soma: total oficial inválido para o Censo ({total_oficial!r})"]
    if isinstance(total_oficial, int):
        expected = total_oficial
    elif (
        isinstance(total_oficial, str)
        and re.fullmatch(r"\d+", total_oficial.strip() or " ")
    ):
        expected = int(total_oficial.strip())
    else:
        return [f"soma: total oficial inválido para o Censo ({total_oficial!r})"]
    try:
        pop = df["pop"]
    except (KeyError, AttributeError, TypeError) as exc:
        return [f"soma: nao foi possivel ler pop do Censo ({exc})"]
    try:
        has_null = bool(pop.isna().any())
    except Exception as exc:
        return [f"soma: nao foi possivel checar nulos em pop ({exc})"]
    if has_null:
        n = int(pop.isna().sum())
        return [f"soma: {n} linha(s) com pop nulo/nao-numerico no Censo"]
    try:
        got = int(pop.sum(skipna=True))
    except Exception as exc:
        return [f"soma: nao foi possivel somar pop do Censo ({exc})"]
    if got != expected:
        return [
            f"soma pop diverge do total oficial IBGE: esperado {expected}, obtido {got}"
        ]
    return []


def register_censo_ingest(manifest_path, rows=None, sha256=None, dataset=None,
                          data=None) -> dict:
    """Registra a ingestão do Censo no manifest; devolve a entry.

    `dataset` default = primeira entrada de `CENSO_DATASETS` (Censo 2022).
    `sha256` deve ser o hash de 64-hex (calculado por
    `etl.fetch.download_dataset`); a validação fail-closed acontece em
    `write_manifest` (Task 6). URL ausente (None/vazia) levanta `ValueError`
    — nunca se registra proveniência sem fonte baixável.
    `data` é injetável p/ testes determinísticos (Task 4 EVOLVE-6):
    default None = hoje UTC (ISO yyyy-mm-dd, comportamento idêntico);
    com valor, grava-o como está (str) ou o ISO da data/datetime.
    """
    entry_meta = dataset if isinstance(dataset, dict) else CENSO_DATASETS[0]
    url = entry_meta.get("url")
    if not url:
        raise ValueError(
            "censo dataset sem url (None/vazia); ingestão bloqueada — "
            "sem dado oficial"
        )
    if data is None:
        data_iso = datetime.now(timezone.utc).date().isoformat()
    elif isinstance(data, datetime):
        # aware não-UTC: converte p/ UTC antes de extrair o dia (sem
        # isso, `.date()` gravaria o dia local em vez do dia UTC).
        if data.tzinfo is not None:
            data_iso = data.astimezone(timezone.utc).date().isoformat()
        else:
            data_iso = data.date().isoformat()
    elif isinstance(data, date):
        data_iso = data.isoformat()
    else:
        data_iso = str(data)
    entry = {
        "source_url": url,
        "sha256": sha256,
        "data": data_iso,
        "etl_version": ETL_VERSION,
        "dataset": entry_meta["dataset"],
        "ano": entry_meta["ano"],
        "nome": entry_meta["nome"],
    }
    if rows is not None:
        entry["rows"] = int(rows)
    write_manifest(manifest_path, entry)
    return entry


def ingerir_censo(duckdb_path, manifest_path, url=None, raw_dir=None,
                  dataset=None) -> dict:
    """Baixa o zip REAL do Censo IBGE e materializa `dim_municipio`.

    Pipeline: `fetch.download_dataset(url)` (backoff/UA/resume/teto — sem
    reimplementar) → extrai o CSV de municípios do zip → `normalize_censo`
    → gate `TOTAL_CENSO_2022` fail-closed → `dim_municipio` no DuckDB →
    `register_censo_ingest` no manifest. Devolve dict com `zip_path`,
    `zip_bytes`, `sha256`, `rows`, `csv_name`, `duckdb` e `entry`.

    `url` default = `url` da entrada (`dataset` ou `CENSO_DATASETS[0]`);
    ausente/None/vazia levanta `ValueError` antes de qualquer IO (sem dado
    oficial). `raw_dir` default = `fetch.RAW_ROOT` (lido na chamada, p/
    testes redirecionarem o sandbox). Zip sem membro `.csv` levanta
    `ValueError`; com vários, o MAIOR vence (determinístico). O CSV real é
    `;`-separado em latin1 (formato confirmado no FTP em 2026-10-10);
    header sem coluna de município levanta `ValueError` via
    `normalize_censo`. O gate da soma reprova ANTES de qualquer escrita —
    `duckdb_path`/`manifest_path` intocados (nunca dim sem total auditado).
    Custo zero: só stdlib + deps já declaradas (requests/pandas/duckdb).
    """
    entry_meta = dataset if isinstance(dataset, dict) else CENSO_DATASETS[0]
    src_url = url or entry_meta.get("url")
    if not isinstance(src_url, str) or not src_url:
        raise ValueError(
            "ingerir_censo: url pendente/ausente, ingestão bloqueada "
            "(sem dado oficial)"
        )
    base = Path(raw_dir) if raw_dir is not None else fetch.RAW_ROOT
    nome_zip = (
        unquote(urlparse(src_url).path.rsplit("/", 1)[-1])
        or "censo_2022_municipios.zip"
    )
    dest = Path(base) / nome_zip
    sha = fetch.download_dataset(src_url, dest)
    zip_bytes = dest.stat().st_size
    with zipfile.ZipFile(dest) as zf:
        csvs = [
            i for i in zf.infolist()
            if not i.is_dir() and i.filename.lower().endswith(".csv")
        ]
        if not csvs:
            raise ValueError(
                f"ingerir_censo: zip sem CSV de municípios em {src_url} "
                "(sem dado oficial)"
            )
        membro = max(csvs, key=lambda i: i.file_size)
        with zf.open(membro.filename) as fh:
            bruto = pd.read_csv(fh, sep=";", encoding="latin1", dtype="string")
    df = normalize_censo(bruto)
    erros = check_censo_sum(df, TOTAL_CENSO_2022)
    if erros:
        raise ValueError(
            "ingerir_censo: gate do Censo reprovou: " + "; ".join(erros)
        )
    db_path = Path(duckdb_path)
    db_path.parent.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect(str(db_path))
    try:
        con.register("censo_df", df)
        con.execute(
            "CREATE OR REPLACE TABLE dim_municipio AS SELECT * FROM censo_df"
        )
    finally:
        con.close()
    manifest_p = Path(manifest_path)
    manifest_p.parent.mkdir(parents=True, exist_ok=True)
    entry = register_censo_ingest(
        str(manifest_p), rows=len(df), sha256=sha, dataset=entry_meta)
    return {
        "zip_path": str(dest),
        "zip_bytes": zip_bytes,
        "sha256": sha,
        "rows": len(df),
        "csv_name": membro.filename.rsplit("/", 1)[-1],
        "duckdb": str(db_path),
        "entry": entry,
    }
