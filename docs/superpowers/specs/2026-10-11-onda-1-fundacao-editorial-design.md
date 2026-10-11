# Spec: Onda 1 — fundação editorial (tokens + shell + Home)

Data: 2026-10-11. Status: design aprovado por seção (§1–§4); aguarda review da spec.

## Entendimento (brief)

- **O que o usuário disse:** foco principal em usabilidade fluida + design elegante e moderno, em ondas por superfície, piloto Home, direção "editorial brasileiro".
- **Assunções confirmadas:** (1) três dimensões (movimento, carregamento percebido, fluxos simples) — onda 1 cobre só a base visual, movimento/loading ficam p/ onda 2; (2) identidade de auditoria intacta (selos, share/proveniência, export CSV, SEM_DADO fail-closed, roles ARIA); (3) abordagem A (fundação primeiro).
- **Sucesso:** Home com cara editorial brasileira + suítes existentes 100% verdes sem ajuste (prova de "só visual") + tokens/contraste/marca cobertos por testes novos.

## §1 — Tokens (`web/lib/tokens.ts`, fonte única, novo)

```ts
cor: fundo #FAF7F0, papel #FFFFFF, tinta #1A1A18, suave #6B675E,
     linha #E3DCCB, graficoBarra #0B6B3A, destaqueVerde #0B6B3A,
     destaqueAmarelo #F2B705 (só detalhes)
fonte: display: Georgia, 'Times New Roman', Charter, serif
       corpo: system-ui, -apple-system, 'Segoe UI', sans-serif
texto: gigante 40/48 display, titulo 28/36 display, secao 20/28 display,
       corpo 16/24, miudo 13/20 (px/lh)
espaco: escala 4/8 → {1:4, 2:8, 3:12, 4:16, 5:24, 6:40}
raio: {sm: 4, md: 6}; largura.conteudo: 960
```

Fora: cores dos selos de veredito (verde/âmbar/vermelho ficam onde estão).
Consumo via `style={{...}}` (padrão atual); zero CSS novo, SSR/jsdom-safe.

## §2 — Shell (`web/app/layout.tsx`)

- `body`: fundo papel, tinta, fonte corpo (tokens).
- Header: filete verde 3px no topo; marca "SAD Eleições" (display) + tagline "resultados auditados" (miúdo); nav com `aria-current="page"` + sublinhado verde no link ativo.
- Links/rotas/ordem idênticos; `main` segue 960. DOM novo: marca (texto) + `aria-current`.

## §3 — Home (`web/components/HomeContent.tsx`, display-only)

- H1 display gigante; H2 com kicker caps + filete; seções com `espaco.6`, separadas por filete (sem sombras/cards).
- Tabelas: thead caps + filete duplo, números com `fontVariantNumeric: "tabular-nums"`; total de votos em display grande verde.
- Inputs: borda `linha`, raio sm, foco visível (`outline: 2px solid` verde).
- Mesmos elementos/ordem/roles/textos. Auditoria (selos, share, export, SEM_DADO) intacta em comportamento.

## §4 — Verificação

- `pytest` + `vitest` + `tsc` + `build` verdes SEM ajustar teste existente (quebra = revert).
- Testes novos: valores dos tokens; contraste AA calculado (tinta/fundo, verde/fundo); marca + `aria-current`.
- Fechamento: build local + conferência visual das rotas.

## Fora de escopo (ondas futuras)

Onda 2: movimento/transições + skeletons/loading (mudam o DOM, com testes novos). Ondas 3+: demais superfícies herdando tokens. Dark mode: não pedido, não incluído.
