import { describe, it, expect } from "vitest";
import {
  buildCsvExport,
  buildShareUrl,
  emptyStateFor,
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
    expect(buildCsvExport([], null).split("\n")[0]).toBe("fonte,url,hash,data");
  });
  it("quote-escapes commas and quotes", () => {
    const csv = buildCsvExport(
      [{ nome: 'A "X", Jr', votos: 1 }],
      { hash: "h", url: "u", date: "d" },
    );
    expect(csv).toContain('"A ""X"", Jr"');
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
