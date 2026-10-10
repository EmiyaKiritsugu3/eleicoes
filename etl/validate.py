"""Quality gates + quarentena (offline-first, custo zero).

`run_gates(db_path, manifest_path=None, totais_oficiais=None, fato_paths=None) -> list[str]`:
lista de erros (vazia = ok). Com `fato_paths`, cada fato precisa
conferir com o manifest resolvido (bytes-aware, EVOLVE-4 T2).

Contrato do chamador (orquestrador ETL, fora do escopo v1): se a lista
for não vazia, o ETL DEVE falhar a ingestão e manter a versão anterior
dos marts (nunca sobrescrever versão boa com dados reprovados). Para
habilitar a comparação externa (soma por UF == total oficial), o
orquestrador DEVE passar `totais_oficiais` (dict `(ano, cargo, uf) ->
total` ou `uf -> total`); sem eles roda só a integridade interna e um
`UserWarning` ("totais oficiais ausentes...") é emitido — explícito,
nunca silencioso (R1: em v1 não há orquestrador, fail-closed bricaria
o pipeline).

Gates (spec §7):
1. soma: votos nulos/não-numéricos ou negativos reprovam; quando
   `totais_oficiais` é informado, a soma por UF no `fato_voto` deve
   bater com o total oficial — divergência devolve erro contendo
   "soma"; grupo esperado ausente no `fato_voto` devolve erro
   "sem dado oficial ..." (nunca coage ausente para 0).
2. orfãos: fração de linhas de `fato_voto` sem `dim_candidato` acima de
   0,1% reprova.
3. manifest: `verify_manifest` falso reprova; sem manifest localizável
   (caminho explícito ou `<db dir>/manifest.json`) reprova fail-closed
   — nunca valida manifest de outro diretório por acidente.

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

import hashlib
import json
import shutil
import warnings
from datetime import datetime, timezone
from pathlib import Path

import duckdb
import pandas as pd

from etl.manifest import _validate_artifact_entry
from etl.manifest import verificar_fato_manifest, verify_manifest

ORPHAN_THRESHOLD = 0.001  # spec: reprova "acima de 0,1%"

# Deve espelhar etl.normalize._COLUMN_ALIASES["ano"] (+ nome canônico).
_ANO_ALIASES = {"ANO_ELEICAO", "ANO"}


def _resolve_manifest(db_path: Path, manifest_path=None) -> Path | None:
    """Manifest explícito ou `<db dir>/manifest.json`; senão None (fail-closed).

    Nunca cai para manifest de outro diretório (repo/CWD): validar o
    manifest errado seria aprovar proveniência que não é a do banco.
    """
    if manifest_path is not None:
        return Path(manifest_path)
    cand = db_path.parent / "manifest.json"
    return cand if cand.is_file() else None


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
    if totais_oficiais is not None:
        if not totais_oficiais:
            # Dict explícito vazio: fail-closed — nada para comparar.
            errors.append(
                "soma: totais oficiais vazios, comparacao externa impossivel"
            )
            return errors
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
            if total is None:
                continue  # grupo sem votos válidos: já coberto pelo gate de nulos
            key = (int(ano), str(cargo).strip().upper(), str(uf).strip().upper())
            actual[key] = int(total)
            actual_uf[key[2]] = actual_uf.get(key[2], 0) + int(total)
        for raw_key, expected in totais_oficiais.items():
            try:
                exp = int(expected)
            except (ValueError, TypeError):
                errors.append(f"soma: total oficial inválido para {raw_key!r}")
                continue
            if isinstance(raw_key, (tuple, list)) and len(raw_key) == 3:
                key = (int(raw_key[0]), str(raw_key[1]).strip().upper(), str(raw_key[2]).strip().upper())
                label = f"{key[0]}/{key[1]}/{key[2]}"
                if key not in actual:
                    errors.append(
                        f"sem dado oficial em fato_voto para {label}: "
                        f"esperado {exp}, grupo ausente"
                    )
                    continue
                got = actual[key]
            else:
                uf = str(raw_key).strip().upper()
                label = uf
                if uf not in actual_uf:
                    errors.append(
                        f"sem dado oficial em fato_voto para {label}: "
                        f"esperado {exp}, grupo ausente"
                    )
                    continue
                got = actual_uf[uf]
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
    # M8: matemática inteira (orphans*1000 > total == fração acima de
    # ORPHAN_THRESHOLD), sem float.
    if orphans * 1000 > total:
        pct = 100 * orphans / total
        return [
            f"orfaos em fato_voto sem dim_candidato acima de 0,1%: "
            f"{pct:.2f}% ({orphans}/{total})"
        ]
    return []


def _fato_artifact_ok(doc: dict, fato_path) -> bool:
    """True iff o mirror atesta os bytes do fato via `artifacts` (T2 fix P1-A).

    Segunda perna da atestação bytes-aware: cobre o fato publicado cujo
    mirror já é cópia do canônico (só-ingestions TSE + `artifacts`, sem
    ingestão do fato) — rebuild saudável passa pelos bytes atestados.
    Exige entry estruturalmente válida (`_validate_artifact_entry`,
    fail-closed contra traversal/malformada) com `arquivo` == nome do
    fato e `sha256`+`size_bytes` conferindo com os bytes atuais. Fato
    novo reprova aqui e na perna de ingestão (crash detection
    intacta); fato sem atestação nenhuma reprova nas duas.
    """
    try:
        raw = Path(fato_path).read_bytes()
    except OSError:
        return False
    artifacts = doc.get("artifacts")
    if not isinstance(artifacts, list):
        return False
    nome = Path(fato_path).name
    digest = hashlib.sha256(raw).hexdigest()
    for entry in artifacts:
        if not isinstance(entry, dict) or entry.get("arquivo") != nome:
            continue
        try:
            _validate_artifact_entry(entry)
        except ValueError:
            continue
        if entry.get("size_bytes") != len(raw):
            continue
        sha = entry.get("sha256")
        if isinstance(sha, str) and sha.lower() == digest:
            return True
    return False


def _gate_fatos(manifest, fato_paths) -> list[str]:
    """Erros bytes-aware: cada fato precisa conferir com o manifest (EVOLVE-4 T2).

    Delega ao predicado `verificar_fato_manifest` (módulo-folha
    `etl.manifest` — sem ciclo de import): fato novo + manifest velho
    (crash entre passos) reprova fail-closed em pt-BR. Aceita também a
    atestação via `artifacts` (`_fato_artifact_ok`, fix P1-A): o mirror
    publicado é cópia do canônico e não carrega ingestão do fato, mas
    atesta seus bytes — sem essa perna, rebuilds saudáveis reprovariam.
    Sem manifest localizável não há baseline p/ comparar bytes — nesse
    caso o gate de manifest já reprovou (bootstrap seguro documentado,
    T2 fix P1-B: sem mirror anterior não há estado rasgado a detectar;
    o primeiro build atesta os bytes de forma fresca via
    `register_served_artifacts`, e um atacante com escrita no fs derrota
    qualquer gate — a fronteira é o acesso ao fs, não o predicado);
    então ausente aqui é `[]`, nunca verde silencioso do gate total.
    Erros começam por "fato" (nunca "manifest") para sobreviverem ao
    filtro do `build_all`, que só exclui o gate de forma.
    """
    if isinstance(fato_paths, (str, Path)):
        fato_paths = [fato_paths]
    errors: list[str] = []
    if manifest is None or not Path(manifest).is_file():
        return errors
    try:
        doc = json.loads(Path(manifest).read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        doc = None
    if not isinstance(doc, dict):
        doc = None
    for fato_path in fato_paths:
        if verificar_fato_manifest(manifest, fato_path):
            continue
        if doc is not None and _fato_artifact_ok(doc, fato_path):
            continue
        errors.append(
            f"fato inconsistente com o manifest: {fato_path} (sha dos "
            "bytes diverge da ingestão — possível crash entre fato e "
            "manifest; o rerun repara)"
        )
    return errors


def run_gates(db_path, manifest_path=None, totais_oficiais=None,
              fato_paths=None) -> list[str]:
    """Roda os quality gates sobre o DuckDB; devolve erros (vazia = ok).

    Nunca levanta por problema nos dados: qualquer falha vira item da
    lista (contrato `-> list[str]`). Sem `totais_oficiais`, emite
    `UserWarning` e checa só integridade interna. `fato_paths=None`
    (default) preserva o comportamento anterior; com uma lista de
    fatos, cada um precisa conferir com o manifest resolvido
    (`_gate_fatos`, bytes-aware fail-closed).
    """
    db_path = Path(db_path)
    errors: list[str] = []
    if totais_oficiais is None:
        warnings.warn(
            "totais oficiais ausentes: comparacao externa pendente",
            UserWarning,
            stacklevel=2,
        )
    try:
        con = duckdb.connect(str(db_path), read_only=True)
    except Exception as exc:
        return [f"banco: nao foi possivel abrir {db_path} ({exc})"]
    try:
        try:
            tables = _tables(con)
        except Exception as exc:
            return [f"banco: nao foi possivel listar tabelas em {db_path} ({exc})"]
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
    if fato_paths is not None:
        errors.extend(_gate_fatos(manifest, fato_paths))
    return errors


def _csv_has_ano(path: Path) -> bool:
    """True se o header do CSV traz coluna de ano reconhecível."""
    for encoding in ("utf-8-sig", "utf-8", "latin1"):
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
    """Move CSVs com schema irreconhecível para quarentena; devolve destinos.

    Quarentena de raw é pré-gate: roda antes de qualquer gate/fato.
    """
    raw = Path(raw_dir)
    if not raw.is_dir():
        return []
    qdir = Path(quarantine_dir) if quarantine_dir is not None else raw / "quarentena"
    if qdir.resolve() == raw.resolve():
        raise ValueError(f"quarantine_dir ({qdir}) deve ser diferente de raw_dir ({raw})")
    qdir.mkdir(parents=True, exist_ok=True)
    moved: list[Path] = []
    for path in sorted(raw.glob("*.[Cc][Ss][Vv]")):
        if path.resolve() == qdir.resolve() or qdir in path.resolve().parents:
            continue
        try:
            valid = _csv_has_ano(path)
        except Exception:
            valid = False
        if not valid:
            dest = qdir / path.name
            if dest.exists():
                stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%f")
                dest = qdir / f"{path.stem}.{stamp}.csv"
                n = 1
                while dest.exists():
                    n += 1
                    dest = qdir / f"{path.stem}.{stamp}.{n}.csv"
            shutil.move(str(path), str(dest))
            moved.append(dest)
    return moved
