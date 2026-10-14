"""Construção dos marts: Parquet particionado + DuckDB + agregados JSON (custo zero).

`build_all(curated_dir, db_path, manifest_path)`:
1. Lê `*.parquet`/`*.csv` sob `curated_dir` (CSVs TSE: `;`, latin1/utf-8);
   frames já canônicos são aproveitados, demais passam por `normalize_resultados`.
2. Escreve Parquet particionado `ano=/cargo=/uf=` em `curated_dir`.
3. Cria o DuckDB com `fato_voto`, `dim_candidato`, `fato_eleitorado` e
   `fato_fin` (eleitorado fica com schema vazio quando não houver
   fonte — caso do V1, só votação nominal; `fato_fin` segue vazio sem
   `fin_df`, preenchido com o canônico de `normalize_prestacao` quando
   dado) + `dim_ente`/`fato_gov`/`fato_transp_federal` (vazios sem
   `gov_df`/`cgu_df`).
4. Escreve agregados JSON em `web/public/data/` (raiz do repo),
   redirecionável via `web_data_dir`: o trio V1
   (`resumo`/`por_uf`/`por_candidato`) + `gov_por_ente.json`/
   `gov_serie.json`/`fin_por_candidato.json` (vazios `[]` sem quadros).
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
from etl.censo import CENSO_ARTIFACT_FILENAME, build_censo_artifact_entry
from etl.entes import load_entes
from etl.manifest import _dedupe_key, _validate_entry, load_manifest
from etl.normalize import CANONICAL_COLUMNS, normalize_resultados
from etl.prestacao import PRESTACAO_CANONICAL
from etl.siconfi import SICONFI_CANONICAL
from etl.sources import CENSO_DATASETS, V1_DATASETS
from etl.transparencia import CGU_CANONICAL
from etl.validate import run_gates

_REPO_ROOT = Path(__file__).resolve().parent.parent
WEB_DATA_DIR = _REPO_ROOT / "web" / "public" / "data"
_CAPITAIS_PATH = Path(__file__).resolve().parent / "capitais_ibge.json"


def _load_capitais() -> set:
    """Códigos IBGE (7 dígitos) das 27 capitais (E8).

    Fail-closed: arquivo ausente levanta `FileNotFoundError`; JSON
    ilegível ou fora do formato (lista de 27 strings únicas de 7
    dígitos) levanta `ValueError`. O filtro de prefeito nunca é
    desativado silenciosamente — sem escopo válido, o build falha em
    vez de deixar prefeito do interior vazar para os marts.
    """
    try:
        codes = json.loads(_CAPITAIS_PATH.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise FileNotFoundError(
            "build_marts: arquivo de escopo ausente "
            f"({_CAPITAIS_PATH}); prefeito restrito às 27 capitais (E8)"
        )
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(
            "build_marts: escopo de capitais ilegível "
            f"({_CAPITAIS_PATH}): {exc}"
        ) from exc
    if (
        not isinstance(codes, list)
        or len(codes) != 27
        or len(set(map(str, codes))) != 27
        or not all(
            isinstance(c, str) and len(c) == 7 and c.isdigit() for c in codes
        )
    ):
        raise ValueError(
            "build_marts: escopo de capitais inválido "
            f"({_CAPITAIS_PATH}): esperada lista de 27 strings IBGE "
            "de 7 dígitos únicas"
        )
    return set(codes)


def _empty_canonical() -> pd.DataFrame:
    out = pd.DataFrame({c: pd.Series(dtype="string") for c in CANONICAL_COLUMNS})
    out["ano"] = out["ano"].astype("int64")
    out["turno"] = out["turno"].astype("int64")
    out["votos"] = out["votos"].astype("int64")
    return out[CANONICAL_COLUMNS]


_GOV_MONETARIAS = ("receita_total", "despesa_empenhada",
                   "despesa_liquidada", "despesa_paga")
_FIN_MONETARIAS = ("receita_total", "despesa_total",
                   "fefc", "fundo_partidario")


def _empty_gov() -> pd.DataFrame:
    out = pd.DataFrame({
        "ano": pd.Series(dtype="int64"),
        "ente_id": pd.Series(dtype="string"),
        "esfera": pd.Series(dtype="string"),
        **{c: pd.Series(dtype="float64") for c in _GOV_MONETARIAS},
    })
    return out[SICONFI_CANONICAL]


def _empty_fin() -> pd.DataFrame:
    out = pd.DataFrame({
        "ano": pd.Series(dtype="int64"),
        "cargo": pd.Series(dtype="string"),
        "candidato_id": pd.Series(dtype="string"),
        **{c: pd.Series(dtype="float64") for c in _FIN_MONETARIAS},
    })
    return out[PRESTACAO_CANONICAL]


def _empty_cgu() -> pd.DataFrame:
    out = pd.DataFrame({
        "ano": pd.Series(dtype="int64"),
        "orgao": pd.Series(dtype="string"),
        "funcao": pd.Series(dtype="string"),
        "valor": pd.Series(dtype="float64"),
    })
    return out[CGU_CANONICAL]


def _coerce_quadro(df: pd.DataFrame | None, canonicas: list[str],
                   rotulo: str) -> pd.DataFrame:
    """Frame canônico do quadro (`gov`/`fin`/`cgu`) ou vazio (None → V1).

    `None` devolve a tabela vazia (build V1 intacto); frame dado sem as
    colunas canônicas (saída de `normalize_*`) levanta `ValueError`
    fail-closed antes de qualquer escrita. Colunas extras são
    descartadas (só o canônico vai ao mart).
    """
    vazios = {"gov": _empty_gov, "fin": _empty_fin, "cgu": _empty_cgu}
    if df is None:
        return vazios[rotulo]()
    ausentes = [c for c in canonicas if c not in df.columns]
    if ausentes:
        raise ValueError(
            f"build_marts: {rotulo}_df sem coluna(s) canônica(s): {ausentes}"
        )
    return df[canonicas].reset_index(drop=True)


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


def _load_canonical(curated_dir: Path, depara=None) -> pd.DataFrame:
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
                frames.append(df if _is_canonical(df) else normalize_resultados(df, depara=depara))
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
    out = out if _is_canonical(out) else normalize_resultados(out, depara=depara)
    # E8: prefeito restrito às 27 capitais; demais cargos intactos.
    # Fail-closed: _load_capitais levanta sem escopo válido (nunca pula
    # o filtro).
    capitais = _load_capitais()
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
        # Guarda S8707: o prune só remove dentro do curated declarado.
        _dentro_de(child, curated_dir)
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


def _write_duckdb(df: pd.DataFrame, db_path: Path, gov_df=None,
                  fin_df=None, cgu_df=None) -> None:
    db_path = Path(db_path)
    db_path.parent.mkdir(parents=True, exist_ok=True)
    dim = (
        df[["candidato_id", "nome_urna", "partido"]]
        .drop_duplicates()
        .reset_index(drop=True)
    )
    gov = _coerce_quadro(gov_df, SICONFI_CANONICAL, "gov")
    fin = _coerce_quadro(fin_df, PRESTACAO_CANONICAL, "fin")
    cgu = _coerce_quadro(cgu_df, CGU_CANONICAL, "cgu")
    entes = load_entes()
    con = duckdb.connect(str(db_path))
    try:
        con.register("fato_df", df[CANONICAL_COLUMNS])
        con.register("dim_df", dim)
        con.register("gov_df", gov)
        con.register("fin_df", fin)
        con.register("cgu_df", cgu)
        con.register("entes_df", entes)
        con.execute("CREATE OR REPLACE TABLE fato_voto AS SELECT * FROM fato_df")
        con.execute("CREATE OR REPLACE TABLE dim_candidato AS SELECT * FROM dim_df")
        con.execute(
            "CREATE OR REPLACE TABLE fato_eleitorado ("
            "ano BIGINT, uf VARCHAR, municipio_ibge VARCHAR, "
            "eleitorado BIGINT, abstencoes BIGINT)"
        )
        con.execute(
            "CREATE OR REPLACE TABLE fato_fin AS SELECT * FROM fin_df"
        )
        con.execute(
            "CREATE OR REPLACE TABLE dim_ente AS SELECT * FROM entes_df"
        )
        con.execute(
            "CREATE OR REPLACE TABLE fato_gov AS SELECT * FROM gov_df"
        )
        con.execute(
            "CREATE OR REPLACE TABLE fato_transp_federal AS SELECT * FROM cgu_df"
        )
    finally:
        con.close()


def _write_json_aggs(df: pd.DataFrame, web_data_dir: Path = WEB_DATA_DIR,
                     gov_df=None, fin_df=None, cgu_df=None) -> None:
    # DECISÃO (EVOLVE-1 Task 2): agregados seguem `indent=2` legível — sem
    # reforma compacta (churn sem ganho nos KBs atuais); a integridade vem
    # do hash dos bytes servidos (`register_served_artifacts`), não do tamanho.
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
    gov = _coerce_quadro(gov_df, SICONFI_CANONICAL, "gov")
    fin = _coerce_quadro(fin_df, PRESTACAO_CANONICAL, "fin")
    if gov.empty:
        gov_por_ente: list[dict] = []
        gov_serie: list[dict] = []
    else:
        g_ente = gov.groupby(["ente_id", "esfera"], as_index=False)[
            list(_GOV_MONETARIAS)].sum()
        gov_por_ente = [
            {"ente_id": r.ente_id, "esfera": r.esfera,
             **{c: float(getattr(r, c)) for c in _GOV_MONETARIAS}}
            for r in g_ente.sort_values("ente_id").itertuples()
        ]
        gov_serie = [
            {"ano": int(r.ano), "ente_id": r.ente_id,
             "despesa_empenhada": float(r.despesa_empenhada)}
            for r in gov.sort_values(["ano", "ente_id"]).itertuples()
        ]
    if fin.empty:
        fin_por_candidato: list[dict] = []
    else:
        g_fin = fin.groupby(["ano", "cargo", "candidato_id"],
                            as_index=False)[list(_FIN_MONETARIAS)].sum()
        fin_por_candidato = [
            {"ano": int(r.ano), "cargo": r.cargo,
             "candidato_id": r.candidato_id,
             **{c: float(getattr(r, c)) for c in _FIN_MONETARIAS}}
            for r in g_fin.sort_values(
                ["ano", "cargo", "candidato_id"]).itertuples()
        ]
    (web_data_dir / "gov_por_ente.json").write_text(
        json.dumps(gov_por_ente, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (web_data_dir / "gov_serie.json").write_text(
        json.dumps(gov_serie, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (web_data_dir / "fin_por_candidato.json").write_text(
        json.dumps(fin_por_candidato, ensure_ascii=False, indent=2), encoding="utf-8"
    )


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
    Idempotente (E6): dedupe pela `_dedupe_key` única de `etl.manifest`
    mantendo a última — rebuild com a mesma fonte atualiza em vez de
    duplicar; runs distintas (outro par ou outra fonte) preservam o
    histórico.
    """
    if df.empty:
        # E5 + cubic R3: df vazio escreve sem proveniência NOVA, mas
        # preserva as ingestões já atestadas no staging (ex. de-para
        # registrado antes do build) — rewrite cego apagaria proveniência.
        # Manifest fresco/ausente segue {"ingestions": []} (contrato E5).
        try:
            staged = json.loads(Path(manifest_path).read_text(encoding="utf-8"))
            herdadas = staged.get("ingestions") if isinstance(staged, dict) else None
        except (OSError, ValueError, UnicodeDecodeError):
            herdadas = None
        Path(manifest_path).write_text(
            json.dumps(
                {"ingestions": herdadas if isinstance(herdadas, list) else []},
                ensure_ascii=False, indent=2,
            ),
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
    sem_chave: list = []
    for item in merged:
        if not isinstance(item, dict):
            continue
        try:
            by_key[_dedupe_key(item)] = item
        except TypeError:
            # Entry legada com campo não-hashable (ex. `dataset`/`turno`
            # como lista — `_validate_entry` não cobre esses campos): sem
            # chave de dedupe, preservada sem colapso e sem crashar o
            # build (fail-safe: dado preservado, nunca exceção).
            sem_chave.append(item)
    deduped = list(by_key.values()) + sem_chave
    legacy = [item for item in merged if not isinstance(item, dict)]
    manifest_file = Path(manifest_path)
    _write_json_atomico(manifest_file, {"ingestions": deduped + legacy})


_SERVED_AGG_NAMES = ("resumo.json", "por_uf.json", "por_candidato.json")


def _served_files(web_data_dir: Path) -> list[Path]:
    """JSONs servidos presentes no dir público: trio + fato_* + Censo.

    `censo_municipios.json` (EVOLVE-7 Task 1, `{ibge7: pop}` do
    `etl.censo.ingerir_censo`) é preservado pelo staging como os demais
    servidos; a atribuição de proveniência acontece em
    `_artifact_entries_for` (fonte do Censo, nunca fan-out TSE).
    """
    files = [web_data_dir / name for name in _SERVED_AGG_NAMES]
    censo = web_data_dir / CENSO_ARTIFACT_FILENAME
    if censo.is_file():
        files.append(censo)
    files += sorted(web_data_dir.glob("fato_*.json"))
    return [p for p in files if p.is_file()]


def _fato_triple_from_name(name: str) -> tuple | None:
    """`(ano, turno, CARGO_MAIÚSCULO)` de `fato_<ano>_<turno>_<slug>.json`."""
    stem = name[:-len(".json")] if name.endswith(".json") else name
    parts = stem.split("_")
    if len(parts) != 4 or parts[0] != "fato":
        return None
    try:
        return (int(parts[1]), int(parts[2]), parts[3].upper())
    except ValueError:
        return None


def _artifact_entries_for(web_data_dir: Path, sources: list[dict],
                          today: str) -> list[dict]:
    """1 entry `sha_origin: "artifact"` por (arquivo servido × fonte V1).

    `sha256`/`size_bytes` medidos dos BYTES servidos; `source_url` é o da
    fonte do dataset (mesma das ingestões). Fato cujo triple não casa com
    as fontes do build é ignorado (não é artefato oficial deste build).
    `censo_municipios.json` (EVOLVE-7 Task 1) ganha 1 entry ÚNICA com a
    fonte do Censo (`CENSO_DATASETS[0]`, via o construtor compartilhado
    de `etl.censo` — sem fork de contrato), nunca fan-out TSE.
    """
    by_pair = {(s["ano"], str(s["cargo"]).upper()): s for s in sources}
    censo_meta = CENSO_DATASETS[0]
    entries = []
    for path in _served_files(web_data_dir):
        # Guarda S8707: só lê bytes servidos de dentro do dir declarado
        # (bloqueia symlink p/ fora). Antes de qualquer `read_bytes`.
        _dentro_de(path, web_data_dir)
        raw = path.read_bytes()
        sha = hashlib.sha256(raw).hexdigest()
        if path.name == CENSO_ARTIFACT_FILENAME:
            entries.append(build_censo_artifact_entry(
                raw, path.name, dataset=censo_meta, data_iso=today))
            continue
        if path.name.startswith("fato_"):
            triple = _fato_triple_from_name(path.name)
            if triple is None:
                continue
            ano, turno, cargo_upper = triple
            source = by_pair.get((ano, cargo_upper))
            if source is None:
                continue
            targets, extra = [source], {"turno": turno}
        else:
            targets, extra = sources, {}
        for target in targets:
            entries.append(
                {
                    "source_url": target["url"],
                    "sha256": sha,
                    "sha_origin": "artifact",
                    "data": today,
                    "etl_version": ETL_VERSION,
                    "dataset": target["dataset"],
                    "ano": target["ano"],
                    "cargo": target["cargo"],
                    "tipo": target["tipo"],
                    **extra,
                    "arquivo": path.name,
                    "size_bytes": len(raw),
                }
            )
    return entries


def _prune_fato_sem_proveniencia(web_staging, sources: list[dict]) -> list[str]:
    """Remove do staging fato_*.json sem match de proveniência (fail-closed).

    O staging copia o web_dir inteiro (incl. fato_* de builds/pleitos
    anteriores); triple que não casa com `(ano, cargo)` das fontes deste
    build não gera entry de hash em `_artifact_entries_for` — promovido
    assim, seria servido sem hash. Podar do staging impede a promoção
    hashless. Devolve os nomes removidos.
    """
    pares = {(s["ano"], str(s["cargo"]).upper()) for s in sources}
    removidos = []
    for path in sorted(Path(web_staging).glob("fato_*.json")):
        triple = _fato_triple_from_name(path.name)
        if triple is None or (triple[0], triple[2]) not in pares:
            path.unlink()
            removidos.append(path.name)
    return removidos


def register_served_artifacts(manifest_path, web_data_dir,
                              sources: list[dict]) -> list[dict]:
    """(Re)escreve a chave `artifacts` do manifest a partir dos bytes servidos.

    Substituição integral (não append): o conteúdo é determinístico dos
    arquivos presentes, então rebuilds atualizam sem duplicar. Cada entry é
    validada por `_validate_entry` (fail-closed: `source_url` truthy + sha
    64-hex). Vive em chave própria para não colidir com o dedupe das
    ingestões (`_dedupe_key` única) nem com `verify_manifest`.
    Devolve as entries registradas.
    """
    today = datetime.now(timezone.utc).date().isoformat()
    entries = _artifact_entries_for(Path(web_data_dir), sources, today)
    for entry in entries:
        _validate_entry(entry)  # fail-closed antes de escrever
    manifest_file = Path(manifest_path)
    # Guarda S8707: leitura confinada ao parent declarado, antes do read.
    _dentro_de(manifest_file, manifest_file.parent)
    manifest = json.loads(manifest_file.read_text(encoding="utf-8"))
    if not isinstance(manifest, dict):
        manifest = {"ingestions": []}
    manifest["artifacts"] = entries
    _write_json_atomico(manifest_file, manifest)
    return entries


def _is_within(path, ancestor) -> bool:
    """True se `path` == `ancestor` ou está sob ele (caminhos absolutos)."""
    try:
        Path(path).relative_to(ancestor)
        return True
    except ValueError:
        return False


def _abs(path) -> Path:
    return Path(os.path.abspath(os.fspath(path)))


def _relocated_staging(target, dir_publics) -> Path:
    """Staging nunca aninhado dentro de outro alvo público.

    Alvos podem aninhar (ex.: `build_all(tmp, tmp/t.duckdb, ...)` nos
    testes): o staging padrão (`<alvo>.tmp`, irmão) cairia dentro do
    `curated`/`web` público e o rename do dir externo o arrastaria,
    orfanando o swap interno. Nesse caso o staging sobe para irmão do
    alvo externo mais externo (mesmo parent → mesmo fs, rename atômico).
    Sem aninhamento, é o próprio `<alvo>.tmp`.
    """
    # Guarda S8707: `..` no alvo é bloqueado AQUI — antes de qualquer
    # toque no fs (`_abs`/abspath normalizaria a travessia e a herança
    # `<alvo>.tmp` a espalharia p/ discard/stage/promote). Fail-closed.
    if ".." in Path(target).parts:
        raise ValueError(
            "build_marts: caminho com '..' bloqueado "
            f"(alvo={os.fspath(target)!r})"
        )
    target_abs = _abs(target)
    st = Path(f"{target_abs}.tmp")
    for _ in range(10):
        outers = [
            _abs(d) for d in dir_publics
            if _abs(d) != target_abs and _is_within(st, _abs(d))
        ]
        if not outers:
            return st
        st = min(outers, key=lambda d: len(d.parts)).parent / st.name
    raise RuntimeError(f"build_marts: aninhamento de alvos sem saída: {target}")


def _prev_for(target) -> Path:
    """Backup last-good de um alvo público: `<alvo>.prev` (irmão, mesmo fs)."""
    return Path(f"{Path(target)}.prev")


def _dentro_de(path, root) -> Path:
    """Resolve `path` e exige continência ESTRITA sob `root` (fail-closed).

    Bloqueia path traversal (`..` lexical, absoluto fora da raiz ou
    escape via symlink): levanta `ValueError` ANTES de qualquer mutação
    no fs. Precedente: sandbox `RAW_ROOT` em `etl/fetch.py`. Devolve o
    caminho resolvido.
    """
    bruto = os.fspath(path)
    raiz = os.fspath(root)
    if ".." in Path(bruto).parts or ".." in Path(raiz).parts:
        raise ValueError(
            "build_marts: caminho com '..' bloqueado "
            f"(path={bruto!r}, raiz={raiz!r})"
        )
    p = Path(bruto).resolve()
    r = Path(raiz).resolve()
    if r not in p.parents:
        raise ValueError(
            "build_marts: caminho fora da raiz esperada "
            f"(path={bruto!r}, raiz={raiz!r})"
        )
    return p


def _write_json_atomico(dest, payload) -> None:
    """Escreve JSON de forma atômica via `<dest>.tmp` + rename (mesmo fs).

    Guarda S8707: o `.tmp` precisa resolver estritamente sob o parent
    declarado de `dest` (`_dentro_de`) — `..`/escape levanta `ValueError`
    antes de qualquer escrita.
    """
    dest = Path(dest)
    tmp = Path(f"{dest}.tmp")
    _dentro_de(tmp, dest.parent)
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    os.replace(tmp, dest)


def _remove_path(path, root) -> None:
    """Remove arquivo/symlink/dir sob `root`; ausente é ok (limpeza de staging).

    Guarda S8707: `path` precisa resolver estritamente sob `root`
    (`_dentro_de`) — `..`/escape levanta `ValueError` antes de deletar.
    """
    _dentro_de(path, root)
    p = Path(path)
    if p.is_symlink() or p.is_file():
        p.unlink()
    elif p.is_dir():
        shutil.rmtree(p)


def _stage_dir(public_dir, staging_dir, skip_roots=()) -> None:
    """Copia o dir público p/ o staging (fontes + fato_* preservados).

    O prune/rewrite posterior opera só no staging: partições obsoletas
    caem no `_write_partitioned_parquet` do staging e o swap publica o
    conjunto novo por inteiro (prune por substituição). Dir ausente vira
    staging vazio. `skip_roots`: públicos de outros alvos aninhados aqui
    dentro — promovidos à parte, nunca carreados (cópia velha voltaria no
    swap). Restos `.tmp`/`.prev` também ficam de fora.
    """
    public_dir, staging_dir = Path(public_dir), Path(staging_dir)
    if not public_dir.is_dir():
        staging_dir.mkdir(parents=True, exist_ok=True)
        return
    skip = {_abs(s) for s in skip_roots}

    def _ignore(dirpath, names):
        ignored = []
        for name in names:
            if name.endswith(".tmp") or name.endswith(".prev"):
                ignored.append(name)
            elif _abs(Path(dirpath) / name) in skip:
                ignored.append(name)
        return ignored

    shutil.copytree(public_dir, staging_dir, ignore=_ignore)


def _stage_file(public_file, staging_file) -> None:
    """Copia o arquivo público p/ o staging (histórico do manifest).

    Ausente deixa o staging ausente (primeiro build / E5 vazio).
    """
    public_file, staging_file = Path(public_file), Path(staging_file)
    if public_file.is_file() or public_file.is_symlink():
        staging_file.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(public_file, staging_file)


def _promote(staging, target) -> None:
    """Troca o staging pelo alvo público, guardando o anterior em `.prev`.

    O `.prev` da geração anterior é removido aqui — isto é, no sucesso
    seguinte ("removido no sucesso seguinte"); falha nunca chega aqui
    (só o staging é deletado, públicos intactos). `rename` de irmãos é
    atômico no mesmo filesystem. Vale p/ arquivos e dirs.
    """
    staging, target = Path(staging), Path(target)
    prev = _prev_for(target)
    # Guardas S8707 (fail-closed, antes de qualquer rename/unlink): os
    # alvos derivados ficam ao lado do parent declarado; `..`/escape
    # levanta ValueError com os públicos intactos.
    _dentro_de(prev, target.parent)
    _dentro_de(staging, staging.parent)
    _dentro_de(target, target.parent)
    _remove_path(prev, target.parent)
    if target.exists() or target.is_symlink():
        target.rename(prev)
    staging.rename(target)


def _discard_staging(paths) -> None:
    """Remove todos os stagings (falha de gate: só o staging morre)."""
    for p in paths:
        _remove_path(p, Path(p).parent)


def _soma_particoes_publicadas(curated_dir) -> tuple | None:
    """`(total_votos, {uf: votos})` das partições publicadas, ou None.

    Devolve None quando não há partição legível (dir ausente, só-fontes ou
    nenhuma partição íntegra): sem geração publicada, nada a comparar.
    Partição ilegível isolada é ignorada aqui (o build a partir das fontes
    cura o dano); a comparação de geração usa só partições íntegras.
    Chaves UF nulas são puladas (nunca viram falso positivo).
    """
    curated = Path(curated_dir)
    if not curated.is_dir():
        return None
    total, por_uf, arquivos = 0, {}, 0
    for part in sorted(p for p in curated.rglob("*") if p.is_file()):
        if part.suffix.lower() != ".parquet" or not _is_generated(part):
            continue
        try:
            df = pd.read_parquet(part, columns=["uf", "votos"])
        except Exception:
            continue
        arquivos += 1
        if df.empty:
            continue
        total += int(df["votos"].fillna(0).sum())
        for uf, votos in df.groupby("uf", dropna=True)["votos"].sum().items():
            if pd.isna(uf):
                continue
            por_uf[str(uf)] = por_uf.get(str(uf), 0) + int(votos)
    return (total, por_uf) if arquivos else None


def _resumo_publicado(web_dir) -> tuple | None:
    """`(total_votos, total_linhas)` do `resumo.json` público, ou None."""
    resumo = Path(web_dir) / "resumo.json"
    try:
        payload = json.loads(resumo.read_bytes().decode("utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        return None
    if not isinstance(payload, dict):
        return None
    votos, linhas = payload.get("total_votos"), payload.get("total_linhas")
    if isinstance(votos, bool) or not isinstance(votos, int):
        return None
    if isinstance(linhas, bool) or not isinstance(linhas, int):
        return None
    return (votos, linhas)


def _por_uf_publicado(web_dir) -> dict | None:
    """`{uf: votos}` do `por_uf.json` público, ou None (ausente/ilegível)."""
    try:
        payload = json.loads(
            (Path(web_dir) / "por_uf.json").read_bytes().decode("utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        return None
    if not isinstance(payload, list):
        return None
    por_uf: dict = {}
    for entry in payload:
        if not isinstance(entry, dict):
            return None
        uf, votos = entry.get("uf"), entry.get("votos")
        if (not isinstance(uf, str) or isinstance(votos, bool)
                or not isinstance(votos, int)):
            return None
        por_uf[uf] = por_uf.get(uf, 0) + votos
    return por_uf


def _fato_publicado(db_file) -> tuple | None:
    """`(SUM(votos), COUNT(*), {uf: votos})` do `fato_voto` público, ou None.

    Leitura `read_only` (nunca muta o público); DB ausente/ilegível/sem a
    tabela é None — os gates do build reprovam o que for dano real, aqui só
    se compara geração.
    """
    if not Path(db_file).is_file():
        return None
    try:
        con = duckdb.connect(str(db_file), read_only=True)
        try:
            n = con.execute("SELECT COUNT(*) FROM fato_voto").fetchone()[0]
            s = con.execute("SELECT SUM(votos) FROM fato_voto").fetchone()[0]
            por_uf = {
                str(r[0]): int(r[1]) if r[1] is not None else 0
                for r in con.execute(
                    "SELECT uf, SUM(votos) FROM fato_voto "
                    "WHERE uf IS NOT NULL GROUP BY uf"
                ).fetchall()
            }
        finally:
            con.close()
    except Exception:
        return None
    return (int(s) if s is not None else 0, int(n), por_uf)


def _linhas_tse_publicadas(manifest_file) -> int | None:
    """Soma de `rows` das ingestões TSE publicadas, ou None.

    Conta só entries com `sha_origin` em ("source", "derived") — fato
    (`fato_json`), Censo e artifacts nunca entram na conta, então appends
    legítimos pós-build (seed, `build_fato` standalone) não geram falso
    positivo. Manifest ausente/ilegível/sem ingestão TSE é None (pula a
    perna, sem bloquear fluxos legítimos).
    """
    try:
        payload = json.loads(Path(manifest_file).read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        return None
    if not isinstance(payload, dict):
        return None
    ingestions = payload.get("ingestions")
    if not isinstance(ingestions, list):
        return None
    total, achou = 0, False
    for entry in ingestions:
        if not isinstance(entry, dict):
            continue
        if entry.get("sha_origin") not in ("source", "derived"):
            continue
        rows = entry.get("rows")
        if isinstance(rows, bool) or not isinstance(rows, int):
            return None
        total += rows
        achou = True
    return total if achou else None


def _verificar_geracao_integra(curated, db_file, manifest_file, web_dir) -> None:
    """Detecta árvore meio-promovida e falha fail-closed em pt-BR (Task 5).

    DECISÃO (EVOLVE-2 Task 5): fail-closed em vez de auto-restore. Restaurar
    às cegas (`<alvo>.prev` por cima de tudo) misturaria a geração N-1 dos
    alvos já promovidos com a N-2 dos não promovidos; restaurar só o
    "promovido" exige saber quem é novo x velho por alvo, isto é, ids de
    geração no protocolo de promote (mudança de protocolo, fora do escopo).
    O `.prev` segue escrito/usado como backup last-good p/ reparo manual
    do operador — a mensagem abaixo diz como. Nunca se publica um mix: o
    erro sai antes de qualquer escrita (inclusive antes do descarte dos
    `.tmp`, preservados p/ diagnóstico).

    Sinais (todos de conteúdo, custo zero, sem arquivos novos):
    - totais de votos: partições publicadas x `fato_voto` x `resumo.json`;
    - contagem de linhas: `fato_voto` x `resumo.json` x ingestões TSE;
    - distribuição por UF: partições x `fato_voto` x `por_uf.json` (fecha o
      buraco dos agregados globais iguais com conteúdo distinto — ex.
      retificação que desloca votos entre UFs).
    Alvo ausente/ilegível não conta (primeiro build, seed, E5 vazio seguem
    intactos); mistura integral-equivalente (mesmos totais e mesma
    distribuição, ex. rebuild idêntico interrompido) não é mix publicado —
    o rebuild cura.

    Residual documentado: redistribuição equilibrada DENTRO da mesma UF
    (por-UF, totais e contagens iguais) + crash após o promote do web_dir
    não é detectada — fechar isso exigiria digest por registro ou ids de
    geração no protocolo (fora do escopo); o modelo de ameaça exige rebuild
    com totais idênticos E crash na janela do half-swap. Crash exatamente
    entre o promote do DB e o do manifest canônico, com gerações de mesma
    contagem, também não é detectado — mas a superfície servida (JSONs +
    espelho + DB) está consistente nesse estado e o próximo build cura o
    canônico via dedupe.
    """
    votos: dict = {}
    parcial = _soma_particoes_publicadas(curated)
    if parcial is not None:
        votos[f"curated ({curated})"] = parcial[0]
    fato = _fato_publicado(db_file)
    if fato is not None:
        votos[f"duckdb ({db_file})"] = fato[0]
    resumo = _resumo_publicado(web_dir)
    if resumo is not None:
        votos[f"resumo.json ({web_dir})"] = resumo[0]
    linhas: dict = {}
    if fato is not None:
        linhas[f"duckdb ({db_file})"] = fato[1]
    if resumo is not None:
        linhas[f"resumo.json ({web_dir})"] = resumo[1]
    tse = _linhas_tse_publicadas(manifest_file)
    if tse is not None:
        linhas[f"manifest ({manifest_file})"] = tse
    por_uf: dict = {}
    if parcial is not None:
        por_uf[f"curated ({curated})"] = parcial[1]
    if fato is not None:
        por_uf[f"duckdb ({db_file})"] = fato[2]
    dist = _por_uf_publicado(web_dir)
    if dist is not None:
        por_uf[f"por_uf.json ({web_dir})"] = dist
    divergentes = []
    if len(set(votos.values())) > 1:
        divergentes.append(
            "totais de votos distintos entre alvos públicos: "
            + ", ".join(f"{k}={v}" for k, v in sorted(votos.items()))
        )
    if len(set(linhas.values())) > 1:
        divergentes.append(
            "contagens de linhas distintas entre alvos públicos: "
            + ", ".join(f"{k}={v}" for k, v in sorted(linhas.items()))
        )
    if len({tuple(sorted(v.items())) for v in por_uf.values()}) > 1:
        divergentes.append(
            "distribuição de votos por UF distinta entre alvos públicos: "
            + "; ".join(f"{k}={v}" for k, v in sorted(por_uf.items()))
        )
    if not divergentes:
        return
    prevs = [str(_prev_for(t)) for t in (curated, db_file, manifest_file, web_dir)
             if _prev_for(t).exists() or _prev_for(t).is_symlink()]
    detalhe_prevs = (
        f" Backups `.prev` encontrados: {', '.join(sorted(prevs))}."
        if prevs else " Nenhum backup `.prev` encontrado."
    )
    raise RuntimeError(
        "build_marts: geração meio-promovida detectada (alvos públicos de "
        "gerações distintas — possível crash entre promotes); nenhum dado "
        "foi publicado e nada foi alterado. "
        + "; ".join(divergentes) + "." + detalhe_prevs
        + " Restaure a geração íntegra anterior a partir dos backups `.prev`,"
        " restaurando o `.prev` SOMENTE sobre os alvos com os valores da"
        " geração NOVA (detalhes acima) — restaurar todos reintroduz o mix"
        " N-1/N-2; remova restos `.tmp` do build interrompido e rode o build"
        " novamente."
    )


def build_all(curated_dir, db_path, manifest_path, web_data_dir=None,
              source_shas=None, depara=None,
              gov_df=None, fin_df=None, cgu_df=None) -> None:
    """Pipeline completo: Parquet particionado + DuckDB + JSONs + manifest.

    `web_data_dir` redireciona os agregados JSON (padrão: `web/public/data/`
    na raiz do repo); útil em testes para não mutar a árvore do repo.
    O manifest canônico é `manifest_path`; uma cópia idêntica é escrita em
    `<web_data_dir>/manifest.json` para a frente pública ler `/data/manifest.json`
    (mesmo conteúdo, escrita única a partir do canônico — R2).
    `source_shas` mapeia `(ano, CARGO_MAIÚSCULO)` → sha256 do ZIP de origem
    (threading E4; Tasks 5 e 7 consomem). `depara` (EVOLVE-15, opcional)
    é o mapeamento `{tse5: ibge7}` do CSV oficial (`etl.depara`) repassado
    a `normalize_resultados` — sem ele, códigos TSE viram `""` fail-closed
    como antes. `gov_df`/`fin_df`/`cgu_df` (Transparência de Gastos,
    opcionais, default None → tabelas/JSONs vazios, build V1 intacto) são
    os quadros já canônicos de `normalize_siconfi`/`normalize_prestacao`/
    `normalize_cgu`: alimentam `dim_ente`/`fato_gov`, `fato_fin` e
    `fato_transp_federal` + os JSONs `gov_por_ente.json`/`gov_serie.json`/
    `fin_por_candidato.json`. Nunca passam pelo `_matched_entries` do
    escopo V1 (quadros de outra fonte, outro escopo). Após as ingestões, os hashes dos
    bytes servidos são registrados em `manifest["artifacts"]`
    (`register_served_artifacts`, EVOLVE-1 Task 2) — dentro do staging,
    junto com Parquet/DB/JSONs/espelho, para o swap publicar hashes
    calculados sobre os bytes exatos que vão ao ar. Pares `(ano, cargo)`
    fora do V1 levantam `ValueError` antes de qualquer escrita (incl.
    staging). Stage-then-promote (EVOLVE-1 Task 4): Parquet + DuckDB +
    JSONs + manifest canônico + espelho são escritos em staging
    (`<alvo>.tmp`, realocado p/ fora quando alvos aninham — staging cobre
    tudo); os quality gates (`run_gates`) rodam contra o
    DB staged; qualquer erro deleta só o staging e levanta `RuntimeError`
    com os públicos anteriores byte-idênticos (C2). Staging obsoleto de
    crash anterior é descartado no início (nunca promove parcial), EXCETO no
    caminho de falha de geração meio-promovida (Task 5) — ali os `.tmp` são
    preservados de propósito p/ diagnóstico. No
    sucesso, cada staging troca de lugar com o público e o anterior vira
    `<alvo>.prev` (removido no sucesso seguinte). O gate de forma do
    manifest é excluído aqui — o manifest desta ingestão ainda não foi
    escrito (vai em `_register_sources`, após os JSONs) — mas o gate
    bytes-aware de fatos (`fato_paths` vs espelho staged) é ativo: fato
    novo + mirror velho reprova; e a ausência de totais
    oficiais é só `UserWarning` (contrato `run_gates`), nunca erro.
    """
    curated = Path(curated_dir)
    db_file = Path(db_path)
    manifest_file = Path(manifest_path)
    web_dir = Path(web_data_dir) if web_data_dir is not None else WEB_DATA_DIR
    dir_publics = [curated, web_dir]
    curated_st = _relocated_staging(curated, dir_publics)
    web_st = _relocated_staging(web_dir, dir_publics)
    db_st = _relocated_staging(db_file, dir_publics)
    manifest_st = _relocated_staging(manifest_file, dir_publics)
    stagings = (curated_st, db_st, manifest_st, web_st)
    # Recovery de crash entre promotes (EVOLVE-2 Task 5): árvore
    # meio-promovida falha fail-closed em pt-BR ANTES de qualquer escrita
    # (nunca publica um mix; `.tmp` do crash preservado p/ diagnóstico).
    _verificar_geracao_integra(curated, db_file, manifest_file, web_dir)
    # Staging obsoleto de build anterior crashado: descarta (nunca promove).
    _discard_staging(stagings)
    df = _load_canonical(curated, depara=depara)
    fontes = _matched_entries(df)  # pré-checagem fail-closed: antes de qualquer escrita
    # Quadros gov/fin/cgu: coerção fail-closed antes de qualquer escrita
    # (None → vazios, V1 intacto; fora do escopo V1 por desenho).
    gov = _coerce_quadro(gov_df, SICONFI_CANONICAL, "gov")
    fin = _coerce_quadro(fin_df, PRESTACAO_CANONICAL, "fin")
    cgu = _coerce_quadro(cgu_df, CGU_CANONICAL, "cgu")
    # Põ props públicos no staging: fontes (CSVs) + fato_* + histórico.
    # Curated/web por cópia (prune/overwrite operam no staging); manifest
    # por cópia (dedupe lê o histórico); DB reescrito por inteiro.
    # Alvos aninhados (ex.: tudo sob tmp_path) são excluídos da cópia do
    # externo e promovidos à parte, do mais externo ao mais interno.
    all_publics = [curated, db_file, manifest_file, web_dir]
    _stage_dir(curated, curated_st,
               [p for p in all_publics
                if p != curated and _is_within(_abs(p), _abs(curated))])
    _stage_dir(web_dir, web_st,
               [p for p in all_publics
                if p != web_dir and _is_within(_abs(p), _abs(web_dir))])
    _stage_file(manifest_file, manifest_st)
    db_st.parent.mkdir(parents=True, exist_ok=True)
    try:
        # Fato staged sem proveniência nunca promove hashless: poda antes
        # de qualquer escrita no staging (fail-closed).
        _prune_fato_sem_proveniencia(web_st, fontes)
        # Ordem Tasks 4–7 preservada, toda dentro do staging.
        _write_partitioned_parquet(df, curated_st)
        _write_duckdb(df, db_st, gov_df=gov, fin_df=fin, cgu_df=cgu)
        # Gates contra o staging (EVOLVE-4 T2, bytes-aware): o manifest
        # aqui é o espelho staged (atestação servida anterior) e os fatos
        # staged precisam conferir com ele (`fato_paths`); fato novo +
        # mirror velho (crash entre passos) reprova com erro "fato"
        # (não filtrado). O gate de forma do manifest segue excluído —
        # o manifest desta ingestão ainda não foi escrito (vai em
        # `_register_sources`, após os JSONs) — e a ausência de totais
        # oficiais é só `UserWarning` (contrato `run_gates`), nunca erro.
        # Sem mirror anterior não há baseline: o gate de fatos é `[]` e
        # a atestação fresca de `register_served_artifacts` cobre.
        gate_errors = run_gates(
            db_st, manifest_path=web_st / "manifest.json",
            fato_paths=sorted(web_st.glob("fato_*.json")))
        gate_errors = [e for e in gate_errors if not e.startswith("manifest")]
        if gate_errors:
            raise RuntimeError(f"gates reprovados: {'; '.join(gate_errors)}")
        _write_json_aggs(df, web_st, gov_df=gov, fin_df=fin, cgu_df=cgu)
        _register_sources(df, manifest_st, source_shas=source_shas)
        if not df.empty:
            # Hashes dos bytes servidos (trio + fato_* presentes): o espelho
            # abaixo os inclui para /auditoria provar igualdade (display é
            # follow-up). Vazio segue sem proveniência (contrato E5).
            register_served_artifacts(manifest_st, web_st, fontes)
        # Espelho idêntico ao canônico — ainda dentro do staging (swap conjunto).
        web_st.mkdir(parents=True, exist_ok=True)
        (web_st / "manifest.json").write_bytes(manifest_st.read_bytes())
    except BaseException:
        _discard_staging(stagings)  # falha (gate ou não): só o staging morre
        raise
    # Promove tudo, do dir mais externo ao mais interno (aninhados saem
    # do `.prev` do externo já com o conteúdo novo); backup last-good em
    # `.prev`.
    for staging, target in sorted(
        ((curated_st, curated), (web_st, web_dir)),
        key=lambda pair: len(_abs(pair[1]).parts),
    ):
        _promote(staging, target)
    _promote(db_st, db_file)
    _promote(manifest_st, manifest_file)
