# Transparência de Gastos Eleitorais — Design Spec

Data: 2026-10-14
Status: aprovado pelo usuário (delegado: revisar e decidir as melhores opções)
Decisão de escopo: transparência geral · União + estados + 27 capitais · série contínua 2014–2024 · abordagem A (SICONFI + TSE + CGU opcional)

## 1. Entendimento

- **O quê:** histórico auditável de gastos em anos eleitorais: (a) execução orçamentária dos governos + (b) financiamento de campanha, lado a lado com votos.
- **Para quem:** eleitor/pesquisador/jornalista que quer ver números oficiais sem tese imposta.
- **Sucesso:** todo número com fonte + data + SHA256; ausente exibe "sem dado oficial", nunca zero; série 2014–2024 permite comparar ano eleitoral vs baseline ímpar.
- **Restrições herdadas:** custo zero, só dado oficial verificável, offline-first, manifest + fail-closed (`etl/manifest.py`, `etl/validate.py`, `web/lib/data.ts:getSealState`).

## 2. Fontes (Seção 1 — aprovada)

| Camada | Fonte oficial | Recorte | Papel |
|---|---|---|---|
| Base governo | SICONFI/STN API Data Lake — `https://apidatalake.tesouro.gov.br/docs/siconfi` (DCA anual; RREO como anexo) | 2014–2024, União + 26 estados + DF + 27 capitais | Verdade comparável: despesa empenhada/liquidada/paga + receita, mesma metodologia contábil |
| Campanha | TSE `prestacao-de-contas-eleitorais-{ano}` — `https://dadosabertos.tse.jus.br/dataset/prestacao-de-contas-eleitorais-2024` (e 2014–2022 equivalentes) | mesmos anos/cargos do V1 | receita/despesa por candidato, doador, FEFC/Fundo Partidário |
| Detalhe federal (opcional) | CGU Portal da Transparência — `https://api.portaldatransparencia.gov.br` / `https://portaldatransparencia.gov.br/api-de-dados` | só União | órgão/função/favorecido; exige chave gratuita gov.br |

Fora: TCEs/portais municipais (33 layouts heterogêneos, quebram comparabilidade e custo zero). MSC/SICONFI detalhado fica fase 2 (volume).

## 3. Modelo de dados (Seção 2 — aprovada com delegação)

- `dim_ente(ente_id, esfera, uf, cod_ibge, nome)` — União (id `UNIAO`), estados (UF), capitais (IBGE7 de `etl/capitais_ibge.json`); sem match → `""` fail-closed.
- `fato_gov(ano, ente_id, receita_total, despesa_empenhada, despesa_liquidada, despesa_paga, tipo_relatorio, fonte_hash)` — 1 linha por ente/ano; `tipo_relatorio` = `DCA` (padrão) ou `RREO` (fallback quando DCA atrasar).
- `fato_fin` existente (`etl/build_marts.py:217-219`, hoje vazio) preenchido via TSE: `(ano, cargo, candidato_id, receita_total, despesa_total, fefc, fundo_partidario, fonte_hash)`.
- `fato_transp_federal(ano, orgao, funcao, valor, fonte_hash)` — tabela separada; nunca mistura com a base SICONFI.
- Moeda: `DOUBLE` (compatível com `fato_fin` atual), centavos preservados; valores nominais V1 + nota metodológica "sem deflação IPCA" (deflator vira fase 2).
- Proveniência: mesmo contrato `manifest.json` (`source_url`, `sha256` 64-hex, `sha_origin`, `data`, `etl_version`, `rows`).

Decisões delegadas aplicadas: DCA (não RREO) como verdade anual; RREO só fallback documentado; CGU em tabela isolada; sem IPCA no V1.

## 4. Fluxo ETL + auditoria (decidido)

1. `fetch`: estender `ALLOWED_HOSTS` (`etl/fetch.py:24`) com `apidatalake.tesouro.gov.br`, `tesourotransparente.gov.br`, `api.portaldatransparencia.gov.br`; mesmo retry/streaming/SHA256/rename atômico. Raw imutável: `data/raw/siconfi-DCA-{ano}-{ente}.json`, `data/raw/tse-prestacao-{ano}.zip`, `data/raw/cgu-despesas-{ano}.json`.
2. `normalize_*`: `normalize_siconfi` (DCA→`fato_gov`), `normalize_prestacao` (TSE→`fato_fin`), `normalize_cgu` (opcional). Encoding `;`/latin1/utf-8 como `normalize_resultados`; código IBGE via depara existente.
3. `build_marts.build_all` estendido: cria `dim_ente`, `fato_gov`, preenche `fato_fin`, cria `fato_transp_federal`; JSONs servidos novos: `gov_por_ente.json`, `gov_serie.json`, `fin_por_candidato.json`; espelho `manifest.json` + `register_served_artifacts` inalterados.
4. Orquestrador (`etl/__main__.py`): flags `--siconfi-csv/--siconfi-ano`, `--prestacao-dir`, `--with-transparencia` (lê `TRANSPARENCIA_API_KEY` do env, nunca do repo). Sem chave CGU → skip honesto com `UserWarning`, build base segue.
5. Gates (`etl/validate.py:run_gates`): valor monetário negativo/não-numérico reprova; ente/ano sem DCA → "sem dado oficial" (nunca 0); orfãos `fato_fin` sem `dim_candidato` > 0,1% reprovam (mesmo `ORPHAN_THRESHOLD`); `verify_manifest` + bytes-aware de fatos reuse total.
6. Stage-then-promote + `.prev` reuse integral de `build_marts.py:922-1035`; falha deleta só staging.

## 5. Telas + testes + limites (decidido)

- Front: nova rota `/transparencia` (não poluir `/explorar`): seletores ente/ano, série 2014–2024 com marcador de ano eleitoral, tabela acessível por gráfico, selo `isOfficialDisplay/getSealState` reuse, nota IPCA + lag DCA. Filtros sem cobertura → nota global (padrão `NOTA_CANDIDATO_GLOBAL` em `web/lib/data.ts:22-25`).
- Testes: `pytest` fixtures sintéticas (`tests/etl/test_siconfi.py`, `test_prestacao.py`): soma, negativo reprova, ausente→sem-dado, orfãos, manifest inválido bloqueia; `vitest` série/flag eleitoral + selo; estender `scripts/seed_fixture_data.py`.
- Limites conhecidos: DCA tem lag 6–12 meses (ano corrente = sem dado); CGU só federal + paginação/rate-limit (cache obrigatório); sem deflação V1; sem TCEs V1.

## 6. Próximo passo

Aguardar revisão deste spec e então invocar `writing-plans` (único próximo skill permitido) para o plano de implementação.
