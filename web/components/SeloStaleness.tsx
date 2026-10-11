"use client";

/** Staleness display-only das páginas SSG curadas (EVOLVE-11 Task 6).
 *
 * As páginas `/verificar/[slug]` e `/perguntas/[slug]` são estáticas (fato
 * lido do disco no build, pleito default via `fatoDatasetDe(manifest,"")`).
 * Sem refetch de números aqui: misturar fato do build com selo do runtime
 * exibiria números sob hash que não os atestou. Em vez disso, disclosure:
 * nota fixa de pleito congelado + alerta quando o manifest servido diverge
 * do hash do build (mount + focus/visibility, mesmo padrão das superfícies
 * runtime). Blip (manifest ilegível/malformado) ≠ rotação: mantém o build
 * sem alerta falso (stale-while-revalidate). Compara o hash oficial, com
 * fallback p/ hash de fixture quando não há oficial nos dois lados (cubic
 * R3: rotação só-fixture também alerta); sem prova em ambos, igualdade.
 * `dataset` nulo (build sem manifest) nunca alerta — caso degenerado.
 * Checks concorrentes (mount/focus/visibility) têm geração: resposta
 * superada nunca publica (cubic R3, mesmo padrão do `geracaoRef` da
 * /regiao — sem estado stale por resolução fora de ordem).
 */

import React, { useEffect, useRef, useState } from "react";
import { fetchJson } from "../lib/fetchJson";
import { getSealParaDataset, hashResumoSeal, manifestoValidoParaRotacao } from "../lib/regiao";

/** Nota estática das páginas SSG (fonte única p/ os 2 slugs). */
export const NOTA_PLEITO_CONGELADO =
  "pleito default do build — páginas curadas congelam o pleito exibido; outros pleitos no /explorar e na /regiao.";

const ALERTA_STYLE: React.CSSProperties = {
  background: "#fff3cd",
  border: "1px solid #b45309",
  fontWeight: "bold",
};

export default function SeloStaleness({
  dataset,
  hashBuild,
}: {
  dataset: string | null;
  hashBuild: string;
}) {
  const [divergiu, setDivergiu] = useState(false);
  const buildRef = useRef(hashBuild);
  buildRef.current = hashBuild;
  const datasetRef = useRef(dataset);
  datasetRef.current = dataset;
  const geracaoRef = useRef(0);

  useEffect(() => {
    let vivo = true;
    const conferir = async () => {
      const minha = ++geracaoRef.current;
      const leitura = await fetchJson("/data/manifest.json");
      if (!vivo || geracaoRef.current !== minha) return;
      if (leitura.status !== "ok" || !manifestoValidoParaRotacao(leitura.data)) return;
      const atual = getSealParaDataset(leitura.data, datasetRef.current);
      if (!vivo || geracaoRef.current !== minha) return;
      setDivergiu(hashResumoSeal(atual) !== buildRef.current);
    };
    void conferir();
    const aoFocar = () => {
      void conferir();
    };
    const aoVisibilidade = () => {
      if (document.visibilityState === "visible") void conferir();
    };
    window.addEventListener("focus", aoFocar);
    document.addEventListener("visibilitychange", aoVisibilidade);
    return () => {
      vivo = false;
      window.removeEventListener("focus", aoFocar);
      document.removeEventListener("visibilitychange", aoVisibilidade);
    };
  }, []);

  return (
    <>
      <p role="note">{NOTA_PLEITO_CONGELADO}</p>
      {divergiu && (
        <p role="alert" className="badge badge-warn" style={ALERTA_STYLE}>
          manifest atual diverge do build — revalide a fonte antes de citar
        </p>
      )}
    </>
  );
}
