"use client";

/** Rota /regiao/[ibge]: painel da região sobre o fato municipal.
 *
 * Descobre o fato em runtime via manifest (`tipo: "fato_municipal"`,
 * `dataset: "fato_<ano>_<turno>_<cargo>"`); `?fato=` permite trocar o
 * pleito e é lido via `useSearchParams`, então navegação cliente
 * (voltar/avançar, links internos) recarrega o pleito exibido. Sem manifest
 * ou sem fato → PainelRegiao fail-closed ("sem dado oficial", nunca número
 * sem hash). O `useSearchParams` exige fronteira Suspense em rota estática
 * (ver `PaginaRegiao` abaixo).
 */

import React, { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import PainelRegiao, { type FatoRegiao } from "../../../components/PainelRegiao";
import type { SealState } from "../../../lib/data";
import { fatoDatasetDe, getSealParaDataset } from "../../../lib/regiao";

async function fetchJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(path, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function ConteudoRegiao({ ibge }: { ibge: string }) {
  const search = useSearchParams();
  const fatoParam = search.get("fato") ?? "";
  const [fato, setFato] = useState<FatoRegiao | null>(null);
  const [seal, setSeal] = useState<SealState>({ official: null, hasFixture: false, fixtureHash: "" });
  const [manifestChecked, setManifestChecked] = useState(false);
  const [dataset, setDataset] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    // Loading honesto a cada ?fato=: volta a "a carregar" no início do run
    // e só libera o painel após o fetch do fato assentar (sem isso, o
    // setFato(null) intermediário exibia SEM_DADO transitório).
    setManifestChecked(false);
    (async () => {
      const manifest = await fetchJson("/data/manifest.json");
      if (!vivo) return;
      const ds = fatoDatasetDe(manifest, fatoParam);
      // Selo ligado ao dataset selecionado: ?fato= sem registro auditado
      // falha fechado (sem oficial), nunca com hash de outra ingestão.
      setSeal(getSealParaDataset(manifest, ds));
      setDataset(ds);
      // Limpa o fato anterior ANTES de buscar o novo: sem isso, a troca de
      // ?fato= exibiria transitoriamente números do dataset antigo sob o
      // selo do novo. Fail-closed também no transiente.
      setFato(null);
      let f: FatoRegiao | null = null;
      if (ds) {
        f = await fetchJson<FatoRegiao>(`/data/${ds}.json`);
        if (!vivo) return;
      }
      setFato(f);
      setManifestChecked(true);
    })();
    return () => {
      vivo = false;
    };
  }, [fatoParam]);

  // Loading honesto (Task 5): manifest pendente mostra "a carregar"
  // com role="status"; SEM_DADO do painel só após resolve.
  if (!manifestChecked) {
    return <p role="status">a carregar…</p>;
  }
  return <PainelRegiao ibge={ibge} fato={fato} seal={seal} manifestChecked={manifestChecked} fatoDataset={dataset} />;
}

export default function PaginaRegiao({ params }: { params: { ibge: string } }) {
  return (
    <Suspense fallback={<p role="status">a carregar…</p>}>
      <ConteudoRegiao ibge={params.ibge} />
    </Suspense>
  );
}
