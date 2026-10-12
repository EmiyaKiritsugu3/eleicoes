/** Rota /perguntas: índice de exemplos de consulta (30 cards). */

import React from "react";
import perguntasJson from "../../data/perguntas.json";
import type { PerguntaCurada } from "./Curada";
import { tokens } from "../../lib/tokens";

const [giganteSize, giganteLine] = tokens.texto.gigante.split("/");

const perguntas = perguntasJson as unknown as PerguntaCurada[];

export default function Perguntas() {
  return (
    <>
      <h1
        style={{
          fontFamily: tokens.fonte.display,
          fontSize: giganteSize,
          lineHeight: giganteLine,
          color: tokens.cor.tinta,
        }}
      >
        Exemplos de consulta
      </h1>
      <p>
        Cada exemplo tem resposta completa pré-computada, com fonte e hash quando há dado
        oficial auditado; sem dado oficial, a página do exemplo mostra sem dado oficial em
        vez de número. Para perguntar o que você quiser, <a href="/analisar">consulte
        direto</a> com filtros. Correlação nunca é apresentada como causa; perfis são
        sempre de municípios, nunca de pessoas.
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
