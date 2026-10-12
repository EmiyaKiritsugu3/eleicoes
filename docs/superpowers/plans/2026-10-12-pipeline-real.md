# Pipeline real end-to-end Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Versionar a ingestão oficial (`scripts/ingestao_real.py --ano --cargo --turno`) reproduzindo o real-run 2024-prefeito e o triple 2022-presidente com gates verdes.

**Architecture:** Script fino que só orquestra entrypoints existentes (`etl.fetch.download_dataset` → `etl.depara.parse_depara_csv` → `etl.build_marts.build_all` → censo com total → `etl.build_fato.build_fato` → `etl.validate.run_gates` no mirror servido), sem duplicar lógica de ETL e sem tocar no CI normal.

**Tech Stack:** Python argparse/stdlib + ETL existente; pytest offline (monkeypatch p/ rede); docs em `metodologia/page.tsx`.

**Spec:** `docs/superpowers/specs/2026-10-12-pipeline-real-design.md`

## Global Constraints

- Custo zero: nenhum serviço pago, nenhum download de 46MB no CI normal ou no build Vercel.
- `web/public/data/` segue gitignored; CI segue `seed --force` com fixtures (`fixture: true`, nunca selo oficial).
- Fail-closed herdado: exit 0 ok, 1 gates reprovados (nada publicado), 2 erro.
- Combos válidos = interseção com `V1_DATASETS` (`etl/sources.py`); fora disso aborta antes de qualquer download.
- Nenhum texto/role/ordem/comportamento do front muda neste ciclo (só a seção deploy da metodologia).

## Review Focus

- Combo fora do V1 (ex. 2022 prefeito) aborta com exit 2 antes de baixar — teste pinna em Task 1.
- Manifest real existente sem `--force-real` aborta antes de baixar — teste pinna em Task 2.
- Falha de rede no meio do fetch sai 2 sem escrever curated/db/webdata — teste pinna em Task 2.
- Censo com soma divergente do total sai 1 sem escrever fato — teste pinna em Task 3.
- CI normal intacto: `seed` + `pytest` + `vitest` + `tsc` + `build` verdes sem tocar em `ci.yml` — prova na Task 4.

---

## File Structure

- **Create `scripts/ingestao_real.py`** — CLI `main(argv) -> int`; parse args, valida combo V1, guarda anti-perda, orquestra os 5 passos, imprime resumo. ~150 linhas, sem dependência nova.
- **Create `tests/etl/test_ingestao_real.py`** — offline: fixtures sintéticos TSE/Censo/de-para mínimos + monkeypatch de `download_dataset`; asserts de exit codes, guards e contrato do manifest.
- **Modify `web/app/metodologia/page.tsx:144-149`** — item "Produção (dados oficiais)" passa a citar o comando exato por triple + SHAs + publish manual.
- **Modify `docs/superpowers/loops/motor-verdade-loop.md`** — entrada do ciclo (sem reescrever histórico).

## Task 1: CLI + validação V1 (offline, sem rede)

**Files:**
- Create: `scripts/ingestao_real.py`
- Test: `tests/etl/test_ingestao_real.py` (bloco 1)

**Interfaces:**
- Consumes: `etl.sources.V1_DATASETS: list[dict]` (campos `ano`, `cargo`).
- Produces: `ingestao_real.main(argv: list[str] | None) -> int`; `_parse_args(argv)` com `--ano: int --cargo: str --turno: int --raw-dir --curated-dir --db --manifest --web-data-dir --censo-total-esperado: int|None --force-real`.

- [ ] **Step 1: Write the failing test** — em `tests/etl/test_ingestao_real.py`:
```python
def test_help_cita_triples_e_exits(tmp_path=None):
    import subprocess, sys
    from pathlib import Path
    repo = Path(__file__).resolve().parents[2]
    p = subprocess.run([sys.executable, "scripts/ingestao_real.py", "--help"], capture_output=True, text=True, cwd=repo)
    assert p.returncode == 0
    assert "--ano" in p.stdout and "--cargo" in p.stdout and "--turno" in p.stdout

def test_combo_fora_v1_aborta_antes_do_download(tmp_path):
    from scripts import ingestao_real
    assert ingestao_real.main(["--ano", "2022", "--cargo", "prefeito", "--turno", "1",
        "--raw-dir", str(tmp_path), "--curated-dir", str(tmp_path),
        "--db", str(tmp_path / "x.duckdb"), "--web-data-dir", str(tmp_path)]) == 2
```
- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/etl/test_ingestao_real.py -q`
Expected: FAIL (module `scripts.ingestao_real` não existe)

- [ ] **Step 3: Implement `_parse_args` + `main` mínimo em `scripts/ingestao_real.py`** — argparse pt-BR com os 9 args; valida `(ano, cargo.lower())` contra `{(e["ano"], e["cargo"]) for e in V1_DATASETS}` + turno em (1,2); inválido imprime erro em pt-BR e retorna 2 antes de qualquer I/O de rede.

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/etl/test_ingestao_real.py -q`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add scripts/ingestao_real.py tests/etl/test_ingestao_real.py
git commit -m "pipeline-real task 1: CLI + validacao V1"
```

## Task 2: fetch + guarda anti-perda (rede mockada)

**Files:**
- Modify: `scripts/ingestao_real.py` (`_passo_fetch`, `_guard_webdata`)
- Test: `tests/etl/test_ingestao_real.py` (bloco 2)

**Interfaces:**
- Consumes: `etl.fetch.download_dataset(url, dest) -> str (sha256)`; `etl.sources.V1_DATASETS`, `CENSO_DATASETS`, `DEPARA_DATASET`.
- Produces: `_guard_webdata(web_data_dir: Path, force_real: bool) -> None` (levanta `SystemExit(2)` se manifest com ingestão `fixture!=true` sem flag); `_passo_fetch(raw_dir, ano, cargo) -> dict` com as 3 URLs.

- [ ] **Step 1: Write the failing tests**
```python
def test_recusa_sobrescrever_real_sem_flag(tmp_path):
    import json
    from scripts import ingestao_real
    webdata = tmp_path / "webdata"; webdata.mkdir()
    (webdata / "manifest.json").write_text(json.dumps({"ingestions": [{"fixture": False}]}), encoding="utf-8")
    with pytest.raises(SystemExit) as e:
        ingestao_real._guard_webdata(webdata, False)
    assert e.value.code == 2

def test_fetch_falha_e_exit_2_sem_escrita(tmp_path, monkeypatch):
    from scripts import ingestao_real
    import etl.fetch as fetch
    monkeypatch.setattr(fetch, "download_dataset", lambda url, dest: (_ for _ in ()).throw(ConnectionError("sem rede")))
    rc = ingestao_real.main(["--ano", "2024", "--cargo", "prefeito", "--turno", "1",
        "--raw-dir", str(tmp_path / "raw"), "--curated-dir", str(tmp_path / "cur"),
        "--db", str(tmp_path / "s.duckdb"), "--web-data-dir", str(tmp_path / "w")])
    assert rc == 2
    assert not (tmp_path / "cur").exists()
```
- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/etl/test_ingestao_real.py -q`
Expected: FAIL (`_guard_webdata`/`_passo_fetch` ausentes)

- [ ] **Step 3: Implement `_guard_webdata` + `_passo_fetch`** — guard lê `<web-data-dir>/manifest.json` se existir (ausente/inválido/só-fixture passa); fetch baixa as 3 URLs (`V1` do triple + Censo + de-para) p/ `raw-dir` via `download_dataset`, imprime `fetch: <nome> ok (sha256=<12>…)`; exceção → msg `erro:` em stderr + return 2 sem criar `curated-dir`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/etl/test_ingestao_real.py -q`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add scripts/ingestao_real.py tests/etl/test_ingestao_real.py
git commit -m "pipeline-real task 2: fetch + guarda anti-perda"
```

## Task 3: wiring do pipeline + resumo auditável (e2e sintético offline)

**Files:**
- Modify: `scripts/ingestao_real.py` (`main` completo)
- Test: `tests/etl/test_ingestao_real.py` (bloco 3)

**Interfaces:**
- Consumes: `etl.build_marts.build_all(curated_dir, db, manifest, web_data_dir, source_shas, depara)`; `etl.depara.parse_depara_csv(bytes)`; censo via `etl.__main__._passo_censo`-equivalente (sem fork: importar e chamar o mesmo código ou extrair helper); `etl.build_fato.build_fato(db, webdata, ano, turno, cargo, depara_url)`; `etl.validate.run_gates(db, mirror, totais, fato_paths)`.
- Produces: resumo stdout `fato: <nome> ok (<N> votos, <M> municípios)` + `ok: pipeline concluído, gates verdes`.

- [ ] **Step 1: Write the failing tests** — e2e sintético em `tmp_path` (mesmo shape de `test_orquestrador.py`: TSE `;` 2024/PREFEITO com `CD_MUNICIPIO` curto + de-para mini + Censo 2 linhas com soma == total passado):
```python
def test_e2e_sintetico_sai_0_com_resumo(tmp_path, monkeypatch, capsys):
    # monkeypatch download_dataset p/ escrever os 3 fixtures em raw-dir
    # main([... "--ano 2024 --cargo prefeito --turno 1 --censo-total-esperado 22000 ...]) == 0
    # assert "ok: pipeline concluído" in capsys.readouterr().out
    # assert (webdata / "fato_2024_1_prefeito.json").exists()

def test_censo_total_divergente_sai_1_sem_fato(tmp_path, monkeypatch):
    # mesmo setup com --censo-total-esperado 1 → rc == 1, sem fato_*.json
```
- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/etl/test_ingestao_real.py -q`
Expected: FAIL (wiring ausente)

- [ ] **Step 3: Implement o `main` completo** — ordem: guard → fetch → parse de-para (`parse_depara_csv` nos mesmos bytes hasheados) → `build_all(..., depara=mapa)` → censo com total (fail-closed antes de gravar) → `build_fato` → `run_gates` no mirror `<web-data-dir>/manifest.json` → resumo. Reusa `etl.__main__._passo_censo/_passo_depara` por import quando possível, sem copiar lógica.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/etl/test_ingestao_real.py -q`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add scripts/ingestao_real.py tests/etl/test_ingestao_real.py
git commit -m "pipeline-real task 3: wiring + resumo auditavel"
```

## Task 4: docs + verificação final

**Files:**
- Modify: `web/app/metodologia/page.tsx:144-149`
- Modify: `docs/superpowers/loops/motor-verdade-loop.md` (append)
- Test: nenhum novo (gates existentes)

**Interfaces:**
- Consumes: SHAs e números do real-run provado (`votacao_candidato_munzona_2024.zip sha 1024537a…`, de-para `22518445…`, Censo `0adc228e…`, 22.886.213 votos, 24 linhas fato).
- Produces: seção deploy com comandos `python scripts/ingestao_real.py --ano 2024 --cargo prefeito --turno 1` e `--ano 2022 --cargo presidente --turno 1` + nota de publish manual.

- [ ] **Step 1: Atualizar metodologia** — trocar o item "Produção" por comandos exatos + aviso de que sem publish o banner "dado não auditado" é o correto; manter tokens/estilos intactos.

- [ ] **Step 2: Rodar suíte Python**

Run: `pytest tests/ -q`
Expected: `223+ passed` (222 baseline + ≥6 novos), 1 skipped

- [ ] **Step 3: Rodar suíte web + tipos + build**

Run: `cd web && npm test -- --run && npx tsc --noEmit && npm run build`
Expected: tudo verde (baseline 579 vitest)

- [ ] **Step 4: Commit**

```bash
git add web/app/metodologia/page.tsx docs/superpowers/loops/motor-verdade-loop.md
git commit -m "pipeline-real task 4: docs deploy real"
```
