"""Orquestrador CLI do ETL (`python -m etl` / `sad-etl`).

Encadeia fetch → normalização/build → fato → gates SÓ orquestrando
(import + call dos entrypoints dos módulos, sem duplicar lógica):
`etl.fetch.download_dataset` → `etl.build_marts.build_all` (normaliza via
`normalize_resultados` internamente) → `etl.censo.normalize_censo` +
`register_censo_ingest` (`dim_municipio`) → `etl.build_fato.build_fato` →
`etl.validate.run_gates` (fail-closed).

Códigos de saída (fail-closed):
  0 — ok, gates verdes;
  1 — gates reprovados (versão anterior dos marts mantida; nada publicado);
  2 — erro (exceção em qualquer passo; fail-closed antes de publicar).

De-para TSE→IBGE7 (EVOLVE-15, opt-in `--depara-csv`): traduz
`CD_MUNICIPIO` nos marts antes da validação (sem ele, códigos TSE viram
`""` fail-closed como antes); a ingestão é registrada no manifest e a
URL entra nas `fontes` do fato.

Os gates finais validam o que será servido: o DuckDB + o mirror
`<web-data-dir>/manifest.json` (irmão dos bytes servidos, único que
`verify_manifest`/`_gate_fatos` atestam byte a byte — o canônico acumula
histórico e aponta p/ outro diretório) + os bytes do fato.

O fetch é opt-in (`--fetch`, baixa os zips V1 p/ `data/raw` — sandbox do
`etl.fetch`, sem `--raw-dir` de propósito); sem ele o run é offline a
partir do `--curated-dir`. Sem `--censo-csv` não há `dim_municipio` e o
`build_fato` reprova fail-closed ("sem dado oficial"), nunca fato sem Censo.

Transparência de gastos (opt-in, offline-first): `--siconfi-json` (array
JSON DCA → `fato_gov`), `--prestacao-csv` (CSV TSE `;` → `fato_fin`) e
`--with-transparencia` (detalhe federal CGU → `fato_transp_federal`,
exige `TRANSPARENCIA_API_KEY` no env; sem chave pula com `UserWarning`).
Sem as flags, os quadros seguem vazios e o build V1 é intacto.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import sys
import warnings
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parent.parent

_SAIDA_OK = "ok: pipeline concluído, gates verdes"
_SAIDA_GATES = "gates reprovados (fail-closed, versão anterior mantida)"


def _parse_args(argv=None):
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--curated-dir", type=Path,
                        default=_REPO_ROOT / "data" / "curated",
                        help="dir com CSVs/Parquet de entrada (padrão: data/curated)")
    parser.add_argument("--db", type=Path,
                        default=_REPO_ROOT / "data" / "sad.duckdb",
                        help="DuckDB de saída (padrão: data/sad.duckdb)")
    parser.add_argument("--manifest", type=Path, default=None,
                        help="manifest canônico de proveniência/histórico "
                             "(padrão: <dir do --db>/manifest.json); "
                             "os gates validam o mirror servido "
                             "(<web-data-dir>/manifest.json), não este arquivo")
    parser.add_argument("--web-data-dir", type=Path,
                        default=_REPO_ROOT / "web" / "public" / "data",
                        help="dir dos JSONs servidos (padrão: web/public/data)")
    parser.add_argument("--fetch", action="store_true",
                        help="baixar os zips V1 do TSE p/ data/raw antes do build "
                             "(com rede; sem a flag o run é offline)")
    parser.add_argument("--censo-csv", type=Path, default=None,
                        help="CSV bruto do Censo (header estilo IBGE/SIDRA, "
                             "`;`-separado) p/ materializar dim_municipio "
                             "(sem --censo-total-esperado, pula o gate de soma)")
    parser.add_argument("--censo-total-esperado", type=int, default=None,
                        help="total oficial esperado p/ a soma de pop do Censo "
                             "(gate fail-closed via check_censo_sum ANTES de "
                             "gravar dim_municipio; diverge → saída 1; "
                             "a ingestão via URL — ingerir_censo — sempre aplica)")
    parser.add_argument("--depara-csv", type=Path, default=None,
                        help="CSV oficial do de-para TSE→IBGE7 (membro .csv "
                             "extraído de municipio_tse_ibge.zip, "
                             "`;`-separado) p/ traduzir CD_MUNICIPIO nos "
                             "marts (sem ele, códigos TSE viram \"\" "
                             "fail-closed como antes)")
    parser.add_argument("--ano", type=int, default=2022,
                        help="ano do triple do fato (padrão: 2022)")
    parser.add_argument("--turno", type=int, default=1,
                        help="turno do triple do fato (padrão: 1)")
    parser.add_argument("--cargo", default="presidente",
                        help="cargo do triple do fato (padrão: presidente)")
    parser.add_argument("--sem-fato", action="store_true",
                        help="pular o build_fato (só marts + gates, sem fato_* nem gate de bytes)")
    parser.add_argument("--totais-oficiais", type=Path, default=None,
                        help="JSON {UF: total} p/ a comparação externa do gate de soma "
                             "(sem ele, só integridade interna + aviso explícito)")
    parser.add_argument("--siconfi-json", type=Path, default=None,
                        help="JSON bruto SICONFI DCA (array de registros) p/ "
                             "materializar fato_gov via normalize_siconfi "
                             "(sem ele, fato_gov vazio, V1 intacto)")
    parser.add_argument("--prestacao-csv", type=Path, default=None,
                        help="CSV bruto TSE de prestação de contas "
                             "(`;`-separado) p/ preencher fato_fin via "
                             "normalize_prestacao (sem ele, fato_fin vazio)")
    parser.add_argument("--with-transparencia", action="store_true",
                        help="buscar o detalhe federal CGU p/ fato_transp_federal "
                             "(exige TRANSPARENCIA_API_KEY no env; sem chave "
                             "ou com falha de rede, pula com UserWarning e o "
                             "build base SICONFI+TSE segue)")
    return parser.parse_args(argv)


def _passo_fetch() -> dict:
    """Baixa os zips V1 (dedupe por URL); devolve `(ano, CARGO) -> sha256`."""
    from etl import fetch
    from etl.sources import V1_DATASETS

    por_url: dict[str, list[dict]] = {}
    for entry in V1_DATASETS:
        por_url.setdefault(entry["url"], []).append(entry)
    shas: dict = {}
    for url, entries in sorted(por_url.items()):
        nome = url.rsplit("/", 1)[-1] or "dataset.zip"
        dest = fetch.RAW_ROOT / nome
        sha = fetch.download_dataset(url, dest)
        for entry in entries:
            shas[(entry["ano"], str(entry["cargo"]).upper())] = sha
        print(f"fetch: {nome} ok (sha256={sha[:12]}…)")
    return shas


def _passo_censo(censo_csv: Path, db: Path, manifest: Path,
                 total_esperado=None, web_data_dir=None) -> list[str]:
    """Normaliza o CSV do Censo, grava dim_municipio e registra a ingestão.

    Com `total_esperado`, aplica `check_censo_sum` fail-closed ANTES de
    qualquer escrita e devolve os erros (contrato `-> list[str]`, como
    `run_gates`); sem ele, só a integridade de schema do `normalize_censo`.
    Emissão do artefato (gatefix PR#9, coerente com `ingerir_censo` que
    nunca emite sem total auditado): SÓ vai ao dir servido com total
    auditado E `web_data_dir` (o recalc do `build_fato` seguinte o atesta
    no mirror); sem total auditado — ou sem dir servido (ex. `--sem-fato`,
    sem recalc adiante) — a emissão é local, irmã do manifest e atestada
    no canônico, nunca servida sem prova. Ordem: dim → ingestão →
    artefato (crash no meio deixa no máximo ingestão sem bytes — UI
    honesta —, nunca bytes sem proveniência de ingestão).
    """
    import duckdb
    import pandas as pd

    from etl.censo import (CENSO_ARTIFACT_FILENAME, normalize_censo,
                           register_censo_artifact, register_censo_ingest,
                           write_censo_artifact)

    bruto = Path(censo_csv).read_bytes()
    sha = hashlib.sha256(bruto).hexdigest()
    df = None
    for encoding in ("utf-8-sig", "utf-8", "latin1"):
        try:
            df = pd.read_csv(io.BytesIO(bruto), sep=";", encoding=encoding,
                             dtype="string")
            break
        except (UnicodeDecodeError, pd.errors.ParserError):
            continue
    if df is None:  # pragma: no cover — só com CSV ilegível nos 3 encodings
        raise ValueError(f"censo: CSV ilegível em {censo_csv} (sem dado oficial)")
    normalizado = normalize_censo(df)  # lógica toda no módulo, sem fork
    if total_esperado is not None:
        from etl.censo import check_censo_sum

        erros = check_censo_sum(normalizado, total_esperado)
        if erros:
            return erros  # dim/manifest intocados, sem fato adiante
    con = duckdb.connect(str(db))
    try:
        con.register("censo_df", normalizado)
        con.execute("CREATE OR REPLACE TABLE dim_municipio AS SELECT * FROM censo_df")
    finally:
        con.close()
    entry = register_censo_ingest(str(manifest), rows=len(normalizado), sha256=sha)
    print(f"censo: dim_municipio ok ({len(normalizado)} linhas, "
          f"sha256={str(entry.get('sha256', ''))[:12]}…)")
    if total_esperado is not None and web_data_dir is not None:
        gravado = write_censo_artifact(
            normalizado, Path(web_data_dir) / CENSO_ARTIFACT_FILENAME)
        print(f"censo: {CENSO_ARTIFACT_FILENAME} ok "
              f"({gravado['rows']} municípios servidos)")
    else:
        # Sem total auditado (ou sem dir servido): emissão local, irmã do
        # manifest e atestada no canônico — o servido segue sem o artefato
        # (nada servido sem prova, mesmo com `--sem-fato`).
        irmao = Path(manifest).parent / CENSO_ARTIFACT_FILENAME
        gravado = write_censo_artifact(normalizado, irmao)
        register_censo_artifact(
            str(manifest), gravado["path"], data_iso=entry["data"])
        print(f"censo: {CENSO_ARTIFACT_FILENAME} local ok "
              f"({gravado['rows']} municípios, sem total auditado — "
              "não servido)")
    return []


def _passo_depara(depara_csv: Path, manifest: Path) -> dict:
    """Lê o CSV oficial, valida (bijection fail-closed) e registra a ingestão.

    Devolve o mapeamento `{tse5: ibge7}` p/ `build_all`. Bytes com sha
    registrado no manifest (proveniência); CSV inválido levanta antes de
    qualquer escrita downstream.
    """
    from etl.depara import load_depara_csv, parse_depara_csv, register_depara_ingest

    bruto = Path(depara_csv).read_bytes()
    # Parse NOS MESMOS bytes hasheados (cubic R3: reler o path abriria
    # TOCTOU — o sha registrado e o mapa aplicado seriam de leituras
    # distintas).
    mapa = parse_depara_csv(bruto)
    entry = register_depara_ingest(
        str(manifest), rows=len(mapa), sha256=hashlib.sha256(bruto).hexdigest(),
        membro_csv=Path(depara_csv).name)
    print(f"de-para: {len(mapa)} pares TSE→IBGE7 ok "
          f"(sha256={str(entry.get('sha256', ''))[:12]}…)")
    return mapa


def _carregar_totais(path) -> dict | None:
    if path is None:
        return None
    doc = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(doc, dict):
        raise ValueError(
            f"totais oficiais: esperado objeto JSON {{UF: total}} em {path}"
        )
    return doc


def _passo_siconfi(siconfi_json: Path):
    """Lê o JSON bruto SICONFI DCA e devolve o quadro canônico (fato_gov).

    Escolha de leitura (brief subespecificado): o arquivo é um array
    JSON de registros (formato do Data Lake); bytes lidos com fallback
    de encoding `utf-8-sig/utf-8/latin1` (mesmo padrão de
    `build_marts._read_input_file`), `json.loads` → `pd.DataFrame` →
    `normalize_siconfi` (sem fork de lógica). Top-level fora de lista
    levanta `ValueError` fail-closed.
    """
    import pandas as pd

    from etl.siconfi import normalize_siconfi

    bruto = Path(siconfi_json).read_bytes()
    texto = None
    for encoding in ("utf-8-sig", "utf-8", "latin1"):
        try:
            texto = bruto.decode(encoding)
            break
        except UnicodeDecodeError:
            continue
    if texto is None:  # pragma: no cover — bytes ilegíveis nos 3 encodings
        raise ValueError(f"siconfi: JSON ilegível em {siconfi_json} (sem dado oficial)")
    try:
        records = json.loads(texto)
    except json.JSONDecodeError as exc:
        raise ValueError(
            f"siconfi: JSON inválido em {siconfi_json}: {exc} (sem dado oficial)"
        ) from exc
    if not isinstance(records, list):
        raise ValueError(
            f"siconfi: esperado array JSON de registros em {siconfi_json} "
            f"(veio {type(records).__name__}; sem dado oficial)"
        )
    if not records:
        # Array vazio: skip honesto (quadro vazio, como Task 4 p/ CGU),
        # nunca erro — a frente exibe "sem dado oficial".
        df = normalize_siconfi(pd.DataFrame(
            {c: pd.Series(dtype="string") for c in
             ("ANO", "ENTE", "RECEITA", "EMPENHADO", "LIQUIDADO", "PAGO")}))
    else:
        df = normalize_siconfi(pd.DataFrame(records))
    print(f"siconfi: fato_gov ok ({len(df)} linhas)")
    return df


def _passo_prestacao(prestacao_csv: Path):
    """Lê o CSV bruto TSE de prestação e devolve o quadro canônico (fato_fin).

    Leitura espelha `build_marts._read_input_file` (`;` com fallback de
    encoding `utf-8-sig/utf-8/latin1`, depois `,`/latin1) → DataFrame →
    `normalize_prestacao` (sem fork de lógica).
    """
    import pandas as pd

    from etl.prestacao import normalize_prestacao

    df = None
    for encoding in ("utf-8-sig", "utf-8", "latin1"):
        try:
            df = pd.read_csv(prestacao_csv, sep=";", encoding=encoding,
                             dtype="string")
            break
        except (UnicodeDecodeError, pd.errors.ParserError):
            continue
    if df is None:
        df = pd.read_csv(prestacao_csv, sep=",", encoding="latin1",
                         dtype="string")
    fin = normalize_prestacao(df)
    print(f"prestacao: fato_fin ok ({len(fin)} linhas)")
    return fin


def _passo_cgu():
    """Busca o detalhe federal CGU ou devolve None com `UserWarning` (skip honesto).

    Sem `TRANSPARENCIA_API_KEY` no env — ou com qualquer falha de rede/
    parse — emite `UserWarning` e devolve None: o build base SICONFI+TSE
    segue intacto (nunca erro). A chave nunca é logada nem gravada.
    """
    from etl.sources import CGU_META
    from etl.transparencia import normalize_cgu

    chave = os.environ.get("TRANSPARENCIA_API_KEY")
    if not chave:
        warnings.warn(
            "transparencia: TRANSPARENCIA_API_KEY ausente — detalhe federal "
            "CGU pulado (base SICONFI+TSE intacta)",
            UserWarning,
            stacklevel=2,
        )
        return None
    try:
        import requests

        resp = requests.get(CGU_META["url"], timeout=60,
                            headers={"chave-api-dados": chave,
                                     "Accept": "application/json"})
        resp.raise_for_status()
        payload = resp.json()
        records = (payload.get("data") if isinstance(payload, dict)
                   else payload) or []
        cgu = normalize_cgu(records if isinstance(records, list) else [])
    except Exception as exc:
        warnings.warn(
            "transparencia: CGU indisponível "
            f"({exc}) — detalhe federal pulado (base SICONFI+TSE intacta)",
            UserWarning,
            stacklevel=2,
        )
        return None
    print(f"transparencia: fato_transp_federal ok ({len(cgu)} linhas)")
    return cgu


def main(argv=None) -> int:
    """Roda o pipeline; devolve 0 ok, 1 gates reprovados, 2 erro."""
    args = _parse_args(argv)
    manifest = Path(args.manifest) if args.manifest is not None else Path(args.db).parent / "manifest.json"
    try:
        source_shas = _passo_fetch() if args.fetch else {}
        if not args.fetch:
            print("fetch: pulado (offline; passe --fetch p/ baixar os zips V1)")
        from etl.build_marts import build_all

        depara = None
        depara_url = None
        if args.depara_csv is not None:
            depara = _passo_depara(Path(args.depara_csv), manifest)
            from etl.depara import DEPARA_URL

            depara_url = DEPARA_URL
            print("de-para: join TSE→IBGE7 ativo nos marts")
        gov_df = _passo_siconfi(Path(args.siconfi_json)) \
            if args.siconfi_json is not None else None
        fin_df = _passo_prestacao(Path(args.prestacao_csv)) \
            if args.prestacao_csv is not None else None
        cgu_df = _passo_cgu() if args.with_transparencia else None
        build_all(args.curated_dir, args.db, manifest,
                  web_data_dir=args.web_data_dir, source_shas=source_shas,
                  depara=depara, gov_df=gov_df, fin_df=fin_df, cgu_df=cgu_df)
        print("build: marts ok")
        if args.censo_csv is not None:
            # --sem-fato: sem build_fato não há recalc de served artifacts
            # adiante — o servido é retido (withhold) e a emissão cai p/
            # local (ver _passo_censo), nunca servida sem atestação.
            erros_censo = _passo_censo(args.censo_csv, Path(args.db), manifest,
                                       args.censo_total_esperado,
                                       web_data_dir=(None if args.sem_fato
                                                     else args.web_data_dir))
            if erros_censo:
                print(f"{_SAIDA_GATES}: {'; '.join(erros_censo)}", file=sys.stderr)
                return 1
        fato_path = None
        if not args.sem_fato:
            from etl.build_fato import build_fato

            fato_path = build_fato(str(args.db), str(args.web_data_dir),
                                   args.ano, args.turno, args.cargo,
                                   depara_url=depara_url)
            print(f"fato: {Path(fato_path).name} ok")
        totais = _carregar_totais(args.totais_oficiais)
        from etl.validate import run_gates

        # Gates sobre o servido (DB + mirror irmão dos bytes + fato):
        # o canônico acumula histórico com `artifacts` de outro diretório
        # e nunca atesta bytes — validar o mirror é o contrato byte-aware.
        mirror = Path(args.web_data_dir) / "manifest.json"
        erros = run_gates(str(args.db), manifest_path=str(mirror),
                          totais_oficiais=totais,
                          fato_paths=[fato_path] if fato_path else None)
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
