"""Seed determinístico de dados de amostra p/ CI e dev local (custo zero).

Gera `web/public/data/*.json` (resumo, por_uf, por_candidato, manifest)
através do caminho REAL do ETL (`etl.build_marts.build_all`) a partir de
um CSV sintético fixo — sem download do TSE, hermético e idempotente.

Uso:
    python scripts/seed_fixture_data.py [--force] [--manifest PATH] [--web-data-dir DIR]

Por padrão, RECUSA sobrescrever um manifest que contenha ingestões
não-fixture (dados oficiais de ingestão real) — nesse caso sai com erro e
preserva o arquivo; passe `--force` para substituir mesmo assim (o CI usa
`--force`, pois o checkout vem sem dados). Manifests só-com-fixture,
ausentes ou inválidos são substituídos sem `--force`.

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
    import sys
    sys.path.insert(0, str(_REPO_ROOT))
    from etl.build_marts import build_all

    manifest_path = Path(manifest_path)
    if manifest_path.exists():
        if _has_official_entries(manifest_path) and not force:
            raise RuntimeError(
                f"seed: {manifest_path} contém ingestões oficiais — "
                f"recusando sobrescrever (passe --force para substituir por amostra sintética)"
            )
        print(f"seed: substituindo manifest existente em {manifest_path} "
              f"(amostra sintética; rode a ingestão real p/ dados oficiais)")
        # Reset p/ saída determinística (build_all anexa ao manifest existente).
        manifest_path.unlink()

    with tempfile.TemporaryDirectory(prefix="sad-seed-") as tmp:
        curated = Path(tmp) / "curated"
        curated.mkdir()
        (curated / "fixture.csv").write_text(_FIXTURE_CSV, encoding="utf-8")
        build_all(curated, Path(tmp) / "seed.duckdb", manifest_path,
                  web_data_dir=web_data_dir)
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    for entry in manifest.get("ingestions", []):
        if isinstance(entry, dict):
            entry["fixture"] = True
            entry["nota"] = _FIXTURE_NOTA
    manifest_path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    # Mantém o espelho idêntico ao canônico (contrato do build_all, Task 5 R2).
    (web_data_dir / "manifest.json").write_bytes(manifest_path.read_bytes())
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
    print(f"ingestions={len(ingestions)} "
          f"sha256={str(first.get('sha256', ''))[:12]}… "
          f"total_votos={resumo.get('total_votos')} "
          f"total_linhas={resumo.get('total_linhas')} "
          f"anos={resumo.get('anos')}")


if __name__ == "__main__":
    main()
