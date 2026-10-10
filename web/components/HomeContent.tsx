"use client";

import React, { useEffect, useMemo, useState } from "react";
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

const SEM_DADO = "sem dado oficial";

async function fetchJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(path, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
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
  const [f, setF] = useState<Filtros>(initialFiltros ?? {});

  useEffect(() => {
    (async () => {
      setResumo(await fetchJson<ResumoJson>("/data/resumo.json"));
      setPorUf((await fetchJson<PorUfRow[]>("/data/por_uf.json")) ?? []);
      setPorCand((await fetchJson<PorCandidatoRow[]>("/data/por_candidato.json")) ?? []);
      setSeal(getSealState(await fetchJson("/data/manifest.json")));
      setManifestChecked(true);
    })();
  }, []);

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
  const badge = <SealSlot seal={seal} />;
  const candidatoAtivo = (f.candidato ?? "").trim() !== "";
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
          <p>{SEM_DADO}</p>
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
        <h2>Mapa por UF (lista v1 — TopoJSON fora do escopo YAGNI)</h2>
        {candidatoAtivo && <p role="note">{NOTA_CANDIDATO_GLOBAL}</p>}
        {badge}
        {carregando ? (
          <p role="status">a carregar…</p>
        ) : semProva || ufs.length === 0 ? (
          <p>{SEM_DADO}</p>
        ) : (
          <div style={{ overflowX: "auto" }} tabIndex={0} role="region" aria-label="Votos por UF">
          <table>
            <caption>Votos por UF</caption>
            <thead>
              <tr><th scope="col">UF</th><th scope="col">Votos</th></tr>
            </thead>
            <tbody>
              {ufs.map((r) => (
                <tr key={r.uf}><td>{r.uf}</td><td>{formatVotes(r.votos)}</td></tr>
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
          <p>{SEM_DADO}</p>
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
          <p>{SEM_DADO}</p>
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
