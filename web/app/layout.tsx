import type { Metadata } from "next";
import React from "react";

export const metadata: Metadata = {
  title: "SAD Eleições — resultados auditados",
  description: "Frente pública de resultados eleitorais com auditoria visível de fonte.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0, color: "#111" }}>
        <header style={{ maxWidth: 960, margin: "0 auto", padding: "1rem 1rem 0" }}>
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
