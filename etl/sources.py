"""Tabela V1 de datasets TSE (votação nominal por município e zona).

Fonte: catálogo https://dadosabertos.tse.jus.br/dataset/resultados-{ano}
(verificado via API CKAN em 2026-10-09). Os arquivos são servidos pelo CDN
oficial do TSE; `dataset` guarda a página do catálogo para rastreabilidade
e `url` o download direto. `sha256` é `None` até a primeira ingestão — o
hash real é calculado por `etl.fetch.download_dataset` e registrado via
`etl.manifest.write_manifest`.

Escopo V1: presidentes + governadores (2014/2018/2022) e prefeitos das
capitais (2016/2020/2024). Os zips são nacionais; o filtro de capitais
para prefeito acontece downstream (Task 3+).
"""

_CDN = "https://cdn.tse.jus.br/estatistica/sead/odsele/votacao_candidato_munzona"
_CATALOG = "https://dadosabertos.tse.jus.br/dataset/resultados-{ano}"
_TIPO = "votacao_candidato_munzona"


def _entry(ano: int, cargo: str) -> dict:
    return {
        "ano": ano,
        "cargo": cargo,
        "tipo": _TIPO,
        "url": f"{_CDN}/votacao_candidato_munzona_{ano}.zip",
        "dataset": _CATALOG.format(ano=ano),
        "sha256": None,
    }


V1_DATASETS: list[dict] = [
    *(_entry(ano, "presidente") for ano in (2014, 2018, 2022)),
    *(_entry(ano, "governador") for ano in (2014, 2018, 2022)),
    *(_entry(ano, "prefeito") for ano in (2016, 2020, 2024)),
]


"""Tabela do Censo Demográfico IBGE 2022 por município.

Fonte (catálogo, rastreabilidade):
https://www.ibge.gov.br/estatisticas/sociais/populacao/22827-censo-demografico-2022.html
Os arquivos são servidos pelo FTP oficial do IBGE; `dataset` guarda a
página do catálogo. `sha256` é `None` até a primeira ingestão — o hash
real é calculado por `etl.fetch.download_dataset` e registrado via
`etl.censo.register_censo_ingest`.

# Confirmado em 2026-10-10 (EVOLVE-4 Task 4): índice do FTP lista
# Agregados_por_Setores_Censitarios/Agregados_por_Municipio_csv/ com
# Agregados_por_municipios_basico_BR_20260520.zip (HTTP 200, 326327 bytes,
# 5570 municípios; CSV sep=";" encoding latin1, CD_MUN + v0001=pop).
# 5101837 (Boa Esperança do Norte/MT, emancipado pós-Censo) existe na API
# de localidades mas não no CSV do Censo: join sem par vira demo None
# ("sem dado oficial"), dentro da tolerância de órfãos de build_fato.
# `normalize_censo` consome sem adaptação (V0001→pop; soma pop =
# TOTAL_CENSO_2022). Escolaridade vive em
# Agregados_por_municipios_alfabetizacao_BR.zip (V-codes sem mapeamento
# p/ esc_* — esc_* seguem nulos fail-closed, "sem dado oficial").
"""

_CENSO_CATALOG = (
    "https://www.ibge.gov.br/estatisticas/sociais/populacao/"
    "22827-censo-demografico-2022.html"
)

# População residente total do Censo 2022 (soma de v0001 do CSV confirmado,
# verificada contra o arquivo real em 2026-10-10 — nunca editar sem reverificar).
TOTAL_CENSO_2022 = 203080756

CENSO_DATASETS: list[dict] = [
    {
        "ano": 2022,
        "nome": "censo_demografico_2022_municipios",
        "url": (
            "https://ftp.ibge.gov.br/Censos/Censo_Demografico_2022/"
            "Agregados_por_Setores_Censitarios/Agregados_por_Municipio_csv/"
            "Agregados_por_municipios_basico_BR_20260520.zip"
        ),  # confirmado no FTP em 2026-10-10 (ver nota acima)
        "dataset": _CENSO_CATALOG,
        "sha256": None,
    },
]
