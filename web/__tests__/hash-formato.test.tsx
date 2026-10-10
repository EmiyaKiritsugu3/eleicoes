import React from "react";
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { getSealState, type SealState } from "../lib/data";
import { vereditoTemProva } from "../lib/regiao";
import { ExplorarConteudo } from "../components/Explorar";
import { CuradaConteudo } from "../app/perguntas/Curada";
import perguntas from "../data/perguntas.json";
import type { MunRow } from "../lib/motor";

// EVOLVE-3 Task 1: hash de formato lixo (não 64-hex) nega selo e número.
// O manifest abaixo imita ingestão com sha256 fora do formato que o ETL
// exige na escrita (`etl/manifest.py:_validate_entry`).

const MANIFEST_LIXO = {
  ingestions: [
    { source_url: "https://cdn.tse.jus.br/x.zip", sha256: "abc123", date: "2026-01-01" },
  ],
};

const HASH_REAL = "ab".repeat(32);
const MANIFEST_REAL = {
  ingestions: [
    { source_url: "https://cdn.tse.jus.br/x.zip", sha256: HASH_REAL, date: "2026-01-01" },
  ],
};

function demo(i: number) {
  return {
    esc_sup: 5 + i * 0.5,
    esc_med: 30,
    esc_fund: 50,
    renda_media: 1500 + i * 50,
    pobres_pct: 30 - i * 0.4,
    idade_mediana: 30 + i * 0.2,
    urbanizacao: 60 + i * 0.8,
    pop: 10000,
    eleitores: 1000,
  };
}

function linhas40(): MunRow[] {
  const rows: MunRow[] = [];
  for (let i = 0; i < 40; i++) {
    const a = 500 + i * 10;
    rows.push({
      ibge: `355030${i}`,
      uf: "SP",
      nome: `Município ${i}`,
      votos: [a, 1000 - a],
      total: 1000,
      abst: 50,
      demo: demo(i),
    });
  }
  return rows;
}

const CANDIDATOS = [
  { id: "cand-a", nome: "Candidata Exemplo A", partido: "PA" },
  { id: "cand-b", nome: "Candidato Exemplo B", partido: "PB" },
];

describe("hash-formato (EVOLVE-3 Task 1: sha256 lixo nega selo)", () => {
  it('manifest com sha256:"abc123" -> sem selo oficial (fail-closed)', () => {
    const seal = getSealState(MANIFEST_LIXO);
    expect(seal.official).toBe(null);
    expect(vereditoTemProva(seal)).toBe(false);
  });
  it("ingestão só com alias `hash` (sem `sha256`) não sela — ETL nunca a produziria", () => {
    const seal = getSealState({
      ingestions: [{ source_url: "https://cdn.tse.jus.br/x.zip", hash: HASH_REAL, date: "2026-01-01" }],
    });
    expect(seal.official).toBe(null);
  });
  it("manifest com sha256 64-hex real -> selo oficial concedido (controle)", () => {
    const seal: SealState = getSealState(MANIFEST_REAL);
    expect(seal.official).toEqual({
      hash: HASH_REAL,
      url: "https://cdn.tse.jus.br/x.zip",
      date: "2026-01-01",
    });
    expect(vereditoTemProva(seal)).toBe(true);
  });
  it("Explorar com selo de hash lixo -> SEM_DADO, nunca número oficial", () => {
    const seal = getSealState(MANIFEST_LIXO);
    const html = renderToStaticMarkup(
      <ExplorarConteudo
        fato={{ candidatos: CANDIDATOS, municipios: linhas40() }}
        seal={seal}
        initial={{ quem: "cand-a", onde: "venceu", cruzar: "esc_sup", ver: ["dispersao"] }}
      />,
    );
    expect(html).not.toContain("fonte auditada");
    expect(html).toContain("sem dado oficial");
    expect(html).toContain("sem hash auditado no manifest");
  });
  it("Curada com selo de hash lixo -> SEM_DADO, nunca número oficial", () => {
    const seal = getSealState(MANIFEST_LIXO);
    const p = perguntas.find((q) => q.slug === "perfil-onde-venceu-vencedor")!;
    const html = renderToStaticMarkup(
      <CuradaConteudo
        pergunta={p}
        fato={{ candidatos: CANDIDATOS, municipios: linhas40() }}
        seal={seal}
        manifestChecked
      />,
    );
    expect(html).not.toContain("fonte auditada");
    expect(html).toContain("sem dado oficial");
  });
});
