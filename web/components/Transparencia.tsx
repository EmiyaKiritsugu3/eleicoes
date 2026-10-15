import React, { useState } from "react";
import {
  NOTA_TRANSPARENCIA_LAG,
  NOTA_TRANSPARENCIA_NOMINAL,
  formatBRL,
  govSerie,
  serieComLacunas,
  type GovRow,
} from "../lib/data";
import { SEM_DADO } from "../lib/textos";

/** Núcleo da /transparencia (o montador fino vive em `app/transparencia/page.tsx`):
 *  série de despesa empenhada com marcador de ano eleitoral + tabela
 *  acessível. Uma entidade por vez (chave ano única, sem colunas
 *  indistinguíveis); ano sem dado rende SEM_DADO na janela fixa
 *  (nunca 0); valores em BRL pt-BR. Série vazia = SEM_DADO. */
export function TransparenciaConteudo({
  rows,
}: {
  readonly rows: GovRow[] | null;
}) {
  const entes = React.useMemo(() => {
    const ids = new Set<string>();
    for (const r of Array.isArray(rows) ? rows : []) {
      const id = String(r.ente_id ?? "").trim();
      if (id) ids.add(id);
    }
    const lista = [...ids].sort();
    const uniao = lista.indexOf("UNIAO");
    if (uniao > 0) {
      lista.splice(uniao, 1);
      lista.unshift("UNIAO");
    }
    return lista;
  }, [rows]);
  const [enteId, setEnteId] = useState<string | null>(null);
  if (!rows) return <output>a carregar…</output>;
  const ativo = enteId ?? entes[0] ?? null;
  if (ativo === null) return <output>{SEM_DADO}</output>;
  const serie = serieComLacunas(govSerie(rows, { ente_id: ativo }));
  return (
    <section aria-label="Transparência de gastos">
      <p role="note">{NOTA_TRANSPARENCIA_NOMINAL}</p>
      <p role="note">{NOTA_TRANSPARENCIA_LAG}</p>
      <label>
        Ente{" "}
        <select
          aria-label="Ente"
          value={ativo}
          onChange={(e) => setEnteId(e.target.value || null)}
        >
          {entes.map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </select>
      </label>
      <table>
        <caption>
          Despesa empenhada por ano de {ativo} (valores nominais)
        </caption>
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
              <td>{r.valor === null ? SEM_DADO : formatBRL(r.valor)}</td>
              <td>{r.eleitoral ? "ano eleitoral" : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
