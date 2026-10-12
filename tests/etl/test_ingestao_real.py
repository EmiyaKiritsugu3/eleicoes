"""Ingestão oficial: CLI da Task 1 (bloco 1: --help + validação V1)."""

import pytest


def test_help_cita_triples_e_exits(tmp_path=None):
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
