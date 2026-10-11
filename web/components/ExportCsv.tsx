"use client";

/** Botão Exportar CSV com gate oficial (EVOLVE-11, fonte única — Analisar,
 *  Explorar, PainelRegiao, Verificar e Curada importam daqui em vez de
 *  forkar o bloco botão+nota; gate Sonar duplication).
 *
 * Consome (sem reinventar): `buildCsvExport`/`downloadCsv` de `lib/export`
 * (linhas + proveniência oficial). Sem oficial, desabilitado com motivo
 * VISÍVEL (cubic R3: `title` sozinho não é acessível por teclado — o motivo
 * vive em texto, não só no hover). Só o botão + nota de proveniência +
 * motivo de bloqueio vivem aqui; estados vazios seguem em cada superfície.
 */

import React from "react";
import { buildCsvExport, downloadCsv } from "../lib/export";
import type { SealState } from "../lib/data";

export default function ExportCsv({
  arquivo,
  linhas,
  seal,
  detalhe,
  pronto,
}: {
  arquivo: string;
  linhas: Record<string, unknown>[];
  seal: SealState;
  /** Sufixo honesto da nota (ex. pop fora do CSV). */
  detalhe?: string;
  /** Manifest resolvido (default true): sem ele, só o botão — o motivo de
   *  bloqueio aparece após resolve (sem alerta prematuro no loading). */
  pronto?: boolean;
}) {
  const resolvido = pronto ?? true;
  return (
    <>
      <p>
        <button
          type="button"
          disabled={!seal.official}
          title={
            seal.official
              ? "Baixar CSV com proveniência auditada"
              : "Exportação bloqueada — dado não auditado"
          }
          onClick={() => downloadCsv(arquivo, buildCsvExport(linhas, seal.official))}
        >
          Exportar CSV
        </button>
      </p>
      {seal.official ? (
        <p>
          <small>
            O CSV inclui header de proveniência <code>fonte,url,hash,data</code>
            {detalhe ?? ""}
          </small>
        </p>
      ) : resolvido ? (
        seal.hasFixture ? (
          <p role="note">
            exportação bloqueada — amostra sintética sem valor oficial; o CSV
            só é gerado com ingestão oficial para que o arquivo seja
            auto-descritivo
          </p>
        ) : (
          <p role="alert">
            exportação bloqueada — dado não auditado; o CSV só é gerado com
            manifest válido para que o arquivo seja auto-descritivo
          </p>
        )
      ) : null}
    </>
  );
}
