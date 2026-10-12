"""Ingestão oficial: CLI + guards + e2e sintético offline (Tasks 1–3)."""

import pytest


# Bloco 3 (Task 3): e2e sintético offline — mesmo shape de
# `test_orquestrador.py` (TSE `;` com `CD_MUNICIPIO` curto + de-para mini
# + Censo 2 linhas), mas 2024/PREFEITO e chegando via zips no raw-dir
# (rede substituída por monkeypatch de `download_dataset`).
_FIXTURE_TSE_2024 = (
    "ANO_ELEICAO;DS_CARGO;SG_UF;CD_MUNICIPIO;NM_URNA;QT_VOTOS\n"
    "2024;PREFEITO;SP;35;CANDIDATO EXEMPLO A;10\n"
    "2024;PREFEITO;RJ;299;CANDIDATO EXEMPLO B;5\n"
)

_FIXTURE_DEPARA_MINI = (
    '"DT_GERACAO";"HH_GERACAO";"CD_UF_TSE";"CD_UF_IBGE";"SG_UF";"NM_UF";'
    '"CD_MUNICIPIO_TSE";"NM_MUNICIPIO_TSE";'
    '"CD_MUNICIPIO_IBGE";"NM_MUNICIPIO_IBGE"\n'
    '"04/10/2026";"09:00:06";35;35;"SP";"Sao Paulo";'
    '"00035";"Exemplo SP";3550308;"Exemplo SP"\n'
    '"04/10/2026";"09:00:06";33;33;"RJ";"Rio de Janeiro";'
    '"00299";"Exemplo RJ";3304557;"Exemplo RJ"\n'
)

_FIXTURE_CENSO_2 = (
    "CD_MUN;P_SUPERIOR;P_MEDIO;P_FUNDAMENTAL;RENDIMENTO_MEDIO;TX_POBREZA;"
    "IDADE_MEDIANA;TX_URBANIZACAO;POP_RESIDENTE\n"
    "3550308;20.0;35.0;45.0;2500.0;15.0;33.0;90.0;10000\n"
    "3304557;25.0;35.0;40.0;2600.0;18.0;34.0;85.0;12000\n"
)


def _zip_bytes(membro: str, dados: bytes) -> bytes:
    import io
    import zipfile

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(membro, dados)
    return buf.getvalue()


def _fake_download_3_zips(url, dest):
    """`download_dataset` sem rede: escreve o fixture certo por URL."""
    import hashlib
    from pathlib import Path

    from etl.sources import CENSO_DATASETS, DEPARA_DATASET

    dest = Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    if url == DEPARA_DATASET["url"]:
        payload = _zip_bytes(
            "municipio_tse_ibge.csv",
            _FIXTURE_DEPARA_MINI.encode("latin-1"))
    elif url == CENSO_DATASETS[0]["url"]:
        payload = _zip_bytes(
            "censo_municipios.csv", _FIXTURE_CENSO_2.encode("utf-8"))
    else:  # V1 do triple (2024-prefeito): 15 votos em 2 municípios
        payload = _zip_bytes(
            "votacao_candidato_munzona_2024_SP.csv",
            _FIXTURE_TSE_2024.encode("utf-8"))
    dest.write_bytes(payload)
    return hashlib.sha256(payload).hexdigest()


def _argv_e2e(tmp_path, total="22000"):
    return [
        "--ano", "2024", "--cargo", "prefeito", "--turno", "1",
        "--raw-dir", str(tmp_path / "raw"),
        "--curated-dir", str(tmp_path / "cur"),
        "--db", str(tmp_path / "s.duckdb"),
        "--web-data-dir", str(tmp_path / "w"),
        "--censo-total-esperado", total,
    ]


def test_e2e_sintetico_sai_0_com_resumo(tmp_path, monkeypatch, capsys):
    import json

    import etl.fetch as fetch
    from scripts import ingestao_real

    monkeypatch.setattr(
        fetch, "download_dataset", _fake_download_3_zips)
    assert ingestao_real.main(_argv_e2e(tmp_path)) == 0
    out = capsys.readouterr().out
    assert "ok: pipeline concluído" in out
    assert ("fato: fato_2024_1_prefeito.json ok "
            "(15 votos, 2 municípios)") in out
    fato = tmp_path / "w" / "fato_2024_1_prefeito.json"
    assert fato.exists()
    payload = json.loads(fato.read_text(encoding="utf-8"))
    assert len(payload["municipios"]) == 2
    assert sum(m["total"] for m in payload["municipios"]) == 15


def test_censo_total_divergente_sai_1_sem_fato(tmp_path, monkeypatch):
    import etl.fetch as fetch
    from scripts import ingestao_real

    monkeypatch.setattr(
        fetch, "download_dataset", _fake_download_3_zips)
    # Fixture: pop 10000 + 12000 = 22000; 1 diverge fail-closed.
    assert ingestao_real.main(_argv_e2e(tmp_path, total="1")) == 1
    assert list((tmp_path / "w").glob("fato_*.json")) == []


def test_help_cita_triples_e_exits():
    import subprocess, sys
    from pathlib import Path
    repo = Path(__file__).resolve().parents[2]
    p = subprocess.run([sys.executable, "scripts/ingestao_real.py", "--help"], capture_output=True, text=True, cwd=repo)
    assert p.returncode == 0
    assert "--ano" in p.stdout and "--cargo" in p.stdout and "--turno" in p.stdout

def test_combo_fora_v1_aborta_antes_do_download(tmp_path):
    from scripts import ingestao_real
    assert ingestao_real.main(["--ano", "2022", "--cargo", "prefeito", "--turno", "1",
        "--raw-dir", str(tmp_path), "--curated-dir", str(tmp_path),
        "--db", str(tmp_path / "x.duckdb"), "--web-data-dir", str(tmp_path)]) == 2

def test_turno_invalido_retorna_2(tmp_path):
    from scripts import ingestao_real
    assert ingestao_real.main(["--ano", "2024", "--cargo", "prefeito", "--turno", "3",
        "--raw-dir", str(tmp_path), "--curated-dir", str(tmp_path),
        "--db", str(tmp_path / "x.duckdb"), "--web-data-dir", str(tmp_path)]) == 2

def test_recusa_sobrescrever_real_sem_flag(tmp_path):
    import json
    from scripts import ingestao_real
    webdata = tmp_path / "webdata"; webdata.mkdir()
    (webdata / "manifest.json").write_text(json.dumps({"ingestions": [{"fixture": False}]}), encoding="utf-8")
    with pytest.raises(SystemExit) as e:
        ingestao_real._guard_webdata(webdata, False)
    assert e.value.code == 2

def test_fetch_falha_e_exit_2_sem_escrita(tmp_path, monkeypatch):
    from scripts import ingestao_real
    import etl.fetch as fetch
    monkeypatch.setattr(fetch, "download_dataset", lambda url, dest: (_ for _ in ()).throw(ConnectionError("sem rede")))
    rc = ingestao_real.main(["--ano", "2024", "--cargo", "prefeito", "--turno", "1",
        "--raw-dir", str(tmp_path / "raw"), "--curated-dir", str(tmp_path / "cur"),
        "--db", str(tmp_path / "s.duckdb"), "--web-data-dir", str(tmp_path / "w")])
    assert rc == 2
    assert not (tmp_path / "cur").exists()


def test_zip_sem_csv_sai_2_com_msg_curada(tmp_path, monkeypatch, capsys):
    import hashlib
    from pathlib import Path

    import etl.fetch as fetch
    from etl.sources import DEPARA_DATASET
    from scripts import ingestao_real

    def _fake_depara_sem_csv(url, dest):
        if url == DEPARA_DATASET["url"]:
            payload = _zip_bytes("leia.txt", b"sem csv aqui")
            dest = Path(dest)
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(payload)
            return hashlib.sha256(payload).hexdigest()
        return _fake_download_3_zips(url, dest)

    monkeypatch.setattr(fetch, "download_dataset", _fake_depara_sem_csv)
    assert ingestao_real.main(_argv_e2e(tmp_path)) == 2
    err = capsys.readouterr().err
    assert "erro:" in err
    assert ("sem membro .csv" in err or "esperado 1 CSV" in err)
