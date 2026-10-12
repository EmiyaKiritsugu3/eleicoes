import React from "react";
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  resumoMunicipio,
  agregarUF,
  ECO_SEAL,
  NOTA_PESO_MISTO,
  type FatoRegiao,
} from "../components/PainelRegiao";
import PainelRegiao from "../components/PainelRegiao";
import type { MunRow } from "../lib/motor";
import type { SealState } from "../lib/data";

const CANDIDATOS = [
  { id: "A", nome: "Cand A", partido: "PA" },
  { id: "B", nome: "Cand B", partido: "PB" },
];

function demoCompleta(over: Partial<Record<string, number | null>> = {}) {
  return {
    esc_sup: 12,
    esc_med: 30,
    esc_fund: 50,
    renda_media: 2200,
    pobres_pct: 18,
    idade_mediana: 34,
    urbanizacao: 85,
    pop: 12000,
    eleitores: 10000,
    ...over,
  };
}

function mun(
  ibge: string,
  uf: string,
  votos: (number | null)[],
  d: MunRow["demo"],
  total?: number | null,
): MunRow {
  return { ibge, uf, nome: "", votos, total: total ?? null, abst: null, demo: d };
}

const FATO: FatoRegiao = {
  candidatos: CANDIDATOS,
  municipios: [
    mun("3550308", "SP", [600, 400], demoCompleta(), 1000),
    mun("3550309", "SP", [100, 900], demoCompleta({ esc_sup: 20 }), 1000),
  ],
};

const SEAL_OFICIAL: SealState = {
  official: {
    hash: "ab".repeat(32),
    url: "https://cdn.tse.jus.br/x.zip",
    date: "2026-01-01",
  },
  hasFixture: false,
  fixtureHash: "",
};

const SEAL_NULO: SealState = { official: null, hasFixture: false, fixtureHash: "" };

describe("resumoMunicipio (matemática do painel)", () => {
  it("vencedor por argmax, margem=(v1-v2)/total, participação=total/eleitores", () => {
    const r = resumoMunicipio(FATO.municipios[0], CANDIDATOS);
    expect(r).not.toBeNull();
    expect(r!.vencedorId).toBe("A");
    expect(r!.vencedorNome).toBe("Cand A");
    expect(r!.margem).toBeCloseTo(0.2, 10); // (600-400)/1000
    expect(r!.participacao).toBeCloseTo(0.1, 10); // 1000/10000
  });
  it("empate: primeiro na ordem vence (determinístico, como o motor)", () => {
    const r = resumoMunicipio(mun("1", "SP", [500, 500], demoCompleta(), 1000), CANDIDATOS);
    expect(r!.vencedorId).toBe("A");
    expect(r!.margem).toBeCloseTo(0, 10);
  });
  it("sem eleitores: participação null (fail-closed, nunca zero silencioso)", () => {
    const r = resumoMunicipio(
      mun("1", "SP", [600, 400], { ...demoCompleta(), eleitores: null }, 1000),
      CANDIDATOS,
    );
    expect(r!.participacao).toBeNull();
  });
});

describe("agregarUF (clique UF do mapa)", () => {
  it("soma votos por candidato e resolve o vencedor da UF", () => {
    const a = agregarUF(FATO.municipios, "SP", CANDIDATOS);
    expect(a).not.toBeNull();
    expect(a!.vencedorId).toBe("B"); // 700 x 1300
    expect(a!.nMun).toBe(2);
  });
  it("UF sem linhas -> null (fail-closed)", () => {
    expect(agregarUF(FATO.municipios, "RJ", CANDIDATOS)).toBeNull();
  });
});

describe("PainelRegiao (município)", () => {
  it("mostra vencedor + margem + perfil com selo ecológico", () => {
    const html = renderToStaticMarkup(
      <PainelRegiao ibge="3550308" fato={FATO} seal={SEAL_OFICIAL} manifestChecked />,
    );
    expect(html).toContain("Cand A");
    expect(html).toContain("20,0%"); // margem pt-BR
    expect(html).toContain(ECO_SEAL);
    expect(html).toContain("dado de município, não de pessoa");
    expect(html).toContain("fonte auditada");
  });
  it("ações Comparar / Por quê? / Verificar com hrefs exatos", () => {
    const html = renderToStaticMarkup(
      <PainelRegiao ibge="3550308" fato={FATO} seal={SEAL_OFICIAL} manifestChecked />,
    );
    expect(html).toContain('href="/analisar"');
    expect(html).toContain('href="/explorar?foco=3550308"');
    expect(html).toContain('href="/verificar?regiao=SP"');
  });
  it("pesoFonte misto: nota honesta de pesos visível", () => {
    const fatoMisto: FatoRegiao = {
      candidatos: CANDIDATOS,
      municipios: [
        mun("3550308", "SP", [600, 400], { ...demoCompleta(), eleitores: null }, 1000),
      ],
    };
    const html = renderToStaticMarkup(
      <PainelRegiao ibge="3550308" fato={fatoMisto} seal={SEAL_OFICIAL} manifestChecked />,
    );
    expect(html).toContain(NOTA_PESO_MISTO);
  });
  it("demo null: perfil em sem dado oficial, votos intactos", () => {
    const fatoNull: FatoRegiao = {
      candidatos: CANDIDATOS,
      municipios: [mun("3550308", "SP", [600, 400], null, 1000)],
    };
    const html = renderToStaticMarkup(
      <PainelRegiao ibge="3550308" fato={fatoNull} seal={SEAL_OFICIAL} manifestChecked />,
    );
    const perfil = html.split(/<h2[^>]*>Perfil do lugar<\/h2>/)[1] ?? "";
    expect(perfil).toContain("sem dado oficial");
    expect(html).toContain("Cand A");
    expect(html).toContain("600");
  });
  it("ibge ausente no fato: fail-closed com role=alert", () => {
    const html = renderToStaticMarkup(
      <PainelRegiao ibge="9999999" fato={FATO} seal={SEAL_OFICIAL} manifestChecked />,
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain("sem dado oficial");
  });
  it("EXTERIOR: fail-closed (fora do fato municipal)", () => {
    const html = renderToStaticMarkup(
      <PainelRegiao ibge="EXTERIOR" fato={FATO} seal={SEAL_OFICIAL} manifestChecked />,
    );
    expect(html).toContain("sem dado oficial");
  });
});

describe("pixel-mentiroso (toda resposta exibe fonte+hash)", () => {
  // Stem de 12 chars do hash do selo oficial (SourceBadge renderiza
  // `<code>{stem}…</code>` + `title="sha256: {hash cheio}"`).
  const HASH_SHORT = "ab".repeat(6);
  /** Outcome honesto POR SEÇÃO: hash curto, selo oficial ou aviso fail-closed. */
  function secaoHonesta(s: string): boolean {
    return (
      s.includes(HASH_SHORT) ||
      s.includes("fonte auditada") ||
      s.includes("dado não auditado")
    );
  }
  function secoesDe(html: string): string[] {
    const ss = html.split("<section").slice(1);
    expect(ss.length).toBeGreaterThan(0);
    return ss;
  }
  it("com selo oficial: cada seção com número tem badge visível", () => {
    const html = renderToStaticMarkup(
      <PainelRegiao ibge="3550308" fato={FATO} seal={SEAL_OFICIAL} manifestChecked />,
    );
    for (const s of secoesDe(html)) {
      expect(secaoHonesta(s)).toBe(true);
    }
    expect(html).toContain("fonte auditada");
    expect(html).toContain(HASH_SHORT); // hash curto visível
  });
  it("sem selo: fato suprimido pelo portão da página → SEM_DADO, sem número (supressão, não só badges)", () => {
    // EVOLVE-10 Task 1: a página passa `fato=null` salvo
    // `vereditoTemProva(seal)` — este input é o único shape sem-prova que o
    // painel recebe em prod. Trava a supressão: Resultado + Perfil em
    // SEM_DADO e ZERO número de candidato, além dos badges honestos.
    const html = renderToStaticMarkup(
      <PainelRegiao ibge="3550308" fato={null} seal={SEAL_NULO} manifestChecked />,
    );
    expect(html).not.toContain("fonte auditada");
    for (const s of secoesDe(html)) {
      expect(secaoHonesta(s)).toBe(true);
    }
    expect(html).toContain("dado não auditado");
    const resultado = html.split(/<h2[^>]*>Resultado<\/h2>/)[1]?.split("<section")[0] ?? "";
    const perfil = html.split(/<h2[^>]*>Perfil do lugar<\/h2>/)[1]?.split("<section")[0] ?? "";
    expect(resultado).toContain("sem dado oficial");
    expect(perfil).toContain("sem dado oficial");
    expect(html).not.toContain("Cand A");
    expect(html).not.toContain("Cand B");
    expect(html).not.toContain("Votos do vencedor");
  });
  it("fail-closed (ibge ausente): cada seção honesta mesmo sem números", () => {
    const html = renderToStaticMarkup(
      <PainelRegiao ibge="9999999" fato={FATO} seal={SEAL_NULO} manifestChecked />,
    );
    for (const s of secoesDe(html)) {
      expect(secaoHonesta(s)).toBe(true);
    }
  });
});

describe("nota de pesos mistos inclui o baseline", () => {
  it("restrito em eleitores + baseline misto -> nota renderiza (município)", () => {
    const fato: FatoRegiao = {
      candidatos: CANDIDATOS,
      municipios: [
        mun("3550308", "SP", [600, 400], demoCompleta(), 1000), // A vence, peso eleitores
        mun("3550309", "SP", [700, 100], { ...demoCompleta(), eleitores: null }, 1000), // A vence, fallback total
        mun("3550310", "SP", [100, 900], demoCompleta(), 1000), // B vence
      ],
    };
    const html = renderToStaticMarkup(
      <PainelRegiao ibge="3550308" fato={fato} seal={SEAL_OFICIAL} manifestChecked />,
    );
    expect(html).toContain(NOTA_PESO_MISTO);
  });
  it("restrito em eleitores + baseline misto -> nota renderiza (UF)", () => {
    const fato: FatoRegiao = {
      candidatos: CANDIDATOS,
      municipios: [
        mun("3550308", "SP", [100, 900], demoCompleta(), 1000), // B vence, peso eleitores
        mun("3550309", "SP", [200, 800], demoCompleta(), 1000), // B vence, peso eleitores
        mun("3304557", "RJ", [100, 900], { ...demoCompleta(), eleitores: null }, 1000), // B vence, fallback total
      ],
    };
    const html = renderToStaticMarkup(
      <PainelRegiao ibge="SP" fato={fato} seal={SEAL_OFICIAL} manifestChecked />,
    );
    expect(html).toContain(NOTA_PESO_MISTO);
  });
  it("restrito e baseline em eleitores -> sem nota", () => {
    const html = renderToStaticMarkup(
      <PainelRegiao ibge="3550308" fato={FATO} seal={SEAL_OFICIAL} manifestChecked />,
    );
    expect(html).not.toContain(NOTA_PESO_MISTO);
  });
});

describe("População real do Censo no ramo UF (EVOLVE-7 Task 3)", () => {
  // Mapa com RJ extra p/ distinguir soma da UF (SP: 12345+6789=19134) do
  // baseline Brasil (19134+1000=20134).
  const CENSO_UF = { "3550308": 12345, "3550309": 6789, "3304557": 1000 };
  const FATO_UF: FatoRegiao = {
    candidatos: CANDIDATOS,
    municipios: [
      mun("3550308", "SP", [600, 400], demoCompleta(), 1000),
      mun("3550309", "SP", [100, 900], demoCompleta({ esc_sup: 20 }), 1000),
      mun("3304557", "RJ", [100, 900], demoCompleta(), 1000),
    ],
  };
  it("UF agrega pop dos municípios (soma) + baseline Brasil + votos intactos", () => {
    const html = renderToStaticMarkup(
      <PainelRegiao ibge="SP" fato={FATO_UF} seal={SEAL_OFICIAL} manifestChecked censo={CENSO_UF} />,
    );
    const perfil = html.split(/<h2[^>]*>Perfil do lugar<\/h2>/)[1] ?? "";
    expect(perfil).toContain("População (Censo 2022)");
    expect(perfil).toContain("19.134"); // soma SP, nunca demo fixture
    expect(perfil).toContain("Brasil:");
    expect(perfil).toContain("20.134"); // baseline = soma do mapa inteiro
    expect(perfil).toContain(ECO_SEAL); // eco-seal mantido
    expect(html).toContain("Cand B"); // votos da UF intactos (700 x 1300)
    expect(html).toContain("Votos do vencedor: 1.300"); // B: 400+900, pt-BR
  });
  it("UF sem censo: pop em SEM_DADO (fail-closed, sem número inventado)", () => {
    const html = renderToStaticMarkup(
      <PainelRegiao ibge="SP" fato={FATO_UF} seal={SEAL_OFICIAL} manifestChecked censo={null} />,
    );
    const perfil = html.split(/<h2[^>]*>Perfil do lugar<\/h2>/)[1] ?? "";
    expect(perfil).toContain("População (Censo 2022)");
    const linha = (perfil.split("População (Censo 2022)")[1] ?? "").split("</li>")[0];
    expect(linha).toContain("sem dado oficial");
  });
  it("totalUFCenso: soma só os IBGEs da UF; vazio/ausente -> null", async () => {
    const { totalUFCenso } = await import("../components/PainelRegiao");
    expect(totalUFCenso(CENSO_UF, ["3550308", "3550309"])).toBe(19134);
    expect(totalUFCenso(CENSO_UF, ["3304557"])).toBe(1000);
    expect(totalUFCenso(CENSO_UF, ["9999999"])).toBe(null);
    expect(totalUFCenso(CENSO_UF, [])).toBe(null);
    expect(totalUFCenso(null, ["3550308"])).toBe(null);
  });
  it("fato null + Censo: UF agrega do mapa (fato-independente, nunca SEM_DADO)", () => {
    const html = renderToStaticMarkup(
      <PainelRegiao ibge="SP" fato={null} seal={SEAL_NULO} manifestChecked censo={CENSO_UF} />,
    );
    const perfil = html.split(/<h2[^>]*>Perfil do lugar<\/h2>/)[1] ?? "";
    expect(perfil).toContain("População (Censo 2022)");
    expect(perfil).toContain("19.134"); // soma SP das chaves do mapa, sem fato
    expect(perfil).toContain(ECO_SEAL);
  });
  it("fato parcial: UF soma o mapa inteiro (sem subestimar pelo fato)", () => {
    const fatoParcial: FatoRegiao = {
      candidatos: CANDIDATOS,
      municipios: [mun("3550308", "SP", [600, 400], demoCompleta(), 1000)],
    };
    const html = renderToStaticMarkup(
      <PainelRegiao ibge="SP" fato={fatoParcial} seal={SEAL_OFICIAL} manifestChecked censo={CENSO_UF} />,
    );
    const perfil = html.split(/<h2[^>]*>Perfil do lugar<\/h2>/)[1] ?? "";
    const linha = (perfil.split("População (Censo 2022)")[1] ?? "").split("</li>")[0];
    expect(linha).toContain("19.134"); // 12345+6789 do mapa, não só o 3550308 do fato
  });
  it("chave UF ausente no mapa soma só o presente (sem fallback, UF)", () => {
    const censoFalha = { "3550308": 12345, "3304557": 1000 }; // 3550309 sem par
    const html = renderToStaticMarkup(
      <PainelRegiao ibge="SP" fato={FATO_UF} seal={SEAL_OFICIAL} manifestChecked censo={censoFalha} />,
    );
    const perfil = html.split(/<h2[^>]*>Perfil do lugar<\/h2>/)[1] ?? "";
    const linha = (perfil.split("População (Censo 2022)")[1] ?? "").split("</li>")[0];
    expect(linha).toContain("12.345");
    expect(linha).not.toContain("19.134"); // soma parcial honesta, sem completar
  });
  it("popUFNoCenso/ibgesDaUFNoCenso: agrega pelas chaves do mapa (prefixo IBGE→UF)", async () => {
    const { popUFNoCenso, ibgesDaUFNoCenso } = await import("../components/PainelRegiao");
    expect(ibgesDaUFNoCenso(CENSO_UF, "SP").sort()).toEqual(["3550308", "3550309"]);
    expect(ibgesDaUFNoCenso(CENSO_UF, "RJ")).toEqual(["3304557"]);
    expect(ibgesDaUFNoCenso(CENSO_UF, "MG")).toEqual([]);
    expect(ibgesDaUFNoCenso(null, "SP")).toEqual([]);
    expect(popUFNoCenso(CENSO_UF, "SP")).toBe(19134);
    expect(popUFNoCenso(CENSO_UF, "RJ")).toBe(1000);
    expect(popUFNoCenso(CENSO_UF, "MG")).toBe(null);
    expect(popUFNoCenso(null, "SP")).toBe(null);
  });
});

describe("fatoDatasetDe (?fato= com allowlist)", () => {
  const MANIFEST = {
    ingestions: [{ tipo: "fato_municipal", dataset: "fato_2022_1_presidente" }],
  };
  it("sem override: default do manifest; override válido vence", async () => {
    const { fatoDatasetDe } = await import("../lib/regiao");
    expect(fatoDatasetDe(MANIFEST)).toBe("fato_2022_1_presidente");
    expect(fatoDatasetDe(MANIFEST, "")).toBe("fato_2022_1_presidente");
    expect(fatoDatasetDe(MANIFEST, "fato_2022_2_governador")).toBe("fato_2022_2_governador");
    expect(fatoDatasetDe(MANIFEST, "  fato_2022_2_governador  ")).toBe("fato_2022_2_governador");
  });
  it("override fora do allowlist é rejeitado -> default do manifest (fail-closed)", async () => {
    const { fatoDatasetDe } = await import("../lib/regiao");
    expect(fatoDatasetDe(MANIFEST, "fato_../manifest")).toBe("fato_2022_1_presidente");
    expect(fatoDatasetDe(MANIFEST, "resumo")).toBe("fato_2022_1_presidente");
    expect(fatoDatasetDe(MANIFEST, "fato_2022_1_presi dente")).toBe("fato_2022_1_presidente");
    expect(fatoDatasetDe(null, "fato_../manifest")).toBe(null);
    expect(fatoDatasetDe(null)).toBe(null);
  });
  it("isFatoDataset: shape fato_* exato, sem traversal", async () => {
    const { isFatoDataset } = await import("../lib/regiao");
    expect(isFatoDataset("fato_2022_1_presidente")).toBe(true);
    expect(isFatoDataset("fato_2022_2_governador")).toBe(true);
    expect(isFatoDataset("fato_../manifest")).toBe(false);
    expect(isFatoDataset("fato_2022_presidente")).toBe(false);
    expect(isFatoDataset("resumo")).toBe(false);
    expect(isFatoDataset("")).toBe(false);
    expect(isFatoDataset(null)).toBe(false);
  });
  it("manifest default fora do shape -> null (mesmo allowlist do ?fato=)", async () => {
    const { fatoDatasetDe } = await import("../lib/regiao");
    expect(
      fatoDatasetDe({ ingestions: [{ tipo: "fato_municipal", dataset: "fato_../../x" }] }),
    ).toBe(null);
    expect(
      fatoDatasetDe({ ingestions: [{ tipo: "fato_municipal", dataset: "fato_x" }] }),
    ).toBe(null);
    expect(
      fatoDatasetDe({
        ingestions: [{ tipo: "fato_municipal", dataset: "fato_2022_1_presidente" }],
      }),
    ).toBe("fato_2022_1_presidente");
  });
});

describe("getSealParaDataset (selo ligado ao dataset selecionado)", () => {
  const MANIFEST_2 = {
    ingestions: [
      {
        tipo: "fato_municipal",
        dataset: "fato_2022_1_presidente",
        sha256: "a".repeat(64),
        source_url: "https://cdn.tse.jus.br/a.zip",
        date: "2026-01-01",
      },
      {
        tipo: "fato_municipal",
        dataset: "fato_2022_2_governador",
        sha256: "b".repeat(64),
        source_url: "https://cdn.tse.jus.br/b.zip",
        date: "2026-02-01",
      },
    ],
  };
  it("resolve o registro do dataset selecionado, não o da primeira ingestão", async () => {
    const { getSealParaDataset } = await import("../lib/regiao");
    expect(getSealParaDataset(MANIFEST_2, "fato_2022_2_governador").official?.hash).toBe(
      "b".repeat(64),
    );
    expect(getSealParaDataset(MANIFEST_2, "fato_2022_1_presidente").official?.hash).toBe(
      "a".repeat(64),
    );
  });
  it("dataset sem registro -> fail-closed (sem oficial, sem fixture)", async () => {
    const { getSealParaDataset } = await import("../lib/regiao");
    const seal = getSealParaDataset(MANIFEST_2, "fato_2024_1_prefeito");
    expect(seal.official).toBe(null);
    expect(seal.hasFixture).toBe(false);
    expect(seal.fixtureHash).toBe("");
  });
  it("fixture do dataset nunca é oficial, mas sinaliza fixture", async () => {
    const { getSealParaDataset } = await import("../lib/regiao");
    const manifest = {
      ingestions: [
        {
          tipo: "fato_municipal",
          dataset: "fato_2022_1_presidente",
          sha256: "f".repeat(64),
          fixture: true,
        },
      ],
    };
    const seal = getSealParaDataset(manifest, "fato_2022_1_presidente");
    expect(seal.official).toBe(null);
    expect(seal.hasFixture).toBe(true);
    expect(seal.fixtureHash).toBe("f".repeat(64));
  });
  it("entrada sem hash não audita o dataset (fail-closed)", async () => {
    const { getSealParaDataset } = await import("../lib/regiao");
    const manifest = {
      ingestions: [
        {
          tipo: "fato_municipal",
          dataset: "fato_2022_1_presidente",
          source_url: "https://cdn.tse.jus.br/a.zip",
        },
      ],
    };
    const seal = getSealParaDataset(manifest, "fato_2022_1_presidente");
    expect(seal.official).toBe(null);
  });
  it("manifest ausente ou dataset vazio -> selo vazio", async () => {
    const { getSealParaDataset } = await import("../lib/regiao");
    expect(getSealParaDataset(null, "fato_2022_1_presidente").official).toBe(null);
    expect(getSealParaDataset(MANIFEST_2, null).official).toBe(null);
    expect(getSealParaDataset(MANIFEST_2, "").official).toBe(null);
  });
});

describe("entradaFatoAuditada (portão fail-closed do fato selecionado)", () => {
  const MANIFEST = {
    ingestions: [
      {
        tipo: "fato_municipal",
        dataset: "fato_2022_1_presidente",
        sha256: "a".repeat(64),
        source_url: "https://cdn.tse.jus.br/a.zip",
        date: "2026-01-01",
      },
      {
        tipo: "fato_municipal",
        dataset: "fato_2022_2_governador",
        sha256: "f".repeat(64),
        fixture: true,
      },
    ],
  };
  it("dataset auditado não-fixture -> devolve a entrada", async () => {
    const { entradaFatoAuditada } = await import("../lib/regiao");
    expect(
      entradaFatoAuditada(MANIFEST, "fato_2022_1_presidente")?.dataset,
    ).toBe("fato_2022_1_presidente");
  });
  it("fixture, sem hash ou outro dataset -> null (sem veredito sem hash)", async () => {
    const { entradaFatoAuditada } = await import("../lib/regiao");
    expect(entradaFatoAuditada(MANIFEST, "fato_2022_2_governador")).toBe(null);
    expect(entradaFatoAuditada(MANIFEST, "fato_2024_1_prefeito")).toBe(null);
    expect(entradaFatoAuditada(null, "fato_2022_1_presidente")).toBe(null);
  });
});

describe("agregarUF usa totalLinha (brancos/nulos no denominador)", () => {
  it("total soma row.total; margem/participação consistentes com o painel", () => {
    const rows = [
      mun("3550308", "SP", [600, 400], demoCompleta(), 1200), // 200 brancos/nulos
      mun("3550309", "SP", [100, 900], demoCompleta(), 1100), // 100 brancos/nulos
    ];
    const a = agregarUF(rows, "SP", CANDIDATOS);
    expect(a).not.toBeNull();
    expect(a!.vencedorId).toBe("B"); // 700 x 1300
    expect(a!.total).toBe(2300); // 1200 + 1100, não 2000
    expect(a!.margem).toBeCloseTo((1300 - 700) / 2300, 10);
    expect(a!.participacao).toBeCloseTo(2300 / 20000, 10);
  });
});

describe("renda ausente nunca vira R$ 0 (fail-closed)", () => {
  const FATO_SEM_RENDA: FatoRegiao = {
    candidatos: CANDIDATOS,
    municipios: [
      mun("3550308", "SP", [600, 400], { ...demoCompleta(), renda_media: null }, 1000),
      mun("3550309", "SP", [100, 900], { ...demoCompleta(), renda_media: null }, 1000),
    ],
  };
  it("município sem renda: SEM_DADO no valor e no baseline Brasil", () => {
    const html = renderToStaticMarkup(
      <PainelRegiao ibge="3550308" fato={FATO_SEM_RENDA} seal={SEAL_OFICIAL} manifestChecked />,
    );
    expect(html).not.toContain("R$ 0");
    expect(html).toContain("sem dado oficial");
  });
  it("UF sem renda: SEM_DADO (ramo UF + baseline Brasil)", () => {
    const html = renderToStaticMarkup(
      <PainelRegiao ibge="SP" fato={FATO_SEM_RENDA} seal={SEAL_OFICIAL} manifestChecked />,
    );
    expect(html).not.toContain("R$ 0");
    expect(html).toContain("sem dado oficial");
  });
});

describe("ações preservam o dataset selecionado (?fato=)", () => {
  it("Por quê? carrega ?fato= (município e UF)", () => {
    const htmlMun = renderToStaticMarkup(
      <PainelRegiao
        ibge="3550308"
        fato={FATO}
        seal={SEAL_OFICIAL}
        manifestChecked
        fatoDataset="fato_2022_1_presidente"
      />,
    );
    expect(htmlMun).toContain(
      'href="/explorar?foco=3550308&amp;fato=fato_2022_1_presidente"',
    );
    const htmlUf = renderToStaticMarkup(
      <PainelRegiao
        ibge="SP"
        fato={FATO}
        seal={SEAL_OFICIAL}
        manifestChecked
        fatoDataset="fato_2022_1_presidente"
      />,
    );
    expect(htmlUf).toContain('href="/explorar?foco=SP&amp;fato=fato_2022_1_presidente"');
  });
  it("sem dataset: links inalterados (sem &fato=)", () => {
    const html = renderToStaticMarkup(
      <PainelRegiao ibge="3550308" fato={FATO} seal={SEAL_OFICIAL} manifestChecked />,
    );
    expect(html).toContain('href="/explorar?foco=3550308"');
    expect(html).not.toContain("fato=");
  });
  it("dataset fora do shape nunca vaza para a URL", () => {
    const html = renderToStaticMarkup(
      <PainelRegiao
        ibge="3550308"
        fato={FATO}
        seal={SEAL_OFICIAL}
        manifestChecked
        fatoDataset="fato_../../x"
      />,
    );
    expect(html).toContain('href="/explorar?foco=3550308"');
    expect(html).not.toContain("fato=");
  });
});

describe("Verificar emite a UF (índice filtra por sigla)", () => {
  it("município SP -> ?regiao=SP (casa com checksParaRegiao)", () => {
    const html = renderToStaticMarkup(
      <PainelRegiao ibge="3550308" fato={FATO} seal={SEAL_OFICIAL} manifestChecked />,
    );
    expect(html).toContain('href="/verificar?regiao=SP"');
  });
});

describe("isHashDivergente (alerta de hash do /explorar)", () => {
  it("URL com hash + manifest sem hash oficial -> diverge (fixture-only)", async () => {
    const { isHashDivergente } = await import("../lib/regiao");
    expect(isHashDivergente("abc123", "", true)).toBe(true);
  });
  it("hash igual -> sem alerta; hashes diferentes -> alerta", async () => {
    const { isHashDivergente } = await import("../lib/regiao");
    expect(isHashDivergente("abc123", "abc123", true)).toBe(false);
    expect(isHashDivergente("abc123", "def456", true)).toBe(true);
  });
  it("sem hash na URL -> sem alerta; sem manifestChecked -> sem alerta", async () => {
    const { isHashDivergente } = await import("../lib/regiao");
    expect(isHashDivergente("", "", true)).toBe(false);
    expect(isHashDivergente("", "abc123", true)).toBe(false);
    expect(isHashDivergente("abc123", "", false)).toBe(false);
  });
});

describe("vereditoTemProva (portão de veredito da rota /verificar)", () => {
  it("selo oficial -> true; selo vazio -> false", async () => {
    const { vereditoTemProva } = await import("../lib/regiao");
    expect(
      vereditoTemProva({ official: { hash: "ab".repeat(32), url: "u", date: "d" }, hasFixture: false, fixtureHash: "" }),
    ).toBe(true);
    expect(vereditoTemProva({ official: null, hasFixture: false, fixtureHash: "" })).toBe(false);
  });
  it("selo hand-built com hash não-64-hex nega prova (strict, fonte única isAudited)", async () => {
    const { vereditoTemProva } = await import("../lib/regiao");
    expect(
      vereditoTemProva({ official: { hash: "abc", url: "u", date: "d" }, hasFixture: false, fixtureHash: "" }),
    ).toBe(false);
    expect(vereditoTemProva({ official: null, hasFixture: true, fixtureHash: "abc" })).toBe(false);
    expect(
      vereditoTemProva({ official: { hash: "   ", url: "u", date: "d" }, hasFixture: false, fixtureHash: "" }),
    ).toBe(false);
  });
  it("selo legítimo com 64-hex (incl. maiúsculas) mantém prova — sem regressão", async () => {
    const { vereditoTemProva } = await import("../lib/regiao");
    expect(
      vereditoTemProva({ official: { hash: "AB".repeat(32), url: "u", date: "d" }, hasFixture: false, fixtureHash: "" }),
    ).toBe(true);
    expect(vereditoTemProva({ official: null, hasFixture: true, fixtureHash: "ef".repeat(32) })).toBe(true);
  });
});

describe("censoTemProva (selo runtime do Censo — EVOLVE-8 Task 1)", () => {
  // Paridade com o gate do fato (`vereditoTemProva` + `isAudited`): a pop
  // só renderiza com entry `artifacts` do Censo com sha256 64-hex.
  // Fixture com hash válido CONTA como prova (seed legítimo é
  // fixture:true — pin de `test_seed_artifact_entries` no pytest).
  const CENSO_OK = {
    artifacts: [
      {
        arquivo: "censo_municipios.json",
        sha256: "c".repeat(64),
        source_url: "https://cdn.ibge.gov.br/censo.zip",
      },
    ],
  };
  it("manifest sem entry do Censo nega prova (fail-closed)", async () => {
    const { censoTemProva } = await import("../lib/regiao");
    expect(censoTemProva(null)).toBe(false);
    expect(censoTemProva({})).toBe(false);
    expect(censoTemProva({ ingestions: [] })).toBe(false);
    expect(censoTemProva({ artifacts: [] })).toBe(false);
    expect(
      censoTemProva({
        artifacts: [{ arquivo: "resumo.json", sha256: "c".repeat(64) }],
      }),
    ).toBe(false);
  });
  it("entry com hash fora do 64-hex nega prova (forjado)", async () => {
    const { censoTemProva } = await import("../lib/regiao");
    const semProva = (sha256: unknown) =>
      censoTemProva({
        artifacts: [{ arquivo: "censo_municipios.json", sha256 }],
      });
    expect(semProva("abc")).toBe(false);
    expect(semProva("   ")).toBe(false);
    expect(semProva("c".repeat(63))).toBe(false);
    expect(semProva(undefined)).toBe(false);
    // Alias `hash` nunca produzido pelo ETL — rejeitado como no fato.
    expect(
      censoTemProva({
        artifacts: [{ arquivo: "censo_municipios.json", hash: "c".repeat(64) }],
      }),
    ).toBe(false);
  });
  it("entry 64-hex (incl. maiúsculas) dá prova — sem falso-negativo", async () => {
    const { censoTemProva, entradaCensoAuditada } = await import("../lib/regiao");
    expect(censoTemProva(CENSO_OK)).toBe(true);
    expect(
      censoTemProva({
        artifacts: [{ arquivo: "censo_municipios.json", sha256: "AB".repeat(32) }],
      }),
    ).toBe(true);
    // Seed legítimo: fixture:true com hash válido conta como prova.
    expect(
      censoTemProva({
        artifacts: [
          { arquivo: "censo_municipios.json", sha256: "f".repeat(64), fixture: true },
        ],
      }),
    ).toBe(true);
    // Basename com prefixo de path casa (entry grava basename; tolera path).
    expect(
      censoTemProva({
        artifacts: [{ arquivo: "data/censo_municipios.json", sha256: "c".repeat(64) }],
      }),
    ).toBe(true);
    expect(entradaCensoAuditada(CENSO_OK)?.arquivo).toBe("censo_municipios.json");
    expect(entradaCensoAuditada({ artifacts: [] })).toBe(null);
    expect(entradaCensoAuditada(null)).toBe(null);
  });
});

describe("População real do Censo (EVOLVE-7 Task 2)", () => {
  // Mapa mínimo no shape do artefato `censo_municipios.json` ({ibge7: pop}):
  // 12345 + 6789 = 19134 de baseline Brasil.
  const CENSO = { "3550308": 12345, "3550309": 6789 };
  const FATO_POP_REAL: FatoRegiao = {
    candidatos: CANDIDATOS,
    municipios: [
      mun(
        "3550308",
        "SP",
        [600, 400],
        {
          ...demoCompleta(),
          esc_sup: null,
          esc_med: null,
          esc_fund: null,
          renda_media: null,
          pobres_pct: null,
          idade_mediana: null,
          urbanizacao: null,
        },
        1000,
      ),
    ],
  };
  function linhaPop(perfil: string): string {
    return (perfil.split("População (Censo 2022)")[1] ?? "").split("</li>")[0];
  }
  it("demo pop-real (esc_* null): número pop + SEM_DADO no resto + votos intactos", () => {
    const html = renderToStaticMarkup(
      <PainelRegiao ibge="3550308" fato={FATO_POP_REAL} seal={SEAL_OFICIAL} manifestChecked censo={CENSO} />,
    );
    const perfil = html.split(/<h2[^>]*>Perfil do lugar<\/h2>/)[1] ?? "";
    expect(perfil).toContain("População (Censo 2022)");
    expect(perfil).toContain("12.345"); // pop do artefato, nunca demo fixture
    expect(perfil).toContain("Brasil:");
    expect(perfil).toContain("19.134"); // baseline = soma do mapa
    expect(linhaPop(perfil)).not.toContain("sem dado oficial"); // sem SEM_DADO espúrio na pop
    expect(perfil).toContain("sem dado oficial"); // SEM_DADO no resto (esc/renda/pobres)
    expect(html).toContain("Cand A"); // votos intactos
    expect(html).toContain("600");
    expect(perfil).toContain(ECO_SEAL); // eco-seal mantido
  });
  it("fato-independent: sem fato, pop real renderiza com eco-seal", () => {
    const html = renderToStaticMarkup(
      <PainelRegiao ibge="3550308" fato={null} seal={SEAL_NULO} manifestChecked censo={CENSO} />,
    );
    expect(html).toContain("População (Censo 2022)");
    expect(html).toContain("12.345");
    expect(html).toContain(ECO_SEAL);
  });
  it("censo ausente: pop em SEM_DADO (fail-closed, sem número inventado)", () => {
    const html = renderToStaticMarkup(
      <PainelRegiao ibge="3550308" fato={FATO} seal={SEAL_OFICIAL} manifestChecked censo={null} />,
    );
    const perfil = html.split(/<h2[^>]*>Perfil do lugar<\/h2>/)[1] ?? "";
    expect(perfil).toContain("População (Censo 2022)");
    expect(linhaPop(perfil)).toContain("sem dado oficial");
  });
  it("pop sem par no mapa nunca cai p/ demo.pop fixture nem baseline (município)", () => {
    const html = renderToStaticMarkup(
      <PainelRegiao ibge="3550308" fato={FATO} seal={SEAL_OFICIAL} manifestChecked censo={{}} />,
    );
    const perfil = html.split(/<h2[^>]*>Perfil do lugar<\/h2>/)[1] ?? "";
    const linha = linhaPop(perfil);
    expect(linha).toContain("sem dado oficial");
    expect(linha).not.toContain("12.000"); // demo.pop fixture do FATO nunca vaza
  });
  it("helpers do artefato: parse fail-closed + baseline soma do mapa", async () => {
    const { parseCensoMapa, popNoCenso, totalBrasilCenso } = await import(
      "../components/PainelRegiao"
    );
    expect(parseCensoMapa({ "3550308": 12345 })).toEqual({ "3550308": 12345 });
    expect(parseCensoMapa(null)).toBe(null);
    expect(parseCensoMapa([])).toBe(null);
    expect(parseCensoMapa("3550308")).toBe(null);
    expect(popNoCenso({ "3550308": 12345 }, "3550308")).toBe(12345);
    expect(popNoCenso(null, "3550308")).toBe(null);
    expect(popNoCenso({ "3550308": 12345 }, "9999999")).toBe(null);
    expect(totalBrasilCenso({ a: 10, b: 20 })).toBe(30);
    expect(totalBrasilCenso(null)).toBe(null);
    expect(totalBrasilCenso({})).toBe(null);
  });
});
