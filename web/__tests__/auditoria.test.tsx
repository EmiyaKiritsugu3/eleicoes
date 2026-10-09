import { describe, it, expect } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Auditoria from "../app/auditoria/page";
describe("auditoria", () => {
  it("requires hash to show numbers as official", async () => {
    const { isAudited } = await import("../lib/data");
    expect(isAudited({ sha256: "x" })).toBe(true);
  });
  it("fixture with hash is audited but never official display", async () => {
    const { isAudited, isFixtureEntry, isOfficialDisplay } = await import("../lib/data");
    const fixture = { sha256: "x", fixture: true };
    expect(isAudited(fixture)).toBe(true);
    expect(isFixtureEntry(fixture)).toBe(true);
    expect(isOfficialDisplay(fixture)).toBe(false);
    expect(isOfficialDisplay({ sha256: "x" })).toBe(true);
    expect(isOfficialDisplay({})).toBe(false);
  });
  it("getOfficialAuditInfo skips fixtures", async () => {
    const { getOfficialAuditInfo } = await import("../lib/data");
    const m = {
      ingestions: [
        { source_url: "u", sha256: "f", fixture: true },
        { source_url: "u2", sha256: "abc", date: "2026-01-01" },
      ],
    };
    expect(getOfficialAuditInfo(m)).toEqual({ hash: "abc", url: "u2", date: "2026-01-01" });
    expect(getOfficialAuditInfo({ ingestions: [{ sha256: "f", fixture: true }] })).toBe(null);
    expect(getOfficialAuditInfo(null)).toBe(null);
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
  it("never renders the official badge without fetched data", () => {
    expect(html).not.toContain("fonte auditada");
  });
});

describe("auditoria data path (CI seed via real build_all)", () => {
  it("reads seeded /data/*.json from disk as fixture (non-official) and coherent", async () => {
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
    const { isAudited, isOfficialDisplay } = await import("../lib/data");
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
      // Hash preservado para transparência, mas seed é fixture: nunca oficial.
      expect(isAudited(entry)).toBe(true);
      expect(isOfficialDisplay(entry)).toBe(false);
    }
    // Valores determinísticos do seed (scripts/seed_fixture_data.py).
    expect(resumo.total_votos).toBe(15);
    expect(resumo.total_linhas).toBe(2);
    expect(resumo.anos).toEqual([2022]);
    expect(porUf.length).toBe(2);
  });
});
