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
    const perfil = html.split("<h2>Perfil do lugar</h2>")[1] ?? "";
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
  it("sem selo: nenhuma seção apresenta número como oficial (badge de aviso em cada)", () => {
    const html = renderToStaticMarkup(
      <PainelRegiao ibge="3550308" fato={FATO} seal={SEAL_NULO} manifestChecked />,
    );
    expect(html).not.toContain("fonte auditada");
    for (const s of secoesDe(html)) {
      expect(secaoHonesta(s)).toBe(true);
    }
    expect(html).toContain("dado não auditado");
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
  it("fixture com hash -> true (transparência, sem selo oficial); sem hash -> false", async () => {
    const { vereditoTemProva } = await import("../lib/regiao");
    expect(vereditoTemProva({ official: null, hasFixture: true, fixtureHash: "cd".repeat(32) })).toBe(true);
    expect(vereditoTemProva({ official: null, hasFixture: true, fixtureHash: "" })).toBe(false);
    expect(vereditoTemProva({ official: null, hasFixture: true, fixtureHash: "   " })).toBe(false);
  });
});
