#!/usr/bin/env python3
"""Ingestão oficial versionada do pipeline real.

Orquestra a ingestão dos dados oficiais (TSE + Censo IBGE + de-para
TSE→IBGE7) para um triple (`--ano --cargo --turno`), sem duplicar
lógica de ETL: só chama os entrypoints existentes, na mesma ordem de
`etl/__main__.py` (guard → fetch → de-para → build → censo → fato → gates).

Combos válidos = interseção com `V1_DATASETS` (`etl/sources.py`:
presidente 2014/2018/2022, governador 2014/2018/2022, prefeito
2016/2020/2024) + `--turno` em (1, 2). Fora disso o script aborta com
saída 2 ANTES de qualquer download (fail-closed, custo zero).

Códigos de saída (fail-closed, como `etl/__main__.py`):
  0 — ok, gates verdes;
  1 — gates reprovados (gate de soma do Censo ou `run_gates`;
  versão anterior mantida; nada publicado);
  2 — erro (combo fora do V1, `--turno` inválido, guarda anti-perda
  sem `--force-real`, exceção no fetch ou em qualquer passo).
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
                             "(gate fail-closed ANTES de gravar dim_municipio; "
                             "diverge → saída 1 sem fato; omitido, vale "
                             "TOTAL_CENSO_2022 do Censo 2022, usado pelos "
                             "triples 2024 e 2022)")
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


def _extrair_csvs_de_zip(zip_path: Path, dest_dir: Path,
                       so_maior: bool = False) -> list[Path]:
    """Extrai os membros `.csv` de um zip p/ `dest_dir`; devolve os paths.

    Com `so_maior=False` extrai todos (TSE: um CSV por UF p/ o curated);
    com `True` só o maior membro (Censo/de-para: um CSV por zip, mesma
    regra determinística de `etl.censo.ingerir_censo`). Zip sem membro
    `.csv` levanta `ValueError` antes de qualquer escrita downstream.
    Arquivo que não é zip é copiado como CSV único (robustez p/
    fixtures — o fluxo oficial sempre baixa zips).
    """
    import zipfile

    zip_path = Path(zip_path)
    dest_dir = Path(dest_dir)
    dest_dir.mkdir(parents=True, exist_ok=True)
    if not zipfile.is_zipfile(zip_path):
        unico = dest_dir / (zip_path.stem + ".csv")
        unico.write_bytes(zip_path.read_bytes())
        return [unico]
    with zipfile.ZipFile(zip_path) as zf:
        infos = [i for i in zf.infolist()
                 if not i.is_dir() and i.filename.lower().endswith(".csv")]
        if not infos:
            raise ValueError(
                f"zip sem membro .csv em {zip_path} (sem dado oficial)"
            )
        if so_maior:
            infos = [max(infos, key=lambda i: i.file_size)]
        saidas: list[Path] = []
        for info in infos:
            nome = Path(info.filename).name or "membro.csv"
            saida = dest_dir / nome
            with zf.open(info.filename) as fh:
                saida.write_bytes(fh.read())
            saidas.append(saida)
    return saidas


def _filtrar_v1(curated_dir: Path) -> dict:
    """Reescreve os CSVs do curated mantendo SÓ pares (ano, cargo) do V1.

    Os zips nacionais do TSE trazem todos os cargos (deputados, senador…
    — prova: run 2022-presidente, `build_marts` reprovando
    `(2022, DEPUTADO FEDERAL)` e cia.); sem este filtro o `build_all`
    abaixo reprova fail-closed antes de qualquer escrita. Linhas fora do
    V1 são descartadas (fora de escopo, nunca chute de mapeamento);
    arquivos sem nenhuma linha V1 são removidos. Devolve
    `{"mantidas", "descartadas", "arquivos_removidos"}` e imprime o
    resumo (auditoria do que ficou de fora).
    """
    from etl.sources import V1_DATASETS

    validos = {(int(e["ano"]), str(e["cargo"]).upper())
               for e in V1_DATASETS}
    mantidas = descartadas = removidos = 0
    for csv_path in sorted(Path(curated_dir).glob("*.csv")):
        bruto = csv_path.read_bytes()
        texto = enc = None
        for encoding in ("utf-8-sig", "utf-8", "latin1"):
            try:
                texto = bruto.decode(encoding)
                enc = encoding
                break
            except UnicodeDecodeError:
                continue
        if texto is None:  # pragma: no cover — só com CSV ilegível
            raise ValueError(
                f"filtro V1: CSV ilegível em {csv_path} (sem dado oficial)"
            )
        linhas = texto.splitlines()
        if not linhas:
            csv_path.unlink()
            removidos += 1
            continue
        header, corpos = linhas[0], linhas[1:]
        idx_ano = idx_cargo = None
        cols = [c.strip().strip('"').upper() for c in header.split(";")]
        if "ANO_ELEICAO" in cols:
            idx_ano = cols.index("ANO_ELEICAO")
        if "DS_CARGO" in cols:
            idx_cargo = cols.index("DS_CARGO")
        keep = []
        for linha in corpos:
            if idx_ano is None or idx_cargo is None:
                keep.append(linha)
                continue
            cels = linha.split(";")
            try:
                par = (int(cels[idx_ano].strip().strip('"')),
                       cels[idx_cargo].strip().strip('"').upper())
            except (IndexError, ValueError):
                continue
            if par in validos:
                keep.append(linha)
        descartadas += len(corpos) - len(keep)
        mantidas += len(keep)
        if keep:
            csv_path.write_text("\n".join([header, *keep]) + "\n",
                                encoding=enc)
        else:
            csv_path.unlink()
            removidos += 1
    print(f"filtro V1: {mantidas} linhas mantidas, {descartadas} "
          f"descartadas (fora de escopo), {removidos} arquivo(s) removido(s)")
    return {"mantidas": mantidas, "descartadas": descartadas,
            "arquivos_removidos": removidos}


def _extrair_csv_unico(zip_path: Path, dest_dir: Path) -> Path:
    """Extrai o único membro `.csv` esperado de um zip; devolve o path.

    Invólucro de `_extrair_csvs_de_zip(..., so_maior=True)` (Censo/de-para:
    um CSV por zip) com guarda explícita de cardinalidade: se a extração
    não devolver exatamente 1 CSV, levanta `ValueError` curado
    (`esperado 1 CSV em …, obtido N`) em vez do `ValueError` críptico do
    desempacotamento de tupla.
    """
    saidas = _extrair_csvs_de_zip(zip_path, dest_dir, so_maior=True)
    if len(saidas) != 1:
        raise ValueError(
            f"esperado 1 CSV em {zip_path}, obtido {len(saidas)}"
        )
    return saidas[0]


def _resumo_fato(fato_path: Path) -> str:
    """Lê o fato gerado; devolve `<N> votos, <M> municípios` p/ o resumo."""
    doc = json.loads(Path(fato_path).read_text(encoding="utf-8"))
    munis = doc.get("municipios", [])
    total = sum((m.get("total") or 0) for m in munis
                if isinstance(m, dict))
    return f"{total} votos, {len(munis)} municípios"


def main(argv=None) -> int:
    """Valida o triple e orquestra a ingestão; devolve 0/1/2.

    "Sem escrita" em falha (p.ex. zip inválido) = sem CSV/DB/JSON
    downstream; os `mkdir`s de `curated`/DB/`web-data-dir` ocorrem antes
    da validação de conteúdo, então dirs vazios podem existir.
    """
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
    # Guarda anti-perda ANTES de qualquer download, depois fetch das 3
    # fontes; o resto só orquestra entrypoints existentes, na mesma ordem
    # de `etl/__main__.py` (sem duplicar lógica de ETL).
    try:
        _guard_webdata(args.web_data_dir, args.force_real)
    except SystemExit as exc:
        return exc.code if isinstance(exc.code, int) else 2
    try:
        fetched = _passo_fetch(args.raw_dir, args.ano, args.cargo)
    except Exception as exc:
        print(f"erro: {exc}", file=sys.stderr)
        return 2
    try:
        from etl.__main__ import (_SAIDA_GATES, _SAIDA_OK, _passo_censo,
                                  _passo_depara)
        from etl.build_fato import build_fato
        from etl.build_marts import build_all
        from etl.depara import DEPARA_URL
        from etl.sources import TOTAL_CENSO_2022
        from etl.validate import run_gates

        manifest = (Path(args.manifest) if args.manifest is not None
                    else Path(args.db).parent / "manifest.json")
        Path(args.curated_dir).mkdir(parents=True, exist_ok=True)
        Path(args.db).parent.mkdir(parents=True, exist_ok=True)
        Path(args.web_data_dir).mkdir(parents=True, exist_ok=True)
        # De-para: extrai o membro CSV do zip e registra/parseia NOS MESMOS
        # bytes hasheados (`_passo_depara`: lê uma vez, hasheia e parseia
        # a mesma leitura — sem TOCTOU).
        depara_csv = _extrair_csv_unico(
            fetched["depara"]["path"], Path(args.raw_dir))
        depara = _passo_depara(depara_csv, manifest)
        print("de-para: join TSE→IBGE7 ativo nos marts")
        # TSE: extrai os membros CSV (um por UF) p/ o curated e constrói
        # os marts com o join ativo; `source_shas` amarra a ingestão ao
        # sha do zip de origem (mesmo contrato de `etl/__main__`).
        _extrair_csvs_de_zip(fetched["tse"]["path"], Path(args.curated_dir))
        # Zips nacionais trazem todos os cargos; `build_all` só aceita
        # pares V1 (fail-closed) — filtra antes, sem chute.
        _filtrar_v1(Path(args.curated_dir))
        source_shas = {(args.ano, str(args.cargo).upper()):
                       fetched["tse"]["sha256"]}
        build_all(args.curated_dir, args.db, manifest,
                  web_data_dir=args.web_data_dir, source_shas=source_shas,
                  depara=depara)
        print("build: marts ok")
        # Censo: gate de soma fail-closed ANTES de gravar dim_municipio
        # (dentro de `_passo_censo`); diverge → saída 1 sem fato adiante.
        # Sem flag, vale o total oficial do Censo 2022 (spec §1: triples
        # 2024 e 2022 usam o mesmo Censo).
        censo_csv = _extrair_csv_unico(
            fetched["censo"]["path"], Path(args.raw_dir))
        total = (args.censo_total_esperado if args.censo_total_esperado
                 is not None else TOTAL_CENSO_2022)
        erros_censo = _passo_censo(censo_csv, Path(args.db), manifest,
                                   total,
                                   web_data_dir=args.web_data_dir)
        if erros_censo:
            print(f"{_SAIDA_GATES}: {'; '.join(erros_censo)}", file=sys.stderr)
            return 1
        fato_path = build_fato(str(args.db), str(args.web_data_dir),
                               args.ano, args.turno, args.cargo,
                               depara_url=DEPARA_URL)
        print(f"fato: {Path(fato_path).name} ok ({_resumo_fato(fato_path)})")
        # Gates sobre o servido (DB + mirror irmão dos bytes + fato):
        # o canônico acumula histórico e nunca atesta bytes — validar o
        # mirror é o contrato byte-aware (mesmo de `etl/__main__`).
        mirror = Path(args.web_data_dir) / "manifest.json"
        erros = run_gates(str(args.db), manifest_path=str(mirror),
                          fato_paths=[fato_path])
        if erros:
            print(f"{_SAIDA_GATES}: {'; '.join(erros)}", file=sys.stderr)
            return 1
        print(_SAIDA_OK)
        return 0
    except Exception as exc:
        print(f"erro: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
