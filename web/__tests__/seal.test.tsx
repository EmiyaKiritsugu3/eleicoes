import { describe, it, expect } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import SealSlot from "../components/SealSlot";
import SourceBadge from "../components/SourceBadge";
import { FixtureSeal } from "../components/FixtureBadge";

const FIXTURE_HASH =
  "879f5504a9918fde9b31045fe810285e8c285ce82a72693a2b4d6e2bc20af07a";

// Lógica de exibição compartilhada por / e /analisar (SealSlot sobre
// getSealState): fixture nunca renderiza o selo oficial.
describe("SealSlot (selo compartilhado de / e /analisar)", () => {
  it("fixture-only: FixtureBadge + hash cheio, nunca selo oficial", () => {
    const html = renderToStaticMarkup(
      <SealSlot seal={{ official: null, hasFixture: true, fixtureHash: FIXTURE_HASH }} />,
    );
    expect(html).toContain('role="note"');
    expect(html).toContain("amostra sintética — não oficial");
    // Hash cheio visível (transparência), não o hash curto do selo oficial.
    expect(html).toContain(FIXTURE_HASH);
    expect(html).not.toContain("fonte auditada");
    expect(html).not.toContain("fonte oficial");
  });
  it("oficial: selo oficial, sem selo de amostra", () => {
    const html = renderToStaticMarkup(
      <SealSlot
        seal={{
          official: { hash: "b".repeat(64), url: "https://tse.jus.br/x", date: "2026-01-01" },
          hasFixture: false,
          fixtureHash: "",
        }}
      />,
    );
    expect(html).toContain("fonte auditada");
    expect(html).not.toContain("amostra sintética");
  });
  it("sem manifest: dado não auditado, nunca selo oficial", () => {
    const html = renderToStaticMarkup(
      <SealSlot seal={{ official: null, hasFixture: false, fixtureHash: "" }} />,
    );
    expect(html).toContain("dado não auditado");
    expect(html).not.toContain("fonte auditada");
  });
});

describe("safeUrl (M10)", () => {
  it("safeUrl bloqueia javascript: e esquemas não-http", async () => {
    const { safeUrl } = await import("../lib/data");
    expect(safeUrl("javascript:alert(1)")).toBe("");
    expect(safeUrl("data:text/html,<h1>x</h1>")).toBe("");
    expect(safeUrl("/relativo/x")).toBe("");
    expect(safeUrl("")).toBe("");
    expect(safeUrl(null)).toBe("");
  });
  it("safeUrl permite http(s)", async () => {
    const { safeUrl } = await import("../lib/data");
    expect(safeUrl("https://cdn.tse.jus.br/x.zip")).toBe(
      "https://cdn.tse.jus.br/x.zip",
    );
    expect(safeUrl("http://example.com")).toBe("http://example.com");
  });
  it("SourceBadge não renderiza link não-http", () => {
    const html = renderToStaticMarkup(
      <SourceBadge hash="abc123" url="javascript:alert(1)" date="d" />,
    );
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("<a ");
  });
});

describe("FixtureSeal (transparência fora do selo oficial)", () => {
  it("hash cheio em <code>, sem link de fonte oficial", () => {
    const html = renderToStaticMarkup(<FixtureSeal hash={FIXTURE_HASH} />);
    expect(html).toContain('role="note"');
    expect(html).toContain("amostra sintética — não oficial");
    expect(html).toContain(`<code title="${FIXTURE_HASH}">${FIXTURE_HASH}</code>`);
    expect(html).not.toContain("fonte oficial");
  });
});
