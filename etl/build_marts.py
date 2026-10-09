"""Construção dos marts: Parquet particionado + DuckDB + agregados JSON (custo zero).

`build_all(curated_dir, db_path, manifest_path)`:
1. Lê `*.parquet`/`*.csv` sob `curated_dir` (CSVs TSE: `;`, latin1/utf-8);
   frames já canônicos são aproveitados, demais passam por `normalize_resultados`.
2. Escreve Parquet particionado `ano=/cargo=/uf=` em `curated_dir`.
3. Cria o DuckDB com `fato_voto`, `dim_candidato`, `fato_eleitorado` e
   `fato_fin` (eleitorado/finanças ficam com schema vazio quando não houver
   fonte — caso do V1, só votação nominal).
4. Escreve agregados JSON em `web/public/data/` (raiz do repo).
5. Registra a fonte oficial (campo `url` CDN de `V1_DATASETS`, Task 2) no manifest.

É idempotente e tolera `curated_dir` vazio (cria tabelas/JSONs vazios).
"""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path

import duckdb
import pandas as pd

from etl.manifest import write_manifest
from etl.normalize import CANONICAL_COLUMNS, normalize_resultados
from etl.sources import V1_DATASETS

_REPO_ROOT = Path(__file__).resolve().parent.parent
WEB_DATA_DIR = _REPO_ROOT / "web" / "public" / "data"

ELEITORADO_SCHEMA = ["ano", "uf", "municipio_ibge", "eleitorado", "abstencoes"]
FIN_SCHEMA = ["ano", "candidato_id", "receita", "despesa"]


def _empty_canonical() -> pd.DataFrame:
    out = pd.DataFrame({c: pd.Series(dtype="string") for c in CANONICAL_COLUMNS})
    out["ano"] = out["ano"].astype("int64")
    out["turno"] = out["turno"].astype("int64")
    out["votos"] = out["votos"].astype("int64")
    return out[CANONICAL_COLUMNS]


def _is_canonical(df: pd.DataFrame) -> bool:
    return list(df.columns) == CANONICAL_COLUMNS


def _read_input_file(path: Path) -> pd.DataFrame | None:
    try:
        if path.suffix.lower() == ".parquet":
            return pd.read_parquet(path)
        if path.suffix.lower() == ".csv":
            for encoding in ("utf-8", "latin1"):
                try:
                    return pd.read_csv(path, sep=";", encoding=encoding, dtype="string")
                except (UnicodeDecodeError, pd.errors.ParserError):
                    continue
            return pd.read_csv(path, sep=",", encoding="latin1", dtype="string")
    except Exception:
        return None
    return None


def _load_canonical(curated_dir: Path) -> pd.DataFrame:
    frames: list[pd.DataFrame] = []
    if curated_dir.is_dir():
        for path in sorted(curated_dir.rglob("*")):
            if path.is_file() and path.suffix.lower() in (".parquet", ".csv"):
                df = _read_input_file(path)
                if df is None or df.empty:
                    continue
                frames.append(df if _is_canonical(df) else normalize_resultados(df))
    if not frames:
        return _empty_canonical()
    out = pd.concat(frames, ignore_index=True)
    return out if _is_canonical(out) else normalize_resultados(out)


def _safe_part(value: str) -> str:
    return str(value).strip().replace(os.sep, "_").replace("/", "_") or "ND"


def _write_partitioned_parquet(df: pd.DataFrame, curated_dir: Path) -> None:
    curated_dir.mkdir(parents=True, exist_ok=True)
    if df.empty:
        return
    for (ano, cargo, uf), part in df.groupby(["ano", "cargo", "uf"], sort=True):
        dest = (
            curated_dir
            / f"ano={ano}"
            / f"cargo={_safe_part(cargo)}"
            / f"uf={_safe_part(uf)}"
            / "data.parquet"
        )
        dest.parent.mkdir(parents=True, exist_ok=True)
        part[CANONICAL_COLUMNS].to_parquet(dest, index=False)


def _write_duckdb(df: pd.DataFrame, db_path: Path) -> None:
    db_path = Path(db_path)
    db_path.parent.mkdir(parents=True, exist_ok=True)
    dim = (
        df[["candidato_id", "nome_urna", "partido"]]
        .drop_duplicates()
        .reset_index(drop=True)
    )
    con = duckdb.connect(str(db_path))
    try:
        con.register("fato_df", df[CANONICAL_COLUMNS])
        con.register("dim_df", dim)
        con.execute("CREATE OR REPLACE TABLE fato_voto AS SELECT * FROM fato_df")
        con.execute("CREATE OR REPLACE TABLE dim_candidato AS SELECT * FROM dim_df")
        con.execute(
            "CREATE OR REPLACE TABLE fato_eleitorado ("
            "ano BIGINT, uf VARCHAR, municipio_ibge VARCHAR, "
            "eleitorado BIGINT, abstencoes BIGINT)"
        )
        con.execute(
            "CREATE OR REPLACE TABLE fato_fin ("
            "ano BIGINT, candidato_id VARCHAR, receita DOUBLE, despesa DOUBLE)"
        )
    finally:
        con.close()


def _write_json_aggs(df: pd.DataFrame, web_data_dir: Path = WEB_DATA_DIR) -> None:
    web_data_dir.mkdir(parents=True, exist_ok=True)
    total_votos = int(df["votos"].sum()) if not df.empty else 0
    anos = sorted(int(a) for a in df["ano"].unique().tolist()) if not df.empty else []
    resumo = {
        "total_votos": total_votos,
        "total_linhas": int(len(df)),
        "anos": anos,
        "tabelas": ["fato_voto", "dim_candidato", "fato_eleitorado", "fato_fin"],
    }
    if df.empty:
        por_uf: list[dict] = []
        por_candidato: list[dict] = []
    else:
        g_uf = df.groupby(["ano", "cargo", "uf"], as_index=False)["votos"].sum()
        por_uf = [
            {"ano": int(r.ano), "cargo": r.cargo, "uf": r.uf, "votos": int(r.votos)}
            for r in g_uf.sort_values(["ano", "cargo", "uf"]).itertuples()
        ]
        g_cand = df.groupby(["candidato_id", "nome_urna", "partido"], as_index=False)[
            "votos"
        ].sum()
        por_candidato = [
            {
                "candidato_id": r.candidato_id,
                "nome_urna": r.nome_urna,
                "partido": r.partido,
                "votos": int(r.votos),
            }
            for r in g_cand.sort_values("votos", ascending=False).itertuples()
        ]
    (web_data_dir / "resumo.json").write_text(
        json.dumps(resumo, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (web_data_dir / "por_uf.json").write_text(
        json.dumps(por_uf, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (web_data_dir / "por_candidato.json").write_text(
        json.dumps(por_candidato, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def _register_sources(df: pd.DataFrame, manifest_path) -> None:
    """Registra a fonte oficial (campo `url` CDN da Task 2) no manifest."""
    anos = sorted(int(a) for a in df["ano"].unique().tolist()) if not df.empty else []
    entries = [e for e in V1_DATASETS if e["ano"] in anos] if anos else [V1_DATASETS[0]]
    for entry in entries:
        if anos:
            payload = df[df["ano"] == entry["ano"]][CANONICAL_COLUMNS].to_csv(index=False)
        else:
            payload = ""
        sha = hashlib.sha256(payload.encode("utf-8")).hexdigest()
        write_manifest(
            manifest_path,
            {
                "source_url": entry["url"],  # ruling: fonte = campo `url` (CDN)
                "sha256": sha,
                "dataset": entry["dataset"],
                "ano": entry["ano"],
                "cargo": entry["cargo"],
                "tipo": entry["tipo"],
                "rows": int((df["ano"] == entry["ano"]).sum()) if anos else 0,
            },
        )


def build_all(curated_dir, db_path, manifest_path) -> None:
    """Pipeline completo: Parquet particionado + DuckDB + JSONs + manifest."""
    curated = Path(curated_dir)
    df = _load_canonical(curated)
    _write_partitioned_parquet(df, curated)
    _write_duckdb(df, Path(db_path))
    _write_json_aggs(df)
    _register_sources(df, manifest_path)
