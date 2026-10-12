#!/usr/bin/env python3
"""Ingestão oficial versionada do pipeline real.

Orquestra a ingestão dos dados oficiais (TSE + Censo IBGE + de-para
TSE→IBGE7) para um triple (`--ano --cargo --turno`), sem duplicar
lógica de ETL: só chama os entrypoints existentes, na mesma ordem de
`etl/__main__.py` (o wiring completo chega nas Tasks 2–3; esta Task 1
entrega o CLI + a validação do combo V1).

Combos válidos = interseção com `V1_DATASETS` (`etl/sources.py`:
presidente 2014/2018/2022, governador 2014/2018/2022, prefeito
2016/2020/2024) + `--turno` em (1, 2). Fora disso o script aborta com
saída 2 ANTES de qualquer download (fail-closed, custo zero).

Códigos de saída (fail-closed, como `etl/__main__.py`):
  0 — ok;
  1 — gates reprovados (versão anterior mantida; nada publicado);
  2 — erro (combo fora do V1, `--turno` inválido, exceção).
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parent.parent


def _parse_args(argv=None):
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--ano", type=int, default=2022,
                        help="ano do triple (válidos V1: 2014/2018/2022 p/ "
                             "presidente e governador; 2016/2020/2024 p/ "
                             "prefeito; padrão: 2022)")
    parser.add_argument("--cargo", default="presidente",
                        help="cargo do triple (presidente|governador|prefeito; "
                             "padrão: presidente)")
    parser.add_argument("--turno", type=int, default=1,
                        help="turno do triple (1|2; padrão: 1)")
    parser.add_argument("--raw-dir", type=Path,
                        default=_REPO_ROOT / "data" / "raw",
                        help="dir dos zips oficiais baixados "
                             "(padrão: data/raw)")
    parser.add_argument("--curated-dir", type=Path,
                        default=_REPO_ROOT / "data" / "curated",
                        help="dir com CSVs/Parquet de entrada "
                             "(padrão: data/curated)")
    parser.add_argument("--db", type=Path,
                        default=_REPO_ROOT / "data" / "sad.duckdb",
                        help="DuckDB de saída (padrão: data/sad.duckdb)")
    parser.add_argument("--manifest", type=Path, default=None,
                        help="manifest canônico de proveniência/histórico "
                             "(padrão: <dir do --db>/manifest.json)")
    parser.add_argument("--web-data-dir", type=Path,
                        default=_REPO_ROOT / "web" / "public" / "data",
                        help="dir dos JSONs servidos "
                             "(padrão: web/public/data)")
    parser.add_argument("--censo-total-esperado", type=int, default=None,
                        help="total oficial esperado p/ a soma de pop do Censo "
                             "(gate fail-closed; sem ele, o artefato Censo não "
                             "é servido)")
    parser.add_argument("--force-real", action="store_true",
                        help="permitir sobrescrever <web-data-dir>/manifest.json "
                             "quando ele contém ingestão não-fixture (dados "
                             "oficiais); sem a flag o script aborta com saída 2")
    return parser.parse_args(argv)


def main(argv=None) -> int:
    """Valida o triple e (Tasks 2–3) orquestra a ingestão; devolve 0/1/2."""
    args = _parse_args(argv)
    sys.path.insert(0, str(_REPO_ROOT))
    from etl.sources import V1_DATASETS

    validos = {(e["ano"], str(e["cargo"]).lower()) for e in V1_DATASETS}
    if (args.ano, str(args.cargo).lower()) not in validos:
        print(
            f"erro: combo fora do V1 (--ano {args.ano} --cargo {args.cargo} "
            f"--turno {args.turno}): o triple precisa estar em V1_DATASETS "
            "(presidente 2014/2018/2022, governador 2014/2018/2022, prefeito "
            "2016/2020/2024); nada foi baixado",
            file=sys.stderr,
        )
        return 2
    if args.turno not in (1, 2):
        print(
            f"erro: --turno deve ser 1 ou 2 (recebido: {args.turno}); "
            "nada foi baixado",
            file=sys.stderr,
        )
        return 2
    # Task 1: só validação (sem I/O de rede). O wiring guard → fetch →
    # de-para → build → censo → fato → gates chega nas Tasks 2–3.
    print(
        f"combo V1 válido (--ano {args.ano} --cargo {str(args.cargo).lower()} "
        f"--turno {args.turno}); wiring da ingestão chega nas Tasks 2–3 "
        "(nada executado)"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
