# Dashboard cruzar investigação — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Evoluir `/explorar` com seção "por quê?" + comparar pleitos 2018 vs 2022 + spike alfabetização sem chute.

**Architecture:** Client-side sobre 2 fatos auditados; ETL só no seed fixture + spike T3; nenhuma fórmula do motor muda.

**Tech Stack:** Next 14.2.35, React 18.3.1, vitest 1.6.1, pytest 8, pandas/duckdb (seed).

**Spec:** `docs/superpowers/specs/2026-10-13-dashboard-cruzar-design.md`

## Global Constraints

- Fail-closed: sem hash auditado → `SEM_DADO` + `MOTIVO_SEM_HASH`, nunca número sem prova (`web/lib/textos.ts`).
- Piso `n >= 30`: `correlacao() === null` e `quintis() === []` → nota supressão; front não recheca piso (`web/lib/motor.ts:186`).
- Pearson + Spearman sempre juntos; divergência denuncia outlier (contrato `lib/motor.ts:252-270`).
- ECO_SEAL em seção com ponto municipal: "cada ponto é um município, nunca uma pessoa" (`web/components/PainelRegiao.tsx`).
- Alfabetização ≠ escolaridade: sem mapeamento V-code seguro, `esc_*` seguem nulos + teste trava bloqueio (padrão T3).
- Orçamento: `web/public/data <15MB`, `*.topojson <3MB` (`tests/ci/test_ci_config.py`).
- Commits pequenos, TDD, sem refator fora do escopo.

## Review Focus

- Comparador com só 1 fato auditado rende `SEM_DADO` comparativo, nunca r solitário como comparação.
- `?fatoA=&fatoB=` adulterado rende default honesto, nunca crash ou fato fantasma.
- Estrato com `n < 30` rende `r: null`, nunca zero.
- Veredito "sustentado" exige maioria estrita de fortes + checagem de sinal oposto do global (regra `conclusaoLeiga`).
- Share URL comparativa restaura o mesmo estado (round-trip).

---

### Task 1: Seção "por quê?" no /explorar (estratos + veredito leigo)

**Files:**
- Modify: `web/components/Explorar.tsx`
- Test: `web/__tests__/explorar-porque.test.tsx`
- Reuse: `web/lib/motor.ts:421-518` (`estratificar`, `conclusaoLeiga`, `LIMIAR_EFEITO_R`, `PISO_CORRELACAO_N`)

**Interfaces:**
- Consumes: `filtradas: MunRow[]`, `sel.cruzar: VarDemo`, `idxQuem: number`, `ordem: {id:string}[]`, `coberto: boolean`
- Produces: seção `aria-label="Por quê?"` com tabelas `regiao` + `faixa_renda` (`Estrato[]`) + `veredito: ConclusaoLeiga` + nota "correlação não implica causa"

- [ ] **Step 1: Write failing test `web/__tests__/explorar-porque.test.tsx`**

```tsx
// com fato fixture 30+ municípios: estratos regiao rendem tabela + veredito "sustentado|misto|nao_sustentado"
// com n<30: rende "sem dado oficial — municípios insuficientes (piso n ≥ 30)"
// sem hash: rende SEM_DADO + MOTIVO_SEM_HASH
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run __tests__/explorar-porque.test.tsx`
Expected: FAIL with "Cannot find module" / "TestingLibraryElementError: Unable to find ... Por quê?"

- [ ] **Step 3: Implement seção `Por quê?` em `web/components/Explorar.tsx`**

Chamar `estratificar(filtradas, sel.cruzar, {candidatoId: sel.quem, candidatos: ordem}, "regiao")` e `"faixa_renda"`, `correlacao(xs, ys, "pearson")` como global, `conclusaoLeiga(global?.r ?? null, [...regiao, ...renda])`. Renderizar 2 tabelas (`estrato | r | n`, `r: null` → `SEM_DADO`) + `<p>veredito: {sustentado|misto|não sustentado} — correlação não implica causa</p>` + `ECO_SEAL`. Gatear por `coberto` (paridade Dispersão). Sem mudar motor.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npx vitest run __tests__/explorar-porque.test.tsx __tests__/explorar.test.tsx __tests__/motor.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/components/Explorar.tsx web/__tests__/explorar-porque.test.tsx
git commit -m "feat(explorar): secao por-que com estratos regiao/renda + veredito leigo"
```

### Task 2: Comparar pleitos 2018 vs 2022 lado a lado (+ fixture 2018)

**Files:**
- Modify: `scripts/seed_fixture_data.py`
- Modify: `web/app/explorar/page.tsx`
- Modify: `web/components/Explorar.tsx` (modo comparar + share `fatoA/fatoB`)
- Test: `web/__tests__/explorar-comparar.test.tsx`
- Reuse: `web/lib/regiao.ts:55-63` (`listarFatosMunicipais`), `web/lib/motor.ts:252-270` (`correlacao`)

**Interfaces:**
- Consumes: `fatoA: FatoRegiao | null`, `fatoB: FatoRegiao | null`, `sealA/sealB` via `getSealParaDataset(manifest, dataset)`
- Produces: `?fatoA=fato_2018_1_presidente&fatoB=fato_2022_1_presidente&hash=` round-trip; seção `aria-label="Comparar pleitos"` com `rA, rB, Δr = rB - rA`

- [ ] **Step 1: Write failing test `web/__tests__/explorar-comparar.test.tsx`**

```tsx
// com 2 fatos: rende "r 2018 = … · r 2022 = … · Δr = …"
// com 1 fato: rende "sem dado oficial — segundo pleito sem fato auditado"
// query ?fatoA=xxx&fatoB=yyy hidrata seletores (round-trip via buildExplorarShareUrl)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run __tests__/explorar-comparar.test.tsx`
Expected: FAIL (seção "Comparar pleitos" não existe)

- [ ] **Step 3: Seed fixture 2018 em `scripts/seed_fixture_data.py`**

Duplicar caminho do fato 2022 para `fato_2018_1_presidente` com mesmos 2 IBGEs mas shares distintos (ex: inverter votos dos 2 candidatos) para Δr visível; registrar 2ª entry `fato_municipal` `fixture:true` + `register_served_artifacts` cobrindo ambos. Rodar `python scripts/seed_fixture_data.py --force` e confirmar `web/public/data/fato_2018_1_presidente.json` + manifest com 2 fatos.

- [ ] **Step 4: Implement comparador em `web/app/explorar/page.tsx` + `web/components/Explorar.tsx`**

`page.tsx`: ler `?fatoA=&fatoB=` (fallback: A=`fato_2018_1_presidente` se auditado senão 1º da lista, B=`fato_2022_1_presidente`), `carregarSeloEFato` × 2 com mesma guarda `geracaoRef/ocupadoRef`, rotação compara `{dsA,dsB,seal}`. `Explorar.tsx`: props `fatoA/fatoB`, computar `corrA/corrB` com mesmo `aplicarOnde` + mesmo `cruzar`; render `rA, rB, Δr.toFixed(3)` + 2 mini-tabelas quintis; sem 2º fato auditado → `SEM_DADO comparativo`. Estender `buildExplorarShareUrl`/`parseExplorarQuery` com `fatoA/fatoB` (b64 `q` existente + params planos, paridade `?foco=`). Dropdown com `listarFatosMunicipais(manifest)`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd web && npx vitest run __tests__/explorar-comparar.test.tsx __tests__/explorar-porque.test.tsx __tests__/explorar.test.tsx`
Expected: PASS

- [ ] **Step 6: Run full gates**

Run: `SAD_SEM_REDE=1 python -m pytest tests/ -q`
Run: `cd web && npm test -- --run`
Run: `cd web && npm run build`
Expected: PASS (227+ pytest base, 586+ vitest base, build ok)

- [ ] **Step 7: Commit**

```bash
git add scripts/seed_fixture_data.py web/app/explorar/page.tsx web/components/Explorar.tsx web/__tests__/explorar-comparar.test.tsx web/public/data/fato_2018_1_presidente.json
git commit -m "feat(explorar): comparar pleitos 2018 vs 2022 lado a lado com fixture"
```

### Task 3: Spike T3 alfabetização 15+ (mapear ou travar sem chute)

**Files:**
- Create: `tests/etl/test_alfabetizacao_spike.py`
- Create (só se mapeamento seguro): `etl/alfabetizacao.py`
- Modify (só se seguro): `etl/censo.py`, `etl/build_fato.py:88-97` (`DEMO_FIELDS`), `web/lib/motor.ts:34-55` (`VAR_DEMO`)

**Interfaces:**
- Consumes: zip `Agregados_por_municipios_alfabetizacao_BR.zip` (362 V-codes `V00644…V01005`), dicionário `.xlsx` (3407 linhas, Tema Alfabetização)
- Produces: ou `taxa_alf_15mais: float 0..1` auditada por município, ou teste travando bloqueio (padrão T3)

- [ ] **Step 1: Write spike test `tests/etl/test_alfabetizacao_spike.py`**

```python
def test_alfabetizacao_numerador_denominador_mapeados():
    # afirma V-codes exatos do numerador (15+ sabe ler) e denominador (15+ total)
    # com evidência do dicionário; se ambíguo, xfails como bloqueio documentado
```

- [ ] **Step 2: Run test offline to verify current state**

Run: `SAD_SEM_REDE=1 python -m pytest tests/etl/test_alfabetizacao_spike.py -v`
Expected: PASS como bloqueio (sem chute) OU FAIL apontando mapeamento — o resultado decide os steps seguintes; sem mapeamento seguro, parar aqui (sem `etl/*.py` produtivo mudado).

- [ ] **Step 3 (condicional): Implement `etl/alfabetizacao.py` + `DEMO_FIELDS` + `VAR_DEMO` só com mapeamento provado**

`normalize_alfabetizacao(df) -> {ibge7: taxa_alf_15mais}` com `Float64` nulo em dúvida (nunca 0); join no `build_fato` como `demo.alfabetizacao`; `VAR_DEMO += "alfabetizacao"`; default `cruzar` migra para ela se cobertura > `renda_media`.

- [ ] **Step 4: Run gates**

Run: `SAD_SEM_REDE=1 python -m pytest tests/etl/test_alfabetizacao_spike.py tests/etl/test_escolaridade_bloqueada.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/etl/test_alfabetizacao_spike.py etl/alfabetizacao.py
git commit -m "feat(etl): alfabetizacao 15+ auditada ou bloqueio T3 travado"
```
