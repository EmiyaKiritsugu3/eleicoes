"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MapaBrasil from "./MapaBrasil";
import { UF_POR_PREFIXO_IBGE } from "./PainelRegiao";
import { loadMalha, MALHA_MUNICIPIOS_URL, UFS, type MalhaFeature } from "../lib/malha";
import SourceBadge from "./SourceBadge";
import SealSlot from "./SealSlot";
import perguntasJson from "../data/perguntas.json";
import {
  evolucaoAnual,
  filtrarCandidatos,
  formatVotes,
  getSealState,
  getResumo,
  NOTA_CANDIDATO_GLOBAL,
  NOTA_RANKING_SEM_COBERTURA,
  rankingUf,
  type Filtros,
  type PorCandidatoRow,
  type PorUfRow,
  type ResumoJson,
  type SealState,
} from "../lib/data";
import { vereditoTemProva } from "../lib/regiao";
import { fetchJson } from "../lib/fetchJson";
import { MOTIVO_SEM_HASH, SEM_DADO } from "../lib/textos";

/** Seleção do mapa → sigla UF p/ focar o filtro (fail-closed: EXTERIOR e
 *  seleções desconhecidas retornam null em vez de focar errado). Aceita
 *  sigla UF (fallback em lista/teclado) ou IBGE7 (clique no canvas).
 *  Tabela de prefixos: fonte única `UF_POR_PREFIXO_IBGE` (PainelRegiao). */
export function ufDeSelecaoMapa(sel: string): string | null {
  const s = (sel ?? "").trim().toUpperCase();
  if ((UFS as readonly string[]).includes(s)) return s;
  const m = /^(\d{2})\d{5}$/.exec(s);
  if (m) return UF_POR_PREFIXO_IBGE[m[1]] ?? null;
  return null;
}

function Bar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div
      role="img"
      aria-label={`${pct}% do máximo`}
      style={{ background: "#eee", height: 10, minWidth: 120 }}
    >
      <div style={{ background: "#1a5fb4", height: 10, width: `${pct}%` }} />
    </div>
  );
}

/** Conteúdo de / extraído da rota para aceitar `initialFiltros` (seam de
 *  teste): o tipo Page do Next (`Diff<PageProps, FirstArg>`) proíbe props
 *  extras no default export da rota, então a rota (`app/page.tsx`) é um
 *  `Home()` sem args que delega para cá. Em produção monta com `{}`.
 */
export function HomeContent({ initialFiltros }: { initialFiltros?: Filtros }) {
  const [resumo, setResumo] = useState<ResumoJson | null>(null);
  const [porUf, setPorUf] = useState<PorUfRow[]>([]);
  const [porCand, setPorCand] = useState<PorCandidatoRow[]>([]);
  const [seal, setSeal] = useState<SealState>({ official: null, hasFixture: false, fixtureHash: "" });
  const [manifestChecked, setManifestChecked] = useState(false);
  const [malhaFeatures, setMalhaFeatures] = useState<MalhaFeature[] | null>(null);
  const [f, setF] = useState<Filtros>(initialFiltros ?? {});
  // EVOLVE-7 Task 6 — trigger vivo de rotação de manifest: `sealRef` é a
  // verdade comparável fora do closure (o effect de foco monta uma vez e
  // nunca veria o `seal` novo); `ocupadoRef` evita fetch duplicado entre o
  // carregamento inicial e um foco no meio dele.
  const sealRef = useRef<SealState>(seal);
  const ocupadoRef = useRef(false);

  // Núcleo único de leitura pesada (webfix Finding 6, P3): mount
  // (`carregarDados`) e rotação (`aoRetomar`) partilham este helper — a
  // sequência de fetches existe UMA vez (sem fork). Devolve o selo lido;
  // cada chamador aplica o seu epílogo (mount: `setManifestChecked(true)`;
  // rotação: só entra aqui com selo mudado). Sem mudança de comportamento.
  const carregarPesados = useCallback(async () => {
    setResumo((await fetchJson<ResumoJson>("/data/resumo.json")).data);
    setPorUf((await fetchJson<PorUfRow[]>("/data/por_uf.json")).data ?? []);
    setPorCand((await fetchJson<PorCandidatoRow[]>("/data/por_candidato.json")).data ?? []);
    return getSealState((await fetchJson("/data/manifest.json")).data);
  }, []);

  const carregarDados = useCallback(async () => {
    if (ocupadoRef.current) return;
    ocupadoRef.current = true;
    try {
      const novoSeal = await carregarPesados();
      sealRef.current = novoSeal;
      setSeal(novoSeal);
      setManifestChecked(true);
    } finally {
      ocupadoRef.current = false;
    }
  }, [carregarPesados]);

  useEffect(() => {
    void carregarDados();
  }, [carregarDados]);

  // Rotação de manifest (completa o sync do EVOLVE-6 T6, que reage a props
  // repassadas mas não tinha trigger vivo): no foco da janela ou na volta
  // de visibilidade, re-lê SÓ o manifest (barato) e só refaz o fetch pesado
  // quando o selo mudou — sem fetch duplicado quando inalterado, sem
  // números stale após rotação. A malha segue "as needed" no effect de
  // elegibilidade abaixo (geometria não rota com o manifest).
  useEffect(() => {
    const aoRetomar = async () => {
      if (ocupadoRef.current) return;
      ocupadoRef.current = true;
      try {
        const novoSeal = getSealState((await fetchJson("/data/manifest.json")).data);
        if (JSON.stringify(novoSeal) === JSON.stringify(sealRef.current)) return;
        sealRef.current = await carregarPesados();
        setSeal(sealRef.current);
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
  }, [carregarPesados]);

  const set = (k: keyof Filtros) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setF((prev) => ({ ...prev, [k]: e.target.value }));

  const res = useMemo(() => getResumo(porUf, f), [porUf, f]);
  const ufs = useMemo(() => rankingUf(porUf, f), [porUf, f]);
  const ev = useMemo(() => evolucaoAnual(porUf, f), [porUf, f]);
  const cands = useMemo(() => filtrarCandidatos(porCand, f), [porCand, f]);
  const maxEv = ev.reduce((m, r) => Math.max(m, r.votos), 0);
  const semDados = !resumo || res.vazio || resumo.total_linhas === 0;
  // Loading honesto (Task 5): fetch pendente mostra "a carregar" com
  // role="status" nas seções de dados; SEM_DADO só após resolve.
  // Seções estáticas (biblioteca, abstenção) não dependem de fetch.
  const carregando = !manifestChecked;
  // Ruling EVOLVE-3 Task 4 (opção a): Home suprime como Explorar/Curada —
  // sem prova no selo (nem oficial nem fixture com hash, cf.
  // `vereditoTemProva` em lib/regiao — fonte única do gate), as seções de
  // dados mostram "sem dado oficial" em vez de números, mesmo com dados
  // carregados e com o banner "dado não auditado" acima. Só display é
  // gated; fetch e agregação (getResumo/rankingUf/...) não mudam.
  const semProva = manifestChecked && !vereditoTemProva(seal);
  // Elegibilidade do mapa (espelha o gate de render abaixo): sem ela a seção
  // suprime de todo jeito, então a malha (1–3MB) nem é buscada/decodificada.
  const elegivelMapa = manifestChecked && !semProva && ufs.length > 0;
  // Resolução única da malha municipal (artefato gitignored, gerado por
  // `scripts/malha.py` no CI): a Home resolve via `loadMalha` e passa as
  // features prontas ao `MapaBrasil` (sem refetch). Com malha válida, mapa
  // clicável; sem malha (ausente OU vazia/inválida — HTTP 200 não basta), o
  // fallback único e honesto na lista v1. Qualquer erro → null (fail-closed,
  // nunca canvas quebrado). Sucesso é cacheado no estado (sem refetch ao
  // re-elegibilizar); falha tenta de novo (a malha pode ter surgido).
  useEffect(() => {
    if (!elegivelMapa || malhaFeatures) return;
    let vivo = true;
    void (async () => {
      try {
        const features = await loadMalha(MALHA_MUNICIPIOS_URL);
        if (vivo) setMalhaFeatures(features);
      } catch {
        if (vivo) setMalhaFeatures(null);
      }
    })();
    return () => {
      vivo = false;
    };
  }, [elegivelMapa, malhaFeatures]);
  const badge = <SealSlot seal={seal} />;
  const candidatoAtivo = (f.candidato ?? "").trim() !== "";
  // Slice-2 (EVOLVE-5 Task 3): UF em foco aproxima o mapa p/ os municípios
  // da UF (zoom via `nivel="municipio"` + `ufSelecionada`, reuse do filtro
  // do `MapaBrasil`); sem foco válido, nível UF. EXTERIOR nunca foca
  // (fail-closed em `ufDeSelecaoMapa`), então nunca há zoom p/ ele.
  const ufFoco = (f.uf ?? "").trim().toUpperCase();
  const comZoom = (UFS as readonly string[]).includes(ufFoco);
  // Alerta honesto sem depender de CSS externo (M4-web): fundo/borda inline.
  const ALERTA_STYLE: React.CSSProperties = {
    background: "#fff3cd",
    border: "1px solid #b45309",
    fontWeight: "bold",
  };
  const escopoIgnoradoNoRanking =
    (f.ano ?? "").trim() !== "" ||
    (f.cargo ?? "").trim() !== "" ||
    (f.uf ?? "").trim() !== "";

  return (
    <>
      <h1>SAD Eleições — resultados</h1>

      {manifestChecked && !seal.official && !seal.hasFixture && (
        <p role="alert" className="badge badge-warn" style={ALERTA_STYLE}>
          dado não auditado — manifest ausente ou inválido; números abaixo não são oficiais
        </p>
      )}
      {manifestChecked && !seal.official && seal.hasFixture && (
        <SealSlot seal={seal} />
      )}
      {seal.official && <SourceBadge hash={seal.official.hash} url={seal.official.url} date={seal.official.date} />}

      <section aria-label="Busca">
        <h2>Busca</h2>
        <form onSubmit={(e) => e.preventDefault()} style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          {(["ano", "cargo", "uf", "candidato"] as const).map((k) => (
            <label key={k}>
              {k}{" "}
              <input value={f[k] ?? ""} onChange={set(k)} placeholder={k} aria-label={k} />
            </label>
          ))}
          <label>
            município{" "}
            <input
              value=""
              disabled
              placeholder="município"
              aria-label="município"
              title="por município em breve — V1 agrega por UF"
            />
            <small>por município em breve — V1 agrega por UF</small>
          </label>
        </form>
      </section>

      <section aria-label="Resumo">
        <h2>Resumo</h2>
        {candidatoAtivo && <p role="note">{NOTA_CANDIDATO_GLOBAL}</p>}
        {carregando ? (
          <p role="status">a carregar…</p>
        ) : semDados || semProva ? (
          <p>{SEM_DADO}{semProva ? ` — ${MOTIVO_SEM_HASH}` : ""}</p>
        ) : (
          <ul>
            <li>Total de votos: {formatVotes(res.totalVotos)}</li>
            <li>Linhas: {formatVotes(resumo?.total_linhas ?? 0)}</li>
            <li>Anos: {(resumo?.anos ?? []).join(", ") || SEM_DADO}</li>
          </ul>
        )}
        {seal.official ? (
          <SourceBadge hash={seal.official.hash} url={seal.official.url} date={seal.official.date} />
        ) : (
          <SealSlot seal={seal} />
        )}
      </section>

      <section aria-label="Mapa por UF">
        <h2>Mapa por UF</h2>
        {candidatoAtivo && <p role="note">{NOTA_CANDIDATO_GLOBAL}</p>}
        {badge}
        {carregando ? (
          <p role="status">a carregar…</p>
        ) : semProva || ufs.length === 0 ? (
          <p>{SEM_DADO}{semProva ? ` — ${MOTIVO_SEM_HASH}` : ""}</p>
        ) : malhaFeatures ? (
          <>
            {comZoom && (
              <div>
                <p role="status">Mostrando municípios de <a href={`/regiao/${ufFoco}`}>{ufFoco}</a></p>
                <button type="button" onClick={() => setF((prev) => ({ ...prev, uf: "" }))}>
                  Voltar para todas as UFs
                </button>
              </div>
            )}
            <MapaBrasil
              malhaUrl={MALHA_MUNICIPIOS_URL}
              nivel={comZoom ? "municipio" : "uf"}
              ufSelecionada={comZoom ? ufFoco : undefined}
              features={malhaFeatures}
              ocultarExterior
              onSelectIbge={(sel) => {
                const uf = ufDeSelecaoMapa(sel);
                if (uf) setF((prev) => ({ ...prev, uf }));
              }}
            />
          </>
        ) : (
          <div style={{ overflowX: "auto" }} tabIndex={0} role="region" aria-label="Votos por UF">
          <table>
            <caption>Votos por UF</caption>
            <thead>
              <tr><th scope="col">UF</th><th scope="col">Votos</th></tr>
            </thead>
            <tbody>
              {ufs.map((r) => (
                <tr key={r.uf}><td><a href={`/regiao/${r.uf}`}>{r.uf}</a></td><td>{formatVotes(r.votos)}</td></tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </section>

      <section aria-label="Ranking de candidatos">
        <h2>Ranking de candidatos</h2>
        {candidatoAtivo && escopoIgnoradoNoRanking && (
          <p role="note">{NOTA_RANKING_SEM_COBERTURA}</p>
        )}
        {badge}
        {carregando ? (
          <p role="status">a carregar…</p>
        ) : semProva || cands.length === 0 ? (
          <p>{SEM_DADO}{semProva ? ` — ${MOTIVO_SEM_HASH}` : ""}</p>
        ) : (
          <div style={{ overflowX: "auto" }} tabIndex={0} role="region" aria-label="Ranking de candidatos por votos">
          <table>
            <caption>Ranking de candidatos por votos</caption>
            <thead>
              <tr><th scope="col">Nome</th><th scope="col">Partido</th><th scope="col">Votos</th></tr>
            </thead>
            <tbody>
              {cands.map((r) => (
                <tr key={r.candidato_id}>
                  <td>{r.nome_urna}</td><td>{r.partido}</td><td>{formatVotes(r.votos)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </section>

      <section aria-label="Evolução">
        <h2>Evolução anual</h2>
        {badge}
        {carregando ? (
          <p role="status">a carregar…</p>
        ) : semProva || ev.length === 0 ? (
          <p>{SEM_DADO}{semProva ? ` — ${MOTIVO_SEM_HASH}` : ""}</p>
        ) : (
          <>
            <ul aria-hidden="true" style={{ listStyle: "none", padding: 0 }}>
              {ev.map((r) => (
                <li key={r.ano} style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                  <span style={{ width: 48 }}>{r.ano}</span>
                  <Bar value={r.votos} max={maxEv} />
                  <span>{formatVotes(r.votos)}</span>
                </li>
              ))}
            </ul>
            <div style={{ overflowX: "auto" }} tabIndex={0} role="region" aria-label="Evolução anual de votos (tabela equivalente)">
            <table>
              <caption>Evolução anual de votos (tabela equivalente)</caption>
              <thead>
                <tr><th scope="col">Ano</th><th scope="col">Votos</th></tr>
              </thead>
              <tbody>
                {ev.map((r) => (
                  <tr key={r.ano}><td>{r.ano}</td><td>{formatVotes(r.votos)}</td></tr>
                ))}
              </tbody>
            </table>
            </div>
          </>
        )}
      </section>

      <section aria-label="Biblioteca curada">
        <h2>Biblioteca curada — 30 perguntas</h2>
        {badge}
        <p>
          Respostas pré-computadas com fonte e hash quando há dado oficial auditado; sem dado
          oficial, cada pergunta mostra sem dado oficial em vez de número.
        </p>
        <ul>
          {(perguntasJson as { slug: string; titulo: string }[]).map((p) => (
            <li key={p.slug}>
              <a href={`/perguntas/${p.slug}`}>{p.titulo}</a>
            </li>
          ))}
        </ul>
      </section>

      <section aria-label="Abstenção, nulos e brancos">
        <h2>Abstenção / nulos / brancos</h2>
        <p>{SEM_DADO} — fato_eleitorado sem fonte no V1 (só votação nominal)</p>
      </section>
    </>
  );
}
