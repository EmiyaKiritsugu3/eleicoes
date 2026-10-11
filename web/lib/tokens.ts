/** Tokens editoriais — fonte única de valores visuais (Onda 1, §1 da spec).
 *
 * TS puro, zero dependências, SSR/jsdom-safe. Consumo via `style={{...}}`
 * (padrão atual); zero CSS novo. Valores verbatim da spec
 * `docs/superpowers/specs/2026-10-11-onda-1-fundacao-editorial-design.md`.
 * Fora: cores dos selos de veredito (ficam onde estão).
 */

export const tokens = {
  cor: {
    fundo: "#FAF7F0",
    papel: "#FFFFFF",
    tinta: "#1A1A18",
    suave: "#6B675E",
    linha: "#E3DCCB",
    graficoBarra: "#0B6B3A",
    destaqueVerde: "#0B6B3A",
    destaqueAmarelo: "#F2B705",
  },
  fonte: {
    display: "Georgia, 'Times New Roman', Charter, serif",
    corpo: "system-ui, -apple-system, 'Segoe UI', sans-serif",
  },
  texto: {
    gigante: "40px/48px",
    titulo: "28px/36px",
    secao: "20px/28px",
    corpo: "16px/24px",
    miudo: "13px/20px",
  },
  espaco: {
    1: 4,
    2: 8,
    3: 12,
    4: 16,
    5: 24,
    6: 40,
  },
  raio: {
    sm: 4,
    md: 6,
  },
  largura: {
    conteudo: 960,
  },
} as const;

export type Tokens = typeof tokens;
