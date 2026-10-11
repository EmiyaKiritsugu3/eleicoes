import type { Metadata } from "next";
import React from "react";
import { tokens } from "../lib/tokens";

export const metadata: Metadata = {
  title: "SAD Eleições — resultados auditados",
  description: "Frente pública de resultados eleitorais com auditoria visível de fonte.",
};

const [giganteSize, giganteLine] = tokens.texto.gigante.split("/");
const [miudoSize, miudoLine] = tokens.texto.miudo.split("/");

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body
        style={{
          background: tokens.cor.fundo,
          color: tokens.cor.tinta,
          fontFamily: tokens.fonte.corpo,
          margin: 0,
        }}
      >
        <header
          style={{
            maxWidth: tokens.largura.conteudo,
            margin: "0 auto",
            padding: "1rem 1rem 0",
            borderTop: `3px solid ${tokens.cor.destaqueVerde}`,
          }}
        >
          <p
            style={{
              fontFamily: tokens.fonte.display,
              fontSize: giganteSize,
              lineHeight: giganteLine,
              margin: "0 0 4px",
            }}
          >
            SAD Eleições
          </p>
          <p
            style={{
              fontFamily: tokens.fonte.corpo,
              fontSize: miudoSize,
              lineHeight: miudoLine,
              color: tokens.cor.suave,
              margin: "0 0 1rem",
            }}
          >
            resultados auditados
          </p>
          <nav aria-label="Principal" style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
            <a href="/">Início</a>
            <a href="/analisar">Analisar</a>
            <a href="/explorar">Explorar</a>
            <a href="/perguntas">Perguntas</a>
            <a href="/verificar">Verificar</a>
            <a href="/metodologia">Metodologia</a>
            <a href="/auditoria">Auditoria</a>
          </nav>
        </header>
        <main style={{ maxWidth: 960, margin: "0 auto", padding: "1rem" }}>{children}</main>
      </body>
    </html>
  );
}
