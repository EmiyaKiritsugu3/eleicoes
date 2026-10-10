"""EVOLVE-7 Task 1 (RED-first): `ingerir_censo` emite `censo_municipios.json`.

Contrato: entrypoint de ingestão emite `{ibge7: pop}` + entry em
`manifest["artifacts"]` sob o MESMO contrato hash dos servidos
(sha256 dos bytes + `size_bytes` + `data` ISO, validado por
`_validate_artifact_entry` — sem fork), gate-first como a dim
(soma divergente bloqueia dim + artefato + manifest antes de
qualquer escrita). Tudo fake-local (sem rede, sem skip).
"""

import hashlib
import io
import json
import zipfile

_LINS = [("3550308", 10000), ("3304557", 12000)]
_FAKE_TOTAL = 22000


def _zip_bytes(rows=_LINS):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr(
            "Agregados_por_municipios_basico_BR.csv",
            "CD_MUN;v0001\n"
            + "".join(f"{cod};{pop}\n" for cod, pop in rows),
        )
    return buf.getvalue()


def _fake_download(payload):
    def _dl(url, dest, **kwargs):
        from pathlib import Path

        Path(dest).write_bytes(payload)
        return hashlib.sha256(payload).hexdigest()

    return _dl


def _ingerir(tmp_path, monkeypatch, rows=_LINS, total=_FAKE_TOTAL):
    import etl.censo as censo_mod
    from etl import fetch
    from etl.censo import ingerir_censo

    monkeypatch.setattr(fetch, "RAW_ROOT", tmp_path)
    monkeypatch.setattr(fetch, "download_dataset",
                        _fake_download(_zip_bytes(rows)))
    monkeypatch.setattr(censo_mod, "TOTAL_CENSO_2022", total)
    db = tmp_path / "censo.duckdb"
    manifest = tmp_path / "manifest.json"
    info = ingerir_censo(str(db), str(manifest))
    return info, db, manifest


def test_artifact_bytes_mapeiam_ibge_para_pop(tmp_path, monkeypatch):
    info, db, manifest = _ingerir(tmp_path, monkeypatch)
    from pathlib import Path

    artifact = Path(info["artifact_path"])
    assert artifact.name == "censo_municipios.json"
    payload = json.loads(artifact.read_bytes().decode("utf-8"))
    assert payload == {"3550308": 10000, "3304557": 12000}
    assert info["artifact_rows"] == 2
    assert db.is_file()  # dim intacta no mesmo run


def test_artifact_hash_entry_mesmo_contrato(tmp_path, monkeypatch):
    from datetime import date, datetime, timezone

    from etl import ETL_VERSION
    from etl.manifest import verify_manifest
    from etl.sources import CENSO_DATASETS

    info, db, manifest = _ingerir(tmp_path, monkeypatch)
    from pathlib import Path

    raw = Path(info["artifact_path"]).read_bytes()
    assert info["artifact_sha256"] == hashlib.sha256(raw).hexdigest()
    assert info["artifact_bytes"] == len(raw)
    doc = json.loads(manifest.read_text(encoding="utf-8"))
    entries = [a for a in doc.get("artifacts", [])
               if a.get("arquivo") == "censo_municipios.json"]
    assert len(entries) == 1
    entry = entries[0]
    assert entry["sha256"] == hashlib.sha256(raw).hexdigest()
    assert entry["size_bytes"] == len(raw)
    assert entry["source_url"] == CENSO_DATASETS[0]["url"]
    assert entry["sha_origin"] == "artifact"
    assert date.fromisoformat(entry["data"]) <= datetime.now(timezone.utc).date()
    assert entry["etl_version"] == ETL_VERSION
    assert len(doc["ingestions"]) == 1  # ingestão intacta em chave própria
    assert verify_manifest(str(manifest)) is True  # bytes provados


def test_gate_bloqueia_artefato_antes_de_qualquer_escrita(tmp_path, monkeypatch):
    import pytest

    import etl.censo as censo_mod
    from etl import fetch
    from etl.censo import ingerir_censo

    monkeypatch.setattr(fetch, "RAW_ROOT", tmp_path)
    monkeypatch.setattr(fetch, "download_dataset",
                        _fake_download(_zip_bytes()))
    monkeypatch.setattr(censo_mod, "TOTAL_CENSO_2022", _FAKE_TOTAL + 1)
    db = tmp_path / "censo.duckdb"
    manifest = tmp_path / "manifest.json"
    with pytest.raises(ValueError, match="(?i)soma"):
        ingerir_censo(str(db), str(manifest))
    assert not db.exists()  # dim intocada
    assert not manifest.exists()  # manifest intocado
    assert not (tmp_path / "censo_municipios.json").exists()  # sem artefato


def test_build_marts_registra_censo_servido(tmp_path):
    """`build_all` preserva + atesta `censo_municipios.json` do web dir."""
    import hashlib

    from etl.build_marts import build_all
    from etl.sources import CENSO_DATASETS

    curated = tmp_path / "curated"
    curated.mkdir()
    (curated / "raw.csv").write_text(
        "ANO_ELEICAO;DS_CARGO;SG_UF;CD_MUNICIPIO;NM_URNA;QT_VOTOS\n"
        "2022;PRESIDENTE;SP;3550308;X;10\n",
        encoding="utf-8",
    )
    webdata = tmp_path / "webdata"
    webdata.mkdir()
    mapa = {"3550308": 10000, "3304557": 12000}
    (webdata / "censo_municipios.json").write_text(
        json.dumps(mapa, ensure_ascii=False, indent=2), encoding="utf-8")
    manifest = tmp_path / "m.json"
    build_all(curated, tmp_path / "t.duckdb", manifest,
              web_data_dir=webdata)
    raw = (webdata / "censo_municipios.json").read_bytes()
    doc = json.loads(manifest.read_text(encoding="utf-8"))
    entries = [a for a in doc.get("artifacts", [])
               if a.get("arquivo") == "censo_municipios.json"]
    assert len(entries) == 1
    assert entries[0]["sha256"] == hashlib.sha256(raw).hexdigest()
    assert entries[0]["size_bytes"] == len(raw)
    assert entries[0]["source_url"] == CENSO_DATASETS[0]["url"]
    assert entries[0]["sha_origin"] == "artifact"
    # Trio TSE intacto (sem colapso p/ fonte do Censo).
    assert {a["arquivo"] for a in doc["artifacts"]} >= {
        "resumo.json", "por_uf.json", "por_candidato.json",
        "censo_municipios.json"}


def test_artifact_bytes_layout_congelado(tmp_path):
    """Pin de byte-identidade (S8707 fix): a serialização canônica não muda.

    `sort_keys=True` + `indent=2` faz parte do hash servido — trocar pelo
    `json.dump(..., indent=2)` do helper compartilhado mudaria os bytes e
    invalidaria hashes já atestados. Qualquer drift falha alto aqui.
    """
    import pandas as pd

    from etl.censo import write_censo_artifact

    df = pd.DataFrame({
        "ibge7": pd.array(["3550308", "3304557"], dtype="string"),
        "pop": pd.array([10000, 12000], dtype="Int64"),
    })
    gravado = write_censo_artifact(df, tmp_path / "censo_municipios.json")
    assert gravado["raw"] == (
        b'{\n  "3304557": 12000,\n  "3550308": 10000\n}'
    )


def test_artifact_out_path_com_dotdot_levanta_sem_criar(tmp_path):
    """S8707: `out_path` com `..` levanta `ValueError` antes de qualquer
    mutação (guarda antes do `mkdir`, precedente `_write_json_atomico`)."""
    import pandas as pd
    import pytest

    from etl.censo import write_censo_artifact

    df = pd.DataFrame({
        "ibge7": pd.array(["3550308"], dtype="string"),
        "pop": pd.array([10000], dtype="Int64"),
    })
    with pytest.raises(ValueError, match=r"\.\."):
        write_censo_artifact(df, tmp_path / "sub" / ".." / "evil.json")
    assert not (tmp_path / "evil.json").exists()
    assert not (tmp_path / "sub").exists()
    assert [p for p in tmp_path.rglob("*.tmp")] == []


def test_artifact_path_fora_do_dir_do_manifest_levanta(tmp_path, monkeypatch):
    """Gatefix (cubic P2): `artifact_path` fora do dir do manifest é
    rejeitado fail-closed em pt-BR — a entry grava basename e o verify
    resolve irmãos (atenderia o arquivo errado). Nada é criado."""
    import pytest

    import etl.censo as censo_mod
    from etl import fetch
    from etl.censo import ingerir_censo

    monkeypatch.setattr(fetch, "RAW_ROOT", tmp_path)
    monkeypatch.setattr(fetch, "download_dataset",
                        _fake_download(_zip_bytes()))
    monkeypatch.setattr(censo_mod, "TOTAL_CENSO_2022", _FAKE_TOTAL)
    db = tmp_path / "censo.duckdb"
    manifest = tmp_path / "manifest.json"
    fora = tmp_path / "outro" / "censo_municipios.json"
    with pytest.raises(ValueError, match="irm.o do manifest"):
        ingerir_censo(str(db), str(manifest), artifact_path=str(fora))
    assert not db.exists()
    assert not manifest.exists()
    assert not fora.exists()
    assert not (tmp_path / "outro").exists()
