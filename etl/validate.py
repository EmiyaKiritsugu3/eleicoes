"""Quality gates + quarentena (offline-first, custo zero).

`run_gates(db_path, manifest_path=None, totais_oficiais=None) -> list[str]`:
lista de erros (vazia = ok). O ETL deve falhar quando não vazia e manter
a versão anterior.

Gates (spec §7):
1. soma: votos nulos/não-numéricos ou negativos reprovam; quando
   `totais_oficiais` é informado (dict `(ano, cargo, uf) -> total` ou
   `uf -> total`), a soma por UF no `fato_voto` deve bater com o total
   oficial — divergência devolve erro contendo "soma".
2. orfãos: fração de linhas de `fato_voto` sem `dim_candidato` acima de
   0,1% reprova.
3. manifest: `verify_manifest` falso (ou arquivo ausente) reprova.

`quarantine_invalid_csvs(raw_dir, quarantine_dir=None) -> list[Path]`:
move para `quarentena/` (padrão: `<raw_dir>/quarentena/`, i.e.
`data/raw/quarentena/` no repo) todo CSV com schema irreconhecível
(sem coluna de ano — `normalize_resultados` levantaria `ValueError` —
ou ilegível). Colunas extras desconhecidas são TOLERADAS (arquivos TSE
reais trazem dezenas de colunas que o normalizador ignora); quarentena
é para drift que quebra a normalização, nunca para crash. Arquivos sob
`data/raw/` nunca entram no build (que lê `data/curated/`), logo o
quarentenado fica excluído por construção.
"""

from __future__ import annotations

import shutil
from pathlib import Path

import duckdb
import pandas as pd

from etl.manifest import verify_manifest

_REPO_ROOT = Path(__file__).resolve().parent.parent

ORPHAN_THRESHOLD = 0.001  # spec: reprova "acima de 0,1%"

# Deve espelhar etl.normalize._COLUMN_ALIASES["ano"] (+ nome canônico).
_ANO_ALIASES = {"ANO_ELEICAO", "ANO"}


def _resolve_manifest(db_path: Path, manifest_path=None) -> Path | None:
    if manifest_path is not None:
        return Path(manifest_path)
    candidates = [
        db_path.parent / "manifest.json",
        _REPO_ROOT / "data" / "manifest.json",
        Path.cwd() / "data" / "manifest.json",
    ]
    for cand in candidates:
        if cand.is_file():
            return cand
    return None


def _tables(con) -> set[str]:
    rows = con.execute(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'main'"
    ).fetchall()
    return {str(r[0]).lower() for r in rows}


def _gate_sum(con, totais_oficiais) -> list[str]:
    errors: list[str] = []
    try:
        bad_null = con.execute(
            "SELECT COUNT(*) FROM fato_voto WHERE TRY_CAST(votos AS BIGINT) IS NULL"
        ).fetchone()[0]
    except Exception as exc:
        return [f"soma: nao foi possivel ler votos de fato_voto ({exc})"]
    if bad_null:
        errors.append(f"soma: {bad_null} linha(s) com votos nulos/nao-numericos em fato_voto")
    try:
        negatives = con.execute(
            "SELECT COUNT(*) FROM fato_voto WHERE TRY_CAST(votos AS BIGINT) < 0"
        ).fetchone()[0]
    except Exception as exc:
        errors.append(f"soma: nao foi possivel checar votos negativos ({exc})")
        return errors
    if negatives:
        errors.append(f"soma: {negatives} linha(s) com votos negativos em fato_voto")
    if totais_oficiais:
        try:
            rows = con.execute(
                "SELECT ano, cargo, uf, SUM(TRY_CAST(votos AS BIGINT)) FROM fato_voto "
                "GROUP BY ano, cargo, uf"
            ).fetchall()
        except Exception as exc:
            errors.append(f"soma: nao foi possivel agregar votos por UF ({exc})")
            return errors
        actual: dict[tuple, int] = {}
        actual_uf: dict[str, int] = {}
        for ano, cargo, uf, total in rows:
            key = (int(ano), str(cargo).strip().upper(), str(uf).strip().upper())
            value = int(total) if total is not None else 0
            actual[key] = value
            actual_uf[key[2]] = actual_uf.get(key[2], 0) + value
        for raw_key, expected in totais_oficiais.items():
            exp = int(expected)
            if isinstance(raw_key, (tuple, list)) and len(raw_key) == 3:
                key = (int(raw_key[0]), str(raw_key[1]).strip().upper(), str(raw_key[2]).strip().upper())
                got = actual.get(key, 0)
                label = f"{key[0]}/{key[1]}/{key[2]}"
            else:
                uf = str(raw_key).strip().upper()
                got = actual_uf.get(uf, 0)
                label = uf
            if got != exp:
                errors.append(
                    f"soma por UF diverge do total oficial em {label}: esperado {exp}, obtido {got}"
                )
    return errors


def _gate_orphans(con, tables: set[str]) -> list[str]:
    try:
        total = con.execute("SELECT COUNT(*) FROM fato_voto").fetchone()[0]
    except Exception as exc:
        return [f"orfaos: nao foi possivel contar fato_voto ({exc})"]
    if not total:
        return []
    if "dim_candidato" not in tables:
        return [f"orfaos: dim_candidato ausente, 100% de {total} linha(s) sem dimensao"]
    try:
        orphans = con.execute(
            "SELECT COUNT(*) FROM fato_voto f LEFT JOIN dim_candidato d "
            "ON f.candidato_id = d.candidato_id WHERE d.candidato_id IS NULL"
        ).fetchone()[0]
    except Exception as exc:
        return [f"orfaos: nao foi possivel checar fato sem dim ({exc})"]
    if orphans / total > ORPHAN_THRESHOLD:
        pct = 100 * orphans / total
        return [
            f"orfaos em fato_voto sem dim_candidato acima de 0,1%: "
            f"{pct:.2f}% ({orphans}/{total})"
        ]
    return []


def run_gates(db_path, manifest_path=None, totais_oficiais=None) -> list[str]:
    """Roda os quality gates sobre o DuckDB; devolve erros (vazia = ok)."""
    db_path = Path(db_path)
    errors: list[str] = []
    try:
        con = duckdb.connect(str(db_path), read_only=True)
    except Exception as exc:
        return [f"banco: nao foi possivel abrir {db_path} ({exc})"]
    try:
        tables = _tables(con)
        if "fato_voto" not in tables:
            return [f"banco: tabela fato_voto ausente em {db_path}"]
        errors.extend(_gate_sum(con, totais_oficiais))
        errors.extend(_gate_orphans(con, tables))
    finally:
        con.close()
    manifest = _resolve_manifest(db_path, manifest_path)
    if manifest is None:
        errors.append("manifest ausente: nenhum manifest.json localizado para validar")
    elif not verify_manifest(manifest):
        errors.append(f"manifest invalido: {manifest} reprovado em verify_manifest")
    return errors


def _csv_has_ano(path: Path) -> bool:
    """True se o header do CSV traz coluna de ano reconhecível."""
    for encoding in ("utf-8", "latin1"):
        for sep in (";", ","):
            try:
                df = pd.read_csv(path, sep=sep, encoding=encoding, dtype="string", nrows=0)
            except Exception:
                continue
            cols = {str(c).strip().upper() for c in df.columns}
            if cols & _ANO_ALIASES:
                return True
            if cols:  # header legível mas sem ano com este sep -> tenta próximo
                continue
            return False
    return False


def quarantine_invalid_csvs(raw_dir, quarantine_dir=None) -> list[Path]:
    """Move CSVs com schema irreconhecível para quarentena; devolve destinos."""
    raw = Path(raw_dir)
    if not raw.is_dir():
        return []
    qdir = Path(quarantine_dir) if quarantine_dir is not None else raw / "quarentena"
    qdir.mkdir(parents=True, exist_ok=True)
    moved: list[Path] = []
    for path in sorted(raw.glob("*.csv")):
        if path.resolve() == qdir.resolve() or qdir in path.resolve().parents:
            continue
        try:
            valid = _csv_has_ano(path)
        except Exception:
            valid = False
        if not valid:
            dest = qdir / path.name
            shutil.move(str(path), str(dest))
            moved.append(dest)
    return moved
