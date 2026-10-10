"""Fix-round tests para etl/build_marts.py (Task 3).

(a) re-ingestão no mesmo dir não duplica votos;
(b) `web_data_dir=` redireciona os JSONs (build hermético);
(c) arquivo corrompido emite warning com o nome do arquivo e não derruba o build.
"""

import importlib.util
import json
from pathlib import Path

import duckdb
import pytest

from etl.build_marts import build_all

_CSV = (
    "ANO_ELEICAO;DS_CARGO;SG_UF;CD_MUNICIPIO;NM_URNA;QT_VOTOS\n"
    "2022;PRESIDENTE;SP;3550308;X;10\n"
    "2022;PRESIDENTE;RJ;3304557;Y;5\n"
)


def _seed(curated):
    (curated / "raw.csv").write_text(_CSV, encoding="utf-8")


def _total_votos(db_path):
    con = duckdb.connect(str(db_path))
    try:
        return con.execute("SELECT SUM(votos) FROM fato_voto").fetchone()[0]
    finally:
        con.close()


def test_double_build_same_dir_does_not_double_votes(tmp_path):
    curated = tmp_path / "curated"
    curated.mkdir()
    _seed(curated)
    webdata = tmp_path / "webdata"
    db = tmp_path / "t.duckdb"
    manifest = tmp_path / "m.json"
    build_all(curated, db, manifest, web_data_dir=webdata)
    first = _total_votos(db)
    resumo1 = json.loads((webdata / "resumo.json").read_text(encoding="utf-8"))
    build_all(curated, db, manifest, web_data_dir=webdata)
    second = _total_votos(db)
    resumo2 = json.loads((webdata / "resumo.json").read_text(encoding="utf-8"))
    assert first == 15
    assert second == first
    assert resumo2["total_votos"] == resumo1["total_votos"] == 15


def test_web_data_dir_override(tmp_path):
    curated = tmp_path / "curated"
    curated.mkdir()
    _seed(curated)
    webdata = tmp_path / "public"
    build_all(curated, tmp_path / "t.duckdb", tmp_path / "m.json", web_data_dir=webdata)
    for name in ("resumo.json", "por_uf.json", "por_candidato.json"):
        assert (webdata / name).exists()


def test_corrupt_file_warns_with_filename(tmp_path):
    curated = tmp_path / "curated"
    curated.mkdir()
    _seed(curated)
    (curated / "bad.parquet").write_bytes(b"\x00\x01\x02not-a-parquet-file")
    webdata = tmp_path / "webdata"
    with pytest.warns(UserWarning, match="bad.parquet"):
        build_all(curated, tmp_path / "t.duckdb", tmp_path / "m.json", web_data_dir=webdata)
    assert _total_votos(tmp_path / "t.duckdb") == 15


_BAD_VOTOS_CSV = (
    "ANO_ELEICAO;DS_CARGO;SG_UF;CD_MUNICIPIO;NM_URNA;QT_VOTOS\n"
    "2022;PRESIDENTE;SP;3550308;X;abc\n"
    "2022;PRESIDENTE;RJ;3304557;Y;5\n"
)


def test_build_all_raises_when_gates_fail_and_keeps_public_outputs(tmp_path):
    """Votos nulos (QT_VOTOS=abc -> Int64 nulo, Task 2) reprovam os gates.

    build_all levanta RuntimeError ANTES dos JSONs/manifest: saídas
    públicas anteriores seguem intactas (C2-contrato).
    """
    curated = tmp_path / "curated"
    curated.mkdir()
    (curated / "raw.csv").write_text(_BAD_VOTOS_CSV, encoding="utf-8")
    webdata = tmp_path / "webdata"
    webdata.mkdir()
    (webdata / "manifest.json").write_text('{"ingestions": []}', encoding="utf-8")
    (webdata / "resumo.json").write_text('{"total_votos": 0}', encoding="utf-8")
    with pytest.raises(RuntimeError, match="gates reprovados") as excinfo:
        build_all(curated, tmp_path / "t.duckdb", tmp_path / "m.json",
                  web_data_dir=webdata)
    assert "soma" in str(excinfo.value)  # gate de nulos, não manifest/órfãos
    assert json.loads((webdata / "manifest.json").read_text(encoding="utf-8")) == {
        "ingestions": []}
    assert json.loads((webdata / "resumo.json").read_text(encoding="utf-8")) == {
        "total_votos": 0}
    assert not (webdata / "por_uf.json").exists()
    assert not (webdata / "por_candidato.json").exists()


def _load_seed_module():
    repo_root = Path(__file__).resolve().parents[2]
    spec = importlib.util.spec_from_file_location(
        "seed_fixture_data", repo_root / "scripts" / "seed_fixture_data.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_seed_backs_up_manifest_on_failure(tmp_path, monkeypatch):
    """Manifest oficial + build que falha -> .bak criado e original restaurado."""
    mod = _load_seed_module()
    manifest_path = tmp_path / "manifest.json"
    official = {"ingestions": [
        {"source_url": "https://example/tse.zip", "sha256": "abc123"}]}
    manifest_path.write_text(json.dumps(official), encoding="utf-8")
    webdata = tmp_path / "webdata"

    def _boom(*args, **kwargs):
        raise RuntimeError("build explodiu após unlink")

    monkeypatch.setattr("etl.build_marts.build_all", _boom)
    with pytest.raises(RuntimeError, match="build explodiu"):
        mod.seed(manifest_path, webdata, force=True)
    bak = tmp_path / "manifest.json.bak"
    assert json.loads(bak.read_text(encoding="utf-8")) == official
    assert json.loads(manifest_path.read_text(encoding="utf-8")) == official


# --- Task 7 (E6): idempotência ---

def _ingestions(manifest):
    return json.loads(Path(manifest).read_text(encoding="utf-8"))["ingestions"]


def test_rebuild_does_not_duplicate_entries(tmp_path):
    curated = tmp_path / "curated"
    curated.mkdir()
    _seed(curated)
    webdata = tmp_path / "webdata"
    db = tmp_path / "t.duckdb"
    manifest = tmp_path / "m.json"
    build_all(curated, db, manifest, web_data_dir=webdata)
    first_entries = _ingestions(manifest)
    first_votos = _total_votos(db)
    build_all(curated, db, manifest, web_data_dir=webdata)
    second_entries = _ingestions(manifest)
    second_votos = _total_votos(db)
    assert len(second_entries) == len(first_entries) == 1
    assert second_votos == first_votos == 15


_SP_ONLY_CSV = (
    "ANO_ELEICAO;DS_CARGO;SG_UF;CD_MUNICIPIO;NM_URNA;QT_VOTOS\n"
    "2022;PRESIDENTE;SP;3550308;X;10\n"
)


def test_shrunk_source_drops_partitions(tmp_path):
    curated = tmp_path / "curated"
    curated.mkdir()
    _seed(curated)  # SP + RJ
    webdata = tmp_path / "webdata"
    db = tmp_path / "t.duckdb"
    manifest = tmp_path / "m.json"
    build_all(curated, db, manifest, web_data_dir=webdata)
    assert _total_votos(db) == 15
    (curated / "raw.csv").write_text(_SP_ONLY_CSV, encoding="utf-8")
    build_all(curated, db, manifest, web_data_dir=webdata)
    leftovers = [p for p in curated.rglob("*.parquet") if "uf=RJ" in p.parts]
    assert leftovers == []
    assert _total_votos(db) == 10


def test_build_500k_rows_counts(tmp_path):
    import pandas as pd

    from etl.normalize import CANONICAL_COLUMNS

    n = 500_000
    ufs = ["SP", "RJ", "MG"]
    uf_col = [ufs[i % 3] for i in range(n)]
    votos_col = [(i % 100) + 1 for i in range(n)]  # 1..100, sem nulos
    df = pd.DataFrame({
        "ano": pd.Series([2022] * n, dtype="int64"),
        "turno": pd.Series([1] * n, dtype="int64"),
        "cargo": pd.Series(["PRESIDENTE"] * n, dtype="string"),
        "uf": pd.Series(uf_col, dtype="string"),
        "municipio_ibge": pd.Series(
            [f"{3550308 + (i % 1000):07d}" for i in range(n)], dtype="string"),
        "candidato_id": pd.Series([str(10 + (i % 5)) for i in range(n)],
                                  dtype="string"),
        "nome_urna": pd.Series([f"CAND{i % 5}" for i in range(n)],
                               dtype="string"),
        "partido": pd.Series([f"P{i % 5}" for i in range(n)], dtype="string"),
        "votos": pd.Series(votos_col, dtype="int64"),
    })[CANONICAL_COLUMNS]
    expected_total = int(df["votos"].sum())
    expected_by_uf = {
        uf: int(df.loc[df["uf"] == uf, "votos"].sum()) for uf in ufs
    }
    curated = tmp_path / "curated"
    curated.mkdir()
    df.to_parquet(curated / "big.parquet", index=False)
    webdata = tmp_path / "webdata"
    db = tmp_path / "t.duckdb"
    manifest = tmp_path / "m.json"
    build_all(curated, db, manifest, web_data_dir=webdata)
    assert _total_votos(db) == expected_total
    por_uf = json.loads((webdata / "por_uf.json").read_text(encoding="utf-8"))
    got_by_uf = {r["uf"]: r["votos"] for r in por_uf}
    assert got_by_uf == expected_by_uf
    for uf in ufs:
        assert (curated / "ano=2022" / "cargo=PRESIDENTE" / f"uf={uf}"
                / "data.parquet").exists()


def _censo_entry_date(manifest_path):
    manifest = json.loads(Path(manifest_path).read_text(encoding="utf-8"))
    for entry in manifest.get("ingestions", []):
        if isinstance(entry, dict) and entry.get("tipo") == "censo_ibge_2022":
            return entry.get("data")
    raise AssertionError("seed sem entry censo_ibge_2022 no manifest")


def test_seed_censo_entry_date_is_pinned(tmp_path):
    """Task 11 fix: data do Censo fixture é fixa entre runs (determinismo).

    Roda seed() duas vezes em dirs isolados: as datas do entry
    censo_ibge_2022 devem ser iguais entre si e ao valor fixo
    (ingestões reais seguem com a data da coleta).
    """
    mod = _load_seed_module()
    dates = []
    for i in ("a", "b"):
        d = tmp_path / i
        d.mkdir()
        mod.seed(d / "manifest.json", d / "webdata")
        dates.append(_censo_entry_date(d / "manifest.json"))
    assert dates[0] == dates[1] == "2022-01-01"


# --- EVOLVE-1 Task 4: stage-then-promote ---

def _snapshot_public(curated, db, manifest, webdata):
    """Bytes públicos pós-build-bom: partições, DB, manifest + JSONs."""
    snap = {}
    snap["partitions"] = {
        str(p.relative_to(curated)): p.read_bytes()
        for p in sorted(curated.rglob("*.parquet"))
    }
    snap["db"] = Path(db).read_bytes()
    snap["manifest"] = Path(manifest).read_bytes()
    snap["web"] = {
        p.name: p.read_bytes()
        for p in sorted(Path(webdata).iterdir()) if p.is_file()
    }
    return snap


def _assert_public_intact(snap, curated, db, manifest, webdata):
    current = _snapshot_public(curated, db, manifest, webdata)
    assert current == snap


def _staging_paths(curated, db, manifest, webdata):
    return [Path(f"{p}.tmp") for p in (curated, db, manifest, webdata)]


def _assert_no_staging(curated, db, manifest, webdata):
    leftovers = [p for p in _staging_paths(curated, db, manifest, webdata)
                 if p.exists() or p.is_symlink()]
    assert leftovers == []


def test_gate_failure_keeps_previous_outputs(tmp_path):
    """Build bom -> snapshot; build ruim -> RuntimeError + públicos intactos.

    Stage-then-promote: gates rodam contra o DB staged; a falha deleta só
    o staging — Parquet particionado, DuckDB, JSONs e manifest anteriores
    seguem byte-idênticos.
    """
    curated, db, manifest, webdata = _novo_caso(tmp_path)
    build_all(curated, db, manifest, web_data_dir=webdata)
    assert _total_votos(db) == 15
    snap = _snapshot_public(curated, db, manifest, webdata)
    (curated / "raw.csv").write_text(_BAD_VOTOS_CSV, encoding="utf-8")
    with pytest.raises(RuntimeError, match="gates reprovados"):
        build_all(curated, db, manifest, web_data_dir=webdata)
    assert _total_votos(db) == 15
    _assert_public_intact(snap, curated, db, manifest, webdata)
    _assert_no_staging(curated, db, manifest, webdata)


def test_stale_staging_cleaned(tmp_path):
    """.tmp obsoleto pré-existente (crash anterior) nunca promove parcial.

    Build bom sucede, o staging obsoleto é descartado (sem restos `.tmp`)
    e as saídas refletem só os dados atuais.
    """
    curated, db, manifest, webdata = _novo_caso(tmp_path)
    for stale in _staging_paths(curated, db, manifest, webdata):
        if stale.name.endswith(".duckdb.tmp") or stale.name.endswith(".json.tmp"):
            stale.parent.mkdir(parents=True, exist_ok=True)
            stale.write_bytes(b"staging-obsoleto")
        else:
            stale.mkdir(parents=True, exist_ok=True)
            (stale / "junk.txt").write_text("staging-obsoleto", encoding="utf-8")
    build_all(curated, db, manifest, web_data_dir=webdata)
    assert _total_votos(db) == 15
    assert json.loads((webdata / "resumo.json").read_text(encoding="utf-8"))[
        "total_votos"] == 15
    assert len(_ingestions(manifest)) == 1
    _assert_no_staging(curated, db, manifest, webdata)
    assert list(curated.rglob("junk.txt")) == []
    assert list(webdata.rglob("junk.txt")) == []


# --- Guarda S8707 (path traversal): alvos derivados confinados à raiz declarada ---

def _novo_caso(tmp_path, csv=_CSV):
    """Setup padrão dos testes de stage-then-promote (sem duplicar boilerplate)."""
    curated = tmp_path / "curated"
    curated.mkdir()
    (curated / "raw.csv").write_text(csv, encoding="utf-8")
    return curated, tmp_path / "t.duckdb", tmp_path / "m.json", tmp_path / "webdata"


def test_remove_path_fora_da_raiz_levanta(tmp_path):
    """_remove_path fora da raiz declarada levanta ValueError sem deletar (S8707)."""
    from etl.build_marts import _remove_path

    alvo = tmp_path / "canario.txt"
    alvo.write_text("intacto", encoding="utf-8")
    with pytest.raises(ValueError, match="fora da raiz"):
        _remove_path(alvo, tmp_path / "outra-raiz")
    assert alvo.read_text(encoding="utf-8") == "intacto"


def test_remove_path_com_dotdot_levanta(tmp_path):
    """`..` no alvo é bloqueado antes de qualquer unlink (fail-closed, S8707)."""
    from etl.build_marts import _remove_path

    with pytest.raises(ValueError, match="bloqueado"):
        _remove_path(tmp_path / "a" / ".." / "evil.txt", tmp_path)


def test_promote_com_dotdot_levanta_e_preserva(tmp_path):
    """_promote com `..` no staging levanta sem renomear nada (S8707)."""
    from etl.build_marts import _promote

    alvo = tmp_path / "alvo.txt"
    alvo.write_text("publico", encoding="utf-8")
    with pytest.raises(ValueError, match="bloqueado"):
        _promote(tmp_path / "sub" / ".." / "evil.tmp", alvo)
    assert alvo.read_text(encoding="utf-8") == "publico"
    assert not (tmp_path / "alvo.txt.prev").exists()


def test_build_all_com_dotdot_no_curated_levanta_sem_efeito(tmp_path):
    """curated com `..` levanta ValueError antes de criar/deletar (S8707)."""
    canario = tmp_path / "canario.txt"
    canario.write_text("intacto", encoding="utf-8")
    travessia = tmp_path / "a" / ".." / "evil"
    with pytest.raises(ValueError, match="bloqueado"):
        build_all(travessia, tmp_path / "t.duckdb", tmp_path / "m.json",
                  web_data_dir=tmp_path / "webdata")
    assert not (tmp_path / "evil").exists()
    assert [p for p in tmp_path.rglob("*.tmp")] == []
    assert [p for p in tmp_path.rglob("*.prev")] == []
    assert canario.read_text(encoding="utf-8") == "intacto"


# --- #13: fato staged sem proveniência nunca promove hashless (fail-closed) ---

def test_fato_sem_proveniencia_nao_promove(tmp_path):
    """fato_*.json obsoleto no web_dir não aparece no webdata promovido.

    O staging copia o web_dir inteiro (incl. fato_*); triple sem match
    nas fontes do build não gera entry de hash — o arquivo precisa ser
    podado do staging, não promovido sem hash.
    """
    curated, db, manifest, webdata = _novo_caso(tmp_path)
    webdata.mkdir()
    (webdata / "fato_1999_1_presidente.json").write_text(
        '{"obsoleto": true}', encoding="utf-8")
    build_all(curated, db, manifest, web_data_dir=webdata)
    assert not (webdata / "fato_1999_1_presidente.json").exists()
    assert (webdata / "resumo.json").exists()
    entries = json.loads(Path(manifest).read_text(encoding="utf-8")).get(
        "artifacts", [])
    arquivos = {e.get("arquivo") for e in entries}
    assert "fato_1999_1_presidente.json" not in arquivos


def test_fato_com_proveniencia_promove_com_hash(tmp_path):
    """fato_*.json com triple casando as fontes promove e ganha entry."""
    curated, db, manifest, webdata = _novo_caso(tmp_path)
    webdata.mkdir()
    (webdata / "fato_2022_1_presidente.json").write_text(
        '{"candidatos": [], "municipios": []}', encoding="utf-8")
    build_all(curated, db, manifest, web_data_dir=webdata)
    assert (webdata / "fato_2022_1_presidente.json").exists()
    entries = json.loads(Path(manifest).read_text(encoding="utf-8")).get(
        "artifacts", [])
    arquivos = {e.get("arquivo") for e in entries}
    assert "fato_2022_1_presidente.json" in arquivos


def test_fato_triple_valido_sem_ingestion_no_mirror_reprova(tmp_path):
    """EVOLVE-4 T2: fato de triple válido sem ingestão no mirror reprova.

    Fail-closed intencional: bytes sem proveniência de ingestão nunca
    promovem (o caminho legítimo é via `build_fato`/seed, que escreve a
    ingestão junto). O build levanta `RuntimeError` (gate "fato", não
    filtrado como "manifest*") e os públicos seguem byte-idênticos —
    só o staging morre.
    """
    curated, db, manifest, webdata = _novo_caso(tmp_path)
    build_all(curated, db, manifest, web_data_dir=webdata)
    (webdata / "fato_2022_1_presidente.json").write_text(
        '{"candidatos": [], "municipios": []}', encoding="utf-8")
    snap = _snapshot_public(curated, db, manifest, webdata)
    with pytest.raises(RuntimeError, match="gates reprovados") as excinfo:
        build_all(curated, db, manifest, web_data_dir=webdata)
    assert "fato" in str(excinfo.value), f"esperava erro de fato, veio: {excinfo.value}"
    _assert_public_intact(snap, curated, db, manifest, webdata)
    _assert_no_staging(curated, db, manifest, webdata)
