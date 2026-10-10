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

import React, { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import PainelRegiao, {
  CENSO_URL,
  parseCensoMapa,
  type CensoMapa,
  type FatoRegiao,
} from "../../../components/PainelRegiao";
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
  // Censo no nível da página (EVOLVE-7 Task 6 follow-up): o PainelRegiao
  // busca o artefato uma vez no mount quando a prop é omitida — sob
  // rotação de manifest, a pop ia stale. A página detém o mapa e o repassa
  // via a prop `censo` existente (seam determinístico p/ SSR/testes, sem
  // fetch no Painel); null inicial = fail-closed idêntico ao self-fetch
  // pendente (SEM_DADO transitório, nunca número inventado).
  const [censo, setCenso] = useState<CensoMapa | null>(null);
  // Trigger vivo de rotação (mesmo padrão do `aoRetomar` da Home, Task 6):
  // `seloRef` é a verdade comparável fora do closure (o effect de foco
  // monta uma vez); `ocupadoRef` evita fetch duplicado com um load em voo;
  // `fatoParamRef` leva o ?fato= atual ao handler sem re-subscrição.
  const seloRef = useRef<string | null>(null);
  const ocupadoRef = useRef(false);
  const fatoParamRef = useRef(fatoParam);
  fatoParamRef.current = fatoParam;

  // Núcleo puro de leitura (sem setState): manifest → dataset+selo →
  // fato + Censo em paralelo. O gate é o mesmo de antes (helpers de
  // lib/regiao só chamados, nunca alterados); a pop segue
  // fato-independente com proveniência na entry `artifacts` do Censo (sem
  // atestação runtime — assunção de confiança documentada em PainelRegiao).
  const buscar = useCallback(async (param: string) => {
    const manifest = await fetchJson("/data/manifest.json");
    const ds = fatoDatasetDe(manifest, param);
    const novoSeal = getSealParaDataset(manifest, ds);
    const [f, rawCenso] = await Promise.all([
      ds ? fetchJson<FatoRegiao>(`/data/${ds}.json`) : Promise.resolve(null),
      fetchJson<unknown>(CENSO_URL),
    ]);
    return { ds, novoSeal, f, censo: parseCensoMapa(rawCenso) };
  }, []);

  useEffect(() => {
    let vivo = true;
    // Loading honesto a cada ?fato=: volta a "a carregar" no início do run
    // e só libera o painel após o fetch do fato assentar (sem isso, o
    // setFato(null) intermediário exibia SEM_DADO transitório).
    setManifestChecked(false);
    ocupadoRef.current = true;
    (async () => {
      try {
        const r = await buscar(fatoParam);
        if (!vivo) return;
        // Selo ligado ao dataset selecionado: ?fato= sem registro auditado
        // falha fechado (sem oficial), nunca com hash de outra ingestão.
        setSeal(r.novoSeal);
        setDataset(r.ds);
        seloRef.current = JSON.stringify({ ds: r.ds, seal: r.novoSeal });
        // Limpa o fato anterior ANTES de publicar o novo: sem isso, a troca
        // de ?fato= exibiria transitoriamente números do dataset antigo sob
        // o selo do novo. Fail-closed também no transiente. (O censo é
        // fato-independente: publica direto, sem flash de SEM_DADO.)
        setFato(null);
        setFato(r.f);
        setCenso(r.censo);
        setManifestChecked(true);
      } finally {
        if (vivo) ocupadoRef.current = false;
      }
    })();
    return () => {
      vivo = false;
      ocupadoRef.current = false;
    };
  }, [fatoParam, buscar]);

  // Rotação de manifest (completa o sync do EVOLVE-6 T6 na /regiao, que não
  // tinha trigger algum — nem o fato recarregava no foco): re-lê SÓ o
  // manifest (barato) e só refaz o fetch pesado (fato + Censo) quando o par
  // dataset+selo mudou — sem fetch duplicado quando inalterado, sem pop
  // stale após rotação. Troca silenciosa (paridade com a Home): sem
  // "a carregar", sem limpar o fato atual — os sets assentam juntos.
  useEffect(() => {
    const aoRetomar = async () => {
      if (ocupadoRef.current) return;
      ocupadoRef.current = true;
      try {
        const param = fatoParamRef.current;
        const manifest = await fetchJson("/data/manifest.json");
        const ds = fatoDatasetDe(manifest, param);
        const novoSeal = getSealParaDataset(manifest, ds);
        if (JSON.stringify({ ds, seal: novoSeal }) === seloRef.current) return;
        const [f, rawCenso] = await Promise.all([
          ds ? fetchJson<FatoRegiao>(`/data/${ds}.json`) : Promise.resolve(null),
          fetchJson<unknown>(CENSO_URL),
        ]);
        // ?fato= trocou no meio do load: o effect do novo param recarrega;
        // este run stale não escreve (nunca número antigo sob selo novo).
        if (fatoParamRef.current !== param) return;
        setSeal(novoSeal);
        setDataset(ds);
        seloRef.current = JSON.stringify({ ds, seal: novoSeal });
        setFato(f);
        setCenso(parseCensoMapa(rawCenso));
      } finally {
        ocupadoRef.current = false;
      }
    };
    const aoFocar = () => {
      void aoRetomar();
    };
    const aoVisibilidade = () => {
      if (document.visibilityState === "visible") void aoRetomar();
    };
    window.addEventListener("focus", aoFocar);
    document.addEventListener("visibilitychange", aoVisibilidade);
    return () => {
      window.removeEventListener("focus", aoFocar);
      document.removeEventListener("visibilitychange", aoVisibilidade);
    };
  }, []);

  // Loading honesto (Task 5): manifest pendente mostra "a carregar"
  // com role="status"; SEM_DADO do painel só após resolve.
  if (!manifestChecked) {
    return <p role="status">a carregar…</p>;
  }
  return <PainelRegiao ibge={ibge} fato={fato} seal={seal} manifestChecked={manifestChecked} fatoDataset={dataset} censo={censo} />;
}

export default function PaginaRegiao({ params }: { params: { ibge: string } }) {
  return (
    <Suspense fallback={<p role="status">a carregar…</p>}>
      <ConteudoRegiao ibge={params.ibge} />
    </Suspense>
  );
}
