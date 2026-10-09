/** Rota /perguntas: índice da biblioteca curada (30 cards). */

import React from "react";
import perguntasJson from "../../data/perguntas.json";
import type { PerguntaCurada } from "./Curada";

const perguntas = perguntasJson as unknown as PerguntaCurada[];

export default function Perguntas() {
  return (
    <>
      <h1>Biblioteca curada — 30 perguntas com resposta auditada</h1>
      <p>
        Cada pergunta tem resposta completa pré-computada com fonte e hash. Correlação nunca é
        apresentada como causa; perfis são sempre de municípios, nunca de pessoas.
      </p>
      <ul>
        {perguntas.map((p) => (
          <li key={p.slug}>
            <a href={`/perguntas/${p.slug}`}>{p.titulo}</a>
          </li>
        ))}
      </ul>
    </>
  );
}
