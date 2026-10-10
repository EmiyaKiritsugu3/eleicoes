import { describe, it, expect } from "vitest";
import React from "react";
import { existsSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import Auditoria from "../app/auditoria/page";
describe("auditoria", () => {
  it("requires hash 64-hex to show numbers as official (lixo nega selo)", async () => {
    const { isAudited } = await import("../lib/data");
    expect(isAudited({ sha256: "ab".repeat(32) })).toBe(true);
    expect(isAudited({ sha256: "abc123" })).toBe(false);
  });
  it("fixture with hash is audited but never official display", async () => {
    const { isAudited, isFixtureEntry, isOfficialDisplay } = await import("../lib/data");
    const fixture = { sha256: "ab".repeat(32), fixture: true };
    expect(isAudited(fixture)).toBe(true);
    expect(isFixtureEntry(fixture)).toBe(true);
    expect(isOfficialDisplay(fixture)).toBe(false);
    expect(isOfficialDisplay({ sha256: "ab".repeat(32) })).toBe(true);
    expect(isOfficialDisplay({})).toBe(false);
  });
  it("getOfficialAuditInfo skips fixtures", async () => {
    const { getOfficialAuditInfo } = await import("../lib/data");
    const m = {
      ingestions: [
        { source_url: "u", sha256: "f".repeat(64), fixture: true },
        { source_url: "u2", sha256: "ab".repeat(32), date: "2026-01-01" },
      ],
    };
    expect(getOfficialAuditInfo(m)).toEqual({ hash: "ab".repeat(32), url: "u2", date: "2026-01-01" });
    expect(getOfficialAuditInfo({ ingestions: [{ sha256: "f".repeat(64), fixture: true }] })).toBe(null);
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

// Sem seed em clone fresco o teste de disco pula (não falha): gere com
// `python scripts/seed_fixture_data.py --force` a partir da raiz do repo.
const DATA_DIR = path.resolve(__dirname, "../public/data");
const HAS_SEED = ["manifest.json", "resumo.json", "por_uf.json"].every((n) =>
  existsSync(path.join(DATA_DIR, n)),
);
describe.skipIf(!HAS_SEED)("auditoria data path (CI seed via real build_all)", () => {
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

describe("auditoria artifacts (EVOLVE-2 Task 1)", () => {
  it("getArtifacts devolve só entries com arquivo+hash, na ordem do manifest", async () => {
    const { getArtifacts } = await import("../lib/data");
    const m = {
      ingestions: [],
      artifacts: [
        { arquivo: "resumo.json", sha256: "ab".repeat(32), size_bytes: 1234, data: "2026-10-10" },
        { arquivo: "", sha256: "cd".repeat(32) },
        { arquivo: "sem-hash.json" },
        "lixo",
      ],
    };
    expect(getArtifacts(m)).toEqual([
      { arquivo: "resumo.json", sha256: "ab".repeat(32), size_bytes: 1234, data: "2026-10-10" },
    ]);
    expect(getArtifacts(null)).toEqual([]);
    expect(getArtifacts({ ingestions: [] })).toEqual([]);
  });
  it("ArtifactsTable renderiza sha resumido + tamanho pt-BR + data", async () => {
    const { ArtifactsTable } = await import("../components/ArtifactsTable");
    const sha = "ab".repeat(32);
    const html = renderToStaticMarkup(
      <ArtifactsTable artifacts={[{ arquivo: "resumo.json", sha256: sha, size_bytes: 1234, data: "2026-10-10" }]} />,
    );
    expect(html).toContain("resumo.json");
    expect(html).toContain(`title="${sha}"`);
    expect(html).toContain(`>${sha.slice(0, 12)}<`);
    expect(html).toContain("1.234 bytes");
    expect(html).toContain("2026-10-10");
  });
  it("ArtifactsTable sem artifacts mostra nota honesta, nunca tabela vazia", async () => {
    const { ArtifactsTable } = await import("../components/ArtifactsTable");
    const html = renderToStaticMarkup(<ArtifactsTable artifacts={[]} />);
    expect(html).not.toContain("<table");
    expect(html).toContain("sem dado oficial");
  });
  it("artifact só-`hash` (sem `sha256`) nunca exibe valor — display fail-closed", async () => {
    const { getArtifacts } = await import("../lib/data");
    const { ArtifactsTable } = await import("../components/ArtifactsTable");
    const HASH_REAL = "ab".repeat(32);
    expect(getArtifacts({ artifacts: [{ arquivo: "x.json", hash: HASH_REAL, size_bytes: 10 }] })).toEqual([]);
    const html = renderToStaticMarkup(
      <ArtifactsTable
        artifacts={[{ arquivo: "x.json", hash: HASH_REAL, size_bytes: 10 } as unknown as import("../lib/data").ManifestArtifact]}
      />,
    );
    expect(html).not.toContain(HASH_REAL);
    expect(html).toContain("dado não auditado");
  });
});
