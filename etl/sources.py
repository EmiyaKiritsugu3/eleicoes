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

Fonte: https://www.ibge.gov.br/estatisticas/sociais/populacao/22827-censo-demografico-2022.html
(os arquivos são servidos pelo FTP oficial do IBGE; `dataset` guarda a
página do catálogo para rastreabilidade e `url` o download direto.
`sha256` é `None` até a primeira ingestão — o hash real é calculado por
`etl.fetch.download_dataset` e registrado via `etl.censo.register_censo_ingest`.
"""

_CENSO_FTP = "https://ftp.ibge.gov.br/Censos/Censo_Demografico_2022"
_CENSO_CATALOG = (
    "https://www.ibge.gov.br/estatisticas/sociais/populacao/"
    "22827-censo-demografico-2022.html"
)

CENSO_DATASETS: list[dict] = [
    {
        "ano": 2022,
        "nome": "censo_demografico_2022_municipios",
        "url": f"{_CENSO_FTP}/agregados_por_municipios.zip",
        "dataset": _CENSO_CATALOG,
        "sha256": None,
    },
]
