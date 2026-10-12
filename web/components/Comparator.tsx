import React from "react";
import { formatVotes } from "../lib/data";
import { SEM_DADO } from "../lib/textos";
import { tokens } from "../lib/tokens";

export interface CompareSide {
  titulo: string;
  votos: number;
  detalhe?: string;
}

interface ComparatorProps {
  left: CompareSide | null;
  right: CompareSide | null;
  labelLeft?: string;
  labelRight?: string;
}

function Side({
  side,
  label,
}: {
  side: CompareSide | null;
  label: string;
}) {
  if (!side) return <p>{SEM_DADO}</p>;
  return (
    <article aria-label={label}>
      <h4>{side.titulo}</h4>
      <p>
        Votos: {formatVotes(side.votos)}
        {side.detalhe ? ` · ${side.detalhe}` : ""}
      </p>
    </article>
  );
}

/** Comparador lado-a-lado (2 candidatos / 2 anos / 2 municípios).
 *  Lado não selecionado ou zerado -> "sem dado oficial", nunca vazio.
 */
export default function Comparator({
  left,
  right,
  labelLeft = "Lado A",
  labelRight = "Lado B",
}: ComparatorProps) {
  const diff =
    left && right ? (Number(left.votos) || 0) - (Number(right.votos) || 0) : null;
  return (
    <div style={{ display: "flex", gap: tokens.espaco[4], flexWrap: "wrap" }}>
      <div style={{ flex: "1 1 200px" }}>
        <Side side={left} label={labelLeft} />
      </div>
      <div style={{ flex: "1 1 200px" }}>
        <Side side={right} label={labelRight} />
      </div>
      <p role="status" style={{ width: "100%" }}>
        {diff === null ? SEM_DADO : `Diferença (A − B): ${formatVotes(diff)} votos`}
      </p>
    </div>
  );
}
