import { describe, it, expect, beforeAll, afterAll } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Metodologia from "../app/metodologia/page";

// Task 11 (TDD, RED-first): a página /metodologia documenta os guardrails
// travados do Motor Verdade — piso n ≥ 30, selo anti-falácia ecológica e
// vereditos tricolores com os limiares exatos (piso de margem 1%, |r| ≥ 0,3,
// maioria folgada ≥ 60%, relevância de média ≥ 5%).
describe("metodologia (motor verdade: guardrails travados)", () => {
  // A página usa JSX sem `import React` (runtime automático do Next); o
  // vitest usa transform clássico — expõe React global só durante este
  // describe e remove depois (sem vazar p/ outros arquivos de teste).
  let html = "";
  beforeAll(() => {
    (globalThis as { React?: unknown }).React = React;
    try {
      html = renderToStaticMarkup(<Metodologia />);
    } finally {
      delete (globalThis as { React?: unknown }).React;
    }
  });
  afterAll(() => {
    delete (globalThis as { React?: unknown }).React;
  });

  it("documents n>=30 floor", () => {
    expect(html).toContain("n ≥ 30");
  });

  it("documents eco fallacy seal", () => {
    expect(html).toContain("dado de município, não de pessoa");
  });

  it("documents tricolor verdicts with exact thresholds", () => {
    for (const v of ["sustentado", "enganoso", "falso"]) {
      expect(html).toContain(v);
    }
    expect(html).toContain("1%");
    expect(html).toContain("|r| ≥ 0,3");
  });
});
