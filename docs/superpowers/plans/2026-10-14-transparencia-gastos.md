# Transparência de Gastos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expor série auditável 2014–2024 de gastos de governo (SICONFI) + financiamento de campanha (TSE) + detalhe federal opcional (CGU) na rota `/transparencia`.

**Architecture:** Novos normalizadores isolados (`entes`, `siconfi`, `prestacao`, `transparencia`) reusando contratos existentes (manifest SHA256, stage-then-promote, gates fail-closed); `build_marts` ganha 3 tabelas + 3 JSONs; front novo consome JSONs com selo existente.

**Tech Stack:** Python >=3.10, pandas>=2, duckdb>=1, pyarrow>=14; Next 14.2.35 + React 18.3.1 + vitest 1.6.1; pytest>=8.

**Spec:** `docs/superpowers/specs/2026-10-14-transparencia-gastos-design.md`

## Global Constraints

- Custo zero: só APIs gratuitas; chave CGU via env `TRANSPARENCIA_API_KEY`, nunca no repo.
- Só dado oficial verificável: ausente exibe "sem dado oficial", nunca 0 ou estimativa.
- Manifest: `source_url` truthy + `sha256` 64-hex (`etl/manifest.py:_validate_entry`); `etl_version` = `1.1.0`.
- Offline-first: sem `--fetch`/flags o run usa arquivos locais; sem chave CGU o build base segue com `UserWarning`.
- Fail-closed: valor monetário negativo/não-finito reprova; ente sem match IBGE vira `""` + aviso, nunca chute.
- Front: números só com selo `isOfficialDisplay/getSealState` (`web/lib/data.ts`); fixture nunca oficial.

## Review Focus

- DCA do ano corrente ainda não publicado (lag 6–12 meses) deve exibir "sem dado oficial", não zerar a série.
- Valor monetário como string pt-BR ("1.234,56") ou negativo deve reprovar no gate, não somar.
- Ente SICONFI sem correspondente em `capitais_ibge.json`/UF deve virar órfão contabilizado, não entrar no fato.
- CGU sem chave, com 429/5xx ou paginação incompleta deve pular com aviso e manter base SICONFI+TSE intacta.
- TSE prestação com drift de header (coluna renomeada) deve ir para quarentena, nunca quebrar o build.

---

## File Structure

- `etl/entes.py` (novo): `load_entes() -> pd.DataFrame[ente_id, esfera, uf, cod_ibge, nome]` — União + 27 UFs + 27 capitais.
- `etl/siconfi.py` (novo): `normalize_siconfi(df) -> pd.DataFrame[ano, ente_id, esfera, receita_total, despesa_empenhada, despesa_liquidada, despesa_paga]` + `SICONFI_CANONICAL` + aliases.
- `etl/prestacao.py` (novo): `normalize_prestacao(df) -> pd.DataFrame[ano, cargo, candidato_id, receita_total, despesa_total, fefc, fundo_partidario]`.
- `etl/transparencia.py` (novo): `normalize_cgu(records: list[dict]) -> pd.DataFrame[ano, orgao, funcao, valor]`.
- `etl/sources.py` (mod): + `SICONFI_DATASETS`, `PRESTACAO_DATASETS`, `CGU_META`.
- `etl/fetch.py` (mod): `ALLOWED_HOSTS` + 3 hosts.
- `etl/build_marts.py` (mod): DuckDB `dim_ente/fato_gov/fato_transp_federal` + preencher `fato_fin` + JSONs `gov_por_ente.json/gov_serie.json/fin_por_candidato.json`.
- `etl/validate.py` (mod): `check_monetario(df, cols) -> list[str]` + gate órfãos fin.
- `etl/__main__.py` (mod): flags `--siconfi-json`, `--prestacao-csv`, `--with-transparencia`.
- `scripts/seed_fixture_data.py` (mod): fixtures gov/fin mínimas.
- `web/lib/data.ts` (mod): tipos `GovRow/FinCampRow` + `isAnoEleitoral(ano)` + `govSerie(rows, filtros)`.
- `web/app/transparencia/page.tsx` + `web/components/Transparencia.tsx` (novos): série 2014–2024 com marcador eleitoral.
- Tests: `tests/etl/test_entes.py`, `test_siconfi.py`, `test_prestacao.py`, `test_transparencia.py`, `test_gov_marts.py`; `web/__tests__/transparencia.test.ts`.

### Task 1: dim_ente foundation

**Files:**
- Create: `etl/entes.py`
- Test: `tests/etl/test_entes.py`

**Interfaces:**
- Consumes: `etl/capitais_ibge.json` (lista de 27 strings IBGE7)
- Produces: `load_entes() -> pd.DataFrame` com colunas `["ente_id","esfera","uf","cod_ibge","nome"]`; União = `ente_id "UNIAO", esfera "uniao", uf "", cod_ibge ""`; estado = `ente_id "UF-SP", esfera "estado"`; capital = `ente_id "MUN-3550308", esfera "municipio"`. Usado pelas Tasks 2/5 para joins.

- [ ] **Step 1: Write the failing test**

```python
def test_load_entes_tem_uniao_27ufs_27capitais():
    df = load_entes()
    assert len(df) == 1 + 27 + 27
    assert "UNIAO" in set(df["ente_id"])
    assert set(df.columns) == {"ente_id", "esfera", "uf", "cod_ibge", "nome"}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/etl/test_entes.py::test_load_entes_tem_uniao_27ufs_27capitais -v`
Expected: FAIL with "No module named 'etl.entes'" / "function not defined"

- [ ] **Step 3: Implement `load_entes() -> pd.DataFrame` in `etl/entes.py`**

Ler `capitais_ibge.json` com o mesmo fail-closed de `build_marts._load_capitais` (ausente/inválido levanta); UFs fixas das 27 siglas; nomes de capitais podem ser `CAPITAL-{ibge7}` no V1 (nomes bonitos fase 2).

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/etl/test_entes.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add etl/entes.py tests/etl/test_entes.py
git commit -m "feat(entes): dim_ente uniao+ufs+capitais"
```

### Task 2: SICONFI DCA → fato_gov

**Files:**
- Create: `etl/siconfi.py`
- Test: `tests/etl/test_siconfi.py`

**Interfaces:**
- Consumes: `etl/entes.py:load_entes` (só para validar `ente_id`; sem match vira órfão, nunca cria ente)
- Produces: `SICONFI_CANONICAL: list[str]` = `["ano","ente_id","esfera","receita_total","despesa_empenhada","despesa_liquidada","despesa_paga"]`; `normalize_siconfi(df: pd.DataFrame) -> pd.DataFrame` (canônico, monetários como float); `orfãos` = linhas com `ente_id` fora de `load_entes()` descartadas com `UserWarning`. Usado pela Task 5.

- [ ] **Step 1: Write the failing test**

```python
def test_normalize_siconfi_alias_e_orfao():
    df = normalize_siconfi(pd.DataFrame([
        {"ANO": "2022", "ENTE": "UNIAO", "RECEITA": "100.50", "EMPENHADO": "80", "LIQUIDADO": "70", "PAGO": "60"},
        {"ANO": "2022", "ENTE": "XX-INVALIDO", "RECEITA": "1", "EMPENHADO": "1", "LIQUIDADO": "1", "PAGO": "1"},
    ]))
    assert len(df) == 1
    assert float(df.iloc[0]["despesa_empenhada"]) == 80.0
    assert int(df.iloc[0]["ano"]) == 2022
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/etl/test_siconfi.py::test_normalize_siconfi_alias_e_orfao -v`
Expected: FAIL with "function not defined"

- [ ] **Step 3: Implement `normalize_siconfi(df: pd.DataFrame) -> pd.DataFrame` in `etl/siconfi.py`**

Alias-mapping case-insensitive (espelhar `etl/normalize.py:_pick_column`): ano=`ANO/ANO_EXERCICIO`, ente=`ENTE/ENTE_ID/COD_IBGE`, receita=`RECEITA/RECEITA_TOTAL`, empenhado=`EMPENHADO/DESPESA_EMPENHADA`, liquidado=`LIQUIDADO/DESPESA_LIQUIDADA`, pago=`PAGO/DESPESA_PAGA`. Monetário via `pd.to_numeric` (ponto decimal; vírgula pt-BR `1.234,56` → NaN → linha descartada com aviso, nunca coagida). `ente_id` fora de `load_entes()` → descarta + `UserWarning` com contagem.

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/etl/test_siconfi.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add etl/siconfi.py tests/etl/test_siconfi.py
git commit -m "feat(siconfi): normalize DCA para fato_gov"
```

### Task 3: TSE prestação → fato_fin

**Files:**
- Create: `etl/prestacao.py`
- Test: `tests/etl/test_prestacao.py`

**Interfaces:**
- Consumes: nada (puro); saída casa com `dim_candidato.candidato_id` na Task 5 (órfãos >0,1% reprovam lá)
- Produces: `normalize_prestacao(df: pd.DataFrame) -> pd.DataFrame` com `["ano","cargo","candidato_id","receita_total","despesa_total","fefc","fundo_partidario"]`; `cargo` upper; ausentes de `fefc/fundo_partidario` viram `0.0` (coluna inexistente ≠ dado faltante). Usado pela Task 5.

- [ ] **Step 1: Write the failing test**

```python
def test_normalize_prestacao_basico():
    df = normalize_prestacao(pd.DataFrame([
        {"ANO_ELEICAO": "2022", "DS_CARGO": "presidente", "SQ_CANDIDATO": "123", "VR_RECEITA": "500", "VR_DESPESA": "400"},
    ]))
    assert df.iloc[0]["candidato_id"] == "123"
    assert float(df.iloc[0]["despesa_total"]) == 400.0
    assert float(df.iloc[0]["fefc"]) == 0.0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/etl/test_prestacao.py::test_normalize_prestacao_basico -v`
Expected: FAIL with "function not defined"

- [ ] **Step 3: Implement `normalize_prestacao(df: pd.DataFrame) -> pd.DataFrame` in `etl/prestacao.py`**

Aliases: ano=`ANO_ELEICAO/ANO`, cargo=`DS_CARGO/CARGO`, candidato=`SQ_CANDIDATO/NR_CANDIDATO`, receita=`VR_RECEITA/RECEITA_TOTAL`, despesa=`VR_DESPESA/DESPESA_TOTAL`, fefc=`VR_FEFC/FEFC`, partidário=`VR_FUNDO_PARTIDARIO/FUNDO_PARTIDARIO`. Reusar `_fix_text` de `etl/normalize.py` para texto.

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/etl/test_prestacao.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add etl/prestacao.py tests/etl/test_prestacao.py
git commit -m "feat(prestacao): normalize TSE para fato_fin"
```

### Task 4: CGU opcional → fato_transp_federal

**Files:**
- Create: `etl/transparencia.py`
- Test: `tests/etl/test_transparencia.py`

**Interfaces:**
- Consumes: env `TRANSPARENCIA_API_KEY` (lido só no `__main__`, nunca aqui); recebe `records: list[dict]` já baixados
- Produces: `normalize_cgu(records: list[dict]) -> pd.DataFrame` com `["ano","orgao","funcao","valor"]`; entrada vazia → DataFrame vazio canônico (skip honesto, não erro). Usado pela Task 5.

- [ ] **Step 1: Write the failing test**

```python
def test_normalize_cgu_vazio_e_basico():
    assert normalize_cgu([]).empty
    df = normalize_cgu([{"ano": 2022, "orgao": "MS", "funcao": "Saude", "valor": "10.5"}])
    assert float(df.iloc[0]["valor"]) == 10.5
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/etl/test_transparencia.py::test_normalize_cgu_vazio_e_basico -v`
Expected: FAIL with "function not defined"

- [ ] **Step 3: Implement `normalize_cgu(records: list[dict]) -> pd.DataFrame` in `etl/transparencia.py`**

Sem rede aqui (fetch vive no `__main__`/fetch); só normaliza. `valor` não-numérico → linha descartada (nunca 0).

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/etl/test_transparencia.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add etl/transparencia.py tests/etl/test_transparencia.py
git commit -m "feat(transparencia): normalize CGU federal"
```

### Task 5: Wiring ETL (sources/fetch/build/gates/cli)

**Files:**
- Modify: `etl/sources.py`, `etl/fetch.py:24`, `etl/build_marts.py`, `etl/validate.py`, `etl/__main__.py`
- Test: `tests/etl/test_gov_marts.py`

**Interfaces:**
- Consumes: `load_entes`, `normalize_siconfi`, `normalize_prestacao`, `normalize_cgu` das Tasks 1–4
- Produces: DuckDB `dim_ente/fato_gov/fato_transp_federal` + `fato_fin` preenchido; JSONs `gov_por_ente.json/gov_serie.json/fin_por_candidato.json`; `check_monetario(df, cols: list[str]) -> list[str]`; CLI `--siconfi-json/--prestacao-csv/--with-transparencia`.

- [ ] **Step 1: Write the failing test**

```python
def test_build_all_com_gov_e_fin(tmp_path):
    build_all(curated, tmp_path / "t.duckdb", manifest, web_data_dir=tmp_path / "webdata",
              gov_df=gov_fixture(), fin_df=fin_fixture())
    con = duckdb.connect(str(tmp_path / "t.duckdb"))
    try:
        assert con.execute("SELECT COUNT(*) FROM fato_gov").fetchone()[0] == 2
        assert con.execute("SELECT COUNT(*) FROM fato_fin").fetchone()[0] == 1
    finally:
        con.close()
    assert (tmp_path / "webdata" / "gov_serie.json").is_file()


def test_check_monetario_reprova_negativo():
    df = pd.DataFrame([{"despesa_empenhada": -1.0}])
    assert any("monetario" in e for e in check_monetario(df, ["despesa_empenhada"]))
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/etl/test_gov_marts.py::test_build_all_com_gov_e_fin -v`
Expected: FAIL (`fato_gov` não existe / kwarg desconhecido)

- [ ] **Step 3: Implement wiring**

`sources.py`: + `SICONFI_DATASETS/PRESTACAO_DATASETS/CGU_META` (só metadados URL+dataset, sem download). `fetch.py`: `ALLOWED_HOSTS` + `apidatalake.tesouro.gov.br/tesourotransparente.gov.br/api.portaldatransparencia.gov.br`. `build_marts.py`: params opcionais `gov_df/fin_df/cgu_df` (default None → tabelas vazias, preserva V1); `_write_duckdb` cria as 3 tabelas; `_write_json_aggs` escreve os 3 JSONs; `_matched_entries` intocado (gov/fin não passam pelo escopo V1). `validate.py`: `check_monetario` (negativo/NaN/inf reprova com "monetario"); órfãos fin>0,1% reuse `ORPHAN_THRESHOLD`. `__main__.py`: 3 flags; CGU sem chave → `UserWarning` + segue.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/etl/test_gov_marts.py tests/etl/test_validate.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add etl/sources.py etl/fetch.py etl/build_marts.py etl/validate.py etl/__main__.py tests/etl/test_gov_marts.py
git commit -m "feat(etl): wiring gov+fin+cgu com gates"
```

### Task 6: Seed + front /transparencia

**Files:**
- Modify: `scripts/seed_fixture_data.py`, `web/lib/data.ts`
- Create: `web/app/transparencia/page.tsx`, `web/components/Transparencia.tsx`
- Test: `web/__tests__/transparencia.test.ts`

**Interfaces:**
- Consumes: JSONs `gov_serie.json` (`[{ano, ente_id, despesa_empenhada}]`), `manifest.json` (selo)
- Produces: `isAnoEleitoral(ano: number) -> boolean` (true para 2014/2016/2018/2020/2022/2024); `govSerie(rows: GovRow[], filtros: {ente_id?: string}) -> {ano, valor, eleitoral}[]` ordenado por ano; página com marcador eleitoral + tabela acessível + `SealSlot`.

- [ ] **Step 1: Write the failing test**

```ts
it("marca anos eleitorais e pula ano sem dado", () => {
  expect(isAnoEleitoral(2022)).toBe(true);
  expect(isAnoEleitoral(2021)).toBe(false);
  expect(govSerie([{ano: 2021, ente_id: "UNIAO", despesa_empenhada: 10} as GovRow], {}).length).toBe(1);
  expect(govSerie([], {})).toEqual([]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- transparencia` (em `web/`)
Expected: FAIL ("isAnoEleitoral is not defined")

- [ ] **Step 3: Implement front + seed**

`data.ts`: tipos + 2 funções (valor não-finito pula a linha, nunca soma 0). `page.tsx`: montador fino como `explorar/page.tsx:1-50` (client + `fetchJson` + `SealSlot`); núcleo em `Transparencia.tsx` com notas fixas "valores nominais, sem deflação IPCA" e "DCA com lag: ano sem dado = sem dado oficial". `seed_fixture_data.py`: +2 linhas gov fixture +1 fin fixture marcadas `fixture:true` (mesmo loop existente).

- [ ] **Step 4: Run tests to verify they pass**

Run: `python scripts/seed_fixture_data.py --force && npm test -- transparencia` (repo root + `web/`)
Expected: PASS + `web/public/data/gov_serie.json` existe

- [ ] **Step 5: Commit**

```bash
git add scripts/seed_fixture_data.py web/lib/data.ts web/app/transparencia/page.tsx web/components/Transparencia.tsx web/__tests__/transparencia.test.ts
git commit -m "feat(transparencia): serie 2014-2024 com selo"
```
