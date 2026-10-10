"use client";

/** Rota /explorar: montador em blocos (núcleo em `components/Explorar`). */

import React, { useEffect, useState } from "react";
import SealSlot from "../../components/SealSlot";
import { ExplorarConteudo, parseExplorarQuery, type ExplorarSelecao } from "../../components/Explorar";
import type { SealState } from "../../lib/data";
import { fatoDatasetDe, getSealParaDataset, isHashDivergente } from "../../lib/regiao";
import type { FatoRegiao } from "../../components/PainelRegiao";

const ALERTA_STYLE: React.CSSProperties = {
  background: "#fff3cd",
  border: "1px solid #b45309",
  fontWeight: "bold",
};

async function fetchJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(path, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

const SEL_VAZIA: ExplorarSelecao = {
  quem: "",
  onde: "venceu",
  cruzar: "esc_sup",
  ver: ["dispersao"],
  foco: "",
};

export default function Explorar() {
  const [fato, setFato] = useState<FatoRegiao | null>(null);
  const [seal, setSeal] = useState<SealState>({ official: null, hasFixture: false, fixtureHash: "" });
  const [manifestChecked, setManifestChecked] = useState(false);
  const [initial, setInitial] = useState<ExplorarSelecao & { hash: string } | null>(null);
  const [urlHash, setUrlHash] = useState("");

  useEffect(() => {
    const q = parseExplorarQuery(window.location.search);
    setInitial(q);
    setUrlHash(q.hash ?? "");
    (async () => {
      const manifest = await fetchJson("/data/manifest.json");
      let fatoParam = "";
      try {
        fatoParam = new URLSearchParams(window.location.search).get("fato") ?? "";
      } catch {
        fatoParam = "";
      }
      const dataset = fatoDatasetDe(manifest, fatoParam);
      setSeal(getSealParaDataset(manifest, dataset));
      setManifestChecked(true);
      setFato(dataset ? await fetchJson<FatoRegiao>(`/data/${dataset}.json`) : null);
    })();
  }, []);

  const hash = seal.official?.hash ?? "";
  const hashDivergente = isHashDivergente(urlHash, hash, manifestChecked);

  return (
    <>
      {manifestChecked && !seal.official && !seal.hasFixture && (
        <p role="alert" className="badge badge-warn" style={ALERTA_STYLE}>
          dado não auditado — manifest ausente ou inválido; números abaixo não são oficiais
        </p>
      )}
      {manifestChecked && !seal.official && seal.hasFixture && <SealSlot seal={seal} />}
      {hashDivergente && (
        <p role="alert" className="badge badge-warn" style={ALERTA_STYLE}>
          hash da URL diverge do manifest atual — revalide a fonte antes de citar
        </p>
      )}
      {!manifestChecked ? (
        <p role="status">a carregar…</p>
      ) : (
        <ExplorarConteudo
          fato={fato}
          seal={seal}
          initial={initial ?? SEL_VAZIA}
          key={initial ? JSON.stringify(initial) : "vazio"}
        />
      )}
    </>
  );
}
