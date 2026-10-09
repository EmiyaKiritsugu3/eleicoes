import { describe, it, expect } from "vitest";
import {
  buildCsvExport,
  buildShareUrl,
  emptyStateFor,
  parseAnalisarSearchParams,
  semCoberturaTurnoZona,
} from "../lib/export";
describe("buildShareUrl", () => {
  it("embeds manifest hash", () => {
    expect(buildShareUrl({ ano: 2022 }, "abc123")).toContain("abc123");
  });
  it("empty filter returns sem dado oficial state", () => {
    expect(emptyStateFor([])).toMatch(/sem dado oficial/i);
  });
  it("round-trips every hydrated filter key", () => {
    const url = buildShareUrl(
      {
        ano: "2022",
        cargo: "presidente",
        uf: "SP",
        turno: "1",
        zona: "003",
        partido: "PT",
        candidato: "LULA",
      },
      "abc123",
    );
    for (const v of ["2022", "presidente", "SP", "1", "003", "PT", "LULA", "abc123"]) {
      expect(url).toContain(encodeURIComponent(v));
    }
  });
});
describe("buildCsvExport", () => {
  it("header carries fonte,url,hash,data with rows", () => {
    const csv = buildCsvExport(
      [{ uf: "SP", votos: 100 }],
      { hash: "h", url: "u", date: "d" },
    );
    expect(csv.split("\n")[0]).toContain("fonte,url,hash,data");
  });
  it("header is exactly fonte,url,hash,data without rows", () => {
    expect(
      buildCsvExport([], { hash: "h", url: "u", date: "d" }).split("\n")[0],
    ).toBe("fonte,url,hash,data");
  });
  it("quote-escapes commas and quotes", () => {
    const csv = buildCsvExport(
      [{ nome: 'A "X", Jr', votos: 1 }],
      { hash: "h", url: "u", date: "d" },
    );
    expect(csv).toContain('"A ""X"", Jr"');
  });
});
describe("semCoberturaTurnoZona por-chave (M9)", () => {
  it("turno ativo sem coluna turno (zona com coluna) => true", () => {
    expect(
      semCoberturaTurnoZona([{ zona: "5" }], [], { turno: "1" }),
    ).toBe(true);
  });
  it("só zona ativa com coluna zona => false", () => {
    expect(
      semCoberturaTurnoZona([{ zona: "5" }], [], { zona: "5" }),
    ).toBe(false);
  });
  it("zona ativa sem coluna zona => true", () => {
    expect(
      semCoberturaTurnoZona([{ turno: "1" }], [], { zona: "5" }),
    ).toBe(true);
  });
  it("turno+zona ativos com só coluna turno => true", () => {
    expect(
      semCoberturaTurnoZona([{ turno: "1" }], [], { turno: "1", zona: "5" }),
    ).toBe(true);
  });
});
describe("semCoberturaTurnoZona", () => {
  it("honest zero: turno filter with no column coverage", () => {
    expect(
      semCoberturaTurnoZona([{ ano: 2022 }], [{ nome_urna: "A" }], { turno: "1" }),
    ).toBe(true);
  });
  it("no filter means no honest-zero", () => {
    expect(semCoberturaTurnoZona([{ ano: 2022 }], [], {})).toBe(false);
  });
  it("column present means filter applies", () => {
    expect(
      semCoberturaTurnoZona(
        [{ ano: 2022, turno: 1 }],
        [],
        { turno: "1" },
      ),
    ).toBe(false);
  });
});
describe("share full state pivo/modo/a/b (M13)", () => {
  it("serializes pivo,modo,a,b keys", () => {
    const url = buildShareUrl(
      { ano: 2022, pivo: "uf", modo: "candidatos", a: "X", b: "Y" },
      "h",
    );
    for (const part of ["pivo=uf", "modo=candidatos", "a=X", "b=Y"]) {
      expect(url).toContain(part);
    }
  });
  it("csv keeps f_* filter context columns", () => {
    const csv = buildCsvExport(
      [{ chave: "SP", votos: 10, f_ano: "2022", f_cargo: "presidente", f_uf: "", f_turno: "", f_zona: "", f_partido: "PT", f_candidato: "" }],
      { hash: "h", url: "u", date: "d" },
    );
    for (const col of ["f_ano", "f_cargo", "f_uf", "f_turno", "f_zona", "f_partido", "f_candidato"]) {
      expect(csv.split("\n")[0]).toContain(col);
    }
  });
});
describe("parseAnalisarSearchParams hydration allowlist (M13)", () => {
  it("tolerates ?modoX=1 preserving ano/cargo/uf", () => {
    const p = parseAnalisarSearchParams("?ano=2022&cargo=presidente&uf=SP&modoX=1");
    expect(p).toMatchObject({ ano: "2022", cargo: "presidente", uf: "SP" });
    expect(p).not.toHaveProperty("modoX");
  });
  it("hydrates pivo/modo/a/b", () => {
    const p = parseAnalisarSearchParams("?pivo=ano&modo=anos&a=2022&b=2018");
    expect(p).toMatchObject({ pivo: "ano", modo: "anos", a: "2022", b: "2018" });
  });
});
