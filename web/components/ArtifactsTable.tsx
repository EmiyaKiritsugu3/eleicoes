"use client";

import React from "react";
import {
  formatVotes,
  isAudited,
  isFixtureEntry,
  isOfficialDisplay,
  type ManifestArtifact,
} from "../lib/data";

const SEM_DADO = "sem dado oficial";

/** Tabela de arquivos servidos com prova de bytes (EVOLVE-2 Task 1):
 *  sha resumido (12) com hash cheio no title + tamanho pt-BR + data.
 *  Sem artifacts (legado só-ingestions), nota honesta — nunca tabela
 *  vazia. Selo segue o contrato das ingestões: fixture exibe o hash
 *  para transparência, mas com a nota de amostra, nunca como oficial.
 */
export function ArtifactsTable({ artifacts }: { artifacts: ManifestArtifact[] }) {
  if (artifacts.length === 0) {
    return <p>{SEM_DADO} — manifest sem hashes de arquivos servidos</p>;
  }
  return (
    <div style={{ overflowX: "auto" }} tabIndex={0} role="region" aria-label="Arquivos servidos com hash sha256, tamanho e data">
    <table>
      <caption>Arquivos servidos com hash sha256, tamanho e data</caption>
      <thead>
        <tr>
          <th scope="col">Arquivo</th>
          <th scope="col">Hash (sha256)</th>
          <th scope="col">Tamanho</th>
          <th scope="col">Data</th>
        </tr>
      </thead>
      <tbody>
        {artifacts.map((a, i) => {
          const hash = String(a.sha256 ?? "");
          const arquivo =
            typeof a.arquivo === "string" && a.arquivo ? a.arquivo : SEM_DADO;
          const tamanho =
            typeof a.size_bytes === "number" && Number.isFinite(a.size_bytes) && a.size_bytes >= 0
              ? `${formatVotes(a.size_bytes)} bytes`
              : SEM_DADO;
          const data =
            (typeof a.data === "string" && a.data) ||
            (typeof a.date === "string" && a.date) ||
            SEM_DADO;
          return (
            <tr key={i}>
              <td>{arquivo}</td>
              <td>
                {isOfficialDisplay(a) ? (
                  <code title={hash}>{hash.slice(0, 12)}</code>
                ) : isFixtureEntry(a) && isAudited(a) ? (
                  <>
                    <code title={hash}>{hash.slice(0, 12)}</code>
                    <p role="note">hash de amostra — sem valor oficial</p>
                  </>
                ) : (
                  <span role="alert">dado não auditado</span>
                )}
              </td>
              <td>{tamanho}</td>
              <td>{data}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
    </div>
  );
}
