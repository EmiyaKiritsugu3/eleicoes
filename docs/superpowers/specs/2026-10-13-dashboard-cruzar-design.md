# Dashboard cruzar voto x indicadores — Design v1 (investigação/pesquisa)

> Override explícito do usuário em 2026-10-13: suspender brainstorming na Seção 1/5 e ir para audit → plano → PR. Este spec congela a Seção 1 aprovada + decisões do audit.

**Objetivo:** Evoluir `/explorar` para cruzar voto municipal com indicadores socioeconômicos auditados e comparar pleitos, para pesquisa (não cidadão leigo, não aula).

**Uso:** Jornalista/pesquisador testa hipótese (ex: alfabetização x voto 2018 vs 2022) com r Pearson+Spearman, quintis, estratos, export reproduzível com hash.

**Fora do v1:** IDHM/PIB/IFDM (1 fonte por vez depois), mapa de virada por município, matriz NxN, escolaridade (bloqueio T3 mantido — alfabetização ≠ escolaridade).

## Arquitetura

- Sem backend novo. ETL offline-first gera `fato_*.json`; Next lê `/data/*.json`, computa em `lib/motor.ts` client-side.
- 3 entregas isoladas, cada uma shippable:
  1. **Por quê?** — expor `estratificar()` + `conclusaoLeiga()` (já testados, só Curada usa) no `/explorar`.
  2. **Comparar pleitos** — carregar 2 fatos (`fato_2018_1_presidente` + `fato_2022_1_presidente`), mesmo `cruzar`, r lado a lado + Δr. Sem join municipal na v1.
  3. **Alfabetização spike T3** — se V-codes 15+ mapeáveis sem chute, vira nova `VarDemo`; senão, teste fail-closed documentado.

## Componentes

- `web/components/Explorar.tsx`: + seção `Porquê` (tabela estratos regiao + faixa_renda + veredito leigo com aviso "correlação ≠ causa"), + modo `comparar` (seletor pleito A/B via `listarFatosMunicipais`, paridade `/regiao`), + default `cruzar` para var com cobertura.
- `web/app/explorar/page.tsx`: carrega 2 fatos (mount + rotação com `{datasetA,datasetB,seal}`), `SEM_DADO` honesto sem 2º fato.
- `web/lib/motor.ts`: sem mudança de fórmula (só reexport se preciso). `VAR_DEMO` só cresce se spike alfabetização provar mapeamento.
- `scripts/seed_fixture_data.py`: + fixture 2018 (2 municípios, shares distintos de 2022 para Δr visível), manifest com 2 fatos `fixture:true`.
- `etl/alfabetizacao.py` (spike): só se mapeamento V-code seguro; senão, só teste em `tests/etl/test_alfabetizacao_spike.py` travando bloqueio.

## Data flow

1. Seed/ETL → `web/public/data/fato_2018_1_presidente.json` + `fato_2022_1_presidente.json` + `manifest.json` (2 entries `fato_municipal` + artifacts).
2. `/explorar?q=&fatoA=&fatoB=` → `derivarDatasetESelo` × 2 → `fetchJson` × 2 → `aplicarOnde` por fato → `correlacao`/`quintis` por fato → `estratificar` no fato A (ou selecionado) → render lado a lado.
3. Share: `?q=` existente + `&fatoA=&fatoB=&hash=` (hash do manifest, paridade `buildExplorarShareUrl`).

## Erro/honestidade (fail-closed)

- Sem 2º fato auditado → seção comparador rende `SEM_DADO — segundo pleito sem fato auditado`, nunca número solitário como comparação.
- `n < 30` → `correlacao() === null` + `quintis() === []` → nota "municípios insuficientes (piso n ≥ 30)" (contrato existente, sem rechecagem no front).
- `vereditoTemProva(seal) === false` → display suprimido, `MOTIVO_SEM_HASH` (paridade Explorar/Curada/Analisar).
- Alfabetização sem mapeamento seguro → `demo.alfabetizacao = null` + teste trava shape, UI mostra `SEM_DADO` (nunca taxa inventada).
- ECO_SEAL em toda seção com ponto municipal: "cada ponto é um município, nunca uma pessoa".

## Testes

- `web/__tests__/explorar-porque.test.tsx`: estratos regiao/faixa_renda rendem tabela + veredito; `n<30` → supressão; `segundo` sem perfil mantido.
- `web/__tests__/explorar-comparar.test.tsx`: com 2 fatos fixture, rA/rB/Δr rendem; com 1 fato, comparador rende `SEM_DADO`; share URL round-trip `fatoA/fatoB`.
- `tests/etl/test_alfabetizacao_spike.py`: se mapeamento seguro, testa taxa 15+ determinística; senão, trava bloqueio (padrão T3, como `test_escolaridade_bloqueada.py`).
- Portas: `SAD_SEM_REDE=1 python -m pytest tests/ -q` (227 passed base), `cd web && npm test -- --run` (586 base), `npm run build`.
