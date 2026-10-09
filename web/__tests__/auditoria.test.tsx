import { describe, it, expect } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Auditoria from "../app/auditoria/page";
describe("auditoria", () => {
  it("requires hash to show numbers as official", async () => {
    const { isAudited } = await import("../lib/data");
    expect(isAudited({ sha256: "x" })).toBe(true);
  });
});

describe("auditoria page (SSR fail-closed)", () => {
  const html = renderToStaticMarkup(<Auditoria />);
  it("renders heading, manifest download button and audit badge slot", () => {
    expect(html).toContain("SAD Eleições — auditoria");
    expect(html).toContain("Baixar manifest");
    expect(html).toContain("dado não auditado");
  });
  it("blocks manifest download without audited hash", () => {
    expect(html).toMatch(/<button[^>]*\bdisabled\b/);
  });
  it("links metodologia for the audit contract", () => {
    expect(html).toContain('href="/metodologia"');
  });
});

describe("auditoria data path (CI seed via real build_all)", () => {
  it("reads seeded /data/*.json from disk as audited and coherent", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const dir = path.resolve(__dirname, "../public/data");
    const missing = (name: string) =>
      new Error(
        `${name} ausente em web/public/data — gere com: python scripts/seed_fixture_data.py`,
      );
    let manifestRaw: string;
    let resumoRaw: string;
    let porUfRaw: string;
    try {
      manifestRaw = fs.readFileSync(path.join(dir, "manifest.json"), "utf-8");
      resumoRaw = fs.readFileSync(path.join(dir, "resumo.json"), "utf-8");
      porUfRaw = fs.readFileSync(path.join(dir, "por_uf.json"), "utf-8");
    } catch {
      throw missing("manifest.json/resumo.json/por_uf.json");
    }
    const { isAudited } = await import("../lib/data");
    const manifest = JSON.parse(manifestRaw) as {
      ingestions?: unknown[];
    };
    const resumo = JSON.parse(resumoRaw) as {
      total_votos: number;
      total_linhas: number;
      anos: number[];
    };
    const porUf = JSON.parse(porUfRaw) as unknown[];
    expect(Array.isArray(manifest.ingestions)).toBe(true);
    expect((manifest.ingestions ?? []).length).toBeGreaterThan(0);
    for (const entry of manifest.ingestions ?? []) {
      expect(isAudited(entry)).toBe(true);
    }
    // Valores determinísticos do seed (scripts/seed_fixture_data.py).
    expect(resumo.total_votos).toBe(15);
    expect(resumo.total_linhas).toBe(2);
    expect(resumo.anos).toEqual([2022]);
    expect(porUf.length).toBe(2);
  });
});
