"""Task 1 (RED-first): ETL Censo IBGE 2022 por município.

RED: estes testes devem FALHAR contra o repo pré-Task 1
(módulo etl.censo ausente, sem CENSO_DATASETS).
"""

import pandas as pd
import pytest


def _fixture_ibge():
    # Header próximo do real IBGE/SIDRA por município.
    return pd.DataFrame(
        [
            {
                "CD_MUN": "3550308",
                "P_SUPERIOR": 25.5,
                "P_MEDIO": 40.0,
                "P_FUNDAMENTAL": 34.5,
                "RENDIMENTO_MEDIO": 3500.0,
                "TX_POBREZA": 12.3,
                "IDADE_MEDIANA": 35.0,
                "TX_URBANIZACAO": 99.1,
                "POP_RESIDENTE": 11000,
            },
            {
                "CD_MUN": "3304557",
                "P_SUPERIOR": 20.0,
                "P_MEDIO": 35.0,
                "P_FUNDAMENTAL": 45.0,
                "RENDIMENTO_MEDIO": 2800.0,
                "TX_POBREZA": 18.7,
                "IDADE_MEDIANA": 33.0,
                "TX_URBANIZACAO": 100.0,
                "POP_RESIDENTE": 670000,
            },
        ]
    )


def test_normalize_censo_columns():
    from etl.censo import normalize_censo

    df = normalize_censo(_fixture_ibge())
    assert list(df.columns) == [
        "ibge7",
        "esc_sup",
        "esc_med",
        "esc_fund",
        "renda_media",
        "pobres_pct",
        "idade_mediana",
        "urbanizacao",
        "pop",
    ]
    assert df["ibge7"].tolist() == ["3550308", "3304557"]
    assert df["ibge7"].dtype == "string"
    assert int(df["pop"].sum()) == 681000


def test_normalize_censo_invalid_ibge_warns():
    from etl.censo import normalize_censo

    df = pd.DataFrame(
        [
            {
                "CD_MUN": "ABC",
                "P_SUPERIOR": 1.0,
                "P_MEDIO": 1.0,
                "P_FUNDAMENTAL": 1.0,
                "RENDIMENTO_MEDIO": 1.0,
                "TX_POBREZA": 1.0,
                "IDADE_MEDIANA": 1.0,
                "TX_URBANIZACAO": 1.0,
                "POP_RESIDENTE": 100,
            }
        ]
    )
    with pytest.warns(UserWarning):
        out = normalize_censo(df)
    assert out["ibge7"].tolist() == [""]


def test_censo_sum_gate_vs_ibge_total(tmp_path):
    from etl.censo import check_censo_sum, normalize_censo

    df = normalize_censo(_fixture_ibge())
    assert check_censo_sum(df, 681000) == []
    errors = check_censo_sum(df, 999999)
    assert errors and any("soma" in e for e in errors)


def test_normalize_censo_rejects_non_dataframe():
    from etl.censo import normalize_censo

    with pytest.raises(TypeError):
        normalize_censo([{"CD_MUN": "3550308"}])


def test_normalize_censo_rejects_missing_municipio():
    from etl.censo import normalize_censo

    with pytest.raises(ValueError, match="municipio"):
        normalize_censo(pd.DataFrame([{"POP": 100}]))


def test_censo_sum_rejects_non_int_totals():
    from etl.censo import check_censo_sum, normalize_censo

    df = normalize_censo(_fixture_ibge())
    assert check_censo_sum(df, "681000") == []
    for bad_total in (681000.9, 681000.0, None, True, "abc", ""):
        errors = check_censo_sum(df, bad_total)
        assert errors and any("soma" in e for e in errors), bad_total


def test_censo_datasets_allowlisted_and_shaped():
    from urllib.parse import urlparse

    from etl.fetch import ALLOWED_HOSTS
    from etl.sources import CENSO_DATASETS

    assert isinstance(CENSO_DATASETS, list) and CENSO_DATASETS
    for entry in CENSO_DATASETS:
        for key in ("ano", "nome", "url", "dataset", "sha256"):
            assert key in entry, f"missing {key} in {entry}"
        assert entry.get("ano") == 2022
        assert entry.get("nome") == "censo_demografico_2022_municipios"
        # URL real confirmada no FTP (EVOLVE-4 T4) — nunca None adivinhada.
        url = entry.get("url")
        assert isinstance(url, str) and url, f"Censo url ausente: {entry}"
        host = (urlparse(url).hostname or "").lower()
        assert host in ALLOWED_HOSTS, f"Censo url fora da allowlist: {entry['url']}"
        assert url.startswith(
            "https://ftp.ibge.gov.br/Censos/Censo_Demografico_2022/"
            "Agregados_por_Setores_Censitarios/Agregados_por_Municipio_csv/"
        ), f"Censo url fora do path confirmado: {url}"
        assert url.endswith(".zip")


def test_censo_pending_url_never_downloads_or_registers(tmp_path):
    from etl.censo import register_censo_ingest
    from etl.fetch import download_dataset
    from etl.sources import CENSO_DATASETS

    assert CENSO_DATASETS[0].get("url")  # URL real confirmada (EVOLVE-4 T4)
    with pytest.raises(ValueError):
        download_dataset(None, str(tmp_path / "x.zip"))
    pending = {"url": None, "ano": 2022, "nome": "x", "dataset": "y"}
    with pytest.raises(ValueError):
        register_censo_ingest(str(tmp_path / "m.json"), rows=1,
                              sha256="ab" * 32, dataset=pending)
    assert not (tmp_path / "m.json").exists()
    # Dataset default (URL confirmada) registra com a URL real como fonte.
    entry = register_censo_ingest(
        str(tmp_path / "m.json"), rows=1, sha256="ab" * 32)
    assert entry["source_url"] == CENSO_DATASETS[0]["url"]


def test_censo_manifest_registers_date_and_version(tmp_path):
    from datetime import date, datetime, timezone

    from etl.censo import register_censo_ingest
    from etl.manifest import verify_manifest

    confirmed = {
        "url": "https://ftp.ibge.gov.br/Censos/Censo_Demografico_2022/confirmado.zip",
        "ano": 2022,
        "nome": "censo_demografico_2022_municipios",
        "dataset": "https://www.ibge.gov.br/estatisticas/sociais/populacao/22827-censo-demografico-2022.html",
    }
    manifest = tmp_path / "m.json"
    register_censo_ingest(str(manifest), rows=2, sha256="ab" * 32, dataset=confirmed)
    assert verify_manifest(str(manifest)) is True
    import json

    entries = json.loads(manifest.read_text(encoding="utf-8"))["ingestions"]
    assert len(entries) == 1
    assert date.fromisoformat(entries[0]["data"]) <= datetime.now(timezone.utc).date()
    assert entries[0]["etl_version"] == "1.1.0"


def test_idade_media_nao_vira_mediana():
    """IDADE_MEDIA (média) não pode alimentar idade_mediana (mediana)."""
    from etl.censo import normalize_censo

    df = pd.DataFrame(
        [
            {"CD_MUN": "3550308", "IDADE_MEDIA": 40.0, "POP_RESIDENTE": 100},
            {"CD_MUN": "3304557", "IDADE_MEDIA": 41.0, "POP_RESIDENTE": 200},
        ]
    )
    out = normalize_censo(df)
    assert out["idade_mediana"].isna().all()  # fail-closed: sem mediana oficial


def test_idade_med_alias_continua():
    """IDADE_MED segue valendo como mediana abreviada (sem super-remoção)."""
    from etl.censo import normalize_censo

    df = pd.DataFrame([{"CD_MUN": "3550308", "IDADE_MED": 33.0}])
    out = normalize_censo(df)
    assert out["idade_mediana"].tolist() == [33.0]


def test_codigo_float_normaliza(tmp_path=None):
    """Coluna de código float (3550308.0) normaliza p/ 7 dígitos, sem warn."""
    import warnings

    from etl.censo import normalize_censo

    df = pd.DataFrame({"CD_MUN": [3550308.0, 3304557.0]})
    with warnings.catch_warnings():
        warnings.simplefilter("error", UserWarning)
        out = normalize_censo(df)
    assert out["ibge7"].tolist() == ["3550308", "3304557"]


def test_formato_real_basico_normaliza_sem_adaptacao():
    """Formato real do FTP (CD_MUN + v0001 minúsculo, resto ausente).

    Espelha o header de Agregados_por_municipios_basico_BR.csv
    (confirmado em 2026-10-10): normalize_censo consome sem adaptação —
    ibge7 + pop preenchidos, demais campos nulos fail-closed.
    """
    from etl.censo import normalize_censo

    df = pd.DataFrame(
        [
            {"CD_MUN": "1100015", "NM_MUN": "Alta Floresta D'Oeste", "v0001": 21494},
            {"CD_MUN": "1100023", "NM_MUN": "Ariquemes", "v0001": 96833},
        ]
    )
    out = normalize_censo(df)
    assert out["ibge7"].tolist() == ["1100015", "1100023"]
    assert out["pop"].tolist() == [21494, 96833]
    for field in (
        "esc_sup",
        "esc_med",
        "esc_fund",
        "renda_media",
        "pobres_pct",
        "idade_mediana",
        "urbanizacao",
    ):
        assert out[field].isna().all(), field
