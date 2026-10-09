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
- fração de linhas sem par acima de 0,1% (matemática inteira,
  `orfaos*1000 > total`, mesmo padrão de `etl.validate`) → `ValueError`;
- chave IBGE vazia nunca casa (nem mesmo com `""` do Censo);
- triple (ano, turno, cargo) sem linhas → `ValueError` ("sem dado
  oficial", nunca JSON vazio);
- `dim_municipio` ausente → `ValueError` (100% órfãos);
- votos nulos (`Int64` anulável, contrato herdado) atravessam como
  `null`; `total` com qualquer nulo é `null` (total com incógnita não
  é afirmado);
- `(ano, cargo)` fora do escopo V1 → `ValueError` (sem `source_url`
  oficial não há proveniência a registrar).

Proveniência: append no `<db dir>/manifest.json` via `write_manifest`
(validação fail-closed herdada) com `source_url` do TSE (par ano/cargo
do V1), `sha256` do payload JSON produzido, e `fontes: [url TSE,
página do catálogo IBGE]` como fonte dupla. `abst`/`eleitores` vêm de
`fato_eleitorado` quando a tabela/grupo existir, senão `null` (v1 só
tem votação nominal). `nome` do município é `""`: nenhum schema
canônico (TSE ou Censo) carrega nomes — a camada do mapa resolve nomes
por IBGE7 a partir da malha.
"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

import duckdb
import pandas as pd

from etl import ETL_VERSION
from etl.manifest import write_manifest
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


def _v1_tse_url(ano: int, cargo_upper: str) -> str:
    for entry in V1_DATASETS:
        if entry["ano"] == ano and str(entry["cargo"]).upper() == cargo_upper:
            return entry["url"]
    raise ValueError(
        f"build_fato: par (ano, cargo) fora do escopo V1: ({ano}, {cargo_upper})"
    )


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


def build_fato(duckdb_path, out_dir, ano, turno, cargo) -> str:
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

    tse_url = _v1_tse_url(ano, cargo_upper)  # fail-closed antes de qualquer IO

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
                f"em {db_path} (Censo não ingerido; URL pendente, Task 1)"
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

    ibges = triple["municipio_ibge"].tolist()
    orphans = sum(1 for b in ibges if not b or b not in censo_map)
    total_rows = len(triple)
    if orphans * 1000 > total_rows:
        pct = 100 * orphans / total_rows
        raise ValueError(
            f"build_fato: orfaos TSE sem par no Censo acima de 0,1%: "
            f"{pct:.2f}% ({orphans}/{total_rows})"
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
    pos = {cid: k for k, cid in enumerate(order)}

    municipios = []
    for ibge, grp in triple.groupby("municipio_ibge", sort=True):
        key = "" if _isna(ibge) else str(ibge)
        votos: list = [None] * len(order)
        for row in grp.itertuples():
            cid = "" if _isna(row.candidato_id) else str(row.candidato_id)
            votos[pos[cid]] = _int_or_none(row.votos)
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
    out_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    sha = hashlib.sha256(out_path.read_bytes()).hexdigest()
    write_manifest(
        db_path.parent / "manifest.json",
        {
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
            "fontes": [tse_url, CENSO_DATASETS[0]["dataset"]],
        },
    )
    return str(out_path)
