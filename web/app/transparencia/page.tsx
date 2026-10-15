"use client";

/** Rota /transparencia: montador fino (núcleo em `components/Transparencia`). */

import React, { useEffect, useState } from "react";
import SealSlot from "../../components/SealSlot";
import { TransparenciaConteudo } from "../../components/Transparencia";
import { getSealState, type GovRow, type SealState } from "../../lib/data";
import { fetchJson } from "../../lib/fetchJson";
import { ALERTA_STYLE } from "../../lib/textos";

export default function Transparencia() {
  const [rows, setRows] = useState<GovRow[] | null>(null);
  const [seal, setSeal] = useState<SealState>({ official: null, hasFixture: false, fixtureHash: "" });
  const [manifestChecked, setManifestChecked] = useState(false);

  useEffect(() => {
    setManifestChecked(false);
    void (async () => {
      const manifest = (await fetchJson("/data/manifest.json")).data;
      setSeal(getSealState(manifest));
      setRows((await fetchJson<GovRow[]>("/data/gov_serie.json")).data);
      setManifestChecked(true);
    })();
  }, []);

  return (
    <>
      {manifestChecked && !seal.official && !seal.hasFixture && (
        <p role="alert" className="badge badge-warn" style={ALERTA_STYLE}>
          dado não auditado — manifest ausente ou inválido; números abaixo não são oficiais
        </p>
      )}
      {manifestChecked && <SealSlot seal={seal} />}
      {!manifestChecked ? (
        <output>a carregar…</output>
      ) : (
        <TransparenciaConteudo rows={rows ?? []} />
      )}
    </>
  );
}
