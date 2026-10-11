# Onda 1 (fundação editorial) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar à Home (piloto) e ao shell a cara editorial brasileira sobre uma fonte única de tokens, sem mudar nenhum texto, role, ordem de elementos ou comportamento.

**Architecture:** Módulo TS puro `web/lib/tokens.ts` (valores + teste de contraste calculado); consumo via `style={{...}}` como hoje; nav ativa isolada em componente cliente (`Nav.tsx`) porque `layout.tsx` é server component; Home só troca valores de estilo nas seções/tabelas/inputs existentes.

**Tech Stack:** Next.js App Router, React inline styles, vitest (SSR + jsdom), pytest/tsc/build como gates.

**Spec:** `docs/superpowers/specs/2026-10-11-onda-1-fundacao-editorial-design.md`

## Global Constraints

- `layout.tsx` é server component: nada de hooks nele; estado ativo vive em `components/Nav.tsx` (`"use client"`, `usePathname` de `next/navigation`).
- Nenhum texto, role ARIA, ordem de elementos ou comportamento muda; exceções: marca (texto novo "SAD Eleições" + tagline, §2) e `aria-current` (atributo novo, §2).
- Valor de `ALERTA_STYLE` (`lib/textos.ts`) intocado — é compartilhado por 9 superfícies.
- Offline-first: nenhuma webfont, nenhum fetch novo; stacks do sistema com fallback genérico no fim.
- Testes existentes NÃO são editados nesta onda (quebra = revert, §4).

## Review Focus

- Link ativo com query/hash (`/?hash=...` ainda marca Início; `/analisar?ano=2022` ainda marca Analisar) — teste pinna em Task 3.
- Foco visível presente nos inputs da Busca (outline verde inline) — teste pinna em Task 5.
- Contraste AA dos pares tinta/fundo e verde/fundo — teste calculado em Task 1.
- Fallback serifado quando Georgia/Charter ausentes (stack termina em `serif`) — teste pinna em Task 1.
- Wrappers de scroll das tabelas mantêm `tabIndex`/`role`/`aria-label` (suíte a11y existente cobre; sem teste novo).

---

## File Structure

- **Create `web/lib/tokens.ts`** — única fonte de `cor`, `fonte`, `texto`, `espaco`, `raio`, `largura`. TS puro, zero dependências.
- **Create `web/components/Nav.tsx`** — `"use client"`; lê `usePathname()`; renderiza os 7 links atuais com `aria-current="page"` + sublinhado verde no ativo.
- **Modify `web/app/layout.tsx`** — body com tokens; header com filete verde, marca + tagline; usa `<Nav/>`.
- **Modify `web/components/HomeContent.tsx`** — só valores de `style`: H1/H2 display, filetes em seções, tabelas (thead caps + `tabular-nums`), total em display verde, inputs com borda/foco. Sem elementos novos (kicker-texto da spec cai aqui: filete + tipografia bastam, sem copy nova).
- **Create `web/__tests__/tokens.test.tsx`** — valores + contraste + fallbacks.
- **Create `web/__tests__/shell.test.tsx`** — marca + `aria-current` (mock de `usePathname` como em `ux.test.tsx`).
- **Extend `web/__tests__/a11y-paridade.test.tsx`** — outline nos inputs da Busca (ou novo `home-visual.test.tsx` se o executor preferir; mesma suíte).

## Task 1: tokens + trava de valores/contraste

**Files:**
- Create: `web/lib/tokens.ts`
- Test: `web/__tests__/tokens.test.tsx`

**Interfaces:**
- Consumes: nada.
- Produces: `tokens` (objeto exportado; Tasks 2–5 importam `cor`, `fonte`, `texto`, `espaco`, `raio`, `largura`).

- [ ] **Step 1: Write the failing test** — `web/__tests__/tokens.test.tsx`:
```tsx
import { expect, it, describe } from "vitest";
import { tokens } from "../lib/tokens";
describe("tokens editoriais", () => {
  it("paleta exata da spec", () => {
    expect(tokens.cor.fundo).toBe("#FAF7F0");
    expect(tokens.cor.tinta).toBe("#1A1A18");
    expect(tokens.cor.destaqueVerde).toBe("#0B6B3A");
    expect(tokens.cor.destaqueAmarelo).toBe("#F2B705");
  });
  it("display serifada com fallback genérico no fim", () => {
    expect(tokens.fonte.display).toMatch(/Georgia/);
    expect(tokens.fonte.display.trim().endsWith("serif")).toBe(true);
  });
  it("contraste AA tinta/fundo e verde/fundo", () => {
    expect(contraste(tokens.cor.tinta, tokens.cor.fundo)).toBeGreaterThanOrEqual(4.5);
    expect(contraste(tokens.cor.destaqueVerde, tokens.cor.fundo)).toBeGreaterThanOrEqual(4.5);
  });
});
```
(`contraste()` = razão WCAG via luminância relativa, implementada no próprio teste, ~10 linhas.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run __tests__/tokens.test.tsx`
Expected: FAIL with "Cannot find module '../lib/tokens'"

- [ ] **Step 3: Implement `tokens` in `web/lib/tokens.ts`** — objeto com exatamente `cor.{fundo,papel,tinta,suave,linha,graficoBarra,destaqueVerde,destaqueAmarelo}`, `fonte.{display,corpo}`, `texto.{gigante,titulo,secao,corpo,miudo}` (strings `"40px/48px"` etc.), `espaco.{1,2,3,4,5,6}` = 4/8/12/16/24/40, `raio.{sm:4,md:6}`, `largura.conteudo: 960`. Valores verbatim da spec.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run __tests__/tokens.test.tsx`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add web/lib/tokens.ts web/__tests__/tokens.test.tsx
git commit -m "onda-1 task 1: tokens editoriais + trava de contraste"
```

## Task 2: shell — body, filete, marca (layout server, sem Nav ainda)

**Files:**
- Modify: `web/app/layout.tsx`
- Test: `web/__tests__/shell.test.tsx` (criado aqui, estendido na Task 3)

**Interfaces:**
- Consumes: `tokens` da Task 1.
- Produces: shell com tokens aplicados; nav antiga ainda inline (Task 3 extrai).

- [ ] **Step 1: Write the failing test** — em `web/__tests__/shell.test.tsx`:
```tsx
import { renderToStaticMarkup } from "react-dom/server";
import RootLayout from "../app/layout";
const html = renderToStaticMarkup(<RootLayout><p>filho</p></RootLayout>);
expect(html).toContain("SAD Eleições");
expect(html).toContain("resultados auditados");
expect(html).toContain("#FAF7F0");
expect(html).toContain("Georgia");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run __tests__/shell.test.tsx`
Expected: FAIL (módulo de teste não existe)

- [ ] **Step 3: Implement em `web/app/layout.tsx`** — body `background: tokens.cor.fundo, color: tokens.cor.tinta, fontFamily: tokens.fonte.corpo`; header com `borderTop: 3px solid tokens.cor.destaqueVerde`; marca `<p style={display gigante}>SAD Eleições</p>` + tagline miúda; nav inline inalterada (extração na Task 3).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run __tests__/shell.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/app/layout.tsx web/__tests__/shell.test.tsx
git commit -m "onda-1 task 2: shell editorial (marca + tokens)"
```

## Task 3: Nav cliente com estado ativo

**Files:**
- Create: `web/components/Nav.tsx`
- Modify: `web/app/layout.tsx` (troca nav inline por `<Nav/>`)
- Test: `web/__tests__/shell.test.tsx` (acrescenta bloco)

**Interfaces:**
- Consumes: `tokens`; `usePathname` de `next/navigation` (mockado no teste como `ux.test.tsx` faz com `useSearchParams`).
- Produces: `<Nav/>` sem props.

- [ ] **Step 1: Write the failing test** — bloco novo em `shell.test.tsx`:
```tsx
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import Nav from "../components/Nav";
vi.mock("next/navigation", () => ({ usePathname: () => "/analisar?ano=2022" }));
const html = renderToStaticMarkup(<Nav />);
expect(html).toContain('aria-current="page"');
expect(html.match(/aria-current="page"/g)).toHaveLength(1);
// query não quebra o match; os 7 links continuam presentes:
for (const href of ["/", "/analisar", "/explorar", "/perguntas", "/verificar", "/metodologia", "/auditoria"]) {
  expect(html).toContain(`href="${href}"`);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run __tests__/shell.test.tsx`
Expected: FAIL with "Cannot find module '../components/Nav'"

- [ ] **Step 3: Implement `<Nav/>` em `web/components/Nav.tsx`** — `"use client"`; `const path = usePathname()`; match por pathname exato sem query/hash (`path.split(/[?#]/)[0]`); link ativo com `aria-current="page"` + `textDecoration: underline`, `textDecorationColor` verde, `textUnderlineOffset: 4`; mesma ordem/rotas/labels; em `layout.tsx`, substituir o `<nav>` inline por `<Nav/>`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run __tests__/shell.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/components/Nav.tsx web/app/layout.tsx web/__tests__/shell.test.tsx
git commit -m "onda-1 task 3: nav com estado ativo"
```

## Task 4: Home — tipografia, ritmo, filetes

**Files:**
- Modify: `web/components/HomeContent.tsx`
- Test: nenhum novo (prova = suíte existente verde, §4); acrescenta 1 assert em `shell.test.tsx`? Não — asserts de estilo da Home vão na Task 5 junto aos inputs. Esta task é verificada pela suíte + Task 6.

**Interfaces:**
- Consumes: `tokens` da Task 1.
- Produces: Home com valores editoriais; zero elementos novos.

- [ ] **Step 1: Aplicar estilos** — H1 `font: display gigante, tinta`; cada `<section>` com `marginTop: espaco.6` (primeira sem) e `borderTop: 1px solid linha` + `paddingTop: espaco.4`; H2 `font: display secao`; Bar usa `graficoBarra`; mapa/tabela sem mudança estrutural.

- [ ] **Step 2: Rodar o entorno da Home**

Run: `cd web && npx vitest run __tests__/ux.test.tsx __tests__/home-map.test.tsx __tests__/gating-paridade.test.tsx __tests__/a11y-paridade.test.tsx __tests__/csv-paridade.test.tsx`
Expected: PASS sem editar nenhum teste (quebra = revert do passo, não ajuste)

- [ ] **Step 3: Commit**

```bash
git add web/components/HomeContent.tsx
git commit -m "onda-1 task 4: Home editorial (só valores de estilo)"
```

## Task 5: Home — tabelas, números, inputs

**Files:**
- Modify: `web/components/HomeContent.tsx`
- Test: `web/__tests__/a11y-paridade.test.tsx` (bloco novo) ou `home-visual.test.tsx`

**Interfaces:**
- Consumes: `tokens` da Task 1.
- Produces: tabelas/inputs com estilo editorial + teste de foco.

- [ ] **Step 1: Write the failing test** (jsdom: SSR não dispara foco)
```tsx
import { tokens } from "../lib/tokens";
import { MANIFEST_OK, mockFetchHome, renderJsdom, teardownJsdom } from "./helpers";
afterEach(teardownJsdom);
it("inputs da Busca têm foco visível verde", async () => {
  mockFetchHome(MANIFEST_OK, "ausente");
  const div = await renderJsdom(<HomeContent />);
  const input = div.querySelector('input[aria-label="ano"]') as HTMLInputElement;
  input.focus();
  expect(input.style.outline).toContain("2px");
  expect(input.style.outline).toContain(tokens.cor.destaqueVerde);
});
it("números de tabela são tabulares (SSR basta)", async () => {
  mockFetchHome(MANIFEST_OK, "ausente");
  const div = await renderJsdom(<HomeContent />);
  expect(div.innerHTML).toContain("tabular-nums");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run __tests__/a11y-paridade.test.tsx`
Expected: FAIL (outline/tabuluar-nums ausentes)

- [ ] **Step 3: Implement** — `th` com `textTransform: uppercase, fontSize: miudo, borderBottom: 3px double linha`; células numéricas com `fontVariantNumeric: "tabular-nums"`; total de votos em `texto.titulo` verde; inputs/selects com `border: 1px solid linha, borderRadius: raio.sm` + `onFocus`/`onBlur` alternando `outline: 2px solid destaqueVerde` (display-only, sem estado semântico).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run __tests__/a11y-paridade.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/components/HomeContent.tsx web/__tests__/a11y-paridade.test.tsx
git commit -m "onda-1 task 5: tabelas e inputs editoriais"
```

## Task 6: verificação final da onda (§4)

**Files:** nenhum (só roda gates).

- [ ] **Step 1: Suite completa Python**

Run: `pytest tests/ -q`
Expected: `202 passed, 1 skipped` (baseline main)

- [ ] **Step 2: Suite completa web + tipos + build**

Run: `cd web && npx vitest run && npx tsc --noEmit && npm run build`
Expected: tudo verde; nenhum teste existente editado (`git status` mostra só os arquivos das Tasks 1–5)

- [ ] **Step 3: Conferência visual** — build local + abrir `/` e 1 rota com dados; confirmar filete/marca/tipografia sem regressão de layout (sem ferramenta nova; inspeção).
