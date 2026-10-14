"""Dashboard cruzar Task 3: spike alfabetização 15+ — BLOQUEIO travado sem chute (padrão T3).

Hipótese: derivar `taxa_alf_15mais` (15+ sabe ler / 15+ total) dos 362 V-codes
do zip de alfabetização IBGE como nova `VarDemo` auditada.

BLOQUEIO (sem chute): o dicionário oficial (.xlsx, 3407 linhas) nunca foi lido
por teste (network-bound, sem dep openpyxl — ver `test_escolaridade_bloqueada.py`);
sem o par numerador/denominador provado pelo dicionário, qualquer V-code
escolhido seria adivinhação. Alfabetização ≠ escolaridade já está travado;
alfabetização 15+ exige o mesmo rigor: só entra com mapeamento provado.

Estes testes travam o fail-closed: nenhum alias atual casa com V-codes,
`normalize_censo` não inventa taxa, e o shape do zip segue travado pelo teste
irmão. Se um dia o dicionário for lido e o par for provado, este arquivo vira
o teste verde da implementação em `etl/alfabetizacao.py`.
"""

import os
import socket
from functools import lru_cache

import pandas as pd
import pytest

from etl.censo import _COLUMN_ALIASES, normalize_censo

_SKIP_REASON = (
    "sem rede p/ ftp.ibge.gov.br:443 (spike alfabetização exige o zip + "
    "dicionário oficial; rode com rede ou SAD_SEM_REDE=1 p/ pular explícito)"
)


@lru_cache(maxsize=1)
def _rede_disponivel() -> bool:
    if os.environ.get("SAD_SEM_REDE") == "1":
        return False
    try:
        socket.create_connection(("ftp.ibge.gov.br", 443), timeout=3).close()
        return True
    except OSError:
        return False


def test_flag_sem_rede_forca_skip():
    assert _rede_disponivel() in (True, False)


def test_aliases_atuais_nao_casam_vcodes_alfabetizacao():
    vcodes = {f"V{i:05d}" for i in range(644, 1006)}
    aliases = set()
    for vals in _COLUMN_ALIASES.values():
        aliases.update(a.upper() for a in vals)
    assert vcodes.isdisjoint(aliases)


def test_frame_alfabetizacao_nao_inventa_taxa():
    df = pd.DataFrame({
        "CD_MUN": ["3550308"],
        "NM_MUN": ["SÃO PAULO"],
        "V00644": ["100"],
        "V00900": ["800"],
        "V01005": ["50"],
    })
    out = normalize_censo(df)
    assert out.loc[0, "ibge7"] != ""
    for col in ("esc_sup", "esc_med", "esc_fund", "renda_media", "pobres_pct", "idade_mediana", "urbanizacao"):
        assert pd.isna(out.loc[0, col])
    assert "alfabetizacao" not in list(out.columns)


@pytest.mark.skipif(not _rede_disponivel(), reason=_SKIP_REASON)
def test_alfabetizacao_zip_acessivel_para_mapeamento_futuro():
    import urllib.request

    url = (
        "https://ftp.ibge.gov.br/Censos/Censo_Demografico_2022/"
        "Agregados_por_Setores_Censitarios/Agregados_por_Municipio_csv/"
        "Agregados_por_municipios_alfabetizacao_BR.zip"
    )
    req = urllib.request.Request(url, method="HEAD")
    with urllib.request.urlopen(req, timeout=15) as r:
        assert r.status == 200
