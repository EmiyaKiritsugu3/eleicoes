# Loop: Motor Verdade → merge → evolução contínua

Diretiva do usuário (2026-10-09): trabalhar em loop — auditar o PR até green e mergear; depois auditar o projeto, achar melhorias, planejar, executar, repetir; documentar tudo (anti-perda, anti-regressão).

## Protocolo do loop (regras fixas)

1. **Fases**: `PR-GREEN` (auditar PR → fixes → CI verde → merge) → `EVOLVE-n` (auditar projeto → plano → executar → verificar), repetindo EVOLVE.
2. **Orçamento**: cubic-loop max 5 iterações por ciclo de review; cada ciclo EVOLVE termina com relatório curto + commit.
3. **Paradas**: só param o loop — operação irreversível/destrutiva, ação de segurança (secrets, auth), merge/push em branch alheia (este PR é próprio, merge autorizado quando green), ou plano tão quebrado que tudo é chute.
4. **Merge**: autorizado pelo usuário quando "todo green + fixes feitos". Método: merge commit (preserva histórico por-task).
5. **Anti-regressão**: todo ciclo roda a suíte completa local antes do push; CI precisa estar verde; findings viram testes quando aplicável.
6. **Contexto**: sem ferramenta de compactação manual — mitigação é contexto enxuto + este arquivo + git. Se compactar, retomar por aqui.

## Estado atual (atualizado 2026-10-10 ~22:30 UTC)

- [x] PR #2 (motor-verdade → main): mergeado 47d6895, CI verde.
- [x] EVOLVE-1: mergeado 453a9da (PR #3).
- [x] EVOLVE-2: mergeado 71aa4ff (PR #4).
- [x] EVOLVE-3: mergeado 39c2258 (PR #5).
- [x] EVOLVE-4: mergeado 9bada45 (PR #6).
- [x] EVOLVE-5: mergeado 140f8fa (PR #7) — primeiro dado REAL fluindo (Censo 2022 e2e).
- [x] EVOLVE-6: mergeado 145de27 (PR #8).
- [x] EVOLVE-7: mergeado eb96878 (PR #9) — primeiro pixel real na UI (pop Censo).
- [x] EVOLVE-8: mergeado 3f46b89 (PR #10).
- [x] EVOLVE-9: completo na branch `evolve-9` — 6/6 tasks + revisão final limpa (PR aberto p/ merge).
- (Histórico original deste bloco preservado abaixo por valor de auditoria.)

## Log de ciclos

| Data (UTC) | Ciclo | Achados | Fixes | Verificação | Commit/PR |
|------------|-------|---------|-------|-------------|-----------|
| 2026-10-09 | PR-GREEN init | CI red (setuptools discovery); cubic/CodeRabbit pending | — | — | — |

## Instrução permanente do usuário (2026-10-09)
- Usar SEMPRE Context7 (docs oficiais) para qualquer tecnologia externa: sintaxe de API, config, versões, debugging de libs, setup. Via `npx ctx7@latest` (MCP execute indisponível neste harness; CLI é o caminho).

## PR-GREEN iteração 1 (2026-10-09 ~14:35 UTC)
- Estado PR: OPEN, MERGEABLE, UNSTABLE. CI red ×2 (pip install quebra em setuptools discovery — 8s).
- Reviews: cubic 60 issues + CodeRabbit 8 comentários (lista integral em /tmp/opencode/pr2/comments.json — 68 fiesta; mover p/ registro se preciso).
- Context7 (sempre): setuptools `/pypa/setuptools` confirma `[tool.setuptools.packages.find] include = ["etl*"]`.
- Triage: P0×1 (zone-sum) + P1×11 + P2×~40 + CodeRabbit 8 → 5 frentes (A:etl B:mapa C:seals D:veredictos E:docs/seed) + fix CI direto (pyproject+node22+teste).
- Regra: fixers validam antes de corrigir; NÃO commitam (eu integro + suíte completa + 1 commit + push).

## PR-GREEN iteração 1 — integração (2026-10-10 ~00:40 UTC)
- 5 frentes (A:ETL B:mapa C:selos D:vereditos E:docs) + F micro (?fato/?regiao) + fix CI direto (packages.find etl* + tomllib assert + node_modules/ ignore) + fix TZ flake (3 asserts data UTC).
- Local: pytest 94 + vitest 259/14 + tsc + build OK. CI quebrou por `pip install .` (setuptools discovery) — verificado isolado em /tmp (só `etl` empacota agora).
- Limpeza: build/ + egg-info/ (subprodutos da verificação pip) removidos, não commitados.

## PR-GREEN iteração 2 (2026-10-10 ~02:45 UTC)
- Push 2f1d4bd: CI avançou (install OK) mas 1 fail — teste CI importa `yaml` ausente no runner.
- Fix: `pyyaml>=6` no extra test + `importorskip` no teste (Context7 não necessário — stdlib/pytest pattern; deps só free).

## PR-GREEN iteração 3 (2026-10-10 ~02:55 UTC)
- Push f0f2e0d: install OK, pytest 93 OK, vitest 238/238 OK — mas exit 1 por "unhandled error" (P2 cubic confirmado): jsdom 30 exige Node 22+, CI rodava Node 20 (EOL).
- Fix: ci.yml node-version 20 → 22 + teste de piso (tomllib/regex). Local é Node 26 (não reproduz; CI é a prova).

## PR-GREEN iteração 3 (2026-10-10 ~03:00 UTC)
- CI VERDE ×2 (1m15s). Resta: cubic + CodeRabbit re-review dos novos pushes.

## PR-GREEN iteração 4 (2026-10-10 ~04:00 UTC)
- 2 findings frescos do re-review CodeRabbit: (1) mismatch transitório fato/selo no ?fato= — fix setFato(null) + teste jsdom de transição (RED sem fix confirmado); (2) gate fixture da rota vs contrato do componente — julgado: sugestão procede, rota alinhada via vereditoTemProva() + testes.
- Local: pytest 95 + vitest 262/15 + tsc + build OK.

## PR-GREEN completo (2026-10-10 ~04:10 UTC)
- Merge PR #2 (merge commit 47d6895): CI verde ×2, GitGuardian + CodeRabbit + cubic pass, zero findings pós-lote.
- Branch motor-verdade deletada local; main atualizada.

## EVOLVE-1: auditoria de melhorias (iniciada)
- Conhecidos pendentes: mapa clicável na Home (gap spec §3); ingest real Censo (URL pendente); verificação com-fato-real; T2 dup/phantom-id; minors do ledger final.

## EVOLVE-1 completo (final review: Merge Yes)
- 6/6 tasks + revisão final limpa; nenhum MUST-FIX; minors → EVOLVE-2 backlog.

## EVOLVE-1 pós-review: Sonar + cubic + CodeRabbit (2026-10-10 ~14:40 UTC)
- Sonar gate: duplicação 4.2%→1.7% OK (helper DV compartilhado); restou só Security Rating C (6× S8707 path-traversal em build_marts.py).
- Ruling (autorizado pelo usuário): won't-fix com justificativa nos 6 issues — ETL batch local, paths dos args do próprio operador (só auto-ataque); mitigação runtime `_dentro_de` + 8 testes TDD; motor de taint não reconhece sanitizer custom. Chaves: AaEj-mP2BIquHGRj1Xcc/cd, AaEj62gSVyNZiS698IBr/Bo/Bp/Bq. Revisitar se os paths forem remotamente alcançáveis. Ação via API direta (MCP sonarqube-mcp-server 1.10.21 com bug no endpoint markIssueWontFix — "issue parameter missing"; reportar upstream).
- cubic 23 issues triadas: 13 corrigidas (commit 054b5da, review Approved), 10 diferidas → EVOLVE-2.
- CodeRabbit MAJOR (9 IBGEs oficiais fora do mod-10, confirmado na API oficial: 5571 municípios, exatamente 9 falham) corrigido com allowlist + teste (commit 9ebb6fb, review Approved); final pass sem achados novos.
- Sonar MCP instalado (sonarqube-mcp-server@1.10.21, org emiyakiritsugu3) — token no config OpenCode.

## EVOLVE-1 mergeado (2026-10-10 ~14:50 UTC)
- Merge PR #3 (merge commit 453a9da): tudo verde — CI ×2, GitGuardian, CodeRabbit, cubic, Sonar (pós won't-fix justificado). Branch evolve-1 deletada.
- Total: 6 tasks + sonar guards + helper DV + 13 fixes cubic + allowlist 9 exceções + triagem Sonar. Suítes finais: pytest 120 + vitest 282 + build OK.

## EVOLVE-2 completo (final review: Merge Yes)
- 6/6 tasks + revisão final limpa; nenhum MUST-FIX; minors → EVOLVE-3 backlog.

## EVOLVE-2 round PR#4-R1/R2 (2026-10-10 ~16:00 UTC)
- CodeRabbit 6 achados: T5 rglob (perna curated morta) + probe por-UF; T6 mapa sem hash + Método sem fato + typing; T3 If-Range/Content-Range — todos corrigidos com re-review limpo.
- Sonar: 5+1 S8707 novos (mesma família) won't-fix justificado; antes, guardas de mutação no build_fato (reuse sem fork). Incidente chave-vizinha corrigido e registrado.
- Smells restantes (S6845×S6819, S3776, S1192) → EVOLVE-3.

## EVOLVE-2 mergeado (2026-10-10 ~16:10 UTC)
- Merge PR #4 (merge commit 71aa4ff): tudo verde — CI, GitGuardian, CodeRabbit, Sonar (pós won't-fix justificado dos S8707 mesma-família). Branch evolve-2 deletada.
- Total: 6 tasks + 3 fix rounds CodeRabbit + guardas build_fato + triagem Sonar 2 rounds. Suítes finais: pytest 143 + vitest 307 + build 52/52.

## EVOLVE-3 completo (final review: Merge Yes)
- 6/6 tasks + revisão final limpa; nenhum MUST-FIX; minors → EVOLVE-4 backlog.

## EVOLVE-3 mergeado (2026-10-10 ~17:05 UTC)
- Merge PR #5 (merge commit 39c2258): tudo verde — CI ×2, GitGuardian, CodeRabbit, cubic, Sonar (pós won't-fix justificado). Branch evolve-3 deletada.
- Total: 6 tasks + T0 a11y + R1 (5 CodeRabbit) + R2 (10 cubic) com re-reviews limpos. Suítes finais: pytest 149 + vitest 338 + tsc clean + build.

## EVOLVE-4 completo (final review: Merge Yes)
- 6/6 tasks + revisão final limpa; nenhum MUST-FIX; minors → EVOLVE-5 backlog.

## EVOLVE-4 mergeado (2026-10-10 ~18:15 UTC)
- Merge PR #6 (merge commit 9bada45): tudo verde — CI ×2, GitGuardian, CodeRabbit, cubic, Sonar (pós won't-fix justificado). Branch evolve-4 deletada.
- Total: 6 tasks + R1 (Sonar gate + cubic 10) + R2 (cubic 2 P2) com re-reviews limpos. Suítes finais: pytest 158 + vitest 361 + tsc clean + build.

## EVOLVE-5 completo (final review: Merge Yes)
- 6/6 tasks + revisão final limpa; nenhum MUST-FIX; minors → EVOLVE-6 backlog.

## EVOLVE-5 round PR#7-R1 (2026-10-10 ~19:00 UTC)
- Sonar: 2 S8707 novos (AaEnIcVKAr7Y89NJiOCA :118, AaEnIcVKAr7Y89NJiOB_ :152 — reads read-only de CSV/JSON de args do operador em `etl/__main__.py`, zero mutação fs) won't-fix: ETL batch local, só auto-ataque; motor não reconhece sanitizers custom.

## EVOLVE-5 mergeado (2026-10-10 ~19:00 UTC)
- Merge PR #7 (merge commit 140f8fa): tudo verde — CI, GitGuardian, CodeRabbit, cubic, Sonar (pós won't-fix justificado). Branch evolve-5 deletada.
- Total: 6 tasks + R1 (Sonar + cubic P3) com re-reviews limpos. Primeiro dado REAL fluindo (Censo 2022 e2e). Suítes finais: pytest 168 + vitest 374 + tsc clean + build.

## EVOLVE-6 completo (final review: Merge Yes)
- 6/6 tasks (4 implemented + 2 documented blockages T1/T5) + revisão final limpa; nenhum MUST-FIX.
- Achado direcional: TSE↔IBGE sem de-para oficial + alfabetização≠escolaridade; próximo win desbloqueado = perfil Censo na UI (EVOLVE-7).

## EVOLVE-6 mergeado (2026-10-10 ~19:55 UTC)
- Merge PR #8 (merge commit 145de27): tudo verde — CI ×2, GitGuardian, CodeRabbit, cubic, Sonar. Branch evolve-6 deletada.
- Total: 6 tasks (4 implemented + 2 blockages documentados) + R1/R2/R3 com re-reviews limpos. Suítes finais: pytest 188 + vitest 391 + tsc clean + build.

## EVOLVE-7 completo (final review: Merge Yes with fixes → fixed + re-reviewed)
- 6/6 tasks + seam-fix (promoção direta p/ served) + rotation-Censo, re-reviews limpos; resto → EVOLVE-8 backlog.

## EVOLVE-7 round PR#9-R2 (2026-10-10 ~20:30 UTC)
- Sonar dup 4.7%→1.0% OK (helpers); 2 S8707 novos (AaEng5Abn3atgy46ToJf/Jg, sinks guardados) won't-fix mesmo ruling.

## EVOLVE-7 mergeado (2026-10-10 ~21:15 UTC)
- Merge PR #9 (merge commit eb96878): tudo verde — CI ×2, GitGuardian, CodeRabbit, cubic, Sonar. Branch evolve-7 deletada.
- Total: 6 tasks + R1/R3/R4/R5 com re-reviews limpos. Primeiro pixel real na UI (pop Censo). Suítes finais: pytest 202 + vitest 412 + tsc clean + build.

## EVOLVE-8 em progresso — timings das suítes (2026-10-10 ~21:38 UTC, Task 6)
- Tasks 1–5 completas (reviews Approved); Task 6 (processo, docs-only) em execução na branch `evolve-8`.
- Medição Task 6 (comandos a partir da raiz do repo; `npm test` roda em `web/`):
  - `pytest tests/ -q` → 202 passed, 1 skipped em 15.50s (wall ~15s).
  - `(cd web && npm test)` → 26 arquivos, 447/447 passed, vitest Duration 2.55s (wall ~3s).
- (Futuros ciclos: anexar novas linhas abaixo neste formato — comando, resultado, wall.)

## EVOLVE-8 completo (final review: Merge Yes)
- 6/6 tasks + revisão final limpa; minors (PainelRegiao fetch cru, Verificar share) → EVOLVE-9 micros.

## EVOLVE-8 mergeado (2026-10-10 ~22:15 UTC)
- Merge PR #10 (merge commit 3f46b89): tudo verde — CI ×2, GitGuardian, CodeRabbit, cubic, Sonar. Branch evolve-8 deletada.
- Total: 6 tasks + R1/R2/R3/R4 com re-reviews limpos. Suítes finais: pytest 202 + vitest 454 + tsc clean + build.

## EVOLVE-9 em progresso — timings das suítes (2026-10-10, Task 6)
- Tasks 1–5 completas; Task 6 (processo, docs-only) em execução na branch `evolve-9`.
- Medição Task 6 (comandos a partir da raiz do repo; `npm test` roda em `web/`):
  - `pytest tests/ -q` → 202 passed, 1 skipped em 15.38s (wall ~15s).
  - `(cd web && npm test)` → 29 arquivos, 473/473 passed, vitest Duration 2.79s (wall ~4s).
- (Futuros ciclos: anexar novas linhas abaixo neste formato — comando, resultado, wall.)

## EVOLVE-9 mergeado (2026-10-10 ~23:55 UTC)
- Merge PR #11 (merge commit d082f65): tudo verde — CI ×2, GitGuardian, CodeRabbit, cubic ("All reported issues were addressed"), Sonar. Branch evolve-9 deletada.
- Total: 6 tasks + R1/R2/R3/R4/R5 com re-reviews limpos. Suítes finais: pytest 202 + vitest 485 + tsc clean + build.

## EVOLVE-10 completo (final review: Merge Yes)
- 6/6 tasks + revisão final limpa; nenhum MUST-FIX; minors → EVOLVE-11 backlog.

## EVOLVE-10 mergeado (2026-10-11 ~01:25 UTC)
- Merge PR #12 (merge commit e3e74d6): tudo verde — CI ×2, GitGuardian, CodeRabbit, cubic ("All reported issues were addressed"), Sonar. Branch evolve-10 deletada.
- Total: 6 tasks + R1/R2 com re-reviews limpos. 5/5 superfícies gated. Suítes finais: pytest 202 + vitest 506 + tsc clean + build.

## EVOLVE-11 mergeado (2026-10-11 ~01:30 UTC)
- Merge PR #13 (merge commit 55645cd): tudo verde — CI ×2, GitGuardian, CodeRabbit (rate-limited, sem findings), cubic (19 findings triados: 16 corrigidos R1/R3/R4, 3 wont_fix justificados em thread), Sonar (dup 8.3%→1.7% via ExportCsv + fixtures fonte única). Branch evolve-11 deletada.
- Total: 6 tasks (pleito switcher /regiao, comparador desabilitado, share Home, CSV /regiao, CSV curadas, staleness SSG) + R1 (ExportCsv fonte única) + R2 (dedupe testes) + R3 (10 findings) + R4 (re-review 8). Suítes finais: pytest 202 + vitest 547 + tsc clean + build 52/52.

## EVOLVE-12 mergeado (2026-10-11 ~09:10 UTC)
- Merge PR #14 (merge commit 055ca8f): tudo verde — CI ×2, GitGuardian, CodeRabbit (3 minors corrigidos em R1), cubic pass, Sonar pass. Branch evolve-12 deletada.
- Total: 6 tasks (CSV Home via homeCsvRows+ExportCsv+pronto, entradas em explorar/verificar via ENTRADAS_CURADA fonte única, pronto={manifestChecked} no PainelRegiao 2 spots, dedupe ano/cargo/uf no Analisar via analisarCsvRows fonte única, inventário CSV-spots 6/6) + R1 (entradas Home honesta ENTRADAS_HOME sem f_candidato + csvEscape tab/CR). Suítes finais: pytest 202 + vitest 557 + tsc clean + build.
- Incidentes de percurso: vitest timer `URL.revokeObjectURL is not a function` (clicarExportar + teste posterior no mesmo arquivo mantém o arquivo vivo p/ o setTimeout de 100ms disparar pós-restore) — resolvido extraindo `analisarCsvRows` pura (sem clique); Next Page export block (`analisarCsvRows` em page.tsx quebra o tipo de Page) — resolvido movendo p/ `lib/export.ts`.

## Próxima sessão — EVOLVE-13 (backlog votado em EVOLVE-11, design pendente de aprovação final)
- Direção: **a11y batch + dedupe** (baseline main @055ca8f verde).
- Design proposto (bounded — REAPRESENTAR p/ aprovação explícita antes de implementar):
  1. Canvas `role` no MapaBrasil.
  2. Live regions auditoria/Comparator.
  3. `SEM_DADO` alert na Home.
  4. Dedupe `ALERTA_STYLE` (fonte única).
  5. Dedupe `finito`/tabela UF.
  6. Teste inventário a11y-spots (trava de paridade).
- Backlog EVOLVE-14: bloqueados (de-para TSE↔IBGE, instrução, GeoJSON) + varredura de minors.
- Retomar: auditar bloqueados, propor design bounded (REAPRESENTAR p/ aprovação explícita), branch `evolve-14`, TDD RED→GREEN por task, PR + reviews até green, merge commit, atualizar este loop.

## EVOLVE-13 mergeado (2026-10-11 ~09:50 UTC)
- Merge PR #15 (merge commit 3a8ef33): tudo verde — CI ×2, GitGuardian, CodeRabbit (rate-limited, sem findings), cubic pass (4 P2 triados: 3 corrigidos R1 + 1 R2, todos com reply em thread), Sonar pass. Branch evolve-13 deletada.
- Total: 6 tasks (role=img canvas MapaBrasil, live regions Comparator role=status + auditoria carregando, SEM_DADO alert Home, ALERTA_STYLE fonte única 9→1 em lib/textos, finito fonte única 4→1 em lib/motor + tabela UF do índice verificar via PainelRegiao, inventário a11y-spots) + R1 (alerta vivo único Home/auditoria + claim dedupe honesto) + R2 (vazio local com prova anuncia via role condicional). Suítes finais: pytest 202 + vitest 565 + tsc clean + build.
- Pesquisa skills de loop (pedido do usuário): carregadas `loop-library`/`loopy`/`cubic-loop` + catálogo publicado consultado — 3 fits: 019 Clodex adversarial-review (≈ nosso PR-GREEN), 040 accessibility repair (≈ EVOLVE-13), 033 propagation compliance (≈ nosso fonte-única). `cubic-loop` segue o protocolo do repo.

## Próxima sessão — EVOLVE-14 (backlog, design pendente de aprovação final)
- Direção: **bloqueados remanescentes** (de-para TSE↔IBGE, instrução, GeoJSON) + varredura de minors.
- Baseline main @3a8ef33 verde (pytest 202 + vitest 565).

## EVOLVE-14 — verificação de bloqueadores + minors (2026-10-11, sem PR: zero mudança em código)
- Testes de evidência verdes: `test_fato_real_e2e.py` + `test_escolaridade_bloqueada.py` (13 passed) — fail-closed segue pinado.
- **De-para TSE↔IBGE: DESBLOQUEADO com evidência externa nova** (única novidade acionável do ciclo): dataset oficial `codigos-oficiais-de-uf-e-municipios-segundo-o-tse-e-o-ibge` (org TSE/SMG, CC-BY, metadados 24/06/2025), recurso `https://cdn.tse.jus.br/estatistica/sead/odsele/municipio_tse_ibge/municipio_tse_ibge.zip` (139KB, DT_GERACAO 04/10/2026). CSV Latin-1 `;`-quoted, 5571 linhas, colunas `CD_MUNICIPIO_TSE` (5 dígitos = formato dos votos reais que o `normalize` rejeita) ↔ `CD_MUNICIPIO_IBGE` (7 dígitos), bijeção 5571↔5571 ambos únicos; `leiame.pdf` documenta layout. Bytes inspecionados em `/tmp/opencode/depara/` (fora do repo). Ingestão no ETL (nova fonte, join em normalize/build_fato, gates, reescrita do teste fail-closed) é **arquitetural** → EVOLVE-15 com spec+plano, sem implementação neste ciclo (hard gate).
- Instrução: segue BLOQUEADO — só lead (panorama/SIDRA citam nível de instrução, sem fonte ETL-ready confirmada; dicionário oficial cobre só alfabetização; alfabetização≠escolaridade).
- GeoJSON: segue BLOQUEADO — só SHP oficial (Malha Municipal 2025); sem GeoJSON direto; conversão SHP→GeoJSON é pipeline próprio.
- Minors: nada acionável (zero TODO/FIXME/XXX/HACK em app/components/lib/etl/scripts).
- Terminal: verificação completa, 1 desbloqueio registrado, 0 churn (sem PR — sem mudança real).

## EVOLVE-15 mergeado (2026-10-11 ~11:00 UTC) — DESBLOQUEIO DO FATO REAL
- Merge PR #16 (merge commit 336a6dc): tudo verde — CI ×2, GitGuardian, CodeRabbit (rate-limited), cubic pass (10 P2 triados: 9 corrigidos R3 + 1 R2-novo, todos com reply; +1 P2 respondido como pré-existente/deferido p/ EVOLVE-16), Sonar pass (S3776×2+S5778×3 corrigidos R1/R2; 2 S8707 mesma-família wont-fix justificado via API, ruling EVOLVE-1). Branch evolve-15 deletada.
- Total: etl/depara.py (parse+gates bijection+DV, chave zfill5, register ingest) + normalize(df,depara=None) default intacto + threading build_all/CLI --depara-csv + fontes triplas no fato + 20 testes (19 offline + e2e real RR→Boa Vista verde) + R1/R2/R3. Suítes finais: pytest 217 + vitest 565 + tsc + build.
- Incidentes: voto "3018" vs oficial "03018" (chave canônica); timer/revoke não se aplica (sem clique); canônico com artifacts stale em fluxo não-vazio — gates correm no MIRROR (contrato __main__), e2e ajustado; S8707 ruling sem MCP (token do config via API direta).
- Backlog EVOLVE-16: E5 empty-build artifact coverage (P2 cubic deferido, quebra contrato pinado — design próprio) + instrução/GeoJSON (bloqueados).

## Onda 1 mergeada (2026-10-11, PR #17, commit 77e5211) — fundação editorial
- Escopo: tokens fonte única (`web/lib/tokens.ts`, paleta papel/tinta + verde/amarelo editoriais) + shell (marca, filete, Nav com `aria-current`) + Home display-only (tipografia, filetes, tabelas, inputs com foco visível). Invariantes intactos: nenhum texto/role/ordem/comportamento muda; `ALERTA_STYLE` intacto; offline-first.
- Execução subagent-driven (6 tasks + reviews por task + final review Ready-to-merge).
- Rounds no PR: R1 (Sonar duplication 4.1% — bloco shell render duplicado shell.test↔ux.test → fonte única `htmlShell()` em shell-html.tsx; + nitpick CodeRabbit pinnando o link ativo `/analisar`). CodeRabbit: 1 trivial corrigido (sem thread p/ reply — só corpo do review). cubic: skipping (quota, neutro, sem findings). CI ×2 + Sonar + GitGuardian verdes no head.
- Incidentes: helper `secao()` acoplado à ausência de atributos (ruling: tolerar atributos, asserções intactas); mock `usePathname` faltando em ux.test (fix test-infra).
- Suítes finais: pytest 221 + vitest 571 + tsc + build.
- Backlog: Onda 2 (movimento/transições + skeletons/loading, com testes novos).

## Próxima sessão — Onda 2 (design pendente de aprovação final)
- Direção: **movimento + carregamento percebido** na Home (transições, skeletons) — mudam o DOM, exigem testes novos.
- Baseline main @77e5211 verde (pytest 221 + vitest 571).

## Onda 2 mergeada (2026-10-11, PR #18, commit 768c5be) — movimento + loading
- Escopo: tokens de movimento + Skeleton display-only (aria-hidden, reduced-motion) + skeletons nas 4 seções + fade-in via keyframes + hover nav/tabelas com gate reduced-motion. Invariantes intactos.
- Execução subagent-driven (4 tasks + reviews + final + micro-round keyframes, todos clean).
- Rounds no PR: ZERO — CI ×2 + Sonar + GitGuardian verdes + CodeRabbit sem threads no head. cubic skipping (quota, neutro, precedente PR #17).
- Incidentes: fade escondia skeleton (fix: fade só no conteúdo resolvido); div-in-p inválido (fix: div role=status); fade morto em opacity 1 (micro: keyframes, hydration-safe por construção — SSR sempre loading).
- Suítes finais: pytest 221 + vitest 579 + tsc + build.
- Backlog: Onda 3 (demais superfícies herdam tokens) + row-hover transition (deferido) + style-hoist (parkado).

## Onda 3 mergeada (2026-10-12, PR #19, commit 4be3819) — tokens nas restantes
- Escopo: Analisar+Comparator, Explorar (cores de dados intactas), Verificar/Curada/PainelRegiao/Auditoria/índices — só valores de estilo. Selos/vereditos/dados byte-idênticos.
- Execução subagent-driven (4 tasks + reviews + final clean). Task 4 extra (receita do reviewer): relax matchers h1/h2 + H1/H2 PainelRegiao, 2-commit split.
- Rounds no PR: ZERO — CI ×2 + Sonar + GitGuardian verdes + CodeRabbit sem threads no head. cubic skipping (quota, neutro).
- Suítes finais: pytest 221 + vitest 579 + tsc + build.
- Backlog: rem-vs-px nos tokens espaco (herança Onda 1) + pipeline real end-to-end (maior valor pendente).

## Fix de-para short-codes mergeado (2026-10-12, PR #20, commit c00554f)
- Bug real achado rodando o pipeline 2024-prefeito nacional: gate cru ^\d{4,5}$ (do achado cubic R3/PR#16) descartava pares oficiais 1–3 dígitos — RO inteira fora do fato, incl. Porto Velho ("35"→1100205) e "299"→1100288.
- Root cause: achado era falso-positivo; zeros à esquerda são suprimidos no arquivo de votos, e pertinência ao mapa já é fail-closed por construção. Gate agora: 1–5 dígitos → zfill(5) → lookup; sem par → "".
- Prova: fato refeito com 25/25 capitais esperadas (só BSB sem-prefeito e AJU sem-turno-1-na-fonte fora, ambas corretas), 22,9M votos, demo nula 0, gates verdes.
- Gap de fonte documentado: arquivo nacional TSE sem prefeito-turno-1 de Aracaju (só 6 linhas turno 2).
- Rounds no PR: ZERO — CI ×2 + Sonar + GitGuardian verdes + CodeRabbit sem threads. Suite: pytest 222.

## Preview real na UI (2026-10-12, sem PR: operação local reversível)
- Swap dos artefatos reais de /tmp/opencode/real-run sobre web/public/data (+backup em /tmp/opencode/served-backup), build + serve local, screenshots Playwright, restore + kill server.
- Home com dado oficial: "Total de votos: 22.886.213", "Anos: 2024", selo "fonte auditada" + URL TSE + hash. /regiao/3550308?fato=fato_2024_1_prefeito: RICARDO NUNES (MDB), 1.801.139 votos, margem 0,4%, total 6.109.051, selo oficial.
- Erros de console só benignos: favicon 404 + malha topojson ausente (fallback em lista, fail-closed por design).
- Incidente: `pkill -f` casou com o próprio comando (suicídio do shell) — restore refeito com kill por porta (ss); backup estava intacto; servido de volta às fixtures 2022, árvore limpa.
- Para dado real no ar (deploy): CI regenera fixtures via seed --force; é preciso job de ingestão real publicando JSONs no deploy (ver metodologia/seção deploy). Backlog.

## Pipeline real parametrizado (2026-10-12, branch `pipeline-real`: script + docs, sem PR ainda)
- `scripts/ingestao_real.py --ano --cargo --turno` (só orquestra entrypoints de `etl/__main__.py`; combos validados contra `V1_DATASETS`; guarda anti-perda espelha `seed --force`).
- Tasks 1–4: CLI + fetch + wiring + docs deploy (`/metodologia` item Produção com comandos dos 2 triples + SHAs do manifest + nota publish manual).
- Suítes: pytest 229 + vitest 580 + tsc + build verdes.
- Real-run provado (2024-prefeito): 22.886.213 votos, fato 25 municípios; SHAs do manifest (CSV extraído/derivado, não do zip) `1024537a…` votacao_2024, `22518445…` de-para, `0adc228e…` Censo.
- 2022-presidente: comando documentado, run real ainda NÃO executado neste ciclo (sem números registrados).

## Pipeline real parametrizado mergeado (2026-10-12, PR #21, commit a526cec)
- Escopo: `scripts/ingestao_real.py --ano --cargo --turno` (só orquestra entrypoints: fetch→depara→build_all→censo→fato→gates + resumo) + 8 testes offline + docs deploy real (metodologia + loop). Combos validados contra V1; fail-closed 0/1/2; guarda anti-perda.
- Execução subagent-driven (4 tasks + reviews por task + final review Ready-to-merge + 1 fix wave).
- Rounds no PR: R1 (Sonar new_security_rating E — 8× S8707/S2083 mesma-família no script novo → won't-fix justificado via API, ruling EVOLVE-1/15: batch local, só auto-ataque; + nit docs que triggou re-análise). CI ×2 + Sonar + GitGuardian verdes no head. CodeRabbit só summary. cubic skipping (quota, neutro, precedente).
- Suítes finais: pytest 230 (229 passed + 1 skipped; 222 baseline + 8 novos) + vitest 580 + tsc + build.
- Backlog: run real 2022-presidente ainda não executado (sem números registrados); workflow_dispatch c/ artifacts (candidato próximo ciclo); rem-vs-px; E5 empty-build.
