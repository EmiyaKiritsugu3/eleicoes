"use client";

/** Rota /regiao/[ibge]: painel da região sobre o fato municipal.
 *
 * Descobre o fato em runtime via manifest (`tipo: "fato_municipal"`,
 * `dataset: "fato_<ano>_<turno>_<cargo>"`); `?fato=` permite trocar o
 * pleito. Sem manifest ou sem fato → PainelRegiao fail-closed
 * ("sem dado oficial", nunca número sem hash).
 */

import React, { useEffect, useState } from "react";
import PainelRegiao, { type FatoRegiao } from "../../../components/PainelRegiao";
import { getSealState, type SealState } from "../../../lib/data";

async function fetchJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(path, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

interface ManifestFato {
  tipo?: string;
  dataset?: string;
}

function fatoDatasetDe(manifest: unknown, override?: string): string | null {
  if (override && override.trim() !== "") return override.trim();
  const ing = (manifest as { ingestions?: ManifestFato[] } | null)?.ingestions;
  if (!Array.isArray(ing)) return null;
  const entry = ing.find(
    (e) => e?.tipo === "fato_municipal" && typeof e?.dataset === "string" && e.dataset.startsWith("fato_"),
  );
  return entry?.dataset ?? null;
}

export default function PaginaRegiao({ params }: { params: { ibge: string } }) {
  const [fato, setFato] = useState<FatoRegiao | null>(null);
  const [seal, setSeal] = useState<SealState>({ official: null, hasFixture: false, fixtureHash: "" });
  const [manifestChecked, setManifestChecked] = useState(false);

  useEffect(() => {
    (async () => {
      const manifest = await fetchJson("/data/manifest.json");
      setSeal(getSealState(manifest));
      setManifestChecked(true);
      let fatoParam = "";
      try {
        fatoParam = new URLSearchParams(window.location.search).get("fato") ?? "";
      } catch {
        fatoParam = "";
      }
      const dataset = fatoDatasetDe(manifest, fatoParam);
      if (dataset) {
        setFato(await fetchJson<FatoRegiao>(`/data/${dataset}.json`));
      } else {
        setFato(null);
      }
    })();
  }, []);

  return <PainelRegiao ibge={params.ibge} fato={fato} seal={seal} manifestChecked={manifestChecked} />;
}
