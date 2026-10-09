# Auditoria Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corrigir os 15 achados críticos + 20 médios da auditoria v1 sem quebrar nenhum contrato aprovado, até o STATUS sair de FAIL.

**Architecture:** 13 tasks sequenciais em 3 fases (A: verdade do pipeline ETL; B: verdade dos filtros/agregações do front; C: endurecimento de auditoria/UI). Cada task TDD com testes que falham antes e passam depois; interfaces travadas nos blocos Interfaces.

**Tech Stack:** Python 3.10+ (pandas/pyarrow/duckdb/requests) + Next.js 14 + vitest + GitHub Actions (só free).

**Spec:** `docs/superpowers/audits/2026-10-09-sad-eleicoes-audit.md` (este plano discute a partir dela; leia os dois)

## Global Constraints

- Custo zero: nada pago, nenhuma dependência nova além de open-source free; `pytest>=8` entra como dependência de teste na Task 1.
- Fail-closed preservado em todo o caminho: sem hash válido = "dado não auditado"; vazio = "sem dado oficial", nunca zero silencioso, nunca tela branca.
- Strings de UI em pt-BR; `?hash=` continua reproduzindo exatamente.
- Todo relatório de task traz evidência TDD RED/GREEN (comando + saída).
- Nenhuma task quebra teste existente salvo ajuste intencional declarado no fix report (ex: bake-ins que o próprio audit condena).

## Review Focus

- CSV TSE real com header fora dos aliases (ex: coluna `NM_VOTAVEL` + extra desconhecida) — espera-se normalizar ou quarentenar, nunca crash. Teste em Task 8 (`test_drifted_header_warns_or_normalizes`).
- Dois downloads concorrentes para o mesmo `dest` — espera-se ambos OK, sha íntegro, sem parcial restante. Teste em Task 8 (`test_concurrent_same_dest`).
- Share URL com chaves desconhecidas (`?modoX=1`) — espera-se ignorar e hidratar as conhecidas. Teste em Task 13 (`ignoresUnknownKeys`).
- Manifest com chaves extras desconhecidas por entry — espera-se front ignorar sem quebrar selo. Teste em Task 12 (`ignoresUnknownEntryKeys`).
- Build com 500k linhas sintéticas — espera-se contagens preservadas e layout particionado correto (sem assert de tempo). Teste em Task 7 (`test_build_500k_rows_counts`).

---

### Task 1: CI truth + hygiene

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `pyproject.toml`
- Create: `.gitignore` (root)
- Create: `tests/ci/test_ci_config.py`
- Create: `tests/__init__.py` (only if missing — check first)

**Interfaces:**
- Consumes: nada.
- Produces: CI instala runner de testes antes de usá-lo; `.gitignore` raiz cobre `__pycache__/`, `*.pyc`, `*.duckdb`, `data/manifest.json`, `web/tsconfig.tsbuildinfo` — Tasks seguintes assumem árvore limpa.

- [ ] **Step 1: Write the failing test** (`tests/ci/test_ci_config.py`, parse YAML + texto):

```python
import pathlib
def _ci():
    import yaml
    return yaml.safe_load(pathlib.Path(".github/workflows/ci.yml").read_text())
def test_ci_installs_pytest_before_running_it():
    runs = [s.get("run", "") for s in _ci()["jobs"]["ci"]["steps"]]
    joined = "\n".join(runs)
    assert "pytest" in joined.split("pytest tests")[0]  # instalado antes de usado
def test_ci_caches_pip_and_pins_actions_by_sha():
    import re
    text = pathlib.Path(".github/workflows/ci.yml").read_text()
    assert "cache: pip" in text
    for ref in re.findall(r"uses:\s*actions/\S+", text):
        assert "@" in ref and len(ref.split("@")[1]) == 40  # SHA pin
def test_root_gitignore_covers_generated():
    g = pathlib.Path(".gitignore").read_text()
    for pat in ["__pycache__/", "*.duckdb", "data/manifest.json", "tsconfig.tsbuildinfo"]:
        assert pat in g
```

(`pyyaml` disponível no runner; se ausente localmente, teste pula com `pytest.importorskip("yaml")`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/ci/test_ci_config.py -v`
Expected: FAIL (sem install de pytest, sem cache, sem SHA, sem `.gitignore`).

- [ ] **Step 3: Implement in `.github/workflows/ci.yml`, `pyproject.toml` (`[project.optional-dependencies] test = ["pytest>=8"]`), `.gitignore`**

Mudar `pip install .` → `pip install ".[test]"`; adicionar `cache: pip` ao setup-python; pinar `actions/*` por SHA completo (manter comentário `# v4/v5`); `.gitignore` raiz com os 4 padrões. NÃO rastrear `data/manifest.json` (decisão: gerado, fail-closed cobre ausência).

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/ci/test_ci_config.py -v && python -c "import yaml;yaml.safe_load(open('.github/workflows/ci.yml'))" && git status --short | grep -v __pycache__`
Expected: PASS + YAML válido + `data/manifest.json` e `__pycache__` somem do status.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/ci.yml pyproject.toml .gitignore tests/ci/test_ci_config.py
git commit -m "fix: ci installs pytest, pip cache, pinned actions, root gitignore"
```

### Task 2: Silent zeros (E2+E3+M7)

**Files:**
- Modify: `etl/normalize.py:88-96`
- Modify: `tests/etl/test_normalize.py:21-28` (trocar tautologia por contrato real)
- Test: `tests/etl/test_validate.py` (adicionar e2e)

**Interfaces:**
- Consumes: nada novo.
- Produces: `normalize_resultados(df) -> DataFrame` com coluna `votos` dtype `Int64` (anulável); coluna `votos` ausente → `ValueError`; `turno` ausente/não-numérico → `1`. Tasks 4, 5, 7, 8 consomem este contrato.

- [ ] **Step 1: Write the failing tests**

```python
def test_missing_votos_column_raises(tmp_path=None):
    import pandas as pd
    from etl.normalize import normalize_resultados
    df = pd.DataFrame([{"ANO_ELEICAO": 2022, "DS_CARGO": "PRESIDENTE", "SG_UF": "SP"}])
    with __import__("pytest").raises(ValueError):
        normalize_resultados(df)

def test_nonnumeric_votes_stay_null_not_zero():
    import pandas as pd
    from etl.normalize import normalize_resultados
    df = pd.DataFrame([{"ANO_ELEICAO": 2022, "QT_VOTOS": "abc", "SG_UF": "SP"}])
    out = normalize_resultados(df)
    assert str(out["votos"].dtype) == "Int64" and out["votos"].isna().all()

def test_garbage_votes_fail_gates_e2e(tmp_path):
    # CSV com QT_VOTOS=abc -> build_all -> run_gates deve retornar erro contendo "soma"
```

Terceiro teste usa `build_all` + `run_gates` (integração Task 4/5 — aqui só prova que o gate enxerga null; o raise de E5 vem depois).

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/etl/test_normalize.py -v -k "missing_votos or nonnumeric"`
Expected: FAIL (retorna 0 em vez de raise/null).

- [ ] **Step 3: Implement em `etl/normalize.py` + corrigir `test_normalize.py:28`**

`votos`: coluna ausente → `raise ValueError("input sem coluna de votos (QT_VOTOS)")`; presente → `pd.to_numeric(errors="coerce").astype("Int64")` (sem `fillna`). `turno`: ausente/não-numérico → `1`. `ano`: inalterado (já raise). Teste L28 vira: `assert "sem_ibge" not in out.columns and out.iloc[0]["municipio_ibge"] == "9999999"`.

- [ ] **Step 4: Run tests**

Run: `pytest tests/etl/ -q`
Expected: tudo PASS (se `build_all`/gates quebrarem com `Int64`, anotar como concern p/ Task 4/5 — NÃO corrigir fora do escopo).

- [ ] **Step 5: Commit**

```bash
git add etl/normalize.py tests/etl/test_normalize.py tests/etl/test_validate.py
git commit -m "fix: votes nullable, missing votes column raises"
```

### Task 3: Mojibake SÃO/JOÃO (E1)

**Files:**
- Modify: `etl/normalize.py:45-61`
- Test: `tests/etl/test_normalize.py`

**Interfaces:**
- Consumes: contrato Task 2 (só texto; sem interação).
- Produces: `_fix_text` repara quando o reparo REDUZ marcadores (não exige eliminação).

- [ ] **Step 1: Write the failing test**

```python
def test_fix_mojibake_sao_joao():
    from etl.normalize import _fix_text
    assert _fix_text("SÃƒO PAULO") == "SÃO PAULO" or _fix_text("SÃ\x83O") == "SÃO"
    assert _fix_text("SÃO PAULO") == "SÃO PAULO"  # correto intacto
    assert _fix_text("JOSÃ\x89") == "JOSÉ"
```

(Ajustar os literais ao que `SÃO`.encode("utf8").decode("latin1") produz de fato: `"SÃƒO"`? Não — `"SÃO"` em latin1-mal-decodificado é `"SÃ\x83O"`. O teste deve construir via `"SÃO".encode("utf-8").decode("latin1")` em vez de literal chutado.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/etl/test_normalize.py::test_fix_mojibake_sao_joao -v`
Expected: FAIL (retorna sem reparo).

- [ ] **Step 3: Implement `_fix_text(value)`: trocar veto por contagem**

```python
if sum(fixed.count(m) for m in mojibake) < sum(value.count(m) for m in mojibake):
    return fixed
return value
```

Atualizar o docstring (remover a explicação errada do fallback).

- [ ] **Step 4: Run test**

Run: `pytest tests/etl/ -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add etl/normalize.py tests/etl/test_normalize.py
git commit -m "fix: mojibake repair by marker count, not elimination"
```

### Task 4: Provenance (E4+E5+M15+M16)

**Files:**
- Modify: `etl/__init__.py` (adicionar `ETL_VERSION = "1.1.0"`)
- Modify: `etl/build_marts.py:190-232`
- Test: `tests/etl/test_manifest_copy.py` (estender) ou novo `tests/etl/test_provenance.py`

**Interfaces:**
- Consumes: contrato Task 2 (`votos` Int64; df pode conter nulls — `_register_sources`/`_write_json_aggs` não devem crashar com null).
- Produces: `build_all(curated_dir, db_path, manifest_path, web_data_dir=None, source_shas=None)` onde `source_shas: dict[tuple[int, str], str] | None` mapeia `(ano, CARGO_MAIÚSCULO)` → sha256-do-ZIP; entry do manifest ganha `sha_origin: "source"|"derived"`, `data: <ISO yyyy-mm-dd UTC>`, `etl_version: "1.1.0"`; match de entries por `(ano, cargo.upper())`; `rows` por `(ano,cargo)`; df vazio → outputs vazios + `{"ingestions": []}` nos dois manifests; `(ano,cargo)` sem match no V1 → `ValueError` antes de qualquer escrita. Tasks 5 e 7 consomem.

- [ ] **Step 1: Write the failing tests**

```python
def test_entries_match_ano_and_cargo(tmp_path):
    # df só-presidente 2022 -> exatamente 1 ingestion (presidente), rows == len(df)
def test_source_sha_threading(tmp_path):
    # source_shas={(2022, "PRESIDENTE"): "ab"*32} -> entry sha256 == "ab"*32, sha_origin == "source"
    # sem source_shas -> sha_origin == "derived"
def test_empty_build_writes_no_provenance(tmp_path):
    # curated vazio -> manifest {"ingestions": []}, verify_manifest False, JSONs vazios existem
def test_unmatched_ano_cargo_raises_before_writes(tmp_path):
    # df ano 2010 -> ValueError e NENHUM artefato criado (db/jsons/manifest ausentes)
def test_manifest_carries_date_and_version(tmp_path):
    # entry tem data ISO válida e etl_version == "1.1.0"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/etl/test_provenance.py -v`
Expected: FAIL (fan-out por ano, sem `sha_origin`/`data`, entry falsa no vazio, sem raise).

- [ ] **Step 3: Implement `_register_sources` + `build_all`**

Comparar `e["cargo"].upper() in set(df["cargo"].astype(str).str.upper())`; `rows=int(((df["ano"]==a)&(df["cargo"].str.upper()==c)).sum())`; `data=datetime.now(timezone.utc).date().isoformat()`; pré-checar matches antes de escrever qualquer saída; vazio escreve outputs vazios + manifests `{"ingestions": []}` (mirror idêntico). Seed (sem `source_shas`) continua válido → `derived` + `fixture:true`.

- [ ] **Step 4: Run tests**

Run: `pytest tests/etl/ -q`
Expected: PASS (ajustar seed/coherence tests se contavam 2 entries do fixture — declarar no report).

- [ ] **Step 5: Commit**

```bash
git add etl/__init__.py etl/build_marts.py tests/etl/test_provenance.py
git commit -m "fix: per-cargo provenance, source sha threading, fail-closed empty"
```

### Task 5: Gates wired + seed backup (C2-contrato+M19)

**Files:**
- Modify: `etl/build_marts.py:214-232` (chamar gates após DuckDB, antes de JSONs/manifest)
- Modify: `scripts/seed_fixture_data.py` (backup `.bak` + restore em exceção)
- Test: `tests/etl/test_build_marts_fixes.py` (adicionar)

**Interfaces:**
- Consumes: contrato Task 4 (entradas/saídas de `build_all`); `run_gates(db_path, manifest_path=None, totais_oficiais=None) -> list[str]`.
- Produces: `build_all` levanta `RuntimeError("gates reprovados: …")` quando gates não-vazios, com JSONs/manifest públicos anteriores intactos; seed nunca perde manifest oficial (backup/restore).

- [ ] **Step 1: Write the failing tests**

```python
def test_build_all_raises_when_gates_fail_and_keeps_public_outputs(tmp_path):
    # dados ruins (votos null via Task 2) -> build_all levanta RuntimeError
    # e web_data_dir NÃO contém manifest.json novo (anteriores intactos / ausentes)
def test_seed_backs_up_manifest_on_failure(tmp_path):
    # manifest oficial existente + build que falha -> .bak criado e original restaurado
```

Para o segundo teste pode ser necessário monkeypatch de `build_all` para falhar após o unlink — usar `monkeypatch` no símbolo importado pelo seed.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/etl/test_build_marts_fixes.py -v -k "gates_fail or backs_up"`
Expected: FAIL (publica sem protestar; sem backup).

- [ ] **Step 3: Implement**

Em `build_all`, após `_write_duckdb` e antes de `_write_json_aggs`: `errors = run_gates(db_path, manifest_path=None)` (sem manifest ainda — checa só integridade interna; warn de totais ausentes esperado, NÃO falha por isso: filtrar erros que começam com `"soma: totais oficiais ausentes"`? Não — decisão: chamar com `totais_oficiais=None` e falhar em qualquer erro EXCETO o warn, que é `warnings.warn`, não item da lista — verificar como `run_gates` implementa; se o warn virou item de erro, ajustar para warn-only). `if errors: raise RuntimeError(...)`. Seed: copiar manifest existente p/ `<manifest>.bak` antes do unlink; `try/finally` restaura em exceção, remove `.bak` em sucesso.

- [ ] **Step 4: Run tests**

Run: `pytest tests/ -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add etl/build_marts.py scripts/seed_fixture_data.py tests/etl/test_build_marts_fixes.py
git commit -m "fix: gates enforced in build, seed backs up manifest"
```

### Task 6: Manifest hardening (E7)

**Files:**
- Modify: `etl/manifest.py:14-28`
- Test: `tests/etl/test_manifest.py` (estender)

**Interfaces:**
- Consumes: nada (só endurece).
- Produces: `write_manifest` levanta `ValueError` em entry sem `source_url`/`sha256` truthy ou sha fora do formato 64-hex; corrompido → rename `<path>.corrupt.<UTC-ts>`; escrita tmp+rename atômico. Consumidores (build, seed) já passam entries válidas.

- [ ] **Step 1: Write the failing tests**

```python
def test_write_manifest_rejects_invalid_entry(tmp_path):
    from etl import manifest
    with __import__("pytest").raises(ValueError):
        manifest.write_manifest(str(tmp_path / "m.json"), {"foo": 1})
    with __import__("pytest").raises(ValueError):
        manifest.write_manifest(str(tmp_path / "m.json"), {"source_url": "https://x", "sha256": "abc"})
def test_write_manifest_preserves_corrupt_as_backup(tmp_path):
    from etl import manifest
    p = tmp_path / "m.json"; p.write_text("{invalid")
    manifest.write_manifest(str(p), {"source_url": "https://x", "sha256": "ab" * 32})
    assert list(tmp_path.glob("m.json.corrupt.*")) != []
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/etl/test_manifest.py -v -k "rejects or preserves"`
Expected: FAIL (aceita tudo; descarta corrompido).

- [ ] **Step 3: Implement em `etl/manifest.py`**

Validar antes do append (`re.fullmatch(r"[0-9a-f]{64}", sha.lower())`); corrupt → `Path(path).rename(f"{path}.corrupt.{datetime.now(timezone.utc):%Y%m%dT%H%M%S}")`; escrever em `tmp` + `os.replace`. Manter `verify_manifest` compatível (ele continua aceitando o que já aceitava — endurecer verify quebraria manifests antigos; NÃO tocar verify).

- [ ] **Step 4: Run tests**

Run: `pytest tests/etl/ -q`
Expected: PASS (seed/build passam entries válidas — se algum teste existente constrói entry inválida, corrigir o teste, não afrouxar a validação).

- [ ] **Step 5: Commit**

```bash
git add etl/manifest.py tests/etl/test_manifest.py
git commit -m "fix: manifest validates entries, backs up corrupt, atomic write"
```

### Task 7: Idempotency (E6)

**Files:**
- Modify: `etl/build_marts.py:105-118` (`_write_partitioned_parquet`), `190-211` (`_register_sources`)
- Test: `tests/etl/test_build_marts_fixes.py` (estender)

**Interfaces:**
- Consumes: contrato Task 4 (entries por `(ano,cargo)`).
- Produces: rebuild com mesma fonte não duplica votos nem entries; fonte encolhida não ressuscita partições; build de 500k linhas preserva contagens.

- [ ] **Step 1: Write the failing tests**

```python
def test_rebuild_does_not_duplicate_entries(tmp_path):
    # build_all 2x no mesmo dir -> len(ingestions) estável e votos iguais
def test_shrunk_source_drops_partitions(tmp_path):
    # build com SP+RJ, rebuild só SP -> nenhum parquet sob uf=RJ, votos == só SP
def test_build_500k_rows_counts(tmp_path):
    # 500k linhas sintéticas -> votos totais e por-UF preservados, layout ano=/cargo=/uf= correto
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/etl/test_build_marts_fixes.py -v -k "duplicate_entries or shrunk or 500k"`
Expected: FAIL (entries duplicam; RJ sobrevive; — 500k provavelmente passa, vira teste de guarda).

- [ ] **Step 3: Implement**

No início de `_write_partitioned_parquet`: remover árvores `ano=*/` geradas sob `curated` (só as geradas — nunca CSVs fonte; checar `p.name.startswith("ano=")`). Em `_register_sources`: dedup por `(ano, cargo.upper(), source_url)` mantendo a última antes de escrever (ou reescrever a lista da run em vez de append — escolher o que preserva histórico de runs distintas sem duplicar a mesma).

- [ ] **Step 4: Run tests**

Run: `pytest tests/etl/ -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add etl/build_marts.py tests/etl/test_build_marts_fixes.py
git commit -m "fix: idempotent rebuilds, stale partitions pruned"
```

### Task 8: ETL robustness bundle (M1+M2+M4+M5+M6+M8+M10+M11)

**Files:**
- Modify: `etl/normalize.py`, `etl/validate.py`, `etl/fetch.py`, `etl/build_marts.py`
- Test: `tests/etl/test_robustness.py` (novo)

**Interfaces:**
- Consumes: contratos Tasks 2 e 4 (não muda assinaturas).
- Produces: mesmos contratos, comportamento endurecido item a item abaixo. Nenhuma task posterior depende de detalhe interno daqui.

- [ ] **Step 1: Write the failing tests** (um por item; todos em `tests/etl/test_robustness.py`):

```python
def test_ibge_not_seven_digits_becomes_empty():  # "123" e "12345678" -> "" (M1)
def test_invalid_totais_return_error_not_raise():  # {"SP": "abc"} -> item "soma:" (M2)
def test_concurrent_same_dest_downloads(tmp_path):  # 2 threads, mesmo dest -> sha ok, sem .part (M4)
def test_drifted_header_warns_or_normalizes(tmp_path):  # header desvia -> build não crasha (M5)
def test_quarantine_case_insensitive_and_unique_names(tmp_path):  # .CSV move; colisão gera nome único (M11)
def test_orphan_boundary_integer_math():  # exatos 0,1% passa sem float (M8, via DB construído)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/etl/test_robustness.py -v`
Expected: FAIL nos itens aplicáveis (M6/BOM podem não ter teste que "falha" — cobrir com asserts de comportamento: BOM ingerido; teste de ausência de código morto via grep? Não — M6 é remoção, sem teste; M10 com teste de ingestão BOM).

- [ ] **Step 3: Implement item a item**

M1 `normalize.py:104-107`: após `zfill`, `ibge.where(ibge.str.fullmatch(r"\d{7}"), "")` + `warnings.warn` único com a contagem. M2 `validate.py:117-120`: try/except → `errors.append(f"soma: total oficial inválido para {raw_key!r}")`. M4 `fetch.py`: tmp `f"{dest.name}.part.{os.getpid()}"` + `with requests.get(...) as resp:`. M5 `build_marts.py:90-94`: try/except `ValueError` por arquivo → warn+skip; warn em `df.empty`. M6: deletar `normalize.py:70-71` e constantes não usadas (confirmar com grep que nada importa). M8: `orphans * 1000 > total`. M10: tentar `encoding="utf-8-sig"` antes de `utf-8` nos dois leitores. M11: glob `*.[Cc][Ss][Vv]`, nome único `stem.<ts>.csv`, `raise ValueError` se `qdir == raw`.

- [ ] **Step 4: Run tests**

Run: `pytest tests/ -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add etl/ tests/etl/test_robustness.py
git commit -m "fix: etl robustness bundle (ibge, totals guard, fetch races, bom, quarantine)"
```

### Task 9: Capitals scope (E8)

**Files:**
- Create: `etl/capitais_ibge.json` (27 códigos)
- Modify: `etl/build_marts.py` (`_load_canonical` filtra `cargo==PREFEITO`)
- Test: `tests/etl/test_capitais.py` (novo)

**Interfaces:**
- Consumes: contrato Task 2 (coluna `municipio_ibge` 7 dígitos; cargo maiúsculo).
- Produces: rows `PREFEITO` fora das 27 capitais nunca chegam aos marts; demais cargos intactos.

- [ ] **Step 1: Write the failing tests**

```python
def test_capitais_list_has_27_unique_valid_codes():
    import json
    codes = json.load(open("etl/capitais_ibge.json"))
    assert len(codes) == 27 and len(set(codes)) == 27
    assert all(__import__("re").fullmatch(r"\d{7}", c) for c in codes)
    assert "3550308" in codes and "3304557" in codes  # SP e RJ
def test_prefeito_filtered_to_capitais_others_kept(tmp_path):
    # df misto (prefeito capital + prefeito interior + presidente interior)
    # -> build_all -> fato_voto sem o interior-prefeito, com os demais
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/etl/test_capitais.py -v`
Expected: FAIL (sem arquivo; sem filtro).

- [ ] **Step 3: Implement**

`etl/capitais_ibge.json`: os 27 códigos IBGE de 7 dígitos das capitais (fonte: IBGE — conferir cada um; erro aqui corrompe escopo). Em `_load_canonical` (ou pós-`normalize`, antes de agregar): `df = df[~((df["cargo"] == "PREFEITO") & (~df["municipio_ibge"].isin(capitais)))]`.

- [ ] **Step 4: Run tests**

Run: `pytest tests/ -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add etl/capitais_ibge.json etl/build_marts.py tests/etl/test_capitais.py
git commit -m "fix: prefeito marts restricted to 27 capitals"
```

### Task 10: Candidate scope honesty (F1+F2)

**Files:**
- Modify: `web/app/page.tsx` (notas `NOTA_CANDIDATO_GLOBAL`)
- Modify: `web/lib/data.ts` (só docstrings — comportamento de `filtrarCandidatos`/`getResumo` mantido)
- Test: `web/__tests__/page.test.tsx` (estender)

**Interfaces:**
- Consumes: nada do ETL (front puro).
- Produces: decisão travada — busca por candidato é GLOBAL no V1; seções Resumo/UF/Ranking exibem nota quando os filtros se misturam. Task 11+ consomem o padrão de notas.

- [ ] **Step 1: Write the failing tests** (`page.test.tsx`):

```tsx
it("shows global-candidate note in Resumo/UF when candidato set", ...)
it("shows no-ano-cargo-uf-coverage note in ranking when those filters set with candidato", ...)
```

(Render SSR da página com filtros via query ou props conforme o padrão existente do arquivo.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npm test -- --run -t "global-candidate"`
Expected: FAIL (notas ausentes).

- [ ] **Step 3: Implement**

Constante `NOTA_CANDIDATO_GLOBAL = "Busca por candidato é global no V1: totais por UF/ano ignoram o nome buscado (agregado sem recorte por candidato)."` com `role="note"` em Resumo e UF quando `f.candidato` não-vazio; nota no Ranking quando `f.candidato` combina com `ano/cargo/uf` ativos. Sem mudança em `lib/data.ts` além de docstrings que remetem às notas.

- [ ] **Step 4: Run tests + build**

Run: `cd web && npm test -- --run && npm run build`
Expected: PASS + build ok.

- [ ] **Step 5: Commit**

```bash
git add web/app/page.tsx web/lib/data.ts web/__tests__/page.test.tsx
git commit -m "fix: disclose global candidate scope per section"
```

### Task 11: Filter coherence (F3+F4+M9+M12-finito)

**Files:**
- Modify: `web/lib/data.ts` (`evolucaoAnual`, `getResumo`, `rankingUf`, `filtrarCandidatos`: pular linhas com `votos` não-finito)
- Modify: `web/lib/export.ts` (`semCoberturaTurnoZona` por-chave)
- Modify: `web/app/analisar/page.tsx` (comparador deriva de `cands`, null sob `semCob`)
- Test: `web/__tests__/data.test.ts`, `web/__tests__/analisar.test.ts` (estender)

**Interfaces:**
- Consumes: padrão de notas da Task 10.
- Produces: `ano` filtra evolução; comparador respeita filtros/`semCob`; turno/zona checados por chave; `votos` não-finito excluído das somas (linha não conta como não-vazia por esse motivo).

- [ ] **Step 1: Write the failing tests**

```ts
evolucaoAnual(rows, { ano: "2022" }) // só 2022
semCoberturaTurnoZona(rowsSemTurnoComZona, [], { turno: "1" }) // true; { zona: "5" } // false
getResumo([{ votos: null }], {}) // { totalVotos: 0, vazio: true } — linha corrupta não sustenta seção
comparatorCandidates follow cands + semCob -> null sides (analisar-page test)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npm test -- --run -t "evolucao or semCobertura or finito or comparator"`
Expected: FAIL.

- [ ] **Step 3: Implement**

`evolucaoAnual`: `if (filtros.ano && !matchAno(r.ano, filtros.ano)) continue;`. Agregadores: `const v = Number(r.votos); if (!Number.isFinite(v)) continue;` (em vez de `|| 0`). `semCoberturaTurnoZona`: `(querTurno && hasTurnoCol || !querTurno) && (querZona && hasZonaCol || !querZona)`. Comparador: resolver ids a partir de `cands` (já filtrado); `if (semCob) return { left: null, right: null }` (+ nota existente).

- [ ] **Step 4: Run tests + build + tsc**

Run: `cd web && npm test -- --run && npx tsc --noEmit && npm run build`
Expected: PASS em tudo.

- [ ] **Step 5: Commit**

```bash
git add web/lib/data.ts web/lib/export.ts web/app/analisar/page.tsx web/__tests__/data.test.ts web/__tests__/analisar.test.ts
git commit -m "fix: coherent filters, finite-votes aggregation, per-key coverage"
```

### Task 12: Audit/security bundle (F5+M10+M11+M12-form+M14)

**Files:**
- Modify: `web/lib/data.ts` (`isAudited` trim; remover `getAuditInfo`)
- Modify: `web/lib/export.ts` (`buildShareUrl` trim já existe — só hash; `buildCsvExport` throw sem audit)
- Modify: `web/components/SourceBadge.tsx` + `web/app/auditoria/page.tsx:128` (helper `safeUrl`)
- Modify: `web/app/metodologia/page.tsx` (trocar `isAudited` por `isOfficialDisplay` no texto)
- Test: `web/__tests__/data.test.ts`, `web/__tests__/seal.test.tsx`, `web/__tests__/export.test.ts` (novo se não existir)

**Interfaces:**
- Consumes: nada (endurece contratos existentes).
- Produces: `isAudited({sha256:"   "}) === false`; `getAuditInfo` removido (só testes importavam — atualizar); CSV sem audit levanta em vez de gerar; links só `http(s)`; fórmulas neutralizadas; metodologia documenta o predicado correto; entries com chaves extras ignoradas.

- [ ] **Step 1: Write the failing tests**

```ts
expect(isAudited({ sha256: "   " })).toBe(false)
expect(() => buildCsvExport([{ a: 1 }], null)).toThrow()
expect(safeUrl("javascript:alert(1)")).toBe("")
buildCsvExport([{ c: "=1+1" }], audit) // célula começa protegida (ex: "'=1+1")
isOfficialDisplay({ sha256: "x".repeat(64), outraChave: 1 }) // true, extras ignoradas
```

(`safeUrl` exportado de `lib/data.ts` ou `SourceBadge.tsx` — decidir no implemento e importar no teste.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npm test -- --run -t "audited or csv or safeUrl or formula"`
Expected: FAIL.

- [ ] **Step 3: Implement**

`isAudited`: `const h = o.sha256 ?? o.hash; return typeof h === "string" && h.trim().length > 0`. Deletar `getAuditInfo`; grep confirma zero importadores em páginas (só testes — atualizar). `buildCsvExport`: `if (!audit?.hash?.trim()) throw new Error("export bloqueado: dado não auditado")` (UI já desabilita; lib não confia na UI). `csvEscape`: após quote, se `/^[=+\-@]/` prefixar `'` . Metodologia: texto passa a citar `isOfficialDisplay` (hash não-vazio + não-fixture). Nota junto ao botão de download (M11-auditoria) vira texto explícito: download permitido por transparência, não como dado oficial.

- [ ] **Step 4: Run tests + build + tsc**

Run: `cd web && npm test -- --run && npx tsc --noEmit && npm run build && pytest tests/ -q`
Expected: PASS (pytest garante que nada no ETL referenciava o removido — não deve, mas confirma).

- [ ] **Step 5: Commit**

```bash
git add web/
git commit -m "fix: audit hardening (trim, safe links, csv guard, formula escape)"
```

### Task 13: UI honesty + test hermeticity (M13+M4+M9-web)

**Files:**
- Modify: `web/app/analisar/page.tsx` (share + CSV ctx + readOnly + banner inline style)
- Modify: `web/__tests__/auditoria.test.tsx` (skipIf sem seed)
- Test: `web/__tests__/analisar.test.ts` (estender)

**Interfaces:**
- Consumes: contratos Tasks 10–12 (notas, guards).
- Produces: share URL inclui `pivo,modo,a,b` com hidratação; CSV inclui as 7 chaves de filtro como colunas; input município com `readOnly`; banners `role="alert"` com estilo inline; suite verde em clone fresco (skip claro quando sem seed).

- [ ] **Step 1: Write the failing tests**

```ts
buildShareUrl({ ano: 2022, pivo: "uf", modo: "candidatos", a: "X", b: "Y" }, "h") // contém as 4 chaves
hydrate tolera ?modoX=1 preservando ano/cargo/uf (teste da função/helper de parse usada no useEffect)
auditoria.test.tsx pula (não falha) sem web/public/data/*.json
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npm test -- --run -t "share or hydrate or skip"`
Expected: FAIL (chaves perdidas; falha sem seed).

- [ ] **Step 3: Implement**

Share: passar `pivo/compMode/compA/compB` a `buildShareUrl` (genérica — já serializa qualquer chave não-vazia); hidratar no mesmo `useEffect` (ignorar chaves fora do allowlist). CSV: `csvRows` ganha colunas `f_ano,f_cargo,f_uf,f_turno,f_zona,f_partido,f_candidato` (valores dos filtros ativos). Município: `readOnly`. Banners: estilo inline (fundo `#fff3cd`, borda `#b45309`, negrito) mantendo `role="alert"`. Teste de data-path: `describe.skipIf(!existsSync(...))` + `package.json` script `pretest` com echo orientando `python scripts/seed_fixture_data.py --force`.

- [ ] **Step 4: Run tests + build**

Run: `cd web && npm test -- --run && npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/
git commit -m "fix: full share state, csv context, hermetic web tests"
```

## Self-Review (feita inline)

1. **Cobertura:** E1→T3, E2/E3→T2(+T5 e2e), E4/E5/M15/M16→T4, E6→T7, E7→T6, E8→T9, F1/F2→T10, F3/F4→T11, F5→T12, C1→T1, C2-contrato→T5; médios M1/M2/M4/M5/M6/M8/M10/M11→T8, M7→T2, M8-front/M9/M12-finito→T11, M10-front/M11-lib/M12-form/M14→T12, M13→T13, M9-web→T13, M17/M18→T1, M19→T5, M20→T8. Sem lacunas.
2. **Consistência de tipos:** `source_shas` `(ano, UPPER)` bate com cargo uppercased do normalize; `sha_origin`/`data`/`etl_version` extras são ignoradas pelo front (index signature — contrato 20/21); `Int64` fluindo p/ DuckDB/JSON é exercido nos testes T2/T4/T5; `getAuditInfo` removido só após grep (T12).
3. **Review Focus:** 5 linhas, cada uma com teste na task dona (T8 ×2, T13, T12, T7).
4. **Proporção:** plano detalha decisões que o implementador não pode tomar sozinho (semânticas fail-closed, formatos, match case-insensitive); corpos de função ficam com o implementador.
