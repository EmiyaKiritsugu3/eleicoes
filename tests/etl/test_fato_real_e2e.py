"""EVOLVE-6 Task 1: fato REAL 2024-prefeito — BLOQUEADO com evidência (padrão T3).

Slice mínimo: zip `votacao_candidato_munzona_2024.zip` (~46 MiB, o menor
nacional) + Censo real 326 KB → via entrypoints do `sad-etl`
(`etl.fetch.download_dataset`, `etl.normalize.normalize_resultados`,
`etl.build_marts.build_all`, `etl.censo.ingerir_censo`,
`etl.build_fato.build_fato`, `etl.validate.run_gates`) → fato + gates.

BLOQUEIO (verificado, sem chute): o `CD_MUNICIPIO` real NÃO é IBGE7 — o
`leiame.pdf` dentro do próprio zip define `CD_MUNICIPIO` como "Código TSE
do município" (ex. Boa Vista/RR = `3018`, não `1400100`) e o `SG_UE`
municipal como "código TSE de identificação do município". O
`normalize_resultados` (correto, fail-closed) rejeita 100% dessas linhas
p/ `""` + `UserWarning`, o filtro de capitais de `build_marts` remove
todo prefeito `""` (fora das 27 capitais), e o `build_fato` reprova
fail-closed ("sem dado oficial"). Sem um de-para oficial TSE→IBGE (que
não existe no zip nem no catálogo CKAN), voto real nunca casa com
`dim_municipio` — mapear na mão seria chute, proibido pelo plano.
O teste abaixo TRAVA esse bloqueio como evidência executável (GREEN
afirmando o fail-closed), em vez de um fato verde impossível.

STREAMING: o zip baixa inteiro p/ tmp (46 MiB ok no teste), mas o CSV
nacional (`*_BRASIL.csv`, ~326 MB) NUNCA é aberto — só o menor membro-UF
(RR, ~684 KB), lido em chunks (`chunksize`), filtrado a prefeito ainda
em streaming. Nada nacional é bufferizado em memória.

Sem rede: PULA com motivo documentado (NUNCA falha, NUNCA passa
silenciosa — mesmo mecanismo de `tests/etl/test_censo_real_e2e.py`: flag
`SAD_SEM_REDE=1` força o skip; senão, sonda TCP curta (3 s) uma vez na
coleta do módulo). Só os testes de rede levam skipif — os offline rodam
sempre, inclusive em CI sem rede.

URLs verificadas em 2026-10-10 (CKAN + HEAD, bytes no report
`.superpowers/sdd/2026-10-10-evolve-6/task-1-report.md`):
- zip: `https://cdn.tse.jus.br/estatistica/sead/odsele/
  votacao_candidato_munzona/votacao_candidato_munzona_2024.zip`
  (= `V1_DATASETS` (2024, prefeito); recurso CKAN "Votação nominal por
  município e zona" de `package_show?id=resultados-2024`).
"""

import os
import socket

import pytest

_TSE_CDN_HOST = "cdn.tse.jus.br"
_TSE_CKAN_HOST = "dadosabertos.tse.jus.br"
_CENSO_HOST = "ftp.ibge.gov.br"
_V1_URL_2024 = (
    "https://cdn.tse.jus.br/estatistica/sead/odsele/"
    "votacao_candidato_munzona/votacao_candidato_munzona_2024.zip"
)
# Banda p/ o zip (DT_GERACAO interno = data da extração: o TSE regenera o
# arquivo; travar byte exato seria flaky — ver report da Task 1).
_ZIP_MIN = 40_000_000
_ZIP_MAX = 60_000_000
_SKIP_REASON = (
    "sem rede p/ cdn.tse.jus.br/dadosabertos.tse.jus.br/ftp.ibge.gov.br:443 "
    "(fato REAL exige o zip 2024-prefeito + o zip do Censo; rode com rede ou "
    "defina SAD_SEM_REDE=1 p/ pular explícito — CI offline pula, nunca falha)"
)


def _alcancavel(host: str) -> bool:
    try:
        socket.create_connection((host, 443), timeout=3).close()
    except OSError:
        return False
    return True


def _rede_disponivel() -> bool:
    """True iff os três hosts do slice real são alcançáveis."""
    if os.environ.get("SAD_SEM_REDE") == "1":
        return False
    return all(
        _alcancavel(h) for h in (_TSE_CDN_HOST, _TSE_CKAN_HOST, _CENSO_HOST)
    )


def test_flag_sem_rede_forca_skip(monkeypatch):
    """O skip offline é explícito e testável (nunca passa silencioso)."""
    monkeypatch.setenv("SAD_SEM_REDE", "1")
    assert _rede_disponivel() is False


def test_v1_2024_prefeito_url_constante():
    """A entry V1 (2024, prefeito) é a URL verificada no CKAN (offline)."""
    from etl import fetch
    from etl.sources import V1_DATASETS

    entries = [
        e for e in V1_DATASETS
        if e["ano"] == 2024 and str(e["cargo"]).upper() == "PREFEITO"
    ]
    assert len(entries) == 1
    assert entries[0]["url"] == _V1_URL_2024
    assert "cdn.tse.jus.br" in fetch.ALLOWED_HOSTS


def test_codigo_tse_sintetico_nao_vira_ibge():
    """Unidade offline do bloqueio: código TSE vira "" + warning (fail-closed)."""
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


@pytest.mark.skipif(not _rede_disponivel(), reason=_SKIP_REASON)
def test_tse_2024_prefeito_url_e_catalogo_verificados():
    """HEAD do CDN + CKAN: a URL V1 é a oficial (sem chute de URL)."""
    import requests

    from etl import fetch
    from etl.sources import V1_DATASETS

    url = next(
        e["url"] for e in V1_DATASETS
        if e["ano"] == 2024 and str(e["cargo"]).upper() == "PREFEITO"
    )
    r = requests.head(url, timeout=30, headers={"User-Agent": fetch.USER_AGENT})
    assert r.status_code == 200
    assert "zip" in r.headers.get("Content-Type", "")
    assert r.headers.get("Accept-Ranges") == "bytes"
    tamanho = int(r.headers["Content-Length"])
    assert _ZIP_MIN <= tamanho <= _ZIP_MAX

    ck = requests.get(
        "https://dadosabertos.tse.jus.br/api/3/action/package_show",
        params={"id": "resultados-2024"}, timeout=30,
        headers={"User-Agent": fetch.USER_AGENT},
    )
    assert ck.status_code == 200
    recursos = ck.json()["result"]["resources"]
    alvos = [
        x["url"] for x in recursos
        if x.get("name") == "Votação nominal por município e zona"
    ]
    assert alvos == [url]  # CKAN confirma a MESMA url da V1


@pytest.mark.skipif(not _rede_disponivel(), reason=_SKIP_REASON)
def test_fato_real_bloqueado_codigo_tse_sem_depara(tmp_path, monkeypatch):
    """Evidência executável do bloqueio: TSE real → fail-closed, Censo verde.

    Baixa o zip 2024-prefeito via `download_dataset` (streaming + sha),
    lê SÓ o menor membro-UF em chunks (o `*_BRASIL.csv` nacional nunca é
    aberto), normaliza via `normalize_resultados`, roda `build_all` +
    `ingerir_censo` (Censo real) e prova: 100% `municipio_ibge` vazio →
    prefeito some no filtro de capitais → `build_fato` levanta "sem dado
    oficial", com `run_gates` verde na infra.
    """
    import zipfile

    import pandas as pd

    from etl import fetch
    from etl.build_fato import build_fato
    from etl.build_marts import build_all
    from etl.censo import ingerir_censo
    from etl.normalize import normalize_resultados
    from etl.validate import run_gates

    monkeypatch.setattr(fetch, "RAW_ROOT", tmp_path)
    dest = tmp_path / _V1_URL_2024.rsplit("/", 1)[-1]
    sha = fetch.download_dataset(_V1_URL_2024, dest)
    zip_bytes = dest.stat().st_size
    assert _ZIP_MIN <= zip_bytes <= _ZIP_MAX
    import hashlib

    assert sha == hashlib.sha256(dest.read_bytes()).hexdigest()

    with zipfile.ZipFile(dest) as zf:
        membros = [i for i in zf.infolist() if not i.is_dir()]
        ufs = sorted(
            (i for i in membros
             if i.filename.startswith("votacao_candidato_munzona_2024_")
             and i.filename not in (
                 "votacao_candidato_munzona_2024_BRASIL.csv",
                 "votacao_candidato_munzona_2024_BR.csv")),
            key=lambda i: i.file_size,
        )
        nacional = [i.filename for i in membros if "BRASIL" in i.filename]
        assert nacional  # o nacional EXISTE mas nunca será aberto
        menor = ufs[0]
        assert menor.file_size <= 1_000_000  # slice barato (RR ~684 KB)
        with zf.open(menor.filename) as fh:
            with pd.read_csv(
                fh, sep=";", encoding="latin1", dtype="string",
                chunksize=500,
            ) as leitor:
                blocos, n_linhas, n_blocos = [], 0, 0
                for bloco in leitor:  # streaming: só o chunk vive em memória
                    n_blocos += 1
                    n_linhas += len(bloco)
                    pref = bloco[
                        bloco["DS_CARGO"].str.strip().str.upper() == "PREFEITO"
                    ]
                    if not pref.empty:
                        blocos.append(pref)
                assert n_blocos > 1  # prova de chunking real, não buffer único
        header = pd.read_csv(
            zf.open(menor.filename), sep=";", encoding="latin1",
            dtype="string", nrows=0,
        ).columns.tolist()
        # Shape travado: TSE puro, sem coluna IBGE a mapear.
        assert "CD_MUNICIPIO" in header and "SG_UE" in header
        assert not (set(header) & {
            "CD_MUNICIPIO_IBGE", "COD_MUNICIPIO_IBGE", "IBGE7", "CD_GEOCODI",
        })

    prefeitos = pd.concat(blocos, ignore_index=True)
    prefeitos = prefeitos[prefeitos["NR_TURNO"].astype(str) == "1"]
    assert len(prefeitos) > 0  # há voto real de prefeito no slice
    # Códigos TSE (4–5 dígitos), nunca IBGE7:
    assert {len(str(c)) for c in prefeitos["CD_MUNICIPIO"].tolist()} <= {4, 5}

    with pytest.warns(UserWarning, match="IBGE"):
        normalizado = normalize_resultados(prefeitos)
    assert (normalizado["municipio_ibge"] == "").all()  # o bloqueio: 100%

    curated = tmp_path / "curated"
    curated.mkdir()
    normalizado.to_csv(curated / "slice_2024_prefeito.csv", index=False, sep=";")
    db = tmp_path / "fato.duckdb"
    manifest = tmp_path / "manifest.json"
    with pytest.warns(UserWarning):
        build_all(curated, db, manifest, web_data_dir=tmp_path / "webdata")

    info = ingerir_censo(str(db), str(manifest))  # metade Censo: verde
    assert info["rows"] == 5570

    with pytest.raises(ValueError, match="sem dado oficial"):
        build_fato(str(db), str(tmp_path / "out"), 2024, 1, "prefeito")
    with pytest.warns(UserWarning):
        assert run_gates(str(db), manifest_path=str(manifest)) == []
