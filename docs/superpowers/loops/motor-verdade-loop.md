# Loop: Motor Verdade → merge → evolução contínua

Diretiva do usuário (2026-10-09): trabalhar em loop — auditar o PR até green e mergear; depois auditar o projeto, achar melhorias, planejar, executar, repetir; documentar tudo (anti-perda, anti-regressão).

## Protocolo do loop (regras fixas)

1. **Fases**: `PR-GREEN` (auditar PR → fixes → CI verde → merge) → `EVOLVE-n` (auditar projeto → plano → executar → verificar), repetindo EVOLVE.
2. **Orçamento**: cubic-loop max 5 iterações por ciclo de review; cada ciclo EVOLVE termina com relatório curto + commit.
3. **Paradas**: só param o loop — operação irreversível/destrutiva, ação de segurança (secrets, auth), merge/push em branch alheia (este PR é próprio, merge autorizado quando green), ou plano tão quebrado que tudo é chute.
4. **Merge**: autorizado pelo usuário quando "todo green + fixes feitos". Método: merge commit (preserva histórico por-task).
5. **Anti-regressão**: todo ciclo roda a suíte completa local antes do push; CI precisa estar verde; findings viram testes quando aplicável.
6. **Contexto**: sem ferramenta de compactação manual — mitigação é contexto enxuto + este arquivo + git. Se compactar, retomar por aqui.

## Estado atual (atualizado 2026-10-10 ~21:38 UTC)

- [x] PR #2 (motor-verdade → main): mergeado 47d6895, CI verde.
- [x] EVOLVE-1: mergeado 453a9da (PR #3).
- [x] EVOLVE-2: mergeado 71aa4ff (PR #4).
- [x] EVOLVE-3: mergeado 39c2258 (PR #5).
- [x] EVOLVE-4: mergeado 9bada45 (PR #6).
- [x] EVOLVE-5: mergeado 140f8fa (PR #7) — primeiro dado REAL fluindo (Censo 2022 e2e).
- [x] EVOLVE-6: mergeado 145de27 (PR #8).
- [x] EVOLVE-7: mergeado eb96878 (PR #9) — primeiro pixel real na UI (pop Censo).
- [ ] EVOLVE-8: em progresso na branch `evolve-8` — Tasks 1–5 completas (reviews Approved), Task 6 (processo) em execução; PR ao final.
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
