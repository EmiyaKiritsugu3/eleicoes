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
  1 — gates reprovados (versão anterior mantida; nada publicado)
  (Task 3; inalcançável nesta task);
  2 — erro (combo fora do V1, `--turno` inválido, guarda anti-perda
  sem `--force-real`, exceção no fetch).
"""

from __future__ import annotations

import argparse
import json
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


def _guard_webdata(web_data_dir: Path, force_real: bool) -> None:
    """Recusa sobrescrever manifest oficial sem `--force-real` (anti-perda).

    Lê `<web-data-dir>/manifest.json` se existir; manifest ausente,
    inválido (não-JSON/não-dict), sem lista `ingestions`, ou com SÓ
    ingestões `fixture: true` passa sem fazer nada. Se qualquer ingestão
    for não-fixture (`fixture != true`, incluindo entrada sem a flag ou
    malformada — ingestão real nunca marca a flag, mesmo predicado de
    `scripts/seed_fixture_data.py:_has_official_entries`) e `force_real`
    for falso, imprime `erro:` em stderr e levanta `SystemExit(2)`.
    """
    if force_real:
        return
    manifest_path = Path(web_data_dir) / "manifest.json"
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, ValueError):
        return  # ausente/inválido passa
    if not isinstance(manifest, dict):
        return
    ingestions = manifest.get("ingestions")
    if not isinstance(ingestions, list):
        return
    oficial = any(
        not isinstance(e, dict) or e.get("fixture") is not True
        for e in ingestions
    )
    if oficial:
        print(
            f"erro: {manifest_path} contém ingestão oficial "
            f"(fixture!=true) — recusando sobrescrever sem --force-real; "
            f"nada foi baixado",
            file=sys.stderr,
        )
        raise SystemExit(2)


def _passo_fetch(raw_dir: Path, ano: int, cargo: str) -> dict:
    """Baixa os 3 zips oficiais do triple p/ `raw_dir`; devolve o mapa.

    As 3 URLs: `V1` do triple (`(ano, cargo)` em `V1_DATASETS`) + Censo
    (`CENSO_DATASETS[0]`) + de-para (`DEPARA_DATASET`), via
    `etl.fetch.download_dataset(url, dest)` com
    `dest = raw_dir/<basename da url>`. Imprime
    `fetch: <nome> ok (sha256=<12>…)` por arquivo (mesmo formato de
    `etl/__main__._passo_fetch`). Devolve
    `{nome: {"url", "path", "sha256"}}` com nomes `tse`/`censo`/`depara`
    (Task 3 consome `path` p/ de-para/Censo e `sha256` p/ o manifest).
    Combo fora do V1 levanta `ValueError` antes de qualquer download;
    erro de rede propaga p/ o chamador (que converte em saída 2).
    """
    if str(_REPO_ROOT) not in sys.path:
        sys.path.insert(0, str(_REPO_ROOT))
    from etl import fetch
    from etl.sources import CENSO_DATASETS, DEPARA_DATASET, V1_DATASETS

    v1 = next(
        (e for e in V1_DATASETS
         if e["ano"] == ano and str(e["cargo"]).lower() == str(cargo).lower()),
        None,
    )
    if v1 is None:
        raise ValueError(
            f"combo fora do V1 (--ano {ano} --cargo {str(cargo).lower()}): "
            f"o triple precisa estar em V1_DATASETS; nada foi baixado"
        )
    alvos = (
        ("tse", v1["url"]),
        ("censo", CENSO_DATASETS[0]["url"]),
        ("depara", DEPARA_DATASET["url"]),
    )
    raw_dir = Path(raw_dir)
    saida: dict = {}
    for nome, url in alvos:
        dest = raw_dir / (url.rsplit("/", 1)[-1] or f"{nome}.zip")
        sha = fetch.download_dataset(url, dest)
        print(f"fetch: {dest.name} ok (sha256={sha[:12]}…)")
        saida[nome] = {"url": url, "path": dest, "sha256": sha}
    return saida


def main(argv=None) -> int:
    """Valida o triple e (Tasks 2–3) orquestra a ingestão; devolve 0/1/2."""
    args = _parse_args(argv)
    if str(_REPO_ROOT) not in sys.path:
        sys.path.insert(0, str(_REPO_ROOT))
    from etl.sources import V1_DATASETS

    validos = {(e["ano"], str(e["cargo"]).lower()) for e in V1_DATASETS}
    if (args.ano, str(args.cargo).lower()) not in validos:
        print(
            f"erro: combo fora do V1 (--ano {args.ano} --cargo {str(args.cargo).lower()} "
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
    # Task 2: guarda anti-perda ANTES de qualquer download, depois fetch
    # das 3 fontes. O wiring de-para \u2192 build \u2192 censo \u2192 fato \u2192 gates
    # chega na Task 3.
    try:
        _guard_webdata(args.web_data_dir, args.force_real)
    except SystemExit as exc:
        return exc.code if isinstance(exc.code, int) else 2
    try:
        _passo_fetch(args.raw_dir, args.ano, args.cargo)
    except Exception as exc:
        print(f"erro: {exc}", file=sys.stderr)
        return 2
    print(
        f"combo V1 válido (--ano {args.ano} --cargo {str(args.cargo).lower()} "
        f"--turno {args.turno}); fetch das 3 fontes ok em {args.raw_dir}; "
        f"wiring de-para \u2192 build \u2192 censo \u2192 fato \u2192 gates chega na Task 3"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
