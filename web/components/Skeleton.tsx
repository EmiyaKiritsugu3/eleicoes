import React from "react";
import { tokens } from "../lib/tokens";

type SkeletonProps = {
  /** Nº de barras de texto. Default 3. Ignorado com `bloco`. */
  linhas?: number;
  /** True = bloco único 4:3 (mapa). Default false. */
  bloco?: boolean;
  /** Texto exposto pelo CHAMADOR em `role=status`. Default "a carregar".
   * Nunca renderizado aqui dentro (aria-hidden não leva texto visível). */
  rotulo?: string;
};

/** Placeholder display-only de carregamento (Onda 2, movimento).
 *
 * Puro e SSR-safe: sem hooks, sem window, sem "use client". Renderiza um
 * `<span aria-hidden="true">` com barras em `tokens.cor.linha` + exatamente
 * 1 tag `<style>` com `@keyframes skeleton-pulse` (nome via
 * `tokens.movimento.keyframePulso`) e media query
 * `prefers-reduced-motion: reduce` que desliga a animação.
 */
export default function Skeleton({
  linhas = 3,
  bloco = false,
  rotulo = "a carregar",
}: SkeletonProps) {
  // Default documentado p/ o chamador; nada de texto dentro do aria-hidden.
  void rotulo;
  const quadro = tokens.movimento.keyframePulso;
  const classe = `${quadro}-barra`;
  const css =
    `@keyframes ${quadro}{from{opacity:1}to{opacity:0.45}}` +
    `.${classe}{animation:${quadro} ${tokens.movimento.duracaoMediaMs}ms ${tokens.movimento.easing} infinite alternate}` +
    `@media (prefers-reduced-motion: reduce){.${classe}{animation:none}}`;
  const base = {
    backgroundColor: tokens.cor.linha,
    borderRadius: tokens.raio.sm,
    height: 12,
    marginBottom: tokens.espaco[2],
  };
  return (
    <>
      <span aria-hidden="true">
        {bloco ? (
          <div className={classe} style={{ ...base, width: "100%", aspectRatio: "4 / 3" }} />
        ) : (
          Array.from({ length: linhas }, (_, i) => (
            <div
              key={i}
              className={classe}
              style={{ ...base, width: i === linhas - 1 ? "60%" : "100%" }}
            />
          ))
        )}
      </span>
      <style>{css}</style>
    </>
  );
}
