# Auditoria SAD Eleições v1 — Relatório (2026-10-09)

Origem: 3 subagentes paralelos (ETL, front, CI/contratos) + verificação própria por leitura direta + Context7 (`/duckdb/duckdb-python`, flag `read_only` confirmada). Status: **50/100 — FAIL**. Itens marcados CONFIRMADO foram lidos no código.

## CRÍTICO

- **E1** `etl/normalize.py:57-61` — `_fix_text` nunca repara mojibake cujo correto contém Ã/Â (SÃO/JOÃO/AÇÃO). CONFIRMADO. Fix aplicado: reparar quando o reparo NÃO AUMENTA marcadores (`<=`; `<` estrito é insuficiente — SÃO tem 1 vs 1).
- **E2** `etl/normalize.py:88-96` — votos não-numérico/coluna ausente vira `0`; turno inválido vira `1`. CONFIRMADO. Fix: ausente→`ValueError`; não-numérico→`Int64` anulável.
- **E3** `etl/validate.py:79-87` — gate `TRY_CAST…IS NULL` vazio p/ saída do pipeline (tudo já `int64`). CONFIRMADO (consequência de E2). Fix: E2 + teste e2e `QT_VOTOS=abc` reprova gates.
- **E4** `etl/build_marts.py:190-211` — sha do CSV derivado (não do ZIP); filtro só por `ano` fabrica entry de governador p/ frame só-presidente. CONFIRMADO. Fix: sha da fonte via parâmetro + `sha_origin`; match `(ano,cargo)`.
- **E5** `etl/build_marts.py:192-193,232` — build vazio registra ingestão falsa 2014-presidente; ano fora do V1 → `FileNotFoundError` após publicar DB/JSONs. CONFIRMADO. Fix: vazio→`{"ingestions": []}`; fora-do-V1→falhar antes de escrever.
- **E6** `etl/build_marts.py:106-117` + `manifest.py:25` — sem limpeza de partições obsoletas; append duplica entries a cada rebuild. CONFIRMADO. Fix: limpar `ano=*/` + dedupe por `(ano,cargo,url)`.
- **E7** `etl/manifest.py:14-28` — sem validação de entry; reset silencioso sem backup; escrita não-atômica. CONFIRMADO. Fix: validar + raise; backup `.corrupt.<ts>`; tmp+rename.
- **E8** `etl/sources.py:10-12` — filtro de capitais prometido, inexistente em código. CONFIRMADO (grep). Fix: allowlist 27 IBGE + teste, ou rebaixar promessa.
- **F1** `web/lib/data.ts:216-228` — ranking ignora ano/cargo/UF (agregado não tem colunas). CONFIRMADO. Fix: nota de cobertura/SEM_DADO.
- **F2** `web/lib/data.ts:165-197` — Resumo/UF ignoram `candidato`. CONFIRMADO. Fix: notas visíveis por seção.
- **F3** `web/lib/data.ts:199-213` — evolução ignora `ano`. CONFIRMADO. Fix: check `matchAno` ou disclosed.
- **F4** `web/app/analisar/page.tsx:193-207` — comparador ignora filtros e `semCob`. CONFIRMADO. Fix: derivar de `cands` + null sob `semCob`.
- **F5** `web/lib/data.ts:69-74`, `export.ts:30` — hash só-espaços passa `isAudited`. CONFIRMADO. Fix: trim + teste.
- **C1** `ci.yml:29` + `pyproject.toml:6` — `pytest` sem declaração; quebra em runner limpo. CONFIRMADO. Fix: instalar no step ou extra `test`.
- **C2** `build_marts.py:214-232`, `ci.yml` — `run_gates` nunca invocado no pipeline/CI (só testes). CONFIRMADO por grep. Fix: gate após DuckDB, antes de JSONs/manifest; step CI.

## MÉDIO (ação curta)

M1 IBGE sem validação (`normalize.py:104-107`); M2 `int()` fora de try (`validate.py:117-120`); M3 dest/url sem sandbox (`fetch.py:26-28`); M4 `.part` determinístico + response sem close; M5 fallback `sep=","` mata build (`build_marts.py:51-69,90-94`); M6 código morto (`normalize.py:70-71`, schemas não usados); M7 teste tautológico (`test_normalize.py:28`); M8 UF substring (`data.ts:161-163`); M9 `semCobertura` conjunto em vez de por-chave (`export.ts:46-59`); M10 `<a href={url}>` sem scheme (`SourceBadge.tsx:48`, `auditoria:128`); M11 CSV sem audit gerável via lib (`export.ts:69-96`); M12 fórmulas Excel + `NaN→"0"` (`export.ts:61-64`, `data.ts:62-64,179`); M13 share perde `pivo/comp`/ctx do CSV, input sem `readOnly`, banner sem estilo; M14 `getAuditInfo` morto e doc errado; M15 `date`/`data` nunca escritos; M16 `rows` com double-count; M17 sem `.gitignore` raiz (manifest fixture commitável); M18 actions por major tag + sem `cache: pip`; M19 seed sem backup pré-unlink; M20 BOM latente.

## APROVADO (verificado)

Download SHA/retry/atômico; `verify_manifest` fail-closed; gates externos corretos (soma, órfãos, manifest, read_only); front runtime `/data/*.json` (build verde comprova independência), selo só via `getOfficialAuditInfo`, CSV bloqueado sem audit na UI, `?hash=` round-trip 7 chaves, XSS estrutural zero, hooks corretos; CI ordem pytest→seed→test→build, seed determinístico; contrato 20/21 campos MATCH (só `date` diverge).
