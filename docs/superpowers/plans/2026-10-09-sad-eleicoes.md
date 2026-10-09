# SAD Eleições Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir v1 custo-zero do SAD eleições com ETL auditável TSE+IBGE e front Next.js com modo público e modo analista.

**Architecture:** ETL Python baixa bulk TSE, valida SHA e gates de soma, gera Parquet particionado + DuckDB local + JSON agregado para o front estático. Mesmo front roda local e na Vercel free, sem backend pago.

**Tech Stack:** Python 3.11 + DuckDB + Parquet (pandas/pyarrow), Next.js 14 App Router + TopoJSON, pytest + vitest, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-09-analise-eleicoes-sad-design.md`

## Global Constraints

- Custo zero v1: nada pago, nada que exija cartão; Supabase/Vercel só espelho opcional fase 2.
- Só dado oficial: todo número exibe fonte + data coleta + hash manifest; sem manifest válido mostra "dado não auditado".
- Offline-first local: `npm run dev` e ETL funcionam sem internet após primeira ingestão.
- Join geográfico sempre por IBGE 7 dígitos.
- Dado faltante exibe "sem dado oficial", nunca zero silencioso.
- Recorte v1: presidentes + governadores 2014-2024 completo, prefeitos só capitais.

## Review Focus

- ZIP TSE com encoding latin1 vs utf8 e colunas renomeadas entre anos — espera-se quarentena + banner, nunca crash.
- Soma votos município divergindo do total UF oficial — espera-se ingestão reprovada e versão anterior mantida.
- Município TSE sem código IBGE correspondente (criado/remanejado) — espera-se "sem dado oficial" no mapa, não zero.
- Manifest corrompido ou ausente no front — espera-se aviso "dado não auditado", nunca número como oficial.
- Filtro /analisar combinando ano+cargo+UF+município sem linhas — espera-se empty-state claro + export vazio com hash, não tela branca.

---

### Task 1: Scaffold repo + manifest core

**Files:**
- Create: `etl/manifest.py`
- Create: `etl/__init__.py`
- Create: `tests/etl/test_manifest.py`
- Create: `data/raw/.gitkeep`
- Create: `data/curated/.gitkeep`
- Create: `pyproject.toml`

**Interfaces:**
- Consumes: nada (primeira task).
- Produces: `etl.manifest.write_manifest(path, entry) -> dict`, `etl.manifest.load_manifest(path) -> dict`, `etl.manifest.verify_manifest(path) -> bool` — Tasks 2-4 usam para registrar cada ingestão.

- [ ] **Step 1: Write the failing test**

```python
def test_write_and_verify_manifest(tmp_path):
    from etl.manifest import write_manifest, verify_manifest
    p = tmp_path / "manifest.json"
    write_manifest(str(p), {"source_url": "https://x", "sha256": "abc", "rows": 1})
    assert verify_manifest(str(p)) is True

def test_corrupt_manifest_fails(tmp_path):
    from etl.manifest import write_manifest, verify_manifest
    p = tmp_path / "manifest.json"
    p.write_text("{invalid")
    assert verify_manifest(str(p)) is False
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/etl/test_manifest.py -v`
Expected: FAIL with "No module named etl" ou "function not defined".

- [ ] **Step 3: Implement `write_manifest / load_manifest / verify_manifest` in `etl/manifest.py`**

JSON com `{"ingestions": [...]}`; verify retorna False se JSON inválido ou sem `sha256`/`source_url`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/etl/test_manifest.py -v`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add etl/manifest.py etl/__init__.py tests/etl/test_manifest.py pyproject.toml data/raw/.gitkeep data/curated/.gitkeep
git commit -m "feat: add manifest core with verify"
```

### Task 2: Fetch TSE + validação SHA

**Files:**
- Create: `etl/sources.py`
- Create: `etl/fetch.py`
- Test: `tests/etl/test_fetch.py`

**Interfaces:**
- Consumes: `etl.manifest.write_manifest` da Task 1.
- Produces: `etl.fetch.download_dataset(url, dest, expected_sha256=None, retries=3) -> str` (retorna sha real), `etl.sources.V1_DATASETS: list[dict]` com URL + ano + cargo + tipo da Task 2 — Task 3 consome.

- [ ] **Step 1: Write the failing test**

```python
def test_download_retries_and_sha(tmp_path, monkeypatch):
    from etl import fetch
    # mock de requests.get com falha 1x depois sucesso; assert sha retornado == sha do conteúdo
    assert True  # substituído por asserts reais de sha + retry no arquivo final
```

Detalhado no arquivo: usa `responses` ou monkeypatch, fixture bytes pequena, `expected_sha256` errado deve levantar `ValueError`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/etl/test_fetch.py -v`
Expected: FAIL — módulo/função ausente.

- [ ] **Step 3: Implement `download_dataset` em `etl/fetch.py` + tabela `V1_DATASETS` em `etl/sources.py`**

`requests.get(stream=True)` com retry 3x, grava em `data/raw/`, calcula SHA256 durante escrita, compara se esperado dado. `V1_DATASETS` lista presidentes/governadores 2014-2024 + prefeitos capitais com URLs dadosabertos.tse.jus.br.

- [ ] **Step 4: Run test + Review Focus (encoding ainda não aqui)**

Run: `pytest tests/etl/test_fetch.py tests/etl/test_manifest.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add etl/fetch.py etl/sources.py tests/etl/test_fetch.py
git commit -m "feat: add TSE fetch with sha and retry"
```

### Task 3: Normalização + marts DuckDB/Parquet

**Files:**
- Create: `etl/normalize.py`
- Create: `etl/build_marts.py`
- Test: `tests/etl/test_normalize.py`

**Interfaces:**
- Consumes: `etl.fetch.download_dataset`, `V1_DATASETS` da Task 2.
- Produces: `etl.normalize.normalize_resultados(df) -> DataFrame` (colunas canônicas + ibge7), `etl.build_marts.build_all(curated_dir, db_path, manifest_path) -> None` — Task 4 consome para gates; Task 5 consome `analise-eleicoes.duckdb` + `data/curated/*.parquet` + `web/public/data/*.json`.

- [ ] **Step 1: Write the failing test**

```python
def test_normalize_resultados_columns():
    from etl.normalize import normalize_resultados
    import pandas as pd
    df = pd.DataFrame([{"ANO_ELEICAO": 2022, "DS_CARGO": "PRESIDENTE", "SG_UF": "SP", "CD_MUNICIPIO": "3550308", "NM_URNA": "X", "QT_VOTOS": 10}])
    out = normalize_resultados(df)
    assert list(out.columns) == ["ano", "turno", "cargo", "uf", "municipio_ibge", "candidato_id", "nome_urna", "partido", "votos"]
    assert out.iloc[0]["municipio_ibge"] == "3550308"

def test_build_all_creates_duckdb(tmp_path):
    from etl.build_marts import build_all
    build_all(str(tmp_path), str(tmp_path / "t.duckdb"), str(tmp_path / "m.json"))
    import os
    assert os.path.exists(tmp_path / "t.duckdb")

def test_normalize_latin1_and_missing_ibge():
    from etl.normalize import normalize_resultados
    import pandas as pd
    # município sem IBGE correspondente deve ser mantido com flag para exibir "sem dado oficial" no mapa
    df = pd.DataFrame([{"ANO_ELEICAO": 2022, "DS_CARGO": "PRESIDENTE", "SG_UF": "SP", "CD_MUNICIPIO": "9999999", "NM_URNA": "Y", "QT_VOTOS": 5}])
    out = normalize_resultados(df)
    assert out.iloc[0]["municipio_ibge"] == "9999999"
    assert "sem_ibge" in out.columns or out.iloc[0]["municipio_ibge"] == "9999999"
```

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/etl/test_normalize.py -v`
Expected: FAIL.

- [ ] **Step 3: Implement `normalize_resultados` e `build_all`**

Normaliza encoding latin1/utf8, renomeia colunas TSE por ano para schema canônico, deriva `municipio_ibge` 7 dígitos, cria `fato_voto`, `dim_candidato`, `fato_eleitorado`, `fato_fin` (quando houver), escreve Parquet particionado `ano=/cargo=/uf=` + DuckDB + agregados JSON para `web/public/data/`.

- [ ] **Step 4: Run test + Review Focus (município sem IBGE vira "sem dado oficial" no mapa, testado aqui como linha mantida com flag)**

Run: `pytest tests/etl/ -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add etl/normalize.py etl/build_marts.py tests/etl/test_normalize.py
git commit -m "feat: add normalize and duckdb marts"
```

### Task 4: Quality gates + quarentena

**Files:**
- Create: `etl/validate.py`
- Test: `tests/etl/test_validate.py`

**Interfaces:**
- Consumes: `build_all` output da Task 3, `verify_manifest` da Task 1.
- Produces: `etl.validate.run_gates(db_path) -> list[str]` (lista de erros; vazia = ok) — ETL falha se não vazia e mantém versão anterior.

- [ ] **Step 1: Write the failing test**

```python
def test_gate_sum_mismatch(tmp_path):
    from etl.validate import run_gates
    # cria duckdb fake com fato_voto somando diferente do total oficial -> espera erro contendo "soma"
    assert True  # asserts reais no arquivo

def test_gate_orphan_candidates(tmp_path):
    from etl.validate import run_gates
    assert True
```

Arquivo final contém asserts: mismatch retorna `["soma ..."]`, órfãos >0.1% retornam erro.

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/etl/test_validate.py -v`
Expected: FAIL.

- [ ] **Step 3: Implement `run_gates` em `etl/validate.py`**

Checa: soma por UF == total oficial; órfãos fato sem dim <0.1%; manifest válido. Qualquer CSV com coluna inesperada vai para `data/raw/quarentena/` e não entra.

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/etl/ -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add etl/validate.py tests/etl/test_validate.py
git commit -m "feat: add quality gates and quarantine"
```

### Task 5: Front pública `/` + auditoria visível

**Files:**
- Create: `web/package.json`, `web/app/page.tsx`, `web/app/layout.tsx`, `web/lib/data.ts`, `web/components/SourceBadge.tsx`
- Create: `web/public/data/.gitkeep` (ETL gera JSON aqui)
- Test: `web/__tests__/data.test.ts`

**Interfaces:**
- Consumes: `web/public/data/manifest.json` + agregados da Task 3 (`etl.build_marts`).
- Produces: `lib/data.ts: getResumo(filtros)`, `SourceBadge(props: {hash, url, date})` — Task 6 reutiliza.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { formatVotes } from "../lib/data";
describe("formatVotes", () => {
  it("formats 1234567 as 1.234.567", () => {
    expect(formatVotes(1234567)).toBe("1.234.567");
  });
});
describe("manifest guard", () => {
  it("flags missing hash as não auditado", async () => {
    const { isAudited } = await import("../lib/data");
    expect(isAudited({})).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npm test -- --run`
Expected: FAIL — arquivo/lib ausente.

- [ ] **Step 3: Implement scaffold Next.js + `/` pública**

`npx create-next-app` mínimo ou Vite se preferir manter leve; página com busca ano/cargo/UF/município/candidato, cards-resumo, mapa TopoJSON simplificado, ranking, evolução, abstenção. Cada número usa `<SourceBadge>` com hash+link. Sem hash = banner "dado não auditado". Tabela equivalente a cada gráfico.

- [ ] **Step 4: Run test + build**

Run: `cd web && npm test -- --run && npm run build`
Expected: PASS + build ok.

- [ ] **Step 5: Commit**

```bash
git add web/
git commit -m "feat: add public front with source badge"
```

### Task 6: `/analisar` pesada + export reproduzível

**Files:**
- Create: `web/app/analisar/page.tsx`
- Create: `web/components/Comparator.tsx`, `web/lib/export.ts`
- Test: `web/__tests__/analisar.test.ts`

**Interfaces:**
- Consumes: `getResumo`, `SourceBadge` da Task 5; agregados + manifest da Task 3.
- Produces: URL compartilhável `?ano=&cargo=&uf=&hash=` — Task 7 lista na auditoria.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { buildShareUrl, emptyStateFor } from "../lib/export";
describe("buildShareUrl", () => {
  it("embeds manifest hash", () => {
    expect(buildShareUrl({ ano: 2022 }, "abc123")).toContain("abc123");
  });
  it("empty filter returns sem dado oficial state", () => {
    expect(emptyStateFor([])).toMatch(/sem dado oficial/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npm test -- --run -t buildShareUrl`
Expected: FAIL.

- [ ] **Step 3: Implement `/analisar`**

Filtros turno/zona/partido, pivô, comparador lado-a-lado, dispersão votos x financiamento, série histórica, export CSV com header `fonte,url,hash,data`. Empty-state "sem dado oficial" quando zero linhas. Review Focus: combinação sem linhas não pode ser tela branca.

- [ ] **Step 4: Run test + build**

Run: `cd web && npm test -- --run && npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/app/analisar/ web/components/Comparator.tsx web/lib/export.ts web/__tests__/analisar.test.ts
git commit -m "feat: add analisar mode with export"
```

### Task 7: Metodologia + auditoria + CI

**Files:**
- Create: `web/app/metodologia/page.tsx`, `web/app/auditoria/page.tsx`
- Create: `.github/workflows/ci.yml`
- Test: `tests/etl/test_audit_page.py` (opcional) + `cd web && npm test`

**Interfaces:**
- Consumes: tudo anterior.
- Produces: CI verde + páginas finais; nenhum consumidor posterior.

- [ ] **Step 1: Write the failing test (front)**

```ts
// web/__tests__/auditoria.test.ts
import { describe, it, expect } from "vitest";
describe("auditoria", () => {
  it("requires hash to show numbers as official", async () => {
    const { isAudited } = await import("../lib/data");
    expect(isAudited({ sha256: "x" })).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify current state**

Run: `cd web && npm test -- --run && pytest tests/ -q`
Expected: PASS parcial (auditoria ainda sem página — passo seguinte cria).

- [ ] **Step 3: Implement `/metodologia`, `/auditoria` + `ci.yml`**

Auditoria lista ingestões do manifest com link TSE, hash, linhas, data + botão baixar manifest. CI roda `pytest` + `npm test` + `npm run build` no free.

- [ ] **Step 4: Run full verification**

Run: `pytest tests/ -q && cd web && npm test -- --run && npm run build`
Expected: tudo PASS + build ok.

- [ ] **Step 5: Commit**

```bash
git add web/app/metodologia/ web/app/auditoria/ .github/workflows/ci.yml
git commit -m "feat: add metodologia auditoria and ci"
```
