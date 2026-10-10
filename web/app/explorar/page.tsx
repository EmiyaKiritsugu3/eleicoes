"use client";

/** Rota /explorar: montador em blocos (núcleo em `components/Explorar`). */

import React, { useCallback, useEffect, useRef, useState } from "react";
import SealSlot from "../../components/SealSlot";
import { ExplorarConteudo, parseExplorarQuery, type ExplorarSelecao } from "../../components/Explorar";
import type { SealState } from "../../lib/data";
import { fatoDatasetDe, getSealParaDataset, isHashDivergente } from "../../lib/regiao";
import { fetchJson } from "../../lib/fetchJson";
import type { FatoRegiao } from "../../components/PainelRegiao";

const ALERTA_STYLE: React.CSSProperties = {
  background: "#fff3cd",
  border: "1px solid #b45309",
  fontWeight: "bold",
};

const SEL_VAZIA: ExplorarSelecao = {
  quem: "",
  onde: "venceu",
  cruzar: "esc_sup",
  ver: ["dispersao"],
  foco: "",
};

// `?fato=` lido no momento da leitura (mount ou rotação), nunca do closure.
function fatoParamDaUrl(): string {
  try {
    return new URLSearchParams(window.location.search).get("fato") ?? "";
  } catch {
    return "";
  }
}

// Derivação pura manifest → dataset+selo (mount + rotação partilham —
// sem fork: o fetch pesado do fato vive só em `carregarSeloEFato` e no
// ramo com-mudança da rotação, nunca antes da comparação).
function derivarDatasetESelo(manifest: unknown): {
  dataset: string | null;
  novoSeal: SealState;
} {
  const dataset = fatoDatasetDe(manifest, fatoParamDaUrl());
  return { dataset, novoSeal: getSealParaDataset(manifest, dataset) };
}

// Manifest legível: objeto não-nulo (200 com corpo null/array/texto não é
// manifest — `getSealState`/`fatoDatasetDe` derivariam selo vazio e o
// wipe apagaria dado validado; ver guard da rotação abaixo).
function manifestoValido(d: unknown): d is Record<string, unknown> {
  return typeof d === "object" && d !== null && !Array.isArray(d);
}

export default function Explorar() {
  const [fato, setFato] = useState<FatoRegiao | null>(null);
  const [seal, setSeal] = useState<SealState>({ official: null, hasFixture: false, fixtureHash: "" });
  const [manifestChecked, setManifestChecked] = useState(false);
  const [initial, setInitial] = useState<ExplorarSelecao & { hash: string } | null>(null);
  const [urlHash, setUrlHash] = useState("");
  // Trigger vivo de rotação (paridade Home/regiao, EVOLVE-9 Task 3):
  // `seloRef` é a verdade comparável fora do closure (o effect de foco
  // monta uma vez); `ocupadoRef` evita fetch duplicado com um load em voo;
  // `geracaoRef` barra publish de run stale (rotação vs mount em voo).
  const seloRef = useRef<string | null>(null);
  const ocupadoRef = useRef(false);
  const geracaoRef = useRef(0);

  // Núcleo único de leitura (mount + ramo com-mudança da rotação
  // partilham — sem fork): manifest → dataset+selo → fato.
  const carregarSeloEFato = useCallback(async () => {
    const manifest = (await fetchJson("/data/manifest.json")).data;
    const { dataset, novoSeal } = derivarDatasetESelo(manifest);
    const f = dataset ? (await fetchJson<FatoRegiao>(`/data/${dataset}.json`)).data : null;
    return { dataset, novoSeal, f };
  }, []);

  useEffect(() => {
    const q = parseExplorarQuery(window.location.search);
    setInitial(q);
    setUrlHash(q.hash ?? "");
    // Loading honesto até o fato assentar: manifestChecked só após o fetch
    // do fato (antes, fato=null exibia SEM_DADO transitório).
    setManifestChecked(false);
    const minha = ++geracaoRef.current;
    ocupadoRef.current = true;
    (async () => {
      try {
        const r = await carregarSeloEFato();
        if (geracaoRef.current !== minha) return;
        setSeal(r.novoSeal);
        seloRef.current = JSON.stringify({ ds: r.dataset, seal: r.novoSeal });
        setFato(r.f);
        setManifestChecked(true);
      } finally {
        if (geracaoRef.current === minha) ocupadoRef.current = false;
      }
    })();
    return () => {
      ocupadoRef.current = false;
    };
  }, [carregarSeloEFato]);

  // Rotação de manifest (paridade Home/regiao): no foco da janela ou na
  // volta de visibilidade, re-lê SÓ o manifest (barato) e só refaz o fetch
  // pesado (fato) quando o par dataset+selo mudou — sem fetch duplicado
  // quando inalterado, sem números stale após rotação. Troca silenciosa:
  // sem "a carregar", sem limpar o fato atual — os sets assentam juntos.
  useEffect(() => {
    const aoRetomar = async () => {
      if (ocupadoRef.current) return;
      ocupadoRef.current = true;
      const minha = ++geracaoRef.current;
      try {
        // Blip ≠ rotação (fail-closed sem supressão): manifest ilegível
        // (offline/500/JSON inválido — `status !== "ok"`) OU corpo sem
        // objeto (`200` com `null`/array/texto — `getSealState` derivaria
        // selo vazio) sai ANTES da comparação e mantém o último selo
        // validado (stale-while-revalidate); só um fetch OK com objeto e
        // selo diferente rotaciona. Falha nunca publica selo vazio.
        const leitura = await fetchJson("/data/manifest.json");
        if (leitura.status !== "ok" || !manifestoValido(leitura.data)) return;
        if (geracaoRef.current !== minha) return;
        const { dataset, novoSeal } = derivarDatasetESelo(leitura.data);
        if (JSON.stringify({ ds: dataset, seal: novoSeal }) === seloRef.current) return;
        const f = dataset ? (await fetchJson<FatoRegiao>(`/data/${dataset}.json`)).data : null;
        if (geracaoRef.current !== minha) return;
        seloRef.current = JSON.stringify({ ds: dataset, seal: novoSeal });
        setSeal(novoSeal);
        setFato(f);
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
  }, [carregarSeloEFato]);

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
