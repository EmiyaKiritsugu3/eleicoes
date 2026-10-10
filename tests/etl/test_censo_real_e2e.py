"""EVOLVE-5 Task 1: Censo REAL end-to-end (zip 326 KB → fato JSON + manifest verde).

O entrypoint `etl.censo.ingerir_censo` baixa o zip confirmado do FTP do IBGE
(via `etl.fetch.download_dataset`, com backoff/UA/resume/teto — sem
reimplementar), normaliza (`normalize_censo`), aplica o gate
`TOTAL_CENSO_2022` fail-closed, grava `dim_municipio` no DuckDB e registra a
ingestão no manifest. O teste principal prova os bytes reais virando fato
verificável: votos sintéticos mínimos sobre 3 municípios REAIS ×
`dim_municipio` REAL → `build_fato` (com o gate do total oficial) →
`verify_manifest` + `verificar_fato_manifest` verdes.

Sem rede: PULA com motivo documentado (NUNCA falha silenciosa, NUNCA passa
silenciosa — `pytest.skip` aparece no relatório; CI sem rede fica verde por
skip, não por verde falso). Mecanismo: `SAD_SEM_REDE=1` força o skip
instantâneo (CI hermético); senão, sonda `ftp.ibge.gov.br:443` com timeout
curto (3 s) uma vez na coleta do módulo.

EVOLVE-5 Task 6 estende este arquivo (sem fork): `test_censo_real_shape_travado`
trava o shape do CSV real com o MESMO mecanismo de skip/convenções.
"""

import os
import socket

import pytest

# Host/prova de rede: o mesmo host allowlisted de CENSO_DATASETS[0]["url"].
_CENSO_HOST = "ftp.ibge.gov.br"
_SKIP_REASON = (
    "sem rede p/ ftp.ibge.gov.br:443 (Censo REAL exige download do zip; "
    "rode com rede ou defina SAD_SEM_REDE=1 p/ pular explícito — "
    "CI offline pula, nunca falha)"
)


def _rede_disponivel() -> bool:
    """True iff o FTP do IBGE é alcançável (sonda TCP curta, sem HTTP)."""
    if os.environ.get("SAD_SEM_REDE") == "1":
        return False
    try:
        socket.create_connection((_CENSO_HOST, 443), timeout=3).close()
    except OSError:
        return False
    return True


# Sem mark em nível de módulo: SÓ os testes de rede real levam skipif (ver
# decoradores) — os dois testes offline abaixo rodam sempre, inclusive em CI
# sem rede.


@pytest.mark.skipif(not _rede_disponivel(), reason=_SKIP_REASON)
def test_censo_real_shape_travado(tmp_path, monkeypatch):
    """Shape do CSV real travado: `;`-sep, latin1, CD_MUN+v0001, 5570, Δ5101837.

    Baixa o MESMO zip barato (326 KB) do teste de ingestão acima — sem
    ingestão/DB/manifest aqui, só os bytes crus do FTP. Cada assert trava
    uma premissa load-bearing de `etl.censo.ingerir_censo` (sep/encoding/
    colunas lidos literais em `pd.read_csv` + aliases de `normalize_censo`).
    """
    import csv
    import zipfile

    from etl import fetch
    from etl.sources import CENSO_DATASETS, TOTAL_CENSO_2022

    monkeypatch.setattr(fetch, "RAW_ROOT", tmp_path)
    url = CENSO_DATASETS[0]["url"]
    dest = tmp_path / url.rsplit("/", 1)[-1]
    fetch.download_dataset(url, dest)
    payload = dest.read_bytes()
    assert 300_000 <= len(payload) <= 350_000

    with zipfile.ZipFile(dest) as zf:
        csvs = [
            i for i in zf.infolist()
            if not i.is_dir() and i.filename.lower().endswith(".csv")
        ]
        assert len(csvs) == 1
        assert csvs[0].filename == "Agregados_por_municipios_basico_BR.csv"
        bruto = zf.read(csvs[0].filename)

    # latin1 exigido: o byte 0xF4 (õ de "Rondônia") quebra decode utf-8
    # estrito — ler como utf-8 corromperia os nomes, não só os acentos.
    with pytest.raises(UnicodeDecodeError):
        bruto.decode("utf-8")
    linhas = bruto.decode("latin1").splitlines()

    # `;` é load-bearing: com `,` o header vira 1 coluna só (join impossível).
    assert ";" in linhas[0]
    assert len(next(csv.reader([linhas[0]], delimiter=","))) == 1
    rows = list(csv.reader(linhas, delimiter=";"))
    hdr = rows[0]
    assert "CD_MUN" in hdr  # alias de ibge7 em normalize_censo
    assert "v0001" in hdr  # alias de pop (minúsculo no arquivo real)
    assert len(hdr) == 26  # travas de shape: 26 cols observadas em 2026-10-10; coluna nova do IBGE deve falhar alto

    dados = rows[1:]
    assert len(dados) == 5570
    i_cd = hdr.index("CD_MUN")
    i_v = hdr.index("v0001")
    cds = [r[i_cd] for r in dados]
    assert len(set(cds)) == 5570
    assert all(len(c) == 7 and c.isdigit() for c in cds)
    # Delta 5101837 (Boa Esperança do Norte/MT, emancipado pós-Censo):
    # existe na API de localidades mas NÃO no CSV — join sem par vira
    # demo None ("sem dado oficial"), nunca linha fantasma.
    assert "5101837" not in set(cds)
    # v0001 é de fato a pop: a soma fecha no total oficial auditado.
    assert sum(int(r[i_v]) for r in dados) == TOTAL_CENSO_2022


# EVOLVE-6 hook — dimensionamento TSE (Task 6, medido 2026-10-10 via HEAD;
# SEM download nacional ainda). O e2e fato-real full ancora AQUI (mesmo
# skip SAD_SEM_REDE/sonda, gate de soma + manifest verde) e baixa os zips
# `votacao_candidato_munzona_{ano}.zip` do CDN TSE (todos HTTP 200,
# Content-Type application/zip, Accept-Ranges: bytes; Content-Length):
#   2014:  494100168 B (~471 MiB) | 2016:  60594613 B (~58 MiB)
#   2018:  395389280 B (~377 MiB) | 2020:  57815640 B (~55 MiB)
#   2022:  596166602 B (~569 MiB) | 2024:  48047775 B (~46 MiB)
# Total: 1652114078 B (~1,54 GiB). Catálogo CKAN
# `package_show?id=resultados-{ano}` (200, 34 recursos p/ 2022) confirma o
# recurso "Votação nominal por município e zona" → a MESMA url de
# `etl.sources.V1_DATASETS` (padrão
# `.../votacao_candidato_munzona_{ano}.zip`). Números completos no report
# `.superpowers/sdd/2026-10-10-evolve-5/task-6-report.md`.


def test_flag_sem_rede_forca_skip(monkeypatch):
    """O skip offline é explícito e testável (nunca passa silencioso)."""
    monkeypatch.setenv("SAD_SEM_REDE", "1")
    assert _rede_disponivel() is False


def _zip_falso_csv(csv_text: str) -> bytes:
    import io
    import zipfile

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("falso.csv", csv_text)
    return buf.getvalue()


def test_gate_soma_bloqueia_dim_e_manifest_sem_rede(tmp_path, monkeypatch):
    """Fail-closed offline: soma divergente não grava dim nem manifest."""
    import hashlib

    from etl import fetch
    from etl.censo import ingerir_censo

    monkeypatch.setattr(fetch, "RAW_ROOT", tmp_path)
    payload = _zip_falso_csv("CD_MUN;v0001\n3550308;100\n3304557;200\n")

    def fake_download(url, dest, **kwargs):
        from pathlib import Path

        Path(dest).write_bytes(payload)
        return hashlib.sha256(payload).hexdigest()

    monkeypatch.setattr(fetch, "download_dataset", fake_download)
    db = tmp_path / "censo.duckdb"
    manifest = tmp_path / "manifest.json"
    with pytest.raises(ValueError, match="(?i)soma"):
        ingerir_censo(str(db), str(manifest))
    assert not db.exists()  # gate reprova antes de qualquer escrita
    assert not manifest.exists()


@pytest.mark.skipif(not _rede_disponivel(), reason=_SKIP_REASON)
def test_censo_real_zip_para_fato_verificavel(tmp_path, monkeypatch):
    """Bytes reais (326 KB) → dim_municipio → fato JSON com manifest verde."""
    import json

    import duckdb

    from etl import fetch
    from etl.build_fato import build_fato
    from etl.censo import ingerir_censo
    from etl.manifest import verificar_fato_manifest, verify_manifest
    from etl.sources import CENSO_DATASETS, TOTAL_CENSO_2022

    monkeypatch.setattr(fetch, "RAW_ROOT", tmp_path)
    db = tmp_path / "censo.duckdb"
    manifest = tmp_path / "manifest.json"

    info = ingerir_censo(str(db), str(manifest))

    # --- bytes reais: forma travada (banda p/ o zip, exato p/ linhas/soma) ---
    import hashlib

    assert 300_000 <= info["zip_bytes"] <= 350_000
    assert info["rows"] == 5570
    zip_brutos = next(tmp_path.glob("*.zip")).read_bytes()
    assert info["zip_bytes"] == len(zip_brutos)
    assert info["sha256"] == hashlib.sha256(zip_brutos).hexdigest()
    assert info["csv_name"] == "Agregados_por_municipios_basico_BR.csv"

    con = duckdb.connect(str(db), read_only=True)
    try:
        linhas = con.execute(
            "SELECT ibge7, pop FROM dim_municipio ORDER BY ibge7 LIMIT 3"
        ).fetchall()
        total = con.execute("SELECT COUNT(*), SUM(pop) FROM dim_municipio").fetchone()
    finally:
        con.close()
    assert total[0] == 5570
    assert int(total[1]) == TOTAL_CENSO_2022
    ibges = [r[0] for r in linhas]
    pops = [int(r[1]) for r in linhas]
    assert all(len(b) == 7 for b in ibges)

    # --- votos sintéticos mínimos sobre municípios REAIS → fato + gates ---
    import pandas as pd

    rows = []
    for i, ibge in enumerate(ibges):
        for j, (cid, nome, part) in enumerate(
            [("13", "CANDIDATA EXEMPLO A", "PA"),
             ("22", "CANDIDATO EXEMPLO B", "PB")]
        ):
            rows.append({
                "ano": 2022, "turno": 1, "cargo": "PRESIDENTE", "uf": "SP",
                "municipio_ibge": ibge, "candidato_id": cid,
                "nome_urna": nome, "partido": part,
                "votos": (i * 7 + j * 13) % 97 + 1,
            })
    fato_df = pd.DataFrame(rows)
    fato_df["votos"] = fato_df["votos"].astype("Int64")
    dim = fato_df[["candidato_id", "nome_urna", "partido"]].drop_duplicates()
    con = duckdb.connect(str(db))
    try:
        con.register("fato_df", fato_df)
        con.register("dim_df", dim)
        con.execute("CREATE OR REPLACE TABLE fato_voto AS SELECT * FROM fato_df")
        con.execute("CREATE OR REPLACE TABLE dim_candidato AS SELECT * FROM dim_df")
    finally:
        con.close()

    out_dir = tmp_path / "out"
    out = build_fato(str(db), str(out_dir), 2022, 1, "PRESIDENTE",
                     censo_total_oficial=TOTAL_CENSO_2022)
    payload = json.loads(open(out, encoding="utf-8").read())
    assert len(payload["municipios"]) == 3
    by_ibge = {m["ibge"]: m for m in payload["municipios"]}
    for ibge, pop in zip(ibges, pops):
        assert by_ibge[ibge]["demo"] is not None
        assert by_ibge[ibge]["demo"]["pop"] == pop  # pop REAL do CSV
    assert sum(v for m in payload["municipios"] for v in m["votos"]) == int(
        fato_df["votos"].sum())

    # --- proveniência: ingestão do Censo + fato, ambas verdes ---
    entries = json.loads(manifest.read_text(encoding="utf-8"))["ingestions"]
    censo_entries = [
        e for e in entries
        if e.get("source_url") == CENSO_DATASETS[0]["url"]
    ]
    assert len(censo_entries) == 1
    assert censo_entries[0]["rows"] == 5570
    # EVOLVE-7 Task 1: `ingerir_censo` agora atesta `censo_municipios.json`
    # em `manifest["artifacts"]` (irmão do manifest) — `verify_manifest`
    # prova os bytes em silêncio, sem o aviso legado de "sem artifacts".
    doc = json.loads(manifest.read_text(encoding="utf-8"))
    censo_artifacts = [a for a in doc.get("artifacts", [])
                       if a.get("arquivo") == "censo_municipios.json"]
    assert len(censo_artifacts) == 1
    assert censo_artifacts[0]["source_url"] == CENSO_DATASETS[0]["url"]
    import warnings

    with warnings.catch_warnings():
        warnings.simplefilter("error", UserWarning)
        assert verify_manifest(str(manifest)) is True
    assert verificar_fato_manifest(str(manifest), out) is True
