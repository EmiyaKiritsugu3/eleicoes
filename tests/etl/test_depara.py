"""EVOLVE-15: de-para oficial TSE→IBGE7 (desbloqueio do fato real).

Fonte oficial (verificada 2026-10-11): dataset
`codigos-oficiais-de-uf-e-municipios-segundo-o-tse-e-o-ibge` (org TSE/SMG,
CC-BY), recurso municipio_tse_ibge.zip — CSV Latin-1 `;`-quoted com
CD_MUNICIPIO_TSE (5 dígitos, = formato dos votos reais) ↔
CD_MUNICIPIO_IBGE (7 dígitos), bijeção 5571↔5571.

Tudo offline (CSV sintético mínimo): rede só no e2e com skip explícito
(mesmo mecanismo de test_fato_real_e2e.py).
"""

import pandas as pd
import pytest

MINI_CSV = (
    '"DT_GERACAO";"HH_GERACAO";"CD_UF_TSE";"CD_UF_IBGE";"SG_UF";"NM_UF";'
    '"CD_MUNICIPIO_TSE";"NM_MUNICIPIO_TSE";"CD_MUNICIPIO_IBGE";"NM_MUNICIPIO_IBGE"\n'
    '"04/10/2026";"09:00:06";24;12;"AC";"Acre";"01007";"Bujari";1200138;"Bujari"\n'
    '"04/10/2026";"09:00:06";1;35;"SP";"São Paulo";"61000";"Euclides Da Cunha Paulista";3515350;"Euclides Da Cunha Paulista"\n'
)


def test_parse_mapeia_tse_para_ibge7():
    from etl.depara import parse_depara_csv

    mapa = parse_depara_csv(MINI_CSV.encode("latin-1"))
    assert mapa == {"01007": "1200138", "61000": "3515350"}


def test_parse_canoniza_chave_4_digitos():
    """Votos sem padding ("3018") casam com o oficial ("03018")."""
    from etl.depara import parse_depara_csv

    mini = MINI_CSV.replace('"01007"', '"1007"')
    mapa = parse_depara_csv(mini.encode("latin-1"))
    assert mapa["01007"] == "1200138"


def test_parse_rejeita_dv_invalido():
    from etl.depara import parse_depara_csv

    payload = MINI_CSV.replace("3515350", "3515351").encode("latin-1")  # DV 1≠0
    with pytest.raises(ValueError, match="DV|dígito|verificador|IBGE"):
        parse_depara_csv(payload)


def test_parse_rejeita_duplicata():
    from etl.depara import parse_depara_csv

    linhas = MINI_CSV.strip().split("\n")
    payload = ("\n".join(linhas + [linhas[1]]) + "\n").encode("latin-1")
    with pytest.raises(ValueError, match="duplicad|bijection|bijec"):
        parse_depara_csv(payload)


def test_parse_rejeita_vazio_e_sem_coluna():
    from etl.depara import parse_depara_csv

    with pytest.raises(ValueError, match="vazi|coluna|header"):
        parse_depara_csv(b"")
    payload = MINI_CSV.replace("CD_MUNICIPIO_TSE", "CD_XX").encode("latin-1")
    with pytest.raises(ValueError, match="coluna"):
        parse_depara_csv(payload)


def test_normalize_com_depara_mapeia_sem_warning():
    import warnings

    import pandas as pd

    from etl.depara import parse_depara_csv
    from etl.normalize import normalize_resultados

    mapa = parse_depara_csv(MINI_CSV.encode("latin-1"))
    df = pd.DataFrame([{
        "ANO_ELEICAO": 2024, "NR_TURNO": 1, "DS_CARGO": "PREFEITO",
        "SG_UF": "AC", "CD_MUNICIPIO": "01007", "SQ_CANDIDATO": "1",
        "NM_URNA_CANDIDATO": "X", "SG_PARTIDO": "PA", "QT_VOTOS_NOMINAIS": 10,
    }])
    with warnings.catch_warnings():
        warnings.simplefilter("error")  # mapeado não avisa
        out = normalize_resultados(df, depara=mapa)
    assert out["municipio_ibge"].tolist() == ["1200138"]


def test_normalize_com_depara_codigo_curto_nao_mapeia():
    """cubic R3: "12" nunca vira "00012" (lixo não casa com município)."""
    import pandas as pd

    from etl.normalize import normalize_resultados

    df = pd.DataFrame([{
        "ANO_ELEICAO": 2024, "NR_TURNO": 1, "DS_CARGO": "PREFEITO",
        "SG_UF": "AC", "CD_MUNICIPIO": "12", "SQ_CANDIDATO": "1",
        "NM_URNA_CANDIDATO": "X", "SG_PARTIDO": "PA", "QT_VOTOS_NOMINAIS": 10,
    }])
    with pytest.warns(UserWarning, match="IBGE"):
        out = normalize_resultados(df, depara={"00012": "1200138"})
    assert out["municipio_ibge"].tolist() == [""]


def test_parse_aceita_bom_utf8():
    """cubic R3: BOM não gruda na 1ª coluna (utf-8-sig antes de latin1)."""
    from etl.depara import parse_depara_csv

    payload = ("\ufeff" + MINI_CSV).encode("utf-8")
    mapa = parse_depara_csv(payload)
    assert mapa["01007"] == "1200138"


def test_normalize_com_depara_desconhecido_fail_closed():
    from etl.normalize import normalize_resultados

    df = pd.DataFrame([{
        "ANO_ELEICAO": 2024, "NR_TURNO": 1, "DS_CARGO": "PREFEITO",
        "SG_UF": "RR", "CD_MUNICIPIO": "99999", "SQ_CANDIDATO": "1",
        "NM_URNA_CANDIDATO": "X", "SG_PARTIDO": "PA", "QT_VOTOS_NOMINAIS": 10,
    }])
    with pytest.warns(UserWarning, match="IBGE"):
        out = normalize_resultados(df, depara={"01007": "1200138"})
    assert out["municipio_ibge"].tolist() == [""]


def test_normalize_sem_depara_comportamento_intacto():
    """Default None = comportamento legado (fail-closed 100% TSE)."""
    import pandas as pd

    from etl.normalize import normalize_resultados

    df = pd.DataFrame([{
        "ANO_ELEICAO": 2024, "NR_TURNO": 1, "DS_CARGO": "PREFEITO",
        "SG_UF": "RR", "CD_MUNICIPIO": "3018", "SQ_CANDIDATO": "1",
        "NM_URNA_CANDIDATO": "X", "SG_PARTIDO": "PA", "QT_VOTOS_NOMINAIS": 10,
    }])
    with pytest.warns(UserWarning, match="IBGE"):
        out = normalize_resultados(df)
    assert out["municipio_ibge"].tolist() == [""]


def test_register_depara_ingest_exige_fonte_e_sha(tmp_path):
    from etl.depara import register_depara_ingest

    manifest = tmp_path / "manifest.json"
    entry = register_depara_ingest(
        str(manifest), rows=5571, sha256="a" * 64, data="2026-10-11")
    assert entry["source_url"].startswith("https://cdn.tse.jus.br/")
    assert entry["rows"] == 5571
    assert entry["sha_origin"] == "csv_extraido"  # cubic R3: sha do membro
    with pytest.raises(ValueError, match="sha256"):
        register_depara_ingest(str(manifest), rows=1, sha256="curto")


def test_register_depara_ingest_cria_parent_e_grava_membro(tmp_path):
    """cubic R3: manifest em dir novo + membro_csv registrado."""
    from etl.depara import register_depara_ingest

    manifest = tmp_path / "novo" / "manifest.json"
    entry = register_depara_ingest(
        str(manifest), rows=2, sha256="b" * 64, data="2026-10-11",
        membro_csv="municipio_tse_ibge.csv")
    assert manifest.is_file()
    assert entry["membro_csv"] == "municipio_tse_ibge.csv"


def test_build_all_vazio_preserva_proveniencia_depara(tmp_path):
    """cubic R3: curated vazio não apaga ingestão já registrada."""
    import json

    from etl.build_marts import build_all
    from etl.depara import register_depara_ingest

    manifest = tmp_path / "m.json"
    register_depara_ingest(
        str(manifest), rows=5571, sha256="c" * 64, data="2026-10-11")
    curated = tmp_path / "curated"
    curated.mkdir()
    build_all(curated, tmp_path / "t.duckdb", manifest,
              web_data_dir=tmp_path / "web")
    doc = json.loads(manifest.read_text(encoding="utf-8"))
    tipos = [e.get("tipo") for e in doc["ingestions"]]
    assert "depara_tse_ibge" in tipos


_VOTOS_TSE = (
    "ANO_ELEICAO;DS_CARGO;SG_UF;CD_MUNICIPIO;NM_URNA;QT_VOTOS\n"
    "2022;PRESIDENTE;AC;01007;X;10\n"
)


def test_build_all_com_depara_traduz_nos_marts(tmp_path):
    import duckdb

    from etl.build_marts import build_all

    curated = tmp_path / "curated"
    curated.mkdir()
    (curated / "votos.csv").write_text(_VOTOS_TSE, encoding="utf-8")
    db = tmp_path / "t.duckdb"
    build_all(curated, db, tmp_path / "m.json",
              web_data_dir=tmp_path / "web", depara={"01007": "1200138"})
    con = duckdb.connect(str(db))
    try:
        ibges = con.execute("SELECT DISTINCT municipio_ibge FROM fato_voto").fetchall()
    finally:
        con.close()
    assert ibges == [("1200138",)]


def test_build_all_sem_depara_mantem_fail_closed(tmp_path):
    import duckdb

    import pytest

    from etl.build_marts import build_all

    curated = tmp_path / "curated"
    curated.mkdir()
    (curated / "votos.csv").write_text(_VOTOS_TSE, encoding="utf-8")
    db = tmp_path / "t.duckdb"
    with pytest.warns(UserWarning, match="IBGE"):
        build_all(curated, db, tmp_path / "m.json",
                  web_data_dir=tmp_path / "web")
    con = duckdb.connect(str(db))
    try:
        ibges = con.execute("SELECT DISTINCT municipio_ibge FROM fato_voto").fetchall()
    finally:
        con.close()
    assert ibges == [("",)]


def _seed_db_com_par(db_path):
    import duckdb

    con = duckdb.connect(str(db_path))
    try:
        con.execute(
            "CREATE TABLE fato_voto (ano BIGINT, turno BIGINT, cargo VARCHAR, "
            "uf VARCHAR, municipio_ibge VARCHAR, candidato_id VARCHAR, "
            "votos BIGINT)"
        )
        con.execute(
            "INSERT INTO fato_voto VALUES "
            "(2022, 1, 'PRESIDENTE', 'AC', '1200138', 'X|PA', 10)"
        )
        con.execute(
            "CREATE TABLE dim_candidato (candidato_id VARCHAR, "
            "nome_urna VARCHAR, partido VARCHAR)"
        )
        con.execute("INSERT INTO dim_candidato VALUES ('X|PA', 'X', 'PA')")
        con.execute(
            "CREATE TABLE dim_municipio (ibge7 VARCHAR, esc_sup DOUBLE, "
            "esc_med DOUBLE, esc_fund DOUBLE, renda_media DOUBLE, "
            "pobres_pct DOUBLE, idade_mediana DOUBLE, urbanizacao DOUBLE, "
            "pop BIGINT)"
        )
        con.execute(
            "INSERT INTO dim_municipio VALUES "
            "('1200138', 20, 35, 45, 2500, 15, 33, 90, 10000)"
        )
    finally:
        con.close()


def _fontes_fato(manifest_path):
    import json

    doc = json.loads(manifest_path.read_text(encoding="utf-8"))
    fato = next(e for e in doc["ingestions"] if e.get("tipo") == "fato_municipal")
    return fato["fontes"]


def test_build_fato_fontes_inclui_depara_quando_join(tmp_path):
    from etl.build_fato import build_fato

    db = tmp_path / "t.duckdb"
    _seed_db_com_par(db)
    out = tmp_path / "out"
    build_fato(str(db), str(out), 2022, 1, "presidente",
               depara_url="https://cdn.tse.jus.br/estatistica/sead/odsele/"
                          "municipio_tse_ibge/municipio_tse_ibge.zip")
    fontes = _fontes_fato(tmp_path / "manifest.json")
    assert len(fontes) == 3
    assert fontes[-1].endswith("municipio_tse_ibge.zip")


def test_build_fato_fontes_dupla_sem_depara(tmp_path):
    from etl.build_fato import build_fato

    db = tmp_path / "t.duckdb"
    _seed_db_com_par(db)
    build_fato(str(db), str(tmp_path / "out"), 2022, 1, "presidente")
    assert len(_fontes_fato(tmp_path / "manifest.json")) == 2


def test_cli_aceita_depara_csv(tmp_path):
    from etl.__main__ import _parse_args

    args = _parse_args(["--depara-csv", str(tmp_path / "d.csv")])
    assert args.depara_csv == tmp_path / "d.csv"
    assert _parse_args([]).depara_csv is None


_V1_URL_2024 = (
    "https://cdn.tse.jus.br/estatistica/sead/odsele/"
    "votacao_candidato_munzona/votacao_candidato_munzona_2024.zip"
)
_SKIP_REDE_REAL = (
    "sem rede p/ cdn.tse.jus.br/ftp.ibge.gov.br:443 "
    "(fato REAL com de-para exige os zips 2024-prefeito + de-para + Censo; "
    "rode com rede ou defina SAD_SEM_REDE=1 p/ pular explícito)"
)


def _rede(*hosts):
    from tests.etl.test_fato_real_e2e import _rede_disponivel

    return _rede_disponivel(*hosts)


@pytest.mark.skipif(
    not _rede("cdn.tse.jus.br", "ftp.ibge.gov.br"), reason=_SKIP_REDE_REAL)
def test_fato_real_com_depara_join_verde(tmp_path, monkeypatch):
    """E2E do desbloqueio (EVOLVE-15): voto real + de-para + Censo → fato.

    Mesmo slice barato do teste bloqueado (menor membro-UF do zip
    2024-prefeito, RR, streaming em chunks — o nacional nunca abre):
    com o de-para oficial, `normalize_resultados` traduz TSE→IBGE7 (zero
    ""), `build_all` + `ingerir_censo` + `build_fato` passam e os gates
    ficam verdes. Sem rede: pula explícito (nunca falha).
    """
    import hashlib
    import json
    import zipfile

    import pandas as pd

    from etl import fetch
    from etl.build_fato import build_fato
    from etl.build_marts import build_all
    from etl.censo import ingerir_censo
    from etl.depara import DEPARA_URL
    from etl.normalize import normalize_resultados
    from etl.validate import run_gates

    monkeypatch.setattr(fetch, "RAW_ROOT", tmp_path)
    dest = tmp_path / _V1_URL_2024.rsplit("/", 1)[-1]
    fetch.download_dataset(_V1_URL_2024, dest)
    dest_dp = tmp_path / DEPARA_URL.rsplit("/", 1)[-1]
    sha_dp = fetch.download_dataset(DEPARA_URL, dest_dp)
    assert sha_dp == hashlib.sha256(dest_dp.read_bytes()).hexdigest()

    with zipfile.ZipFile(dest_dp) as zf:
        membros_dp = [i for i in zf.infolist()
                      if not i.is_dir() and i.filename.lower().endswith(".csv")]
        assert len(membros_dp) == 1  # só o CSV oficial no zip
        bruto_dp = zf.read(membros_dp[0].filename)
    from etl.depara import parse_depara_csv

    mapa = parse_depara_csv(bruto_dp)
    assert len(mapa) == 5571  # bijeção oficial completa
    assert mapa.get("03018") == "1400100"  # Boa Vista/RR (capital do slice)

    with zipfile.ZipFile(dest) as zf:
        membros = [i for i in zf.infolist() if not i.is_dir()]
        ufs = sorted(
            (i for i in membros
             if i.filename.startswith("votacao_candidato_munzona_2024_")
             and "BRASIL" not in i.filename and i.filename != "votacao_candidato_munzona_2024_BR.csv"),
            key=lambda i: i.file_size,
        )
        menor = ufs[0]
        assert menor.file_size <= 1_000_000
        with zf.open(menor.filename) as fh:
            with pd.read_csv(
                fh, sep=";", encoding="latin1", dtype="string",
                chunksize=500,
            ) as leitor:
                blocos = []
                for bloco in leitor:
                    pref = bloco[
                        bloco["DS_CARGO"].str.strip().str.upper() == "PREFEITO"
                    ]
                    if not pref.empty:
                        blocos.append(pref)
    prefeitos = pd.concat(blocos, ignore_index=True)
    prefeitos = prefeitos[prefeitos["NR_TURNO"].astype(str) == "1"]
    assert len(prefeitos) > 0

    normalizado = normalize_resultados(prefeitos, depara=mapa)
    assert (normalizado["municipio_ibge"] != "").all()  # o desbloqueio: zero ""
    assert "1400100" in set(normalizado["municipio_ibge"].tolist())

    curated = tmp_path / "curated"
    curated.mkdir()
    normalizado.to_csv(curated / "slice_2024_prefeito.csv", index=False, sep=";")
    db = tmp_path / "fato.duckdb"
    manifest = tmp_path / "manifest.json"
    build_all(curated, db, manifest, web_data_dir=tmp_path / "webdata",
              depara=mapa)

    info = ingerir_censo(str(db), str(manifest))
    assert info["rows"] == 5570

    out = tmp_path / "out"
    fato_path = build_fato(str(db), str(out), 2024, 1, "prefeito",
                           depara_url=DEPARA_URL)
    fato = json.loads((out / "fato_2024_1_prefeito.json").read_text(encoding="utf-8"))
    ibges = {m["ibge"] for m in fato["municipios"]}
    assert "1400100" in ibges  # Boa Vista real no fato
    doc = json.loads(manifest.read_text(encoding="utf-8"))
    entry = next(e for e in doc["ingestions"] if e.get("tipo") == "fato_municipal")
    assert entry["fontes"][-1] == DEPARA_URL
    # Gates sobre o MIRROR servido (contrato de `etl.__main__`: o canônico
    # acumula histórico com `artifacts` relativos ao webdata — só o mirror
    # atesta bytes).
    with pytest.warns(UserWarning):
        assert run_gates(str(db), manifest_path=str(out / "manifest.json")) == []
