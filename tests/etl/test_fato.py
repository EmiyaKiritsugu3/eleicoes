"""Task 2 (RED-first): fato municipal — join TSE × Censo.

RED: estes testes devem FALHAR contra o repo pré-Task 2
(módulo etl.build_fato ausente).

Contrato sob teste:
`etl.build_fato.build_fato(duckdb_path, out_dir, ano, turno, cargo) -> str`
devolve o path de `fato_<ano>_<turno>_<cargo>.json` com shape
`{candidatos: [{id, nome, partido}], municipios: [{ibge, uf, nome,
votos: [...], total, abst, demo: {...} | null}]}`.

Os frames do Censo são sempre sintéticos via `normalize_censo`
(Censo real indisponível — URL pendente, Task 1); nenhum teste
faz download.
"""

import hashlib
import json

import duckdb
import pandas as pd

CANDS = [
    ("13", "CANDIDATA EXEMPLO A", "PA"),
    ("22", "CANDIDATO EXEMPLO B", "PB"),
]

_DEMO_FIELDS = [
    "esc_sup",
    "esc_med",
    "esc_fund",
    "renda_media",
    "pobres_pct",
    "idade_mediana",
    "urbanizacao",
    "pop",
]


def _ibge(i: int) -> str:
    """Código IBGE7 sintético válido (7 dígitos, nunca 0000000)."""
    return f"{3500000 + i:07d}"


def _censo_raw(ibges, pop_base=10000):
    """Frame bruto com header estilo IBGE/SIDRA p/ normalize_censo."""
    return pd.DataFrame(
        [
            {
                "CD_MUN": ibge,
                "P_SUPERIOR": 20.0 + (k % 7),
                "P_MEDIO": 35.0,
                "P_FUNDAMENTAL": 45.0,
                "RENDIMENTO_MEDIO": 2500.0 + k * 10,
                "TX_POBREZA": 15.0,
                "IDADE_MEDIANA": 33.0,
                "TX_URBANIZACAO": 90.0,
                "POP_RESIDENTE": pop_base + k,
            }
            for k, ibge in enumerate(ibges)
        ]
    )


def _seed_duckdb(path, fato_df, censo_df=None, eleitorado_df=None):
    """Escreve fato_voto + dim_candidato (+ dim_municipio/fato_eleitorado)."""
    from etl.censo import normalize_censo

    path = str(path)
    dim = (
        fato_df[["candidato_id", "nome_urna", "partido"]]
        .drop_duplicates()
        .reset_index(drop=True)
    )
    con = duckdb.connect(path)
    try:
        con.register("fato_df", fato_df)
        con.register("dim_df", dim)
        con.execute("CREATE OR REPLACE TABLE fato_voto AS SELECT * FROM fato_df")
        con.execute("CREATE OR REPLACE TABLE dim_candidato AS SELECT * FROM dim_df")
        if censo_df is not None:
            norm = normalize_censo(censo_df)
            con.register("censo_df", norm)
            con.execute(
                "CREATE OR REPLACE TABLE dim_municipio AS SELECT * FROM censo_df"
            )
        if eleitorado_df is not None:
            con.register("eleit_df", eleitorado_df)
            con.execute(
                "CREATE OR REPLACE TABLE fato_eleitorado AS SELECT * FROM eleit_df"
            )
        else:
            con.execute(
                "CREATE OR REPLACE TABLE fato_eleitorado ("
                "ano BIGINT, uf VARCHAR, municipio_ibge VARCHAR, "
                "eleitorado BIGINT, abstencoes BIGINT)"
            )
    finally:
        con.close()


def _fato_rows(ibges, ano=2022, turno=1, cargo="PRESIDENTE", uf="SP"):
    rows = []
    for i, ibge in enumerate(ibges):
        for j, (cid, nome, part) in enumerate(CANDS):
            rows.append(
                {
                    "ano": ano,
                    "turno": turno,
                    "cargo": cargo,
                    "uf": uf,
                    "municipio_ibge": ibge,
                    "candidato_id": cid,
                    "nome_urna": nome,
                    "partido": part,
                    "votos": (i * 7 + j * 13) % 97 + 1,
                }
            )
    df = pd.DataFrame(rows)
    df["ano"] = df["ano"].astype("int64")
    df["turno"] = df["turno"].astype("int64")
    df["votos"] = df["votos"].astype("Int64")
    return df


def test_fato_sums_match_fato_voto(tmp_path):
    from etl.build_fato import build_fato

    ibges = [_ibge(1), _ibge(2)]
    fato_df = _fato_rows(ibges)
    eleit = pd.DataFrame(
        [
            {"ano": 2022, "uf": "SP", "municipio_ibge": b,
             "eleitorado": 1000 + k, "abstencoes": 100 + k}
            for k, b in enumerate(ibges)
        ]
    )
    db = tmp_path / "t.duckdb"
    _seed_duckdb(db, fato_df, _censo_raw(ibges), eleit)

    out = build_fato(str(db), str(tmp_path / "out"), 2022, 1, "PRESIDENTE")
    payload = json.loads(open(out, encoding="utf-8").read())

    assert [c["id"] for c in payload["candidatos"]] == ["22", "13"]  # total desc
    assert payload["candidatos"][0] == {
        "id": "22",
        "nome": "CANDIDATO EXEMPLO B",
        "partido": "PB",
    }
    got = sum(v for m in payload["municipios"] for v in m["votos"])
    assert got == int(fato_df["votos"].sum())
    assert len(payload["municipios"]) == 2
    for m in payload["municipios"]:
        assert set(m) == {"ibge", "uf", "nome", "votos", "total", "abst", "demo"}
        assert len(m["votos"]) == 2
        assert m["total"] == sum(m["votos"])
        assert m["abst"] in (100, 101)
        assert m["demo"] is not None
        assert set(m["demo"]) == set(_DEMO_FIELDS + ["eleitores"])
        assert m["demo"]["eleitores"] in (1000, 1001)


def test_join_miss_keeps_votes_no_demo(tmp_path):
    from etl.build_fato import build_fato

    # 1100 munis × 2 cands = 2200 linhas; 1 muni (2 linhas) sem par
    # no Censo -> 2*1000 <= 2200, abaixo do teto de 0,1%.
    ibges = [_ibge(i) for i in range(1, 1101)]
    missing = ibges[-1]
    fato_df = _fato_rows(ibges)
    db = tmp_path / "t.duckdb"
    _seed_duckdb(db, fato_df, _censo_raw(ibges[:-1]))

    out = build_fato(str(db), str(tmp_path / "out"), 2022, 1, "PRESIDENTE")
    payload = json.loads(open(out, encoding="utf-8").read())

    by_ibge = {m["ibge"]: m for m in payload["municipios"]}
    assert len(by_ibge) == 1100
    miss = by_ibge[missing]
    assert miss["demo"] is None  # sem par no Censo -> sem dado oficial
    order = [c["id"] for c in payload["candidatos"]]
    expected = [
        int(
            fato_df[
                (fato_df["municipio_ibge"] == missing)
                & (fato_df["candidato_id"] == cid)
            ]["votos"].iloc[0]
        )
        for cid in order
    ]
    assert miss["votos"] == expected  # votos intactos, na ordem de candidatos
    assert miss["total"] == sum(expected)
    assert by_ibge[ibges[0]]["demo"] is not None
    got = sum(
        v for m in payload["municipios"] for v in m["votos"] if v is not None
    )
    assert got == int(fato_df["votos"].sum())


def test_join_orphans_above_threshold_raise(tmp_path):
    from etl.build_fato import build_fato

    ibges = [_ibge(i) for i in range(1, 1101)]
    fato_df = _fato_rows(ibges)
    db = tmp_path / "t.duckdb"
    # 5 munis (10 linhas) sem par: 10*1000 > 2200 -> fail-closed.
    _seed_duckdb(db, fato_df, _censo_raw(ibges[:-5]))
    import pytest

    with pytest.raises(ValueError, match="(?i)orfa"):
        build_fato(str(db), str(tmp_path / "out"), 2022, 1, "PRESIDENTE")


def test_missing_dim_municipio_raises(tmp_path):
    import pytest

    from etl.build_fato import build_fato

    ibges = [_ibge(1)]
    db = tmp_path / "t.duckdb"
    _seed_duckdb(db, _fato_rows(ibges), None)
    with pytest.raises(ValueError, match="(?i)censo|dim_municipio|sem dado"):
        build_fato(str(db), str(tmp_path / "out"), 2022, 1, "PRESIDENTE")


def test_unknown_triple_raises(tmp_path):
    import pytest

    from etl.build_fato import build_fato

    ibges = [_ibge(1)]
    db = tmp_path / "t.duckdb"
    _seed_duckdb(db, _fato_rows(ibges), _censo_raw(ibges))
    # turno sem linhas p/ o triple -> sem dado oficial, nunca JSON vazio.
    with pytest.raises(ValueError, match="(?i)sem dado|vazio|fora"):
        build_fato(str(db), str(tmp_path / "out"), 2022, 2, "PRESIDENTE")


def test_null_votes_stay_null(tmp_path):
    from etl.build_fato import build_fato

    ibges = [_ibge(1)]
    fato_df = _fato_rows(ibges)
    fato_df.loc[1, "votos"] = pd.NA  # contrato: nulo anulável, nunca 0
    db = tmp_path / "t.duckdb"
    _seed_duckdb(db, fato_df, _censo_raw(ibges))

    out = build_fato(str(db), str(tmp_path / "out"), 2022, 1, "PRESIDENTE")
    payload = json.loads(open(out, encoding="utf-8").read())
    muni = payload["municipios"][0]
    assert None in muni["votos"]  # nulo visível p/ os gates, nunca 0
    assert muni["total"] is None  # total com incógnita não é afirmado


def test_manifest_entry_dual_source(tmp_path):
    from etl.build_fato import build_fato
    from etl.manifest import verify_manifest

    ibges = [_ibge(1), _ibge(2)]
    db = tmp_path / "t.duckdb"
    _seed_duckdb(db, _fato_rows(ibges), _censo_raw(ibges))

    out = build_fato(str(db), str(tmp_path / "out"), 2022, 1, "PRESIDENTE")
    manifest = tmp_path / "manifest.json"  # <db dir>/manifest.json
    assert verify_manifest(str(manifest)) is True
    entries = json.loads(manifest.read_text(encoding="utf-8"))["ingestions"]
    assert len(entries) == 1
    entry = entries[0]
    assert entry["source_url"]  # truthy (TSE, par ano/cargo do V1)
    assert "tse.jus.br" in entry["source_url"]
    payload_sha = hashlib.sha256(open(out, "rb").read()).hexdigest()
    assert entry["sha256"] == payload_sha
    assert entry["ano"] == 2022 and entry["turno"] == 1
    assert entry["cargo"] == "presidente"
    assert entry["etl_version"] == "1.1.0"
    from datetime import date

    assert date.fromisoformat(entry["data"]) <= date.today()
