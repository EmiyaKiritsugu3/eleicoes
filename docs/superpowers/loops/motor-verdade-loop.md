# Loop: Motor Verdade → merge → evolução contínua

Diretiva do usuário (2026-10-09): trabalhar em loop — auditar o PR até green e mergear; depois auditar o projeto, achar melhorias, planejar, executar, repetir; documentar tudo (anti-perda, anti-regressão).

## Protocolo do loop (regras fixas)

1. **Fases**: `PR-GREEN` (auditar PR → fixes → CI verde → merge) → `EVOLVE-n` (auditar projeto → plano → executar → verificar), repetindo EVOLVE.
2. **Orçamento**: cubic-loop max 5 iterações por ciclo de review; cada ciclo EVOLVE termina com relatório curto + commit.
3. **Paradas**: só param o loop — operação irreversível/destrutiva, ação de segurança (secrets, auth), merge/push em branch alheia (este PR é próprio, merge autorizado quando green), ou plano tão quebrado que tudo é chute.
4. **Merge**: autorizado pelo usuário quando "todo green + fixes feitos". Método: merge commit (preserva histórico por-task).
5. **Anti-regressão**: todo ciclo roda a suíte completa local antes do push; CI precisa estar verde; findings viram testes quando aplicável.
6. **Contexto**: sem ferramenta de compactação manual — mitigação é contexto enxuto + este arquivo + git. Se compactar, retomar por aqui.

## Estado atual

- [x] Fase PR-GREEN: CI verde (setuptools discovery corrigido iteração 1; Node 22 iteração 3); findings cubic/CodeRabbit das iterações 1–4 corrigidos; re-review final pendente.
- [ ] Merge PR #2 (motor-verdade → main) — após checks verdes.
- [ ] EVOLVE-1: (a definir após merge).

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
