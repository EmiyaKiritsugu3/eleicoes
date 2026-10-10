import { describe, it, expect } from "vitest";
import { buildCsvExport, buildShareUrl } from "../lib/export";

const AUDIT = {
  hash: "abc123",
  url: "https://cdn.tse.jus.br/x.zip",
  date: "2026-01-01",
};

describe("csv guard (M11)", () => {
  it("csv sem audit levanta em vez de gerar", () => {
    expect(() => buildCsvExport([{ a: 1 }], null)).toThrow(
      "export bloqueado: dado não auditado",
    );
  });
  it("csv com hash só-espaços levanta", () => {
    expect(() =>
      buildCsvExport([{ a: 1 }], { hash: "   ", url: "u", date: "d" }),
    ).toThrow("export bloqueado: dado não auditado");
  });
  it("csv com audit gera header de proveniência", () => {
    const csv = buildCsvExport([{ a: 1 }], AUDIT);
    expect(csv.split("\n")[0]).toContain("fonte,url,hash,data");
  });
});

describe("csv formula (M12)", () => {
  it("formula =1+1 sai neutralizada com apóstrofo", () => {
    const csv = buildCsvExport([{ c: "=1+1" }], AUDIT);
    expect(csv).toContain("'=1+1");
  });
  it("formula +,-,@ neutralizadas; valor normal intacto", () => {
    const csv = buildCsvExport(
      [{ c: "+2", d: "-3", e: "@x", f: "ok" }],
      AUDIT,
    );
    expect(csv).toContain("'+2");
    expect(csv).toContain("'-3");
    expect(csv).toContain("'@x");
    expect(csv).toContain(",ok,");
  });
});

describe("csv blank-cell (T4)", () => {
  it("null vira célula vazia deliberada (não 'null')", () => {
    const csv = buildCsvExport([{ a: null, b: 1 }], AUDIT);
    expect(csv.split("\n")[1].split(",")[0]).toBe("");
    expect(csv).not.toContain("null");
  });
  it("undefined vira célula vazia deliberada (não 'undefined')", () => {
    const csv = buildCsvExport([{ a: undefined, b: 1 }], AUDIT);
    expect(csv.split("\n")[1].split(",")[0]).toBe("");
    expect(csv).not.toContain("undefined");
  });
});

describe("csv header escape (T4)", () => {
  it("chave com vírgula sai escapada com aspas", () => {
    const csv = buildCsvExport([{ "a,b": 1 }], AUDIT);
    expect(csv.split("\n")[0]).toContain('"a,b"');
  });
  it("chave com aspa sai com aspa duplicada", () => {
    const csv = buildCsvExport([{ 'a"b': 1 }], AUDIT);
    expect(csv.split("\n")[0]).toContain('"a""b"');
  });
});

describe("csv formula+quote (CodeRabbit minor)", () => {
  it("header fórmula com vírgula fica um campo só: apóstrofo dentro das aspas", () => {
    const csv = buildCsvExport([{ "=a,b": 1 }], AUDIT);
    const header = csv.split("\n")[0];
    expect(header).toContain("\"'=a,b\"");
    expect(header).not.toContain("'\"=a,b\"");
  });
  it("valor fórmula com vírgula fica um campo só", () => {
    const csv = buildCsvExport([{ c: "=a,b" }], AUDIT);
    expect(csv.split("\n")[1]).toContain("\"'=a,b\"");
  });
});

describe("share hash trim (F5)", () => {
  it("hash só-espaços não entra na URL", () => {
    expect(buildShareUrl({ ano: "2022" }, "   ")).not.toContain("hash=");
  });
  it("hash com espaços ao redor entra aparado", () => {
    expect(buildShareUrl({ ano: "2022" }, "  abc  ")).toContain("hash=abc");
  });
});
