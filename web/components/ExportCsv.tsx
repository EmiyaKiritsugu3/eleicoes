"use client";

/** Botão Exportar CSV com gate oficial (EVOLVE-11, fonte única — Analisar,
 *  Explorar, PainelRegiao, Verificar e Curada importam daqui em vez de
 *  forkar o bloco botão+nota; gate Sonar duplication).
 *
 * Consome (sem reinventar): `buildCsvExport`/`downloadCsv` de `lib/export`
 * (linhas + proveniência oficial). Sem `seal`, desabilitado com título
 * honesto (fail-closed: nunca gera CSV sem hash auditado — a lib também
 * levanta sem hash). Só o botão + nota de proveniência vivem aqui; alertas
 * de bloqueio e estados vazios seguem em cada superfície.
 */

import React from "react";
import { buildCsvExport, downloadCsv, type AuditoriaCsv } from "../lib/export";

export default function ExportCsv({
  arquivo,
  linhas,
  seal,
  detalhe,
}: {
  arquivo: string;
  linhas: Record<string, unknown>[];
  seal: AuditoriaCsv | null;
  /** Sufixo honesto da nota (ex. pop fora do CSV). */
  detalhe?: string;
}) {
  return (
    <>
      <p>
        <button
          type="button"
          disabled={!seal}
          title={
            seal
              ? "Baixar CSV com proveniência auditada"
              : "Exportação bloqueada — dado não auditado"
          }
          onClick={() => downloadCsv(arquivo, buildCsvExport(linhas, seal))}
        >
          Exportar CSV
        </button>
      </p>
      <p>
        <small>
          O CSV inclui header de proveniência <code>fonte,url,hash,data</code>
          {detalhe ?? ""}
        </small>
      </p>
    </>
  );
}
