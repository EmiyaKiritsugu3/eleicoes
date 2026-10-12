# Spec: Pipeline real end-to-end parametrizado (ingestão oficial versionada)

Data: 2026-10-12. Status: design aprovado em chat; aguarda review da spec.

## Entendimento (brief)

- **O que o usuário disse:** continuar o loop; frente escolhida = pipeline real end-to-end; triples = ambos parametrizados (2024-prefeito capitais + 2022-presidente); modo de publicação = recomendação do executor.
- **Assunções confirmadas:** (1) reproduzir o real-run já provado em `/tmp/opencode/real-run` (2024-prefeito, 22.886.213 votos, 25 linhas fato, 5570 Censo, 5571 de-para), não inventar pipeline novo; (2) custo zero e "free-tier nunca no caminho crítico v1" seguem valendo; (3) abordagem A (script local + docs), sem fetch no build Vercel.
- **Sucesso:** `scripts/ingestao_real.py --ano --cargo --turno` roda do zero ao `ok: pipeline concluído, gates verdes` nos dois triples, com manifest real (`fixture!=true`, 3 fontes, `artifacts` com sha) e servidos ~100KB dentro dos budgets; CI normal intacto com fixtures.

## §1 — Arquitetura (só orquestra, sem lógica nova de ETL)

- Novo `scripts/ingestao_real.py` (argparse, stdlib + imports locais) que só chama entrypoints existentes, na mesma ordem de `etl/__main__.py`: `etl.fetch.download_dataset` (3 URLs oficiais) → `etl.depara.parse_depara_csv` → `etl.build_marts.build_all(..., depara=...)` → `_passo_censo` equivalente (com `--censo-total-esperado`) → `etl.build_fato.build_fato` → `etl.validate.run_gates` sobre o mirror servido.
- Fontes pinadas (de `etl/sources.py` + `etl/depara.py`): `votacao_candidato_munzona_{ano}.zip` (CDN TSE), `Agregados_por_municipios_basico_BR_20260520.zip` (FTP IBGE), `municipio_tse_ibge.zip` (CDN TSE). `TOTAL_CENSO_2022 = 203080756` como default de `--censo-total-esperado` p/ 2022; triple 2024 usa o mesmo Censo 2022 (pop por município) + gate de soma.
- Sem mudança em `etl/`, `scripts/seed_fixture_data.py`, `.github/workflows/ci.yml`, guards de budget (`<15MB` dir, `<3MB` por topojson) ou `web/.gitignore`. Fetch no build Vercel explicitamente fora (ZIP 2024 = 46MB medido em `/tmp/opencode/real-run/raw/`; servidos = 36KB webdata + 76KB fato).

## §2 — Componentes (1 script + 1 teste + docs)

- **Script:** `scripts/ingestao_real.py` com `--ano (2022|2024) --cargo (presidente|prefeito) --turno (1|2) --raw-dir --curated-dir --db --web-data-dir --force-real` (recusa sobrescrever `web-data-dir` com manifest não-fixture sem a flag; nunca chama `seed --force`). Combos válidos = interseção com `V1_DATASETS` (`etl/sources.py`: presidente 2014/2018/2022, prefeito 2016/2020/2024); fora disso o script aborta com exit 2 antes de qualquer download. Imprime resumo auditável: votos totais, nº municípios fato, capitais esperadas, SHAs (12 chars) das 3 fontes, caminho do fato.
- **Teste:** `tests/etl/test_ingestao_real.py` offline: `--help` ok; recusa overwrite de manifest real sem flag; `build_all`/`build_fato` não tocados (mock ouavais de path); asserts de contrato do manifest real (3 `ingestions` com `fontes` triplas, `artifacts` com sha por arquivo servido). Nenhum download de 46MB no teste.
- **Docs:** `web/app/metodologia/page.tsx` seção deploy real (comando exato por triple + SHAs esperados + como publicar JSONs junto ao deploy) + entrada no loop `docs/superpowers/loops/motor-verdade-loop.md`.

## §3 — Data flow (diretórios gitignored, publish manual)

- `data/raw/` (zips) → `data/curated/` (parquet particionado `ano=/cargo=/uf=`) → `data/sad.duckdb` (+ `dim_municipio`) → `web/public/data/*.json` (resumo, por_uf, por_candidato, fato `{ano}_{turno}_{cargo}.json`, manifest.json mirror + `censo_municipios.json` quando com total auditado).
- Deploy: copiar os servidos gerados localmente p/ o host (ou remover a linha do gitignore com mecanismo próprio); sem esse passo o site exibe fixtures com selo sintético por design (fail-closed). CI segue `seed --force` (checkout sem dados) e não roda o script real.

## §4 — Erros (fail-closed herdado, sem chute)

- Gates reprovados → exit 1, versão anterior mantida, nada publicado (contrato `etl/__main__.py`: 0 ok, 1 gates, 2 erro). Exceção em qualquer passo → exit 2 antes de publicar.
- Sem `--depara-csv` os códigos TSE viram `""` (comportamento atual); sem `--censo-total-esperado` o artefato Censo cai p/ emissão local irmã do manifest, nunca servido sem prova (contrato `_passo_censo`). Aracaju sem prefeito-turno-1 na fonte nacional segue fora do fato (gap documentado no loop, não erro).
- Proteção anti-perda: script aborta se `web-data-dir/manifest.json` contém ingestão não-fixture sem `--force-real`; `seed` segue recusando o inverso (não sobrescreve real sem `--force`).

## §5 — Verificação

- `pytest tests/etl/test_ingestao_real.py -q` verde + suíte completa `pytest tests/ -q` (baseline 222 passed) + `vitest`/`tsc`/`build` intactos.
- Runs manuais documentados (fora do CI): `2024 1 prefeito` (esperado: 22.886.213 votos, 25/25 capitais menos BSB-sem-prefeito, 25 linhas fato) e `2022 1 presidente` (triple V1 nacional); ambos com `verify_manifest` + `_gate_fatos` verdes e SHAs registrados.
- Budgets: `du -sh web/public/data` < 15MB; cada `*.topojson` < 3MB (malha real segue via `scripts/malha.py`, fora deste ciclo).

## Fora de escopo

- Workflow `workflow_dispatch` com artifacts (candidato a EVOLVE seguinte, só se o script manual provar estável). Malha municipal real (SHP→GeoJSON segue bloqueado). Nível de instrução (alfabetização≠escolaridade, bloqueado). `rem-vs-px` nos tokens e E5 empty-build artifact coverage (vão em micro-ciclo separado).
