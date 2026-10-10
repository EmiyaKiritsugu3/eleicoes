"""EVOLVE-2 Task 5 — recovery de promote via .prev (fail-closed).

Cobre o crash entre promotes do stage-then-promote: a troca de cada alvo
com o público é atômica, mas o loop de promotes não — um crash no meio
deixa a árvore meio-promovida (parte dos alvos na geração nova, parte na
antiga). O próximo `build_all` precisa detectar a mistura e falhar
fail-closed em pt-BR antes de publicar qualquer coisa (nunca publicar um
mix), com os públicos intactos.
"""

import json
from pathlib import Path

import duckdb
import pytest

import etl.build_marts as bm
from etl.build_marts import build_all

_GEN1_CSV = (
    "ANO_ELEICAO;DS_CARGO;SG_UF;CD_MUNICIPIO;NM_URNA;QT_VOTOS\n"
    "2022;PRESIDENTE;SP;3550308;X;10\n"
    "2022;PRESIDENTE;RJ;3304557;Y;5\n"
)

# Geração distinta: mesmos pares (ano, cargo) no escopo V1, totais e
# contagem diferentes (15 votos/2 linhas -> 22 votos/3 linhas).
_GEN2_CSV = (
    "ANO_ELEICAO;DS_CARGO;SG_UF;CD_MUNICIPIO;NM_URNA;QT_VOTOS\n"
    "2022;PRESIDENTE;SP;3550308;X;10\n"
    "2022;PRESIDENTE;RJ;3304557;Y;5\n"
    "2022;PRESIDENTE;MG;3106200;Z;7\n"
)


# Mesmos totais e contagem da gen1 (15 votos/2 linhas), distribuição por UF
# distinta (SP 10→8, RJ 5→7): agregados globais iguais, conteúdo distinto.
_GEN3_CSV = (
    "ANO_ELEICAO;DS_CARGO;SG_UF;CD_MUNICIPIO;NM_URNA;QT_VOTOS\n"
    "2022;PRESIDENTE;SP;3550308;X;8\n"
    "2022;PRESIDENTE;RJ;3304557;Y;7\n"
)


def _novo_caso(tmp_path):
    curated = tmp_path / "curated"
    curated.mkdir()
    (curated / "raw.csv").write_text(_GEN1_CSV, encoding="utf-8")
    return curated, tmp_path / "t.duckdb", tmp_path / "m.json", tmp_path / "webdata"


def _total_votos(db_path):
    con = duckdb.connect(str(db_path))
    try:
        return con.execute("SELECT SUM(votos) FROM fato_voto").fetchone()[0]
    finally:
        con.close()


def _snapshot_public(crated, db, manifest, webdata):
    snap = {}
    snap["partitions"] = {
        str(p.relative_to(crated)): p.read_bytes()
        for p in sorted(crated.rglob("*.parquet"))
    }
    snap["db"] = Path(db).read_bytes()
    snap["manifest"] = Path(manifest).read_bytes()
    snap["web"] = {
        p.name: p.read_bytes()
        for p in sorted(Path(webdata).iterdir()) if p.is_file()
    }
    return snap


def _crash_entre_promotes(n_ok=2):
    """Troca `_promote` por versão que quebra após `n_ok` swaps (crash).

    Devolve o `_promote` original para restauração pelo chamador.
    """
    original = bm._promote
    feitos = {"n": 0}

    def _quebrado(staging, target):
        if feitos["n"] >= n_ok:
            raise RuntimeError("crash simulado entre promotes")
        feitos["n"] += 1
        return original(staging, target)

    bm._promote = _quebrado
    return original


def test_arvore_meio_promovida_falha_fail_closed_sem_publicar(tmp_path):
    """Crash entre promotes (dados novos) -> próximo build falha em pt-BR.

    A geração meio-promovida nunca é publicada por cima: o build seguinte
    levanta `RuntimeError` com mensagem pt-BR antes de qualquer escrita e
    os públicos seguem byte-idênticos ao estado do crash.
    """
    curated, db, manifest, webdata = _novo_caso(tmp_path)
    build_all(curated, db, manifest, web_data_dir=webdata)
    assert _total_votos(db) == 15

    # Geração nova, distinta, com crash após 2 promotes (curated+web novas;
    # db+manifest antigas).
    (curated / "raw.csv").write_text(_GEN2_CSV, encoding="utf-8")
    original = _crash_entre_promotes(n_ok=2)
    try:
        with pytest.raises(RuntimeError, match="crash simulado"):
            build_all(curated, db, manifest, web_data_dir=webdata)
    finally:
        bm._promote = original
    # Estado do crash: mistura real entre gerações (web nova x db antigo).
    assert json.loads((webdata / "resumo.json").read_text(encoding="utf-8"))[
        "total_votos"] == 22
    assert _total_votos(db) == 15

    snap = _snapshot_public(curated, db, manifest, webdata)
    with pytest.raises(RuntimeError, match="meio-promovida"):
        build_all(curated, db, manifest, web_data_dir=webdata)
    current = _snapshot_public(curated, db, manifest, webdata)
    assert current == snap  # fail-closed: nada publicado, nada tocado


def test_crash_com_mesmos_dados_recupera_sem_falso_positivo(tmp_path):
    """Crash entre promotes sem mudança de dados não bloqueia o rebuild.

    A mistura é integral-equivalente (mesmos totais) — o próximo build
    sucede, publica a geração íntegra e não deixa restos `.tmp`.
    """
    curated, db, manifest, webdata = _novo_caso(tmp_path)
    build_all(curated, db, manifest, web_data_dir=webdata)
    assert _total_votos(db) == 15

    original = _crash_entre_promotes(n_ok=2)
    try:
        with pytest.raises(RuntimeError, match="crash simulado"):
            build_all(curated, db, manifest, web_data_dir=webdata)
    finally:
        bm._promote = original

    build_all(curated, db, manifest, web_data_dir=webdata)
    assert _total_votos(db) == 15
    assert json.loads((webdata / "resumo.json").read_text(encoding="utf-8"))[
        "total_votos"] == 15
    assert [p for p in tmp_path.rglob("*.tmp")] == []


def test_crash_apos_primeiro_promote_detecta_via_curated(tmp_path):
    """Crash após 1 promote (só curated nova) -> próximo build falha.

    A perna curated do cross-check precisa enxergar os `data.parquet`
    publicados: sem ela, db+web+manifest (todos da geração antiga,
    consistentes entre si) passam silenciosamente e o mix é publicado.
    """
    curated, db, manifest, webdata = _novo_caso(tmp_path)
    build_all(curated, db, manifest, web_data_dir=webdata)
    assert _total_votos(db) == 15

    (curated / "raw.csv").write_text(_GEN2_CSV, encoding="utf-8")
    original = _crash_entre_promotes(n_ok=1)
    try:
        with pytest.raises(RuntimeError, match="crash simulado"):
            build_all(curated, db, manifest, web_data_dir=webdata)
    finally:
        bm._promote = original
    # Estado do crash: só o curated promoveu (db+web seguem antigos).
    assert _total_votos(db) == 15
    assert json.loads((webdata / "resumo.json").read_text(encoding="utf-8"))[
        "total_votos"] == 15

    snap = _snapshot_public(curated, db, manifest, webdata)
    with pytest.raises(RuntimeError, match="meio-promovida"):
        build_all(curated, db, manifest, web_data_dir=webdata)
    assert _snapshot_public(curated, db, manifest, webdata) == snap


def test_mesmos_totais_distribuicao_distinta_falha(tmp_path):
    """Mix com agregados globais iguais mas distribuição por UF distinta falha.

    Totais e contagens iguais não provam mesma geração (ex. retificação que
    desloca votos entre UFs): o cross-check por UF precisa acusar o mix.
    """
    curated, db, manifest, webdata = _novo_caso(tmp_path)
    build_all(curated, db, manifest, web_data_dir=webdata)
    assert _total_votos(db) == 15

    (curated / "raw.csv").write_text(_GEN3_CSV, encoding="utf-8")
    original = _crash_entre_promotes(n_ok=2)
    try:
        with pytest.raises(RuntimeError, match="crash simulado"):
            build_all(curated, db, manifest, web_data_dir=webdata)
    finally:
        bm._promote = original
    # Agregados globais idênticos entre gerações (15 votos/2 linhas).
    assert json.loads((webdata / "resumo.json").read_text(encoding="utf-8"))[
        "total_votos"] == 15
    assert _total_votos(db) == 15

    snap = _snapshot_public(curated, db, manifest, webdata)
    with pytest.raises(RuntimeError, match="meio-promovida"):
        build_all(curated, db, manifest, web_data_dir=webdata)
    assert _snapshot_public(curated, db, manifest, webdata) == snap
