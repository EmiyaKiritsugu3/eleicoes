"use client";

import React, { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { tokens } from "../lib/tokens";

const LINKS = [
  { href: "/", label: "Início" },
  { href: "/analisar", label: "Analisar" },
  { href: "/explorar", label: "Explorar" },
  { href: "/verificar", label: "Verificar" },
  { href: "/perguntas", label: "Perguntas" },
  { href: "/metodologia", label: "Metodologia" },
  { href: "/auditoria", label: "Auditoria" },
] as const;

export default function Nav() {
  const path = usePathname();
  const current = path.split(/[?#]/)[0];
  // Onda-2 final (display-only): hover com transição desliga com
  // prefers-reduced-motion. useState(false) + effect: SSR + primeiro
  // render do cliente idênticos (sem mismatch de hidratação).
  const [semMovimento, setSemMovimento] = useState(false);
  useEffect(() => {
    if (typeof window !== "undefined" && typeof window.matchMedia === "function")
      setSemMovimento(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);
  return (
    <nav aria-label="Principal" style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
      {LINKS.map((link) =>
        link.href === current ? (
          <a
            key={link.href}
            href={link.href}
            aria-current="page"
            style={{
              textDecoration: "underline",
              textDecorationColor: tokens.cor.destaqueVerde,
              textUnderlineOffset: 4,
            }}
          >
            {link.label}
          </a>
        ) : (
          <a
            key={link.href}
            href={link.href}
            style={{
              color: tokens.cor.tinta,
              transition: semMovimento
                ? "none"
                : `color ${tokens.movimento.duracaoCurtaMs}ms ${tokens.movimento.easing}`,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = tokens.cor.destaqueVerde;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = tokens.cor.tinta;
            }}
          >
            {link.label}
          </a>
        ),
      )}
    </nav>
  );
}
