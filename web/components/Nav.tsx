"use client";

import React from "react";
import { usePathname } from "next/navigation";
import { tokens } from "../lib/tokens";

const LINKS = [
  { href: "/", label: "Início" },
  { href: "/analisar", label: "Analisar" },
  { href: "/explorar", label: "Explorar" },
  { href: "/perguntas", label: "Perguntas" },
  { href: "/verificar", label: "Verificar" },
  { href: "/metodologia", label: "Metodologia" },
  { href: "/auditoria", label: "Auditoria" },
] as const;

export default function Nav() {
  const path = usePathname();
  const current = path.split(/[?#]/)[0];
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
              transition: `color ${tokens.movimento.duracaoCurtaMs}ms ${tokens.movimento.easing}`,
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
