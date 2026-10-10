"use client";

import React from "react";
import {
  fontesDaEntrada,
  type ManifestIngestion,
} from "../lib/data";
import { SEM_DADO } from "../lib/textos";

/** Célula "Fontes" da tabela de ingestões da /auditoria (EVOLVE-6 Task 4):
 *  extraída da página (Next veta exports não-página em `page.tsx`) p/
 *  ser testável em cell-render — mesmo padrão de `ArtifactsTable`.
 *  Contrato idêntico ao inline anterior: 0 fontes → SEM_DADO; senão, um
 *  link por fonte (`fontesDaEntrada` já filtra p/ http(s) — fail-closed). */
export function FontesCell({ entry }: { entry: ManifestIngestion }) {
  const fontes = fontesDaEntrada(entry);
  if (fontes.length === 0) return <>{SEM_DADO}</>;
  return (
    <ul>
      {fontes.map((f, j) => (
        <li key={`${f}#${j}`}>
          <a href={f} target="_blank" rel="noreferrer">
            {f}
          </a>
        </li>
      ))}
    </ul>
  );
}
