"""EVOLVE-5 Task 2 (RED-first): orquestrador CLI `python -m etl` / `sad-etl`.

Contrato sob teste:
- `etl.__main__.main(argv) -> int` só orquestra (import + call dos
  entrypoints: fetch.download_dataset, build_marts.build_all,
  censo.normalize_censo/register_censo_ingest, build_fato.build_fato,
  validate.run_gates) — sem duplicar lógica dos módulos;
- exit codes fail-closed: 0 ok, 1 gates reprovados, 2 erro;
- `--help` em pt-BR documentando os exit codes.

Sem rede: fetch é opt-in (`--fetch`); o run sintético usa CSVs fixture
locais (mesmo shape do seed: TSE `;` 2022/PRESIDENTE + Censo estilo
IBGE/SIDRA) e precisa sair 0 de ponta a ponta.
"""

import json
import subprocess
import sys
from pathlib import Path

_FIXTURE_TSE_CSV = (
    "ANO_ELEICAO;DS_CARGO;SG_UF;CD_MUNICIPIO;NM_URNA;QT_VOTOS\n"
    "2022;PRESIDENTE;SP;3550308;CANDIDATO EXEMPLO A;10\n"
    "2022;PRESIDENTE;RJ;3304557;CANDIDATO EXEMPLO B;5\n"
)

_FIXTURE_CENSO_CSV = (
    "CD_MUN;P_SUPERIOR;P_MEDIO;P_FUNDAMENTAL;RENDIMENTO_MEDIO;TX_POBREZA;"
    "IDADE_MEDIANA;TX_URBANIZACAO;POP_RESIDENTE\n"
    "3550308;20.0;35.0;45.0;2500.0;15.0;33.0;90.0;10000\n"
    "3304557;25.0;35.0;40.0;2600.0;18.0;34.0;85.0;12000\n"
)


def _escrever_fixture(tmp_path):
    """Curated TSE + Censo sintéticos em dirs isolados; devolve os paths."""
    curated = tmp_path / "curated"
    curated.mkdir()
    (curated / "fixture.csv").write_text(_FIXTURE_TSE_CSV, encoding="utf-8")
    censo_csv = tmp_path / "censo.csv"
    censo_csv.write_text(_FIXTURE_CENSO_CSV, encoding="utf-8")
    db = tmp_path / "sad.duckdb"
    manifest = tmp_path / "manifest.json"  # == <db dir>/manifest.json
    webdata = tmp_path / "webdata"
    return curated, censo_csv, db, manifest, webdata


def _argv_base(tmp_path):
    curated, censo_csv, db, manifest, webdata = _escrever_fixture(tmp_path)
    return (
        [
            "--curated-dir", str(curated),
            "--db", str(db),
            "--manifest", str(manifest),
            "--web-data-dir", str(webdata),
            "--censo-csv", str(censo_csv),
            "--ano", "2022",
            "--turno", "1",
            "--cargo", "presidente",
        ],
        webdata,
    )


def test_help_documenta_exit_codes_ptbr():
    repo_root = Path(__file__).resolve().parents[2]
    proc = subprocess.run(
        [sys.executable, "-m", "etl", "--help"],
        capture_output=True, text=True, cwd=repo_root,
    )
    assert proc.returncode == 0
    saida = proc.stdout.lower()
    assert "gate" in saida
    for codigo in ("0", "1", "2"):
        assert codigo in proc.stdout


def test_run_sintetico_triplo_exit_0(tmp_path):
    from etl.__main__ import main

    argv, webdata = _argv_base(tmp_path)
    assert main(argv) == 0
    fato = webdata / "fato_2022_1_presidente.json"
    assert fato.is_file()
    payload = json.loads(fato.read_text(encoding="utf-8"))
    assert len(payload["municipios"]) == 2
    assert sum(m["total"] for m in payload["municipios"]) == 15
    resumo = json.loads((webdata / "resumo.json").read_text(encoding="utf-8"))
    assert resumo["total_votos"] == 15


def test_gates_divergentes_exit_1(tmp_path):
    from etl.__main__ import main

    argv, _webdata = _argv_base(tmp_path)
    totais = tmp_path / "totais.json"
    # Real: SP=10, RJ=5 — SP errado diverge a soma por UF (fail-closed).
    totais.write_text(json.dumps({"SP": 11, "RJ": 5}), encoding="utf-8")
    assert main([*argv, "--totais-oficiais", str(totais)]) == 1


def test_totais_ilegivel_exit_2(tmp_path):
    from etl.__main__ import main

    argv, _webdata = _argv_base(tmp_path)
    assert main([*argv, "--totais-oficiais", str(tmp_path / "ausente.json")]) == 2


def test_censo_total_divergente_exit_1(tmp_path):
    """Gate de soma do Censo opt-in: total divergente barra antes do fato."""
    from etl.__main__ import main

    argv, webdata = _argv_base(tmp_path)
    # Fixture: pop 10000 + 12000 = 22000; 1 diverge fail-closed.
    assert main([*argv, "--censo-total-esperado", "1"]) == 1
    assert not (webdata / "fato_2022_1_presidente.json").exists()


def test_censo_total_correto_exit_0(tmp_path):
    from etl.__main__ import main

    argv, webdata = _argv_base(tmp_path)
    assert main([*argv, "--censo-total-esperado", "22000"]) == 0
    assert (webdata / "fato_2022_1_presidente.json").is_file()
