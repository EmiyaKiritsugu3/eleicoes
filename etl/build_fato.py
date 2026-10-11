"""Fato municipal: join TSE × Censo → JSON compacto por (ano, turno, cargo).

`build_fato(duckdb_path, out_dir, ano, turno, cargo) -> str` lê
`fato_voto`/`dim_candidato` (+ `dim_municipio` com o schema canônico de
`etl.censo.normalize_censo`, `fato_eleitorado` quando houver) do DuckDB,
faz o join por IBGE7 e escreve `fato_<ano>_<turno>_<cargo>.json` com
arrays compactos (uma linha por município, não um objeto por voto):

    {candidatos: [{id, nome, partido}],
     municipios: [{ibge, uf, nome, votos, total, abst, demo | null}]}

Regras fail-closed (nunca zero silencioso / número sem hash):
- município sem par no Censo → `demo: null`, votos intactos;
- fração de MUNICÍPIOS sem par acima de 0,1% (matemática inteira,
  `orfaos*1000 > total_municipios`, mesmo padrão de `etl.validate`) →
  `ValueError` (contagem por município único, não por linha de voto/zona);
- chave IBGE vazia nunca casa (nem mesmo com `""` do Censo);
- triple (ano, turno, cargo) sem linhas → `ValueError` ("sem dado
  oficial", nunca JSON vazio);
- `dim_municipio` ausente → `ValueError` (100% órfãos);
- fonte V1 é por zona (`votacao_candidato_munzona`): linhas do mesmo
  (município, candidato) SÃO SOMADAS; valor nulo em qualquer zona
  contamina o agregado (`null`, incógnita nunca some); candidato da
  lista nacional sem linha no município = 0 votos (ausência no TSE),
  nunca `null`;
- votos nulos (`Int64` anulável, contrato herdado) atravessam como
  `null`; `total` com qualquer nulo é `null` (total com incógnita não
  é afirmado);
- gate soma-do-Censo (`check_censo_sum`): roda quando `censo_total_oficial`
  é informado; divergência → `ValueError` antes de escrever o fato
  (sem total oficial informado — ex. fixtures sintéticos sem soma
  auditada — o gate é pulado);
- `(ano, cargo)` fora do escopo V1 → `ValueError` (sem `source_url`
  oficial não há proveniência a registrar).

Proveniência: upsert no `<db dir>/manifest.json` com o MESMO predicado
de idempotência do mirror (`_dedupe_key` única de `etl.manifest`,
importada — sem fork): reruns atualizam o `sha256` sem duplicar a
ingestão. A entry leva `source_url` do TSE (par ano/cargo do V1),
`sha256` do payload JSON produzido, e `fontes: [url TSE, página do
catálogo IBGE]` como fonte dupla. `abst`/`eleitores` vêm de
`fato_eleitorado` quando a tabela/grupo existir, senão `null` (v1 só
tem votação nominal). `nome` do município é `""`: nenhum schema
canônico (TSE ou Censo) carrega nomes — a camada do mapa resolve nomes
por IBGE7 a partir da malha.

Ordem crash-safe (EVOLVE-3 Task 2, write-fato-then-verify-before-serve):
fato (escrita atômica, sem rasgo) → upsert do manifest do `<db dir>` →
porta `verificar_fato_manifest` → mirror servido. Manifest-first foi
rejeitado: atestaria bytes ainda não servidos (verde com arquivo ausente).
A porta roda ANTES do mirror (CodeRabbit PR#5 F2): db malformado ou
inconsistente levanta com o mirror intocado — nunca publica artefato
"válido" com proveniência quebrada. Qualquer crash entre passos deixa
ou o par antigo intacto ou fato novo + manifest velho — e esse estado
REPROVA o predicado `verificar_fato_manifest` (sha da entry vs bytes do
fato), nunca dá verde falso; o rerun seguinte repara ao reescrever fato
+ upsert (após a remoção de eventual lixo legado, que o upsert preserva
sem apagar e a porta reprova). `verify_manifest` sozinho continua só-forma no `<db dir>`
(contrato legado) e NÃO basta para atestar bytes — portas/gates devem
usar `verificar_fato_manifest` antes de servir.

O manifest do `<db dir>` segue só-ingestions (contrato legado). Em
adição, o manifest irmão das saídas (`<out_dir>/manifest.json`) recebe
a ingestão (upsert idempotente) + `artifacts` recalculados sobre os
bytes do fato via `register_served_artifacts` — reruns atualizam o sha
sem duplicar, e `verify_manifest` desse mirror prova os bytes servidos.
"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

import duckdb
import pandas as pd

from etl import ETL_VERSION
from etl.build_marts import register_served_artifacts
from etl.build_marts import _dentro_de, _prune_fato_sem_proveniencia
from etl.build_marts import _write_json_atomico
from etl.censo import check_censo_sum
from etl.manifest import _dedupe_key, _validate_entry
from etl.manifest import verificar_fato_manifest
from etl.sources import CENSO_DATASETS, V1_DATASETS

DEMO_FIELDS = [
    "esc_sup",
    "esc_med",
    "esc_fund",
    "renda_media",
    "pobres_pct",
    "idade_mediana",
    "urbanizacao",
    "pop",
]


def _v1_entry(ano: int, cargo_upper: str) -> dict:
    for entry in V1_DATASETS:
        if entry["ano"] == ano and str(entry["cargo"]).upper() == cargo_upper:
            return entry
    raise ValueError(
        f"build_fato: par (ano, cargo) fora do escopo V1: ({ano}, {cargo_upper})"
    )


def _served_source_shape(v1_entry: dict) -> dict:
    """Subconjunto da entry V1 que `_artifact_entries_for` consome."""
    return {
        "url": v1_entry["url"],
        "ano": v1_entry["ano"],
        "cargo": v1_entry["cargo"],
        "dataset": v1_entry["dataset"],
        "tipo": v1_entry["tipo"],
    }


def _atualizar_manifest_db(db_manifest_path, ingestion: dict) -> None:
    """Upsert da ingestão no manifest do `<db dir>` (EVOLVE-3 Task 2).

    DECISÃO: mesmo predicado de idempotência do mirror servido
    (`_dedupe_key` única de `etl.manifest`, importada — sem fork): a
    entry nova substitui a de mesma chave `(dataset, ano, turno, cargo,
    source_url)`; chaves distintas (outro triple/fonte) preservam o
    histórico. Reruns atualizam o `sha256` sem duplicar. Validação
    fail-closed via `_validate_entry` (precedente de import cruzado
    `etl`: `_dentro_de`/`_write_json_atomico`/`_prune_fato_sem_proveniencia`
    já vêm de `etl.build_marts`), leitura tolerante a ausente/corrompido
    (preserva `.corrupt.<ts>`, mesmo contrato de `write_manifest`), e
    escrita atômica via o helper compartilhado (guarda S8707 inclusa).
    Outras chaves do manifest e itens legados não-dict são preservados.
    """
    db_manifest_path = Path(db_manifest_path)
    _dentro_de(db_manifest_path, db_manifest_path.parent)  # fail-closed antes de tudo
    _validate_entry(ingestion)  # fail-closed antes de qualquer mutação
    try:
        manifest = json.loads(db_manifest_path.read_text(encoding="utf-8"))
        if not isinstance(manifest, dict):
            manifest = {"ingestions": []}
    except FileNotFoundError:
        manifest = {"ingestions": []}
    except (json.JSONDecodeError, OSError, UnicodeDecodeError):
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S")
        db_manifest_path.rename(f"{db_manifest_path}.corrupt.{stamp}")
        manifest = {"ingestions": []}
    ingestions = manifest.get("ingestions")
    if not isinstance(ingestions, list):
        ingestions = []
    key = _dedupe_key(ingestion)
    ingestions = [
        e for e in ingestions
        if not (isinstance(e, dict) and _dedupe_key(e) == key)
    ] + [ingestion]
    manifest["ingestions"] = ingestions
    _write_json_atomico(db_manifest_path, manifest)  # guarda S8707 inclusa


def _atualizar_manifest_servido(out_dir, ingestion: dict, v1_entry: dict) -> None:
    """Recalcula `artifacts` do manifest irmão das saídas (EVOLVE-2 Task 2).

    DECISÃO: o `out_dir` do standalone É o mirror servido — o fato acaba
    de ser escrito ali, então o recalc sempre é possível (sem ramo de
    erro fail-closed). O manifest do `<db dir>` leva a mesma ingestão
    via upsert (`_atualizar_manifest_db`, mesmo predicado — sem fork).
    Aqui o manifest `out_dir/manifest.json` ganha a ingestão (upsert
    idempotente) + `artifacts` via `register_served_artifacts` — reruns
    atualizam o sha do fato sem duplicar. As fontes do recalc são a do
    fato atual + as já atestadas nas ingestões do mirror (só V1 com
    cargo; Censo-type sem cargo nunca gera artifact e é ignorado): sem
    a reconstrução, o replace integral colapsaria a atribuição do trio
    em dir servido multi-par para a fonte única do fato atual. Antes do
    recalc, fatos stray sem proveniência são podados do out_dir com o
    mesmo predicado do build_all (`_prune_fato_sem_proveniencia`,
    reutilizado por import — precedente: `_validate_entry`/`_artifact_entries_for`
    cruzam módulos `etl`): triple que não casa com as fontes atestadas
    nunca é servido hashless; só fato_*.json é tocado, nunca não-fato.
    Guarda S8707 (precedente `etl/build_marts.py::_dentro_de` +
    `_write_json_atomico`, reutilizados por import — sem fork): o
    manifest do mirror precisa resolver estritamente sob o out_dir
    declarado (`..`/escape levanta `ValueError` pt-BR antes de qualquer
    mutação no fs); a escrita é atômica via o helper compartilhado, que
    protege o `.tmp` do mesmo modo. A leitura inicial (`read_text`) é
    read-only e dispensa guarda própria — o `..` é barrado pelo guarda
    de entrada antes dela.
    """
    served_path = Path(out_dir) / "manifest.json"
    _dentro_de(served_path, Path(out_dir))  # fail-closed antes de tudo
    try:
        served = json.loads(served_path.read_text(encoding="utf-8"))
        if not isinstance(served, dict):
            served = {"ingestions": []}
    except FileNotFoundError:
        served = {"ingestions": []}
    except (json.JSONDecodeError, OSError, UnicodeDecodeError):
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S")
        served_path.rename(f"{served_path}.corrupt.{stamp}")
        served = {"ingestions": []}
    ingestions = served.get("ingestions")
    if not isinstance(ingestions, list):
        ingestions = []
    key = _dedupe_key(ingestion)
    ingestions = [
        e for e in ingestions
        if not (isinstance(e, dict) and _dedupe_key(e) == key)
    ] + [ingestion]
    served["ingestions"] = ingestions
    _write_json_atomico(served_path, served)  # guarda S8707 inclusa
    sources = [_served_source_shape(v1_entry)]
    seen = {(v1_entry["ano"], str(v1_entry["cargo"]).upper(), v1_entry["url"])}
    for e in ingestions:
        if (
            isinstance(e, dict)
            and e.get("source_url") and e.get("cargo") is not None
            and e.get("ano") is not None and e.get("dataset") and e.get("tipo")
        ):
            pair = (e["ano"], str(e["cargo"]).upper(), e["source_url"])
            if pair not in seen:
                seen.add(pair)
                sources.append({
                    "url": e["source_url"],
                    "ano": e["ano"],
                    "cargo": e["cargo"],
                    "dataset": e["dataset"],
                    "tipo": e["tipo"],
                })
    # Fail-closed: fato sem fonte atestada seria servido sem hash
    # (`_artifact_entries_for` o ignora) — podar antes do recalc.
    _prune_fato_sem_proveniencia(Path(out_dir), sources)
    register_served_artifacts(served_path, Path(out_dir), sources)


def _tables(con) -> set[str]:
    rows = con.execute(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'main'"
    ).fetchall()
    return {str(r[0]).lower() for r in rows}


def _isna(v) -> bool:
    try:
        return bool(pd.isna(v))
    except (TypeError, ValueError):
        return False


def _int_or_none(v):
    return None if v is None or _isna(v) else int(v)


def _float_or_none(v):
    return None if v is None or _isna(v) else float(v)


def build_fato(duckdb_path, out_dir, ano, turno, cargo,
               censo_total_oficial=None, depara_url=None) -> str:
    """Gera o fato municipal de (ano, turno, cargo); devolve o path do JSON."""
    try:
        ano = int(ano)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"build_fato: ano inválido ({ano!r})") from exc
    try:
        turno = int(turno)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"build_fato: turno inválido ({turno!r})") from exc
    if not isinstance(cargo, str) or not cargo.strip():
        raise ValueError(f"build_fato: cargo inválido ({cargo!r})")
    cargo_upper = cargo.strip().upper()
    cargo_slug = cargo.strip().lower()

    v1_entry = _v1_entry(ano, cargo_upper)  # fail-closed antes de qualquer IO
    tse_url = v1_entry["url"]

    db_path = Path(duckdb_path)
    if not db_path.is_file():
        raise FileNotFoundError(f"build_fato: banco ausente: {db_path}")
    con = duckdb.connect(str(db_path), read_only=True)
    try:
        tables = _tables(con)
        for required in ("fato_voto", "dim_candidato"):
            if required not in tables:
                raise ValueError(
                    f"build_fato: sem dado oficial — tabela {required} "
                    f"ausente em {db_path}"
                )
        if "dim_municipio" not in tables:
            raise ValueError(
                "build_fato: sem dado oficial — tabela dim_municipio ausente "
                f"em {db_path} (Censo não ingerido; ingira o Censo antes de "
                "construir o fato)"
            )
        triple = con.execute(
            "SELECT ano, turno, cargo, uf, municipio_ibge, candidato_id, votos"
            " FROM fato_voto WHERE ano = ? AND turno = ? AND UPPER(cargo) = ?",
            [ano, turno, cargo_upper],
        ).fetchdf()
        dim = con.execute(
            "SELECT candidato_id, nome_urna, partido FROM dim_candidato"
        ).fetchdf()
        censo = con.execute(
            f"SELECT ibge7, {', '.join(DEMO_FIELDS)} FROM dim_municipio"
        ).fetchdf()
        if "fato_eleitorado" in tables:
            eleit = con.execute(
                "SELECT ano, municipio_ibge, eleitorado, abstencoes"
                " FROM fato_eleitorado WHERE ano = ?",
                [ano],
            ).fetchdf()
        else:
            eleit = pd.DataFrame(
                columns=["ano", "municipio_ibge", "eleitorado", "abstencoes"]
            )
    finally:
        con.close()

    if triple.empty:
        raise ValueError(
            f"build_fato: sem dado oficial em fato_voto para "
            f"({ano}, turno {turno}, {cargo_upper})"
        )

    if censo_total_oficial is not None:
        # Gate total-vs-IBGE fail-closed antes de qualquer escrita: Censo
        # com soma divergente nunca vira fato. Sem total oficial
        # (fixtures sintéticos não têm total auditado) o gate é pulado —
        # a chamada sem total assume dado sem soma auditada.
        erros = check_censo_sum(censo, censo_total_oficial)
        if erros:
            raise ValueError(
                "build_fato: gate do Censo reprovou: " + "; ".join(erros)
            )

    triple["municipio_ibge"] = triple["municipio_ibge"].astype("string").fillna("")
    censo_map: dict[str, dict] = {}
    for row in censo.itertuples():
        key = "" if _isna(row.ibge7) else str(row.ibge7).strip()
        if not key or key in censo_map:
            continue  # vazia nunca casa; 1ª ocorrência vence (determinístico)
        censo_map[key] = {f: getattr(row, f) for f in DEMO_FIELDS}

    eleit_map: dict[str, tuple] = {}
    for row in eleit.itertuples():
        key = "" if _isna(row.municipio_ibge) else str(row.municipio_ibge).strip()
        if key and key not in eleit_map:
            eleit_map[key] = (row.eleitorado, row.abstencoes)

    ibges_unicos = set(triple["municipio_ibge"].tolist())
    orphans = sum(1 for b in ibges_unicos if not b or b not in censo_map)
    total_munis = len(ibges_unicos)
    if orphans * 1000 > total_munis:
        pct = 100 * orphans / total_munis
        raise ValueError(
            f"build_fato: orfaos TSE sem par no Censo acima de 0,1%: "
            f"{pct:.2f}% ({orphans}/{total_munis})"
        )

    name_map: dict[str, tuple[str, str]] = {}
    for row in dim.itertuples():
        cid = "" if _isna(row.candidato_id) else str(row.candidato_id)
        if cid and cid not in name_map:
            nome = "" if _isna(row.nome_urna) else str(row.nome_urna)
            part = "" if _isna(row.partido) else str(row.partido)
            name_map[cid] = (nome, part)

    # Ordem determinística: total de votos desc, id asc no desempate.
    cids = sorted(
        {"" if _isna(c) else str(c) for c in triple["candidato_id"].tolist()}
    )
    cid_total: dict[str, int | None] = {}
    as_str = triple["candidato_id"].astype("string").fillna("")
    for cid in cids:
        s = triple.loc[as_str == cid, "votos"].sum(min_count=1)
        cid_total[cid] = None if _isna(s) else int(s)
    order = sorted(
        cids,
        key=lambda cid: (
            -cid_total[cid] if cid_total[cid] is not None else float("inf"),
            cid,
        ),
    )
    candidatos = [
        {"id": cid, "nome": name_map.get(cid, ("", ""))[0],
         "partido": name_map.get(cid, ("", ""))[1]}
        for cid in order
    ]

    municipios = []
    for ibge, grp in triple.groupby("municipio_ibge", sort=True):
        key = "" if _isna(ibge) else str(ibge)
        # Fonte V1 é por zona: soma as linhas por candidato. Ausência de
        # linha = 0 votos (TSE); nulo presente em qualquer zona = incógnita
        # (None, nunca somado nem zerado — propaga p/ o total).
        agregado: dict[str, int | None] = {}
        for row in grp.itertuples():
            cid = "" if _isna(row.candidato_id) else str(row.candidato_id)
            v = _int_or_none(row.votos)
            if cid not in agregado:
                agregado[cid] = v
            elif v is None or agregado[cid] is None:
                agregado[cid] = None
            else:
                agregado[cid] += v
        votos: list = [agregado[cid] if cid in agregado else 0
                       for cid in order]
        total = sum(votos) if all(v is not None for v in votos) else None
        el, ab = eleit_map.get(key, (None, None))
        demo_row = censo_map.get(key)
        if demo_row is None:
            demo = None
        else:
            demo = {f: _float_or_none(demo_row[f]) for f in DEMO_FIELDS[:-1]}
            demo["pop"] = _int_or_none(demo_row["pop"])
            demo["eleitores"] = _int_or_none(el)
        ufs = sorted({"" if _isna(u) else str(u) for u in grp["uf"].tolist()})
        municipios.append(
            {
                "ibge": key,
                "uf": ufs[0] if ufs else "",
                "nome": "",
                "votos": votos,
                "total": total,
                "abst": _int_or_none(ab),
                "demo": demo,
            }
        )

    payload = {"candidatos": candidatos, "municipios": municipios}
    out_dir_p = Path(out_dir)
    out_dir_p.mkdir(parents=True, exist_ok=True)
    out_path = out_dir_p / f"fato_{ano}_{turno}_{cargo_slug}.json"
    # Ordem crash-safe (EVOLVE-3 Task 2, write-fato-then-verify-before-serve):
    # fato primeiro (escrita atômica via helper compartilhado — mesma
    # serialização `json.dump(..., ensure_ascii=False, indent=2)`, bytes
    # idênticos aos do `write_text` anterior; sem janela de rasgo), depois
    # upsert do manifest do <db dir>, porta de consistência e SÓ ENTÃO o
    # mirror servido (porta reprovada levanta com o mirror intocado).
    _write_json_atomico(out_path, payload)
    sha = hashlib.sha256(out_path.read_bytes()).hexdigest()
    fontes = [tse_url, CENSO_DATASETS[0]["dataset"]]
    if depara_url:  # EVOLVE-15: join TSE→IBGE7 aplicado no pipeline
        fontes.append(depara_url)
    ingestion = {
        "source_url": tse_url,
        "sha256": sha,
        "sha_origin": "fato_json",
        "data": datetime.now(timezone.utc).date().isoformat(),
        "etl_version": ETL_VERSION,
        "dataset": f"fato_{ano}_{turno}_{cargo_slug}",
        "ano": ano,
        "turno": turno,
        "cargo": cargo_slug,
        "tipo": "fato_municipal",
        "rows": len(municipios),
        "fontes": fontes,
    }
    db_manifest_path = db_path.parent / "manifest.json"
    _atualizar_manifest_db(db_manifest_path, ingestion)
    # Porta fail-closed ANTES de publicar o mirror (CodeRabbit PR#5 F2):
    # db malformado/inconsistente levanta aqui com o mirror intocado —
    # nunca publica artefato "válido" com proveniência quebrada. O rerun
    # após a remoção do lixo repara (reescreve fato + upsert).
    if not verificar_fato_manifest(db_manifest_path, out_path):
        raise ValueError(
            "build_fato: porta fato×manifest reprovada antes de publicar "
            f"o mirror (fato={out_path}, manifest={db_manifest_path})"
        )
    # Mirror servido (Task 2): o manifest irmão das saídas recalcula
    # `artifacts` sobre os bytes do fato; só executa com a porta acima
    # verde, então o retorno nunca é verde com fato≠manifest.
    _atualizar_manifest_servido(out_dir_p, ingestion, v1_entry)
    return str(out_path)
