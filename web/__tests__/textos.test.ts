// EVOLVE-5 Task 4: `SEM_DADO` tem fonte única (`lib/textos`) — S1192.
// `PainelRegiao` re-exporta por compatibilidade (sem fork);
// `emptyStateFor` consome a mesma fonte (pin: segue bare, sem motivo).
// EVOLVE-6 Task 2: `MOTIVO_SEM_HASH` idem — zero literal próprio nos
// 4 arquivos de UI (guarda estático S1192).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { MOTIVO_SEM_HASH, SEM_DADO } from "../lib/textos";
import { SEM_DADO as SEM_PAINEL } from "../components/PainelRegiao";
import { emptyStateFor } from "../lib/export";

describe("textos (fonte única SEM_DADO)", () => {
  it("trava o literal pt-BR exato", () => {
    expect(SEM_DADO).toBe("sem dado oficial");
  });
  it("PainelRegiao re-exporta a mesma fonte (sem fork)", () => {
    expect(SEM_PAINEL).toBe(SEM_DADO);
  });
  it("emptyStateFor consome a fonte única (pin: bare, sem motivo)", () => {
    expect(emptyStateFor([])).toBe(SEM_DADO);
  });
  it("motivo de hash travado (paridade Curada :283)", () => {
    expect(MOTIVO_SEM_HASH).toBe(
      "sem hash auditado no manifest; números exigem fato hash-verificado",
    );
  });
  it("S1192: motivo sem-hash só existe em lib/textos (zero literal próprio na UI)", () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), "..");
    for (const f of [
      "components/HomeContent.tsx",
      "components/Explorar.tsx",
      "app/perguntas/Curada.tsx",
      "app/verificar/Verificar.tsx",
    ]) {
      const src = readFileSync(join(root, f), "utf8");
      // Literal canônico (só o identificador MOTIVO_SEM_HASH pode aparecer).
      expect(src, f).not.toContain("números exigem fato hash-verificado");
      // Wording à deriva normalizado p/ a constante (Verificar :549).
      expect(src, f).not.toContain("número sem hash não é oficial");
    }
    const fonte = readFileSync(join(root, "lib/textos.ts"), "utf8");
    expect(fonte).toContain("números exigem fato hash-verificado");
  });
});
