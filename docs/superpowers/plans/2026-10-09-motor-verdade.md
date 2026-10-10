# Motor Verdade Eleitoral Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir o site de perguntas-respostas eleitorais (mapa clicável + motor de perfil/correlações + explorador + curada + verificação) sobre o SAD existente, custo zero.

**Architecture:** Python estende o ETL (Censo→`dim_municipio`, join→`fato_<ano>_<turno>_<cargo>.json` compacto); TODA a estatística vive UMA vez em `web/lib/motor.ts` (perfil, correlação, estratos); curada pré-computa no build com a mesma lib; explorador/painel computam client-side sobre o fato municipal (~milhares de linhas, leve). Sem servidor, sem WASM, sem API.

**Tech Stack:** Python (pandas/pyarrow/duckdb, reaproveita etl/*) + Next.js 14 + canvas Path2D + TopoJSON + vitest + pytest + GitHub Actions free.

**Spec:** `docs/superpowers/specs/2026-10-09-motor-verdade-eleicoes-design.md`

## Global Constraints

- Custo zero v1: nada pago; Supabase/Vercel só espelho opcional; fatos+TopoJSON somem < 15 MB em `web/public/data/`.
- Só dado oficial: TSE + IBGE Censo 2022; sem Censo auditado a seção de perfil mostra "sem dado oficial".
- Fail-closed: sem hash = "dado não auditado"; vazio = "sem dado oficial"; nunca zero silencioso nem tela branca.
- Join geográfico sempre por IBGE 7 dígitos; piso metodológico n ≥ 30 municípios (abaixo, suprime com nota).
- Selo "dado de município, não de pessoa" em toda tela de perfil/correlação; linguagem nunca causal; vereditos só tricolores com prova.
- Toda resposta carrega query + hash do manifest; UI em pt-BR; TDD com evidência RED/GREEN por task.
- Sem tempo real de apuração nesta v1.

## Review Focus

- Município TSE sem par no Censo (código criado/remanejado) — espera-se votos intactos + perfil "sem dado oficial". Teste em Task 2 (`join_miss_keeps_votes_no_demo`).
- Correlação com n < 30 — espera-se supressão com nota, nunca número publicado. Teste em Task 4 (`n_below_floor_suppressed`).
- Outlier invertendo Pearson vs Spearman — espera-se ambos os r + outlier nomeado. Teste em Task 4 (`outlier_reports_both_r`).
- Canvas sem suporte — espera-se fallback em lista + link TSE, nunca tela vazia. Teste em Task 6 (`no_canvas_fallback_list`).
- Afirmação fora da biblioteca — espera-se sugestão, nunca veredito inventado. Teste em Task 10 (`unknown_claim_suggests`).

---

### Task 1: ETL Censo IBGE (dim_municipio)

**Files:**
- Create: `etl/censo.py`
- Create: `tests/etl/test_censo.py`
- Modify: `etl/sources.py` (adicionar `CENSO_DATASETS`)

**Interfaces:**
- Consumes: `etl/manifest.py` (write/verify), `etl/fetch.py` (download com sha), `etl/validate.py` (padrão de gates).
- Produces: `etl.censo.normalize_censo(df) -> DataFrame` colunas `[ibge7, esc_sup, esc_med, esc_fund, renda_media, pobres_pct, idade_mediana, urbanizacao, pop]`; `dim_municipio` no DuckDB — Task 2 consome.

- [ ] **Step 1: Write the failing tests**

```python
def test_normalize_censo_columns():
    from etl.censo import normalize_censo
    # fixture mínima com header IBGE real -> colunas canônicas + ibge7 string
def test_censo_sum_gate_vs_ibge_total(tmp_path):
    # soma pop fixture vs total declarado -> mismatch retorna erro contendo "soma"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/etl/test_censo.py -v`
Expected: FAIL (módulo ausente).

- [ ] **Step 3: Implement `normalize_censo` em `etl/censo.py` + `CENSO_DATASETS` em `etl/sources.py`**

Aliases do header real do Censo 2022 por município; ibge7 string 7 dígitos (inválido → `""` + warn, padrão Task 8); registra no manifest com URL IBGE + SHA + data (campos `data`, `etl_version` como Task 4).

- [ ] **Step 4: Run tests**

Run: `pytest tests/etl/test_censo.py tests/etl/test_manifest.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add etl/censo.py etl/sources.py tests/etl/test_censo.py
git commit -m "feat: add IBGE census ingest with gates"
```

### Task 2: Fato municipal (join TSE × Censo)

**Files:**
- Create: `etl/build_fato.py`
- Test: `tests/etl/test_fato.py`

**Interfaces:**
- Consumes: `fato_voto`/`dim_candidato` (marts), `normalize_censo` (Task 1).
- Produces: `etl.build_fato.build_fato(duckdb_path, out_dir, ano, turno, cargo) -> str` (retorna path do JSON); arquivo `fato_<ano>_<turno>_<cargo>.json` shape `{candidatos: [{id, nome, partido}], municipios: [{ibge, uf, nome, votos: [n por candidato, mesma ordem], total, abst, demo: {esc_sup, esc_med, esc_fund, renda_media, pobres_pct, idade_mediana, urbanizacao, pop, eleitores} | null}]}` — arrays compactos, não objetos por voto. Tasks 3–9 consomem este shape exato.

- [ ] **Step 1: Write the failing tests**

```python
def test_fato_sums_match_fato_voto(tmp_path):
    # soma votos do JSON == soma fato_voto p/ (ano,turno,cargo)
def test_join_miss_keeps_votes_no_demo(tmp_path):
    # município sem par no Censo -> demo null, votos intactos
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/etl/test_fato.py -v`
Expected: FAIL.

- [ ] **Step 3: Implement `build_fato` em `etl/build_fato.py`**

Join por IBGE7; miss → `demo: null` (votos intactos); órfãos de join acima de 0,1% → `ValueError` (fail-closed); registra ingest no manifest (fonte dupla TSE+IBGE). v1 gera: presidente 2014/2018/2022 T1+T2 + governador 2022 T1+T2.

- [ ] **Step 4: Run tests**

Run: `pytest tests/etl/ -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add etl/build_fato.py tests/etl/test_fato.py
git commit -m "feat: add municipal fact join with demo miss tolerance"
```

### Task 3: motor.ts — perfil

**Files:**
- Create: `web/lib/motor.ts`
- Test: `web/__tests__/motor.test.ts`

**Interfaces:**
- Consumes: shape `fato_*.json` da Task 2 (tipos `MunRow`, `VarDemo` definidos aqui).
- Produces: `perfilOndeVenceu(rows: MunRow[], cond: {candidatoId: string}) -> {nMun: number, nEleitores: number, medias: Record<VarDemo, number>, vsBrasil: Record<VarDemo, number>}` (médias ponderadas por eleitores; demo null excluída com contagem) — Tasks 7–9 consomem.

- [ ] **Step 1: Write the failing tests**

```ts
perfilOndeVenceu(sintético 3 mun, vencedor A em 2) // nMun 2, média ponderada exata, vsBrasil exato
perfilOndeVenceu(rowsComDemoNull) // nulls excluídos, nEleitores só dos válidos
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npm test -- --run -t perfilOndeVenceu`
Expected: FAIL (módulo ausente).

- [ ] **Step 3: Implement `perfilOndeVenceu` + tipos em `web/lib/motor.ts`**

`VarDemo = "esc_sup"|"esc_med"|"esc_fund"|"renda_media"|"pobres_pct"|"idade_mediana"|"urbanizacao"|"pop"|"eleitores"`. Vencedor = argmax de `votos` na ordem de `candidatos`.

- [ ] **Step 4: Run tests**

Run: `cd web && npm test -- --run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/lib/motor.ts web/__tests__/motor.test.ts
git commit -m "feat: add motor profile aggregation"
```

### Task 4: motor.ts — correlações

**Files:**
- Modify: `web/lib/motor.ts`
- Test: `web/__tests__/motor.test.ts` (estender)

**Interfaces:**
- Consumes: tipos da Task 3.
- Produces: `correlacao(xs: number[], ys: number[], metodo: "pearson"|"spearman") -> {r: number, n: number} | null` (null quando n < 30); `quintis(xs, ys) -> {faixa: string, mediaY: number, n: number}[]` (5 faixas) — Tasks 7–9 consomem.

- [ ] **Step 1: Write the failing tests**

```ts
correlacao([1,2,3],[2,4,6],"pearson") // {r: 1, n: 3}? NÃO — n<30 deve suprimir: usar dataset sintético n=40 p/ r≈1 e r≈0
n_below_floor_suppressed // 20 pontos perfeitos -> null
outlier_reports_both_r // outlier inverte pearson; ambos reportados (sem nomear aqui — front nomeia)
quintis divide em 5 faixas com n somando total
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npm test -- --run -t "correlacao or quintis or suppressed or outlier"`
Expected: FAIL.

- [ ] **Step 3: Implement `correlacao` + `quintis` em `web/lib/motor.ts`**

Pearson fórmula direta; Spearman por ranks médios (empates com rank médio); pares com null/NaN excluídos antes de contar n; `n < 30 → null`.

- [ ] **Step 4: Run tests**

Run: `cd web && npm test -- --run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/lib/motor.ts web/__tests__/motor.test.ts
git commit -m "feat: add motor correlations with n-floor"
```

### Task 5: motor.ts — estratos (porquê)

**Files:**
- Modify: `web/lib/motor.ts`
- Test: `web/__tests__/motor.test.ts` (estender)

**Interfaces:**
- Consumes: `correlacao` da Task 4.
- Produces: `estratificar(rows: MunRow[], varX: VarDemo, varY: {candidatoId: string} | VarDemo, por: "regiao" | "faixa_renda") -> {estrato: string, r: number | null, n: number}[]` + `conclusaoLeiga(global: number|null, estratos) -> "sustentado"|"misto"|"nao_sustentado"` (regra: sinal consistente e |r|≥0,3 em maioria dos estratos com n≥30 → sustentado; sinais opostos → misto; resto → nao_sustentado) — Tasks 7–8 consomem.

- [ ] **Step 1: Write the failing tests**

```ts
estratificar(sintético, efeito some num estrato) // r por estrato exatos
conclusaoLeiga(...) // 3 casos -> 3 rótulos
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npm test -- --run -t "estratificar or conclusao"`
Expected: FAIL.

- [ ] **Step 3: Implement em `web/lib/motor.ts`**

Região derivada do prefixo UF (N/NE/CO/SE/S por mapa UF→região); faixa_renda por tercis de `renda_media`. Reusa `correlacao` (piso n≥30 herdado).

- [ ] **Step 4: Run tests**

Run: `cd web && npm test -- --run && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/lib/motor.ts web/__tests__/motor.test.ts
git commit -m "feat: add motor strata and lay conclusion"
```

### Task 6: Mapa canvas clicável

**Files:**
- Create: `web/components/MapaBrasil.tsx`
- Create: `web/lib/malha.ts` (loader TopoJSON → paths)
- Test: `web/__tests__/mapa.test.tsx`

**Interfaces:**
- Consumes: `web/public/data/malha_municipios.topojson` (ETL/scripts: malha IBGE simplificada — gerar via script `scripts/malha.py` com `simplification` agressiva; se ausente, componente recebe `malhaUrl` prop e falha fechado).
- Produces: `<MapaBrasil malhaUrl nivel onSelectIbge>` — clique retorna IBGE7; sem canvas/Path2D → fallback em lista de UFs + link TSE. Tasks 7–8 consomem `onSelectIbge(ibge7: string)`.

- [ ] **Step 1: Write the failing tests**

```tsx
no_canvas_fallback_list // sem Path2D -> lista + link resultados.tse.jus.br, sem <canvas>
onSelectIbge retorna "3550308" ao clicar (mock de hit-test)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npm test -- --run -t "mapa or fallback"`
Expected: FAIL.

- [ ] **Step 3: Implement `MapaBrasil` + `malha.ts` + `scripts/malha.py`**

Canvas + Path2D por município (cor por vencedor via prop `cores: Record<ibge7,string>`); zoom UF→município por bounding box; hit-test por ponto-em-polígono simplificado (ou índice espacial simples); exterior como botão separado "Exterior". Guard `typeof Path2D === "function"` (padrão do reference).

- [ ] **Step 4: Run tests + build**

Run: `cd web && npm test -- --run && npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/components/MapaBrasil.tsx web/lib/malha.ts scripts/malha.py web/__tests__/mapa.test.tsx
git commit -m "feat: add clickable canvas map with fallback"
```

### Task 7: Painel da região

**Files:**
- Create: `web/app/regiao/[ibge]/page.tsx` (ou `web/components/PainelRegiao.tsx` + rota)
- Test: `web/__tests__/regiao.test.tsx`

**Interfaces:**
- Consumes: `perfilOndeVenceu`/`correlacao` (Tasks 3–4), `onSelectIbge` (Task 6), `SourceBadge`+selo ecológico (existentes), fato JSONs (Task 2).
- Produces: painel com vencedores/margem/participação/perfil/ações Comparar–Por quê?–Verificar; teste pixel-mentiroso.

- [ ] **Step 1: Write the failing tests**

```tsx
painel mostra vencedor + margem + perfil com selo "dado de município, não de pessoa"
pixel_mentiroso: resposta sem fonte+hash visíveis quebra (assert nos seletores de badge)
demo null -> seção perfil em "sem dado oficial", votos intactos
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npm test -- --run -t "regiao or mentiroso"`
Expected: FAIL.

- [ ] **Step 3: Implement painel**

Vencedor por (ano,turno,cargo) via argmax; margem = (v1-v2)/total; participação = total/eleitores; perfil via `perfilOndeVenceu` restrito ao município + vsBrasil; ações linkam `/analisar`, `/explorar?foco=<ibge>`, `/verificar?regiao=<ibge>`.

- [ ] **Step 4: Run tests + build**

Run: `cd web && npm test -- --run && npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/app/regiao/ web/__tests__/regiao.test.tsx
git commit -m "feat: add region panel with eco seal"
```

### Task 8: /explorar em blocos

**Files:**
- Create: `web/app/explorar/page.tsx`
- Test: `web/__tests__/explorar.test.tsx`

**Interfaces:**
- Consumes: motor completo (Tasks 3–5), fato JSONs, `MapaBrasil` (Task 6, opcional p/ `onde`).
- Produces: blocos quem/onde/cruzar/ver computando client-side; combinação sem cobertura → "sem dado oficial"; fora dos blocos → sugestão (sem texto livre).

- [ ] **Step 1: Write the failing tests**

```tsx
combinação válida (Lula × onde venceu × escolaridade × dispersão) renderiza r + n + selo
combinação sem cobertura -> "sem dado oficial", sem tela branca
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npm test -- --run -t explorar`
Expected: FAIL.

- [ ] **Step 3: Implement `/explorar`**

Blocos como selects dependentes (onde: lista de condições — venceu/2º lugar/margem>/participação>; cruzar: VarDemo + candidato; ver: mapa/dispersão/ranking/tabela). Estado → URL compartilhável (`?q=` + hash). Teto: no máx. 3 visões simultâneas; debounce em inputs de texto (busca candidato).

- [ ] **Step 4: Run tests + build**

Run: `cd web && npm test -- --run && npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/app/explorar/ web/__tests__/explorar.test.tsx
git commit -m "feat: add block-based explorer"
```

### Task 9: Biblioteca curada (30 perguntas)

**Files:**
- Create: `web/data/perguntas.json` (30 entries `{slug, titulo, blocos: {quem, onde, cruzar, ver}, texto_metodo}`)
- Create: `web/app/perguntas/[slug]/page.tsx` (gera estático no build via motor)
- Test: `web/__tests__/curada.test.ts`

**Interfaces:**
- Consumes: motor (Tasks 3–5) executado em build (`generateStaticParams` + cálculo).
- Produces: 30 rotas estáticas, cada uma resposta completa com fonte+hash; cards na home.

- [ ] **Step 1: Write the failing tests**

```ts
todas as 30 slugs computam sem throw sobre os fatos v1
cada resposta tem fonte+hash (pixel-mentiroso p/ curada)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npm test -- --run -t curada`
Expected: FAIL (arquivo/rotas ausentes).

- [ ] **Step 3: Implement `perguntas.json` (30 perguntas: perfil-onde-venceu p/ principais candidatos, estudo×voto, pobreza×voto, idade, urbanização, abstenção, margens, exterior, evolução) + página que computa via motor no build**

Texto-método em pt-BR por pergunta (2-3 frases fixas + números dinâmicos).

- [ ] **Step 4: Run tests + build**

Run: `cd web && npm test -- --run && npm run build`
Expected: PASS (build gera as 30 rotas).

- [ ] **Step 5: Commit**

```bash
git add web/data/perguntas.json web/app/perguntas/ web/__tests__/curada.test.ts
git commit -m "feat: add curated question library"
```

### Task 10: Verificar afirmações

**Files:**
- Create: `web/data/checks.json` (`{slug, frase, computacao: {tipo, params}, fontes}`)
- Create: `web/app/verificar/[slug]/page.tsx`
- Test: `web/__tests__/verificar.test.ts`

**Interfaces:**
- Consumes: motor + fatos; tipos de computação: `vencedor_regiao`, `comparar_medias`, `correlacao_sinal`, `serie_temporal`, `soma_condicional` (cada um com regra de veredito).
- Produces: veredito `sustentado|enganoso|falso` + 3 números + método + fonte + hash; slug desconhecido → sugestão (nunca veredito).

- [ ] **Step 1: Write the failing tests**

```ts
3 checks sintéticos -> 1 veredito de cada cor, cada um com 3 números + hash
unknown_claim_suggests // slug fora da lib -> sugestão, sem veredito
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npm test -- --run -t "verificar or unknown_claim"`
Expected: FAIL.

- [ ] **Step 3: Implement `checks.json` (12 afirmações iniciais: regionais, abstenção, viradas, margens) + motor de veredito + página**

Regra: `sustentado` (números confirmam sem ressalva), `enganoso` (verdade parcial que induz erro — explicar o engano), `falso` (números contradizem). Link `/verificar?regiao=` do painel resolve p/ checks daquela região ou sugestão.

- [ ] **Step 4: Run tests + build**

Run: `cd web && npm test -- --run && npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/data/checks.json web/app/verificar/ web/__tests__/verificar.test.ts
git commit -m "feat: add claim verification with tricolor verdicts"
```

### Task 11: Metodologia + auditoria estendida + CI

**Files:**
- Create: `web/app/metodologia-motor/page.tsx` (ou estender metodologia)
- Modify: `web/app/auditoria/page.tsx` (lista Censo), `.github/workflows/ci.yml` (seed fato + motor tests)
- Test: full verification (sem teste novo — cobre tudo)

**Interfaces:**
- Consumes: tudo (Tasks 1–10).
- Produces: CI verde fim-a-fim; metodologia documenta piso n≥30, falácia, tricolor; auditoria lista ingestões Censo + fatos.

- [ ] **Step 1: Write the failing test (front)**

```ts
// web/__tests__/metodologia.test.ts
it("documents n>=30 floor and eco fallacy", ...) // asset texto presente na página
```

- [ ] **Step 2: Run test to verify current state**

Run: `cd web && npm test -- --run -t metodologia && pytest tests/ -q`
Expected: FAIL (página/linha ausente) + pytest PASS.

- [ ] **Step 3: Implement metodologia-motor + auditoria Censo + CI (seed Censo fixture + fato sintético antes dos testes web)**

CI: após seed existente, rodar `build_fato` sobre fixture (fatos sintéticos pequenos) para os testes de motor/painel lerem.

- [ ] **Step 4: Run full verification**

Run: `pytest tests/ -q && cd web && npm test -- --run && npm run build`
Expected: tudo PASS + build com rotas `/`, `/explorar`, `/perguntas/*`, `/verificar/*`, `/regiao/*`.

- [ ] **Step 5: Commit**

```bash
git add web/app/metodologia-motor/ web/app/auditoria/ .github/workflows/ci.yml
git commit -m "feat: add motor methodology, extended audit and ci"
```

## Self-Review (feita inline)

1. **Cobertura:** spec §3→T6/T7; §4→T3/T4/T5/T10; §5→T1/T2; §6→T2/T6/T8/T9; §7→T7/T10; §8→T11 + testes por task; 30 cards→T9; tricolor→T10.
2. **Consistência:** `MunRow`/`VarDemo` definidos T3, reusados T4–T10; fato shape T2 consumido por T3/T7/T8; `?q=`+hash T8; vereditos T10; `ETL_VERSION` segue Task 4 do plano anterior.
3. **Review Focus:** 5 linhas com teste na task dona (T2, T4 ×2, T6, T10).
4. **Proporção:** decisões travadas (shapes, assinaturas, regras de veredito, piso n≥30); corpos com o implementador.
