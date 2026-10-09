"""Construção dos marts: Parquet particionado + DuckDB + agregados JSON (custo zero).

`build_all(curated_dir, db_path, manifest_path)`:
1. Lê `*.parquet`/`*.csv` sob `curated_dir` (CSVs TSE: `;`, latin1/utf-8);
   frames já canônicos são aproveitados, demais passam por `normalize_resultados`.
2. Escreve Parquet particionado `ano=/cargo=/uf=` em `curated_dir`.
3. Cria o DuckDB com `fato_voto`, `dim_candidato`, `fato_eleitorado` e
   `fato_fin` (eleitorado/finanças ficam com schema vazio quando não houver
   fonte — caso do V1, só votação nominal).
4. Escreve agregados JSON em `web/public/data/` (raiz do repo),
   redirecionável via `web_data_dir`.
5. Registra a fonte oficial (campo `url` CDN de `V1_DATASETS`, Task 2) no manifest.

É idempotente e tolera `curated_dir` vazio (cria tabelas/JSONs vazios).
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import warnings
from datetime import datetime, timezone
from pathlib import Path

import duckdb
import pandas as pd

from etl import ETL_VERSION
from etl.manifest import _validate_entry, load_manifest
from etl.normalize import CANONICAL_COLUMNS, normalize_resultados
from etl.sources import V1_DATASETS
from etl.validate import run_gates

_REPO_ROOT = Path(__file__).resolve().parent.parent
WEB_DATA_DIR = _REPO_ROOT / "web" / "public" / "data"
_CAPITAIS_PATH = Path(__file__).resolve().parent / "capitais_ibge.json"


def _load_capitais() -> set:
    """Códigos IBGE (7 dígitos) das 27 capitais (E8).

    Falha aberta com `UserWarning` se o arquivo estiver ausente ou
    corrompido — o build não deve derrubar por falta do filtro, mas o
    operador precisa saber que o escopo de prefeito não foi aplicado.
    """
    try:
        codes = json.loads(_CAPITAIS_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        warnings.warn(
            f"build_marts: capitais_ibge.json ilegível ({exc}); "
            "filtro de prefeito desativado",
            UserWarning,
            stacklevel=3,
        )
        return set()
    return {str(c) for c in codes}


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
            for encoding in ("utf-8-sig", "utf-8", "latin1"):
                try:
                    return pd.read_csv(path, sep=";", encoding=encoding, dtype="string")
                except (UnicodeDecodeError, pd.errors.ParserError):
                    continue
            return pd.read_csv(path, sep=",", encoding="latin1", dtype="string")
    except Exception as exc:
        warnings.warn(
            f"build_marts: skipping unreadable file {path.name}: {exc}",
            UserWarning,
            stacklevel=3,
        )
        return None
    return None


def _is_generated(path: Path) -> bool:
    """True se o arquivo foi escrito pelo próprio build (partição `ano=`)."""
    return any(part.startswith("ano=") for part in path.parts)


def _load_canonical(curated_dir: Path) -> pd.DataFrame:
    frames: list[pd.DataFrame] = []
    if curated_dir.is_dir():
        paths = sorted(
            p
            for p in curated_dir.rglob("*")
            if p.is_file() and p.suffix.lower() in (".parquet", ".csv")
        )
        # Idempotência: numa re-ingestão no mesmo dir, os Parquet particionados
        # (`ano=/.../data.parquet`) escritos pelo build anterior duplicariam os
        # votos se lidos junto com as fontes. Prefere as fontes; só lê os
        # gerados quando não há fonte (dir só com partições).
        sources = [p for p in paths if not _is_generated(p)]
        for path in sources or paths:
            df = _read_input_file(path)
            if df is None:
                continue
            if df.empty:
                warnings.warn(
                    f"build_marts: arquivo vazio ignorado: {path.name}",
                    UserWarning,
                    stacklevel=2,
                )
                continue
            try:
                frames.append(df if _is_canonical(df) else normalize_resultados(df))
            except ValueError as exc:
                warnings.warn(
                    f"build_marts: skipping file with drifted header {path.name}: {exc}",
                    UserWarning,
                    stacklevel=2,
                )
                continue
    if not frames:
        return _empty_canonical()
    out = pd.concat(frames, ignore_index=True)
    out = out if _is_canonical(out) else normalize_resultados(out)
    # E8: prefeito restrito às 27 capitais; demais cargos intactos.
    capitais = _load_capitais()
    if capitais:
        is_prefeito_fora = (out["cargo"].astype(str).str.upper() == "PREFEITO") & (
            ~out["municipio_ibge"].astype(str).isin(capitais)
        )
        out = out[~is_prefeito_fora].reset_index(drop=True)
    return out


def _safe_part(value: str) -> str:
    return str(value).strip().replace(os.sep, "_").replace("/", "_") or "ND"


def _write_partitioned_parquet(df: pd.DataFrame, curated_dir: Path) -> None:
    curated_dir.mkdir(parents=True, exist_ok=True)
    # Idempotência (E6): remove as árvores `ano=*/` geradas por builds
    # anteriores para que fonte encolhida não ressuscite partições
    # obsoletas. Só o gerado — nunca CSVs fonte (nome `ano=`).
    for child in sorted(curated_dir.iterdir()):
        if not child.name.startswith("ano="):
            continue
        if child.is_symlink() or child.is_file():
            child.unlink()
        elif child.is_dir():
            shutil.rmtree(child)
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


def _dedupe_key(entry: dict) -> tuple:
    """Chave de idempotência da entry: `(ano, cargo.upper(), source_url)`."""
    return (entry.get("ano"), str(entry.get("cargo", "")).upper(),
            entry.get("source_url"))


def _read_existing_ingestions(manifest_path) -> list:
    """Ingestions já registradas; tolera ausente/vazio/corrompido.

    Arquivo corrompido é preservado como `<path>.corrupt.<UTC-ts>` antes
    de recomeçar (mesmo contrato de `write_manifest`, Task 6).
    """
    manifest_file = Path(manifest_path)
    try:
        loaded = load_manifest(manifest_file)
    except FileNotFoundError:
        return []
    except (json.JSONDecodeError, OSError, UnicodeDecodeError):
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S")
        manifest_file.rename(f"{manifest_file}.corrupt.{stamp}")
        return []
    if not isinstance(loaded, dict):
        return []
    ingestions = loaded.get("ingestions", [])
    return ingestions if isinstance(ingestions, list) else []


def _matched_entries(df: pd.DataFrame) -> list[dict]:
    """Entries V1 que correspondem aos pares `(ano, cargo)` presentes no df.

    Match por `(ano, cargo.upper())` (df usa cargo em MAIÚSCULAS, V1 em
    minúsculas). Qualquer par sem correspondência no V1 levanta `ValueError`
    — fail-closed antes de qualquer escrita (E5).
    """
    if df.empty:
        return []
    pairs = {
        (int(a), str(c).upper())
        for a, c in zip(df["ano"].tolist(), df["cargo"].tolist())
    }
    known = {(e["ano"], e["cargo"].upper()) for e in V1_DATASETS}
    unmatched = sorted(pairs - known)
    if unmatched:
        raise ValueError(
            "build_marts: pares (ano, cargo) fora do escopo V1: "
            + ", ".join(f"({a}, {c})" for a, c in unmatched)
        )
    return [e for e in V1_DATASETS if (e["ano"], e["cargo"].upper()) in pairs]


def _register_sources(df: pd.DataFrame, manifest_path, source_shas=None) -> None:
    """Registra uma ingestão por par `(ano, cargo)` presente no df (E4).

    `source_shas` mapeia `(ano, CARGO_MAIÚSCULO)` → sha256 do ZIP de origem;
    com match, a entry usa esse sha com `sha_origin="source"`, senão o sha do
    CSV derivado com `sha_origin="derived"`. Cada entry leva ainda `data`
    (ISO yyyy-mm-dd UTC, M15) e `etl_version` (M15). `rows` conta só as
    linhas do próprio par (M16). df vazio escreve `{"ingestions": []}` (E5).
    Tolerante a `votos` nulo (contrato Task 2: só usa ano/cargo + CSV).
    Idempotente (E6): dedupe por `(ano, cargo.upper(), source_url)` mantendo
    a última — rebuild com a mesma fonte atualiza em vez de duplicar; runs
    distintas (outro par ou outra fonte) preservam o histórico.
    """
    if df.empty:
        Path(manifest_path).write_text(
            json.dumps({"ingestions": []}, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        return
    source_shas = source_shas or {}
    entries = _matched_entries(df)
    cargos_upper = df["cargo"].astype(str).str.upper()
    today = datetime.now(timezone.utc).date().isoformat()
    new_entries = []
    for entry in entries:
        cargo_upper = entry["cargo"].upper()
        mask = (df["ano"] == entry["ano"]) & (cargos_upper == cargo_upper)
        key = (entry["ano"], cargo_upper)
        if key in source_shas:
            sha, origin = source_shas[key], "source"
        else:
            payload = df[mask][CANONICAL_COLUMNS].to_csv(index=False)
            sha, origin = hashlib.sha256(payload.encode("utf-8")).hexdigest(), "derived"
        new_entries.append(
            {
                "source_url": entry["url"],  # ruling: fonte = campo `url` (CDN)
                "sha256": sha,
                "sha_origin": origin,
                "data": today,
                "etl_version": ETL_VERSION,
                "dataset": entry["dataset"],
                "ano": entry["ano"],
                "cargo": entry["cargo"],
                "tipo": entry["tipo"],
                "rows": int(mask.sum()),
            }
        )
    for new_entry in new_entries:
        _validate_entry(new_entry)  # fail-closed Task 6 antes de escrever
    merged = _read_existing_ingestions(manifest_path) + new_entries
    by_key: dict = {}
    for item in merged:
        if isinstance(item, dict):
            by_key[_dedupe_key(item)] = item
    deduped = list(by_key.values())
    legacy = [item for item in merged if not isinstance(item, dict)]
    manifest_file = Path(manifest_path)
    tmp_path = f"{manifest_file}.tmp"
    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump({"ingestions": deduped + legacy}, f, ensure_ascii=False,
                  indent=2)
    os.replace(tmp_path, manifest_file)


def build_all(curated_dir, db_path, manifest_path, web_data_dir=None,
              source_shas=None) -> None:
    """Pipeline completo: Parquet particionado + DuckDB + JSONs + manifest.

    `web_data_dir` redireciona os agregados JSON (padrão: `web/public/data/`
    na raiz do repo); útil em testes para não mutar a árvore do repo.
    O manifest canônico é `manifest_path`; uma cópia idêntica é escrita em
    `<web_data_dir>/manifest.json` para a frente pública ler `/data/manifest.json`
    (mesmo conteúdo, escrita única a partir do canônico — R2).
    `source_shas` mapeia `(ano, CARGO_MAIÚSCULO)` → sha256 do ZIP de origem
    (threading E4; Tasks 5 e 7 consomem). Pares `(ano, cargo)` fora do V1
    levantam `ValueError` antes de qualquer escrita. Após o DuckDB e antes
    dos JSONs/manifest, os quality gates (`run_gates`) são aplicados sobre
    a integridade interna (soma/órfãos); qualquer erro levanta
    `RuntimeError` com as saídas públicas anteriores intactas (C2). O gate
    de manifest é excluído aqui — o manifest desta ingestão ainda não foi
    escrito (vai em `_register_sources`, após os JSONs) — e a ausência de
    totais oficiais é só `UserWarning` (contrato `run_gates`), nunca erro.
    """
    curated = Path(curated_dir)
    df = _load_canonical(curated)
    _matched_entries(df)  # pré-checagem fail-closed: antes de qualquer escrita
    _write_partitioned_parquet(df, curated)
    _write_duckdb(df, Path(db_path))
    gate_errors = run_gates(Path(db_path), manifest_path=None)
    gate_errors = [e for e in gate_errors if not e.startswith("manifest")]
    if gate_errors:
        raise RuntimeError(f"gates reprovados: {'; '.join(gate_errors)}")
    web_dir = Path(web_data_dir) if web_data_dir is not None else WEB_DATA_DIR
    _write_json_aggs(df, web_dir)
    _register_sources(df, manifest_path, source_shas=source_shas)
    # Cópia idêntica p/ a frente pública (manifest_path segue canônico).
    web_dir.mkdir(parents=True, exist_ok=True)
    (web_dir / "manifest.json").write_bytes(Path(manifest_path).read_bytes())
