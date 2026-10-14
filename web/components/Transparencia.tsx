import React from "react";
import {
  NOTA_TRANSPARENCIA_LAG,
  NOTA_TRANSPARENCIA_NOMINAL,
  govSerie,
  type GovRow,
} from "../lib/data";
import { SEM_DADO } from "../lib/textos";

/** Núcleo da /transparencia (o montador fino vive em `app/transparencia/page.tsx`):
 *  série de despesa empenhada com marcador de ano eleitoral + tabela
 *  acessível. Série vazia = "{SEM_DADO}" (ano sem dado nunca vira 0). */
export function TransparenciaConteudo({
  rows,
  enteId,
}: {
  rows: GovRow[] | null;
  enteId?: string;
}) {
  if (!rows) return <p role="status">a carregar…</p>;
  const serie = govSerie(rows, enteId ? { ente_id: enteId } : {});
  return (
    <section aria-label="Transparência de gastos">
      <p role="note">{NOTA_TRANSPARENCIA_NOMINAL}</p>
      <p role="note">{NOTA_TRANSPARENCIA_LAG}</p>
      {serie.length === 0 ? (
        <p role="status">{SEM_DADO}</p>
      ) : (
        <table>
          <caption>Despesa empenhada por ano (valores nominais)</caption>
          <thead>
            <tr>
              <th scope="col">Ano</th>
              <th scope="col">Despesa empenhada</th>
              <th scope="col">Eleitoral</th>
            </tr>
          </thead>
          <tbody>
            {serie.map((r) => (
              <tr key={r.ano}>
                <th scope="row">{r.ano}</th>
                <td>{r.valor}</td>
                <td>{r.eleitoral ? "ano eleitoral" : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
