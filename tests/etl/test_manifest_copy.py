"""Task 5 fix (R2): build_all escreve cópia idêntica do manifest em web_data_dir.

O manifest canônico segue sendo `manifest_path`; a frente pública lê
`/data/manifest.json`, por isso o build publica a mesma cópia em web_data_dir.
"""

import json

from etl.build_marts import build_all

_CSV = (
    "ANO_ELEICAO;DS_CARGO;SG_UF;CD_MUNICIPIO;NM_URNA;QT_VOTOS\n"
    "2022;PRESIDENTE;SP;3550308;X;10\n"
    "2022;PRESIDENTE;RJ;3304557;Y;5\n"
)


def test_manifest_copy_in_web_data_dir(tmp_path):
    curated = tmp_path / "curated"
    curated.mkdir()
    (curated / "raw.csv").write_text(_CSV, encoding="utf-8")
    webdata = tmp_path / "webdata"
    manifest = tmp_path / "m.json"
    build_all(curated, tmp_path / "t.duckdb", manifest, web_data_dir=webdata)
    copy = webdata / "manifest.json"
    assert copy.exists()
    canonical = json.loads(manifest.read_text(encoding="utf-8"))
    mirrored = json.loads(copy.read_text(encoding="utf-8"))
    assert mirrored == canonical
    assert len(mirrored["ingestions"]) == len(canonical["ingestions"]) > 0
    for entry in mirrored["ingestions"]:
        assert entry["source_url"] and entry["sha256"]
