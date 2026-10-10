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
import { censoTemProva, entradaCensoAuditada, fatoDatasetDe, getSealParaDataset } from "../../../lib/regiao";
import { fetchJson } from "../../../lib/fetchJson";

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
  // Matriz de guards (webfix Finding 4, P2 — VERIFICADO: overlap real):
  // - mesmo run em voo → `ocupadoRef` barra o segundo (sem fetch duplicado);
  // - run stale (rotação vs mount de outro ?fato=) → `geracaoRef`: publica
  //   e LIMPA o flag SOMENTE se ainda for o run atual; o finally de um run
  //   morto nunca solta o flag do dono novo (era o buraco: finally
  //   incondicional + publish só com `vivo`/param);
  // - ?fato= trocou no meio do voo → `vivo` (mount) / `fatoParamRef`
  //   (rotação) barram o publish cruzado.
  const seloRef = useRef<string | null>(null);
  const ocupadoRef = useRef(false);
  const geracaoRef = useRef(0);
  const fatoParamRef = useRef(fatoParam);
  fatoParamRef.current = fatoParam;

  // Núcleo puro de leitura (sem setState): dataset+selo → fato, sobre um
  // manifest já lido. O manifest viaja UMA vez (`manifestP` no effect):
  // fato e Censo partem do mesmo doc em paralelo — o JSON do fato (lento)
  // nunca segura o fetch do Censo, nem vice-versa. O gate é o mesmo de
  // antes (helpers de lib/regiao só chamados, nunca alterados); a pop
  // segue fato-independente com selo runtime na entry `artifacts` do Censo
  // (EVOLVE-8 Task 1: sem entry auditada, o mapa é null — JSON forjado no
  // path servido nunca vira número, paridade com o gate do fato).
  const buscarFato = useCallback(async (param: string, manifest: unknown) => {
    const ds = fatoDatasetDe(manifest, param);
    const novoSeal = getSealParaDataset(manifest, ds);
    const f = ds ? (await fetchJson<FatoRegiao>(`/data/${ds}.json`)).data : null;
    return { ds, novoSeal, f, manifest };
  }, []);
  const buscarCenso = useCallback(
    async (manifest: unknown) =>
      censoTemProva(manifest) ? parseCensoMapa((await fetchJson<unknown>(CENSO_URL)).data) : null,
    [],
  );

  useEffect(() => {
    let vivo = true;
    const minha = ++geracaoRef.current;
    // Loading honesto a cada ?fato=: volta a "a carregar" no início do run
    // e só libera o painel após o fetch do fato assentar (sem isso, o
    // setFato(null) intermediário exibia SEM_DADO transitório). O Censo
    // NÃO gateia o painel: corre em paralelo e assenta quando chega.
    setManifestChecked(false);
    ocupadoRef.current = true;
    // Uma única leitura do manifest alimenta fato E Censo (sem fetch
    // duplicado — custo zero): o selo do Censo deriva do mesmo doc, e os
    // dois fetches pesados (fato + Censo) disparam em paralelo sobre ele.
    const manifestP = fetchJson("/data/manifest.json");
    const leitura = manifestP.then((m) => buscarFato(fatoParam, m.data));
    (async () => {
      try {
        const r = await leitura;
        if (!vivo || geracaoRef.current !== minha) return;
        // Selo ligado ao dataset selecionado: ?fato= sem registro auditado
        // falha fechado (sem oficial), nunca com hash de outra ingestão.
        setSeal(r.novoSeal);
        setDataset(r.ds);
        seloRef.current = JSON.stringify({
          ds: r.ds,
          seal: r.novoSeal,
          censo: entradaCensoAuditada(r.manifest)?.sha256 ?? null,
        });
        // Limpa o fato anterior ANTES de publicar o novo: sem isso, a troca
        // de ?fato= exibiria transitoriamente números do dataset antigo sob
        // o selo do novo. Fail-closed também no transiente. (O censo é
        // fato-independente: publica direto, sem flash de SEM_DADO.)
        setFato(null);
        setFato(r.f);
        setManifestChecked(true);
      } finally {
        if (geracaoRef.current === minha) ocupadoRef.current = false;
      }
    })();
    void (async () => {
      try {
        const c = await buscarCenso((await manifestP).data);
        if (vivo && geracaoRef.current === minha) setCenso(c);
      } catch {
        // fail-closed: sem mapa, a pop exibe SEM_DADO (nunca throw)
      }
    })();
    return () => {
      vivo = false;
      ocupadoRef.current = false;
    };
  }, [fatoParam, buscarFato, buscarCenso]);

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
      const minha = ++geracaoRef.current;
      try {
        const param = fatoParamRef.current;
        const manifest = (await fetchJson("/data/manifest.json")).data;
        const ds = fatoDatasetDe(manifest, param);
        const novoSeal = getSealParaDataset(manifest, ds);
        // A comparação inclui a identidade da entry do Censo (sha): sem
        // isso, um manifest refrescado que remove SÓ o Censo (fato+selo
        // idênticos) caía no early return e a pop ia stale com prova
        // ausente. sha ausente (entry removida) → null ≠ sha anterior.
        const novoCenso = entradaCensoAuditada(manifest)?.sha256 ?? null;
        if (JSON.stringify({ ds, seal: novoSeal, censo: novoCenso }) === seloRef.current) return;
        // Selo runtime do Censo (EVOLVE-8 Task 1): sem entry auditada, o
        // artefato nem é buscado (custo zero no caso forjado) e a pop cai
        // p/ SEM_DADO junto com os votos.
        const censoOk = censoTemProva(manifest);
        const [rf, rc] = await Promise.all([
          ds ? fetchJson<FatoRegiao>(`/data/${ds}.json`) : Promise.resolve(null),
          censoOk ? fetchJson<unknown>(CENSO_URL) : Promise.resolve(null),
        ]);
        const f = rf?.data ?? null;
        const rawCenso = rc?.data ?? null;
        // ?fato= trocou no meio do load: o effect do novo param recarrega;
        // este run stale não escreve (nunca número antigo sob selo novo).
        // Geração idem: run superado por outro load não publica nem limpa.
        if (fatoParamRef.current !== param || geracaoRef.current !== minha) return;
        setSeal(novoSeal);
        setDataset(ds);
        seloRef.current = JSON.stringify({ ds, seal: novoSeal, censo: novoCenso });
        setFato(f);
        setCenso(censoOk ? parseCensoMapa(rawCenso) : null);
      } finally {
        if (geracaoRef.current === minha) ocupadoRef.current = false;
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
