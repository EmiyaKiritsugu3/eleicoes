"use client";

import { useEffect, useMemo, useState } from "react";
import SourceBadge from "../components/SourceBadge";
import {
  evolucaoAnual,
  filtrarCandidatos,
  formatVotes,
  getAuditInfo,
  getResumo,
  rankingUf,
  type AuditInfo,
  type Filtros,
  type PorCandidatoRow,
  type PorUfRow,
  type ResumoJson,
} from "../lib/data";

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

export default function Home() {
  const [resumo, setResumo] = useState<ResumoJson | null>(null);
  const [porUf, setPorUf] = useState<PorUfRow[]>([]);
  const [porCand, setPorCand] = useState<PorCandidatoRow[]>([]);
  const [audit, setAudit] = useState<AuditInfo | null>(null);
  const [manifestChecked, setManifestChecked] = useState(false);
  const [f, setF] = useState<Filtros>({});

  useEffect(() => {
    (async () => {
      setResumo(await fetchJson<ResumoJson>("/data/resumo.json"));
      setPorUf((await fetchJson<PorUfRow[]>("/data/por_uf.json")) ?? []);
      setPorCand((await fetchJson<PorCandidatoRow[]>("/data/por_candidato.json")) ?? []);
      setAudit(getAuditInfo(await fetchJson("/data/manifest.json")));
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

  return (
    <>
      <h1>SAD Eleições — resultados</h1>

      {manifestChecked && !audit && (
        <p role="alert" className="badge badge-warn">
          dado não auditado — manifest ausente ou inválido; números abaixo não são oficiais
        </p>
      )}
      {audit && <SourceBadge hash={audit.hash} url={audit.url} date={audit.date} />}

      <section aria-label="Busca">
        <h2>Busca</h2>
        <form onSubmit={(e) => e.preventDefault()} style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          {(["ano", "cargo", "uf", "municipio", "candidato"] as const).map((k) => (
            <label key={k}>
              {k}{" "}
              <input value={f[k] ?? ""} onChange={set(k)} placeholder={k} aria-label={k} />
            </label>
          ))}
        </form>
      </section>

      <section aria-label="Resumo">
        <h2>Resumo</h2>
        {semDados ? (
          <p>{SEM_DADO}</p>
        ) : (
          <ul>
            <li>Total de votos: {formatVotes(res.totalVotos)}</li>
            <li>Linhas: {formatVotes(resumo?.total_linhas ?? 0)}</li>
            <li>Anos: {(resumo?.anos ?? []).join(", ") || SEM_DADO}</li>
          </ul>
        )}
        {audit ? (
          <SourceBadge hash={audit.hash} url={audit.url} date={audit.date} />
        ) : (
          <SourceBadge hash="" url="" date="" />
        )}
      </section>

      <section aria-label="Mapa por UF">
        <h2>Mapa por UF (lista v1 — TopoJSON fora do escopo YAGNI)</h2>
        {ufs.length === 0 ? (
          <p>{SEM_DADO}</p>
        ) : (
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
        )}
      </section>

      <section aria-label="Ranking de candidatos">
        <h2>Ranking de candidatos</h2>
        {cands.length === 0 ? (
          <p>{SEM_DADO}</p>
        ) : (
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
        )}
      </section>

      <section aria-label="Evolução">
        <h2>Evolução anual</h2>
        {ev.length === 0 ? (
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
          </>
        )}
      </section>

      <section aria-label="Abstenção, nulos e brancos">
        <h2>Abstenção / nulos / brancos</h2>
        <p>{SEM_DADO} — fato_eleitorado sem fonte no V1 (só votação nominal)</p>
      </section>
    </>
  );
}
