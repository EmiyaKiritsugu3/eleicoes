"""Seed determinístico de dados de amostra p/ CI e dev local (custo zero).

Gera `web/public/data/*.json` (resumo, por_uf, por_candidato, manifest,
fato_2022_1_presidente + ingestões do Censo fixture) através do caminho
REAL do ETL (`etl.build_marts.build_all` + `normalize_censo` +
`etl.build_fato.build_fato`) a partir de CSVs sintéticos fixos — sem
download do TSE/IBGE, hermético e idempotente.

Uso:
    python scripts/seed_fixture_data.py [--force] [--manifest PATH] [--web-data-dir DIR]

Por padrão, RECUSA sobrescrever um manifest que contenha ingestões
não-fixture (dados oficiais de ingestão real) — nesse caso sai com erro e
preserva o arquivo; passe `--force` para substituir mesmo assim (o CI usa
`--force`, pois o checkout vem sem dados). Manifests só-com-fixture,
ausentes ou inválidos são substituídos sem `--force`.

Antes de substituir, o manifest existente é copiado para
`<manifest>.bak` e o conteúdo pré-existente do diretório público é copiado
para `<web-data-dir>.bak`; ambos são restaurados se o build falhar (M19)
e removidos em sucesso. Sem esse backup do diretório público, uma falha
após o `build_all` deixaria JSONs misturados (novos agregados + fato ausente).

Os dados gerados são SINTÉTICOS (2 linhas, 15 votos, ano 2022) e servem
apenas para exercitar o data path real no CI (`npm test` + `npm run build`)
e no dev local. NÃO são oficiais: as entradas do manifest levam
`"fixture": true` + nota, e a página /auditoria as rotula como amostra
sintética (nunca o selo oficial).
Para produção com dados oficiais, rode a ingestão real do TSE e publique
os JSONs junto ao deploy (ver web/app/metodologia/page.tsx, seção deploy).
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
import tempfile
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parent.parent

_FIXTURE_CSV = (
    "ANO_ELEICAO;DS_CARGO;SG_UF;CD_MUNICIPIO;NM_URNA;QT_VOTOS\n"
    "2022;PRESIDENTE;SP;3550308;CANDIDATO EXEMPLO A;10\n"
    "2022;PRESIDENTE;RJ;3304557;CANDIDATO EXEMPLO B;5\n"
)

_FIXTURE_NOTA = (
    "amostra sintética determinística p/ CI — sem valor oficial; "
    "produção exige ingestão real do TSE"
)

# Censo fixture mínimo (Task 11): um par por município do _FIXTURE_CSV,
# header estilo IBGE/SIDRA p/ normalize_censo (mesmo padrão de
# tests/etl/test_fato.py::_censo_raw). Sem Censo auditado o fato não
# existe (build_fato reprova 100% órfãos) e o motor/painel exibe
# "sem dado oficial" — o CI precisa deste passo antes dos testes web.
_FIXTURE_CENSO_CSV = (
    "CD_MUN;P_SUPERIOR;P_MEDIO;P_FUNDAMENTAL;RENDIMENTO_MEDIO;TX_POBREZA;"
    "IDADE_MEDIANA;TX_URBANIZACAO;POP_RESIDENTE\n"
    "3550308;20.0;35.0;45.0;2500.0;15.0;33.0;90.0;10000\n"
    "3304557;25.0;35.0;40.0;2600.0;18.0;34.0;85.0;12000\n"
)

# Data fixa do entry Censo fixture (determinismo do seed): a amostra é
# sempre a mesma, então a data nunca varia entre runs. Ingestões REAIS
# usam a data da coleta (register_censo_ingest) — só o fixture é fixo.
_FIXTURE_CENSO_DATA = "2022-01-01"

# Triple coberta pelo fixture TSE acima (turno ausente vira 1, M7).
_FATO_TRIPLE = (2022, 1, "presidente")


def _has_official_entries(manifest_path: Path) -> bool:
    """True se o manifest existente contém ingestões não-fixture (oficiais).

    Entradas sem a flag `fixture` contam como oficiais (ingestão real nunca
    marca a flag); manifest ausente/inválido/sem ingestões é seguro substituir.
    """
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        return False
    if not isinstance(manifest, dict):
        return False
    ingestions = manifest.get("ingestions")
    if not isinstance(ingestions, list):
        return False
    return any(
        not isinstance(e, dict) or e.get("fixture") is not True
        for e in ingestions
    )


def seed(manifest_path: Path, web_data_dir: Path, force: bool = False) -> dict:
    """Roda o build real sobre o fixture e marca as entradas como sintéticas."""
    import hashlib
    import io
    import sys
    sys.path.insert(0, str(_REPO_ROOT))
    from etl import ETL_VERSION
    from etl.build_fato import build_fato
    from etl.build_marts import build_all, register_served_artifacts
    from etl.censo import normalize_censo
    from etl.manifest import write_manifest
    from etl.sources import CENSO_DATASETS, V1_DATASETS

    manifest_path = Path(manifest_path)
    web_data_dir = Path(web_data_dir)
    backup_path = None
    manifest_existed = manifest_path.exists()
    web_existed = web_data_dir.exists()
    web_backup_dir = None
    if manifest_existed:
        if _has_official_entries(manifest_path) and not force:
            raise RuntimeError(
                f"seed: {manifest_path} contém ingestões oficiais — "
                f"recusando sobrescrever (passe --force para substituir por amostra sintética)"
            )
        print(f"seed: substituindo manifest existente em {manifest_path} "
              f"(amostra sintética; rode a ingestão real p/ dados oficiais)")
        # Backup pré-unlink (M19): nunca perder o manifest oficial se o
        # build falhar no meio do caminho.
        backup_path = manifest_path.with_name(manifest_path.name + ".bak")
        shutil.copy2(manifest_path, backup_path)
        # Reset p/ saída determinística (build_all anexa ao manifest existente).
        manifest_path.unlink()

    # Backup do diretório público: build_all + build_fato substituem os
    # JSONs públicos antes de qualquer ponto de falha, então um seed que
    # falha no meio deixaria saídas misturadas sem este backup.
    if web_existed:
        web_backup_dir = web_data_dir.with_name(web_data_dir.name + ".bak")
        if web_backup_dir.exists():
            shutil.rmtree(web_backup_dir)
        shutil.copytree(web_data_dir, web_backup_dir)

    try:
        with tempfile.TemporaryDirectory(prefix="sad-seed-") as tmp:
            curated = Path(tmp) / "curated"
            curated.mkdir()
            (curated / "fixture.csv").write_text(_FIXTURE_CSV, encoding="utf-8")
            db_tmp = Path(tmp) / "seed.duckdb"
            build_all(curated, db_tmp, manifest_path,
                      web_data_dir=web_data_dir)
            # Motor Verdade: Censo fixture -> dim_municipio -> fato sintético,
            # pelo caminho REAL (normalize_censo + build_fato). O Censo real
            # segue indisponível (URL pendente, Task 1): o entry do Censo
            # abaixo usa a página do catálogo IBGE como source_url e o sha256
            # do payload sintético — sempre marcado fixture:true adiante.
            import duckdb
            import pandas as pd
            censo_raw = pd.read_csv(io.StringIO(_FIXTURE_CENSO_CSV), sep=";",
                                    dtype="string")
            con = duckdb.connect(str(db_tmp))
            try:
                con.register("censo_df", normalize_censo(censo_raw))
                con.execute(
                    "CREATE OR REPLACE TABLE dim_municipio AS "
                    "SELECT * FROM censo_df"
                )
            finally:
                con.close()
            write_manifest(manifest_path, {
                "source_url": CENSO_DATASETS[0]["dataset"],
                "sha256": hashlib.sha256(
                    _FIXTURE_CENSO_CSV.encode("utf-8")).hexdigest(),
                "data": _FIXTURE_CENSO_DATA,
                "etl_version": ETL_VERSION,
                "dataset": CENSO_DATASETS[0]["nome"],
                "ano": CENSO_DATASETS[0]["ano"],
                "tipo": "censo_ibge_2022",
                "rows": 2,
            })
            ano, turno, cargo = _FATO_TRIPLE
            build_fato(db_tmp, web_data_dir, ano, turno, cargo)
            # build_fato anexa ao <db dir>/manifest.json (aqui o tmp):
            # promove o entry do fato p/ o manifest real.
            tmp_manifest = json.loads(
                (db_tmp.parent / "manifest.json").read_text(encoding="utf-8"))
            for entry in tmp_manifest.get("ingestions", []):
                if isinstance(entry, dict):
                    write_manifest(manifest_path, entry)
            # Hashes dos bytes servidos (trio do build_all + fato do
            # build_fato): recalculados aqui porque o fato só existe após o
            # build_fato. Substituição integral — o trio sai idêntico.
            ano, turno, cargo = _FATO_TRIPLE
            fixture_sources = [
                e for e in V1_DATASETS
                if e["ano"] == ano and str(e["cargo"]).upper() == cargo.upper()
            ]
            register_served_artifacts(manifest_path, web_data_dir,
                                      fixture_sources)
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        for entry in manifest.get("ingestions", []):
            if isinstance(entry, dict):
                entry["fixture"] = True
                entry["nota"] = _FIXTURE_NOTA
        for entry in manifest.get("artifacts", []):
            if isinstance(entry, dict):
                entry["fixture"] = True
                entry["nota"] = _FIXTURE_NOTA
        manifest_path.write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
        # Mantém o espelho idêntico ao canônico (contrato do build_all, Task 5 R2).
        (web_data_dir / "manifest.json").write_bytes(manifest_path.read_bytes())
    except BaseException:
        if backup_path is not None and backup_path.exists():
            shutil.copy2(backup_path, manifest_path)  # restaura o oficial
        elif not manifest_existed and manifest_path.exists():
            manifest_path.unlink()  # criado pelo run falho: sem entulho parcial
        if web_backup_dir is not None and web_backup_dir.exists():
            shutil.rmtree(web_data_dir, ignore_errors=True)
            shutil.copytree(web_backup_dir, web_data_dir)  # restaura os JSONs públicos
            shutil.rmtree(web_backup_dir, ignore_errors=True)  # restaurado: sem entulho
        elif not web_existed:
            shutil.rmtree(web_data_dir, ignore_errors=True)  # sem entulho parcial
        raise
    else:
        if backup_path is not None and backup_path.exists():
            backup_path.unlink()  # sucesso: sem entulho
        if web_backup_dir is not None and web_backup_dir.exists():
            shutil.rmtree(web_backup_dir)  # sucesso: sem entulho
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--force", action="store_true",
                        help="substituir mesmo se o manifest contiver ingestões oficiais")
    parser.add_argument("--manifest", type=Path,
                        default=_REPO_ROOT / "data" / "manifest.json")
    parser.add_argument("--web-data-dir", type=Path,
                        default=_REPO_ROOT / "web" / "public" / "data")
    args = parser.parse_args()
    try:
        manifest = seed(args.manifest, args.web_data_dir, force=args.force)
    except RuntimeError as exc:
        print(f"erro: {exc}", file=sys.stderr)
        raise SystemExit(2)
    resumo = json.loads((args.web_data_dir / "resumo.json").read_text(encoding="utf-8"))
    ingestions = manifest.get("ingestions", [])
    first = ingestions[0] if ingestions else {}
    ano, turno, cargo = _FATO_TRIPLE
    fato_name = f"fato_{ano}_{turno}_{cargo}.json"
    fato = json.loads((args.web_data_dir / fato_name).read_text(encoding="utf-8"))
    print(f"ingestions={len(ingestions)} "
          f"sha256={str(first.get('sha256', ''))[:12]}… "
          f"total_votos={resumo.get('total_votos')} "
          f"total_linhas={resumo.get('total_linhas')} "
          f"anos={resumo.get('anos')} "
          f"fato_municipios={len(fato.get('municipios', []))}")


if __name__ == "__main__":
    main()
