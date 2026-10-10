// EVOLVE-5 Task 4: `SEM_DADO` tem fonte única (`lib/textos`) — S1192.
// `PainelRegiao` re-exporta por compatibilidade (sem fork);
// `emptyStateFor` consome a mesma fonte (pin: segue bare, sem motivo).
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
});
