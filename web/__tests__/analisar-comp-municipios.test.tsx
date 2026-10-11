// EVOLVE-11 Task 2 (comparador `municipios` morto, opção viva): o radio
// `municipios` nunca teve cobertura (sempre null) — vira opção desabilitada
// com nota honesta em vez de controle que promete e entrega SEM_DADO.
// SSR estático basta: radios rendem no estado inicial (sem effects).
import React from "react";
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import Analisar from "../app/analisar/page";

const html = renderToStaticMarkup(<Analisar />);

describe("analisar: modo municipios desabilitado (EVOLVE-11 Task 2)", () => {
  it("terceiro radio do grupo (municipios) rende desabilitado com título honesto", () => {
    const radios = html.match(/<input[^>]*name="compMode"[^>]*>/g) ?? [];
    expect(radios.length).toBe(3);
    expect(radios[2]).toMatch(/\bdisabled\b/);
    expect(radios[2]).toMatch(/por munic[ií]pio em breve/);
  });

  it("radios candidatos/anos seguem habilitados", () => {
    const radios = html.match(/<input[^>]*name="compMode"[^>]*>/g) ?? [];
    expect(radios[0]).not.toMatch(/\bdisabled\b/);
    expect(radios[1]).not.toMatch(/\bdisabled\b/);
  });

  it("nota permanente do modo em breve sob o grupo", () => {
    expect(html).toContain("modo munic\u00edpios em breve");
  });
});
