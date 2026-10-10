"""EVOLVE-6 Task 5: linkage escolaridade — BLOQUEADO com evidência (padrão T3).

Hipótese: o zip `Agregados_por_municipios_alfabetizacao_BR.zip` (FTP do IBGE,
mesmo dir do básico) alimentaria `esc_sup`/`esc_med`/`esc_fund` via V-codes.

BLOQUEIO (verificado, sem chute — nunca mapear na mão):
- O zip tem 1 único membro CSV com 364 colunas = `CD_MUN` + `NM_MUN` +
  `V00644`…`V01005` (362 V-codes; HEAD 2026-10-10: HTTP 200, 3.418.671 bytes).
  NENHUMA coluna casa com os aliases de `esc_*` (`P_SUPERIOR`, `TX_ESC_SUP`,
  …) — `normalize_censo` devolve `esc_*` nulos fail-closed (correto).
- O dicionário OFICIAL no mesmo dir do FTP
  (`dicionario_de_dados_agregados_por_setores_censitarios_20260520.xlsx`,
  HEAD 200, 118.369 bytes) documenta os 362 V-codes TODOS no Tema
  "Alfabetização": taxa/condição de alfabetização (sabe ler e escrever) por
  faixa etária × sexo × cor/raça (ex. `V00900` = "15 anos ou mais, Morador
  sabe ler e escrever"). O dicionário inteiro (3.407 linhas, todas as abas)
  tem ZERO variáveis de nível de instrução (`superior`, `médio`,
  `fundamental`, `ensino`, `instrução`, `frequenta`, `escola`, `creche`,
  `graduação` — zero hits em 2026-10-10). Alfabetização ≠ escolaridade:
  saber ler e escrever nada diz sobre % com superior/médio/fundamental
  completo — derivar `esc_*` disso seria chute, proibido pelo plano.
- Nenhum outro agregado por município da família (básico, domicílios 1–3,
  cor/raça, demografia, óbitos, parentesco, indígenas, quilombolas — mesma
  lista nos dirs csv e xlsx) tem tema de escolaridade; os temas do
  dicionário confirmam a ausência.
- Consequência: `esc_*` seguem nulos fail-closed; o `SEM_DADO` de
  escolaridade no `PainelRegiao` é correto (não espúrio) — pop/votos reais
  continuam fluindo. `etl/censo.py` e `etl/build_fato.py` NÃO mudam (nada a
  ligar sem adivinhar); só a nota em `etl/sources.py` ganha a evidência.

Os testes abaixo TRAVAM o bloqueio como evidência executável (GREEN
afirmando o fail-closed). Sem rede: PULA com motivo documentado (mesmo
mecanismo de `test_censo_real_e2e.py`/`test_fato_real_e2e.py`: flag
`SAD_SEM_REDE=1` força o skip; senão, sonda TCP curta uma vez na coleta).
Só os testes de rede levam skipif — os offline rodam sempre.

URLs verificadas em 2026-10-10 (HEAD, bytes no report
`.superpowers/sdd/2026-10-10-evolve-6/task-5-report.md`):
- zip: `https://ftp.ibge.gov.br/Censos/Censo_Demografico_2022/
  Agregados_por_Setores_Censitarios/Agregados_por_Municipio_csv/
  Agregados_por_municipios_alfabetizacao_BR.zip`
- dicionário: `https://ftp.ibge.gov.br/Censos/Censo_Demografico_2022/
  Agregados_por_Setores_Censitarios/
  dicionario_de_dados_agregados_por_setores_censitarios_20260520.xlsx`
"""

import os
import socket
import zipfile

import pytest

_ALFA_URL = (
    "https://ftp.ibge.gov.br/Censos/Censo_Demografico_2022/"
    "Agregados_por_Setores_Censitarios/Agregados_por_Municipio_csv/"
    "Agregados_por_municipios_alfabetizacao_BR.zip"
)
_DICIONARIO_URL = (
    "https://ftp.ibge.gov.br/Censos/Censo_Demografico_2022/"
    "Agregados_por_Setores_Censitarios/"
    "dicionario_de_dados_agregados_por_setores_censitarios_20260520.xlsx"
)
_CENSO_HOST = "ftp.ibge.gov.br"
# Banda p/ o zip (CSV interno fixo de 2024-11; travar byte exato seria
# flaky se o IBGE republicar — ver report da Task 5).
_ALFA_MIN = 3_000_000
_ALFA_MAX = 4_000_000
_DIC_MIN = 100_000
_DIC_MAX = 200_000
# V-codes do CSV de alfabetização: faixa contígua documentada no dicionário.
_VCODE_PRIMEIRO = 644
_VCODE_ULTIMO = 1005
_SKIP_REASON = (
    "sem rede p/ ftp.ibge.gov.br:443 (linkage escolaridade exige o zip de "
    "alfabetização + o dicionário oficial; rode com rede ou defina "
    "SAD_SEM_REDE=1 p/ pular explícito — CI offline pula, nunca falha)"
)


def _rede_disponivel() -> bool:
    """True iff o FTP do IBGE é alcançável (sonda TCP curta, sem HTTP)."""
    if os.environ.get("SAD_SEM_REDE") == "1":
        return False
    try:
        socket.create_connection((_CENSO_HOST, 443), timeout=3).close()
    except OSError:
        return False
    return True


def _vcodes_alfabetizacao() -> set[str]:
    return {
        f"V{n:05d}" for n in range(_VCODE_PRIMEIRO, _VCODE_ULTIMO + 1)
    }


def test_flag_sem_rede_forca_skip(monkeypatch):
    """O skip offline é explícito e testável (nunca passa silencioso)."""
    monkeypatch.setenv("SAD_SEM_REDE", "1")
    assert _rede_disponivel() is False


def test_esc_aliases_nao_colidem_com_vcodes():
    """Nenhum alias de esc_* casa com V00644…V01005 (unidade offline)."""
    from etl.censo import _COLUMN_ALIASES

    vcodes = _vcodes_alfabetizacao()
    assert len(vcodes) == 362
    for campo in ("esc_sup", "esc_med", "esc_fund"):
        colisao = {a.upper() for a in _COLUMN_ALIASES[campo]} & vcodes
        assert colisao == set(), (campo, colisao)


def test_frame_alfabetizacao_nao_alimenta_esc():
    """Frame shape-alfabetização → esc_* nulos (fail-closed, offline).

    Valores reais de Alta Floresta D'Oeste/RO (`V00644`=15–19 anos,
    `V00900`=15+ alfabetizados, `V01005`=domicílios/convivente/fem/15+):
    `ibge7` casa, mas `esc_*` ficam nulos — e `pop` também (o arquivo de
    alfabetização não tem `V0001`; nem pop ele alimentaria).
    """
    import pandas as pd

    from etl.censo import normalize_censo

    df = pd.DataFrame([{
        "CD_MUN": "1100015",
        "NM_MUN": "Alta Floresta D'Oeste",
        "V00644": "1644",
        "V00900": "15343",
        "V01005": "6",
    }])
    out = normalize_censo(df)
    assert out["ibge7"].tolist() == ["1100015"]
    for campo in (
        "esc_sup", "esc_med", "esc_fund", "renda_media", "pobres_pct",
        "idade_mediana", "urbanizacao", "pop",
    ):
        assert out[campo].isna().all(), campo


@pytest.mark.skipif(not _rede_disponivel(), reason=_SKIP_REASON)
def test_alfabetizacao_zip_shape_travado(tmp_path):
    """Evidência executável: o zip real não tem coluna p/ esc_*.

    Baixa o zip barato (3,4 MiB) com streaming + `requests` (host
    allowlisted em `etl.fetch.ALLOWED_HOSTS`), abre SEM extrair p/ disco
    (só o header do membro CSV é lido): 1 único membro `.csv` cujo header
    é exatamente `CD_MUN, NM_MUN, V00644…V01005` — zero interseção com os
    aliases de `esc_*`/`pop` além de `CD_MUN`.
    """
    import pandas as pd
    import requests

    from etl import fetch
    from etl.censo import _COLUMN_ALIASES

    assert "ftp.ibge.gov.br" in fetch.ALLOWED_HOSTS
    dest = tmp_path / "alfabetizacao_BR.zip"
    with requests.get(
        _ALFA_URL, timeout=60, headers={"User-Agent": fetch.USER_AGENT},
        stream=True,
    ) as r:
        assert r.status_code == 200
        assert "zip" in r.headers.get("Content-Type", "")
        with open(dest, "wb") as fh:
            for bloco in r.iter_content(chunk_size=1 << 20):
                fh.write(bloco)
    zip_bytes = dest.stat().st_size
    assert _ALFA_MIN <= zip_bytes <= _ALFA_MAX

    with zipfile.ZipFile(dest) as zf:
        membros = [
            i for i in zf.infolist()
            if not i.is_dir() and i.filename.lower().endswith(".csv")
        ]
        assert len(membros) == 1  # sem layout/dicionário dentro do zip
        with zf.open(membros[0].filename) as fh:
            header = pd.read_csv(
                fh, sep=";", encoding="latin1", dtype="string",
                nrows=0,
            ).columns.tolist()
    assert header[:2] == ["CD_MUN", "NM_MUN"]
    assert header[2:] == sorted(_vcodes_alfabetizacao())
    aliases = {
        a.upper()
        for campo in ("esc_sup", "esc_med", "esc_fund", "pop")
        for a in _COLUMN_ALIASES[campo]
    }
    # CD_MUN é só o join (ibge7), não dado de escolaridade: nenhum alias
    # de esc_*/pop aparece no header (sanity: CD_MUN não é alias de esc_*).
    assert "CD_MUN" not in {
        a.upper()
        for campo in ("esc_sup", "esc_med", "esc_fund")
        for a in _COLUMN_ALIASES[campo]
    }
    assert set(header) & aliases == set()


@pytest.mark.skipif(not _rede_disponivel(), reason=_SKIP_REASON)
def test_dicionario_oficial_acessivel():
    """O dicionário que fecha o bloqueio existe no FTP (HEAD 200).

    Conteúdo verificado em 2026-10-10 (ver docstring do módulo): os 362
    V-codes, todos no Tema "Alfabetização" (condição de alfabetização, não
    nível de instrução), zero variáveis de escolaridade nas 3.407 linhas.
    Travar bytes do .xlsx seria flaky (o IBGE republica); trava-se
    existência + faixa de tamanho + Content-Type.
    """
    import requests

    from etl import fetch

    r = requests.head(
        _DICIONARIO_URL, timeout=30, headers={"User-Agent": fetch.USER_AGENT}
    )
    assert r.status_code == 200
    tamanho = int(r.headers["Content-Length"])
    assert _DIC_MIN <= tamanho <= _DIC_MAX
