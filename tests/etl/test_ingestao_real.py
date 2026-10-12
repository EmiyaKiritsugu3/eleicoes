"""Ingestão oficial: CLI da Task 1 (bloco 1: --help + validação V1)."""


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
