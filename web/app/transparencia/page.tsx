"use client";

/** Rota /transparencia: montador fino (núcleo em `components/Transparencia`). */

import React, { useEffect, useState } from "react";
import SealSlot from "../../components/SealSlot";
import { TransparenciaConteudo } from "../../components/Transparencia";
import { getSealParaArquivo, type GovRow } from "../../lib/data";
import { fetchJson } from "../../lib/fetchJson";
import { ALERTA_STYLE } from "../../lib/textos";

export default function Transparencia() {
  const [rows, setRows] = useState<GovRow[] | null>(null);
  const [manifest, setManifest] = useState<unknown>(null);
  const [erroCarga, setErroCarga] = useState(false);
  const [manifestChecked, setManifestChecked] = useState(false);

  useEffect(() => {
    setManifestChecked(false);
    void (async () => {
      const man = await fetchJson("/data/manifest.json");
      const serie = await fetchJson<GovRow[]>("/data/gov_serie.json");
      // 404 da série = sem dado oficial (quadro vazio não é escrito);
      // qualquer outra falha = erro de carga, nunca "sem dado".
      const serieOk =
        serie.status === "ok" || serie.status === "nao-encontrado";
      if (man.status !== "ok" || !serieOk) {
        setErroCarga(true);
      } else {
        setManifest(man.data);
        setRows(serie.data ?? []);
      }
      setManifestChecked(true);
    })();
  }, []);

  // Selo ligado ao ARTEFATO gov_serie.json (nunca à 1ª ingestão do
  // manifest): oficial TSE de votos acima da série de governo seria
  // hash alheio.
  const seal = getSealParaArquivo(manifest, "gov_serie.json");

  if (!manifestChecked) return <output>a carregar…</output>;
  if (erroCarga) {
    return (
      <p role="alert" className="badge badge-warn" style={ALERTA_STYLE}>
        falha ao carregar — tente de novo; ausência de dado se mostra como
        &quot;sem dado oficial&quot;, nunca como erro
      </p>
    );
  }
  return (
    <>
      {!seal.official && !seal.hasFixture && (
        <p role="alert" className="badge badge-warn" style={ALERTA_STYLE}>
          dado não auditado — manifest ausente ou inválido; números abaixo não são oficiais
        </p>
      )}
      <SealSlot seal={seal} />
      <TransparenciaConteudo rows={rows ?? []} />
    </>
  );
}
