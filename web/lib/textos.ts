/** Fonte única dos textos fail-closed da UI (EVOLVE-5 Task 4, S1192).
 *
 * `SEM_DADO` ("sem dado oficial") era um literal duplicado em 7+ módulos;
 * toda UI importa daqui (ou do re-export de `PainelRegiao`, sem fork).
 * `MOTIVO_SEM_HASH` é o motivo sob `semProva` (paridade Curada :283):
 * rende `SEM_DADO — MOTIVO_SEM_HASH`, nunca bare sob selo sem prova.
 */

export const SEM_DADO = "sem dado oficial";

export const MOTIVO_SEM_HASH =
  "sem hash auditado no manifest; números exigem fato hash-verificado";
