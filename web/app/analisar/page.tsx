"use client";

import React, { useEffect, useMemo, useState } from "react";
import SourceBadge from "../../components/SourceBadge";
import Comparator, { type CompareSide } from "../../components/Comparator";
import {
  evolucaoAnual,
  formatVotes,
  getAuditInfo,
  getResumo,
  rankingUf,
  type AuditInfo,
  type Filtros,
  type PorCandidatoRow,
  type PorUfRow,
  type ResumoJson,
} from "../../lib/data";
import {
  buildCsvExport,
  buildShareUrl,
  emptyStateFor,
  semCoberturaTurnoZona,
} from "../../lib/export";

const SEM_DADO = "sem dado oficial";
const SEM_COBERTURA_AGG =
  " — filtro sem cobertura no agregado V1 (só ano/cargo/UF e partido)";

interface AnalisarFiltros extends Filtros {
  turno?: string;
  zona?: string;
  partido?: string;
}

async function fetchJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(path, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** Filtra linhas genéricas por partido quando o agregado carrega a coluna. */
function matchPartido(row: unknown, partido?: string): boolean {
  if (!partido || partido.trim() === "") return true;
  const rec = (row ?? {}) as Record<string, unknown>;
  if (rec.partido === undefined) return true;
  return String(rec.partido ?? "").toLowerCase().includes(partido.trim().toLowerCase());
}

/** Filtra candidatos por partido (agregado V1 tem partido; turno/zona não). */
function filtrarPorPartido(
  rows: PorCandidatoRow[],
  partido?: string,
): PorCandidatoRow[] {
  if (!partido || partido.trim() === "") return [...rows];
  const q = partido.trim().toLowerCase();
  return rows.filter((r) => String(r.partido ?? "").toLowerCase().includes(q));
}

function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function Analisar() {
  const [porUf, setPorUf] = useState<PorUfRow[]>([]);
  const [porCand, setPorCand] = useState<PorCandidatoRow[]>([]);
  const [resumo, setResumo] = useState<ResumoJson | null>(null);
  const [audit, setAudit] = useState<AuditInfo | null>(null);
  const [manifestChecked, setManifestChecked] = useState(false);
  const [f, setF] = useState<AnalisarFiltros>({});
  const [pivo, setPivo] = useState<"uf" | "partido" | "ano">("uf");
  const [compMode, setCompMode] = useState<"candidatos" | "anos" | "municipios">(
    "candidatos",
  );
  const [compA, setCompA] = useState("");
  const [compB, setCompB] = useState("");
  const [urlHash, setUrlHash] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setF({
      ano: params.get("ano") ?? undefined,
      cargo: params.get("cargo") ?? undefined,
      uf: params.get("uf") ?? undefined,
      turno: params.get("turno") ?? undefined,
      zona: params.get("zona") ?? undefined,
      partido: params.get("partido") ?? undefined,
      candidato: params.get("candidato") ?? undefined,
    });
    setUrlHash(params.get("hash") ?? "");
    (async () => {
      setResumo(await fetchJson<ResumoJson>("/data/resumo.json"));
      setPorUf((await fetchJson<PorUfRow[]>("/data/por_uf.json")) ?? []);
      setPorCand(
        (await fetchJson<PorCandidatoRow[]>("/data/por_candidato.json")) ?? [],
      );
      setAudit(getAuditInfo(await fetchJson("/data/manifest.json")));
      setManifestChecked(true);
    })();
  }, []);

  const set =
    (k: keyof AnalisarFiltros) => (e: React.ChangeEvent<HTMLInputElement>) =>
      setF((prev) => ({ ...prev, [k]: e.target.value }));

  const semCob = useMemo(
    () => semCoberturaTurnoZona(porUf, porCand, f),
    [porUf, porCand, f],
  );

  // Partido aplica-se uniformemente: onde o agregado carrega a coluna, filtra;
  // onde não carrega (por_uf no V1), as seções exibem nota de divulgação.
  const partidoAtivo = (f.partido ?? "").trim() !== "";
  const porUfTemPartido = useMemo(
    () => porUf.some((r) => (r as unknown as Record<string, unknown>).partido !== undefined),
    [porUf],
  );
  const porUfFiltrado = useMemo(
    () =>
      porUfTemPartido
        ? porUf.filter((r) => matchPartido(r, f.partido))
        : porUf,
    [porUf, porUfTemPartido, f.partido],
  );
  const partidoIgnoradoUF = partidoAtivo && !porUfTemPartido;
  const NOTA_PARTIDO =
    "nota: filtro partido sem cobertura no agregado por UF (V1) — números desta seção ignoram partido";

  const baseFiltros: Filtros = useMemo(
    () => ({ ano: f.ano, cargo: f.cargo, uf: f.uf }),
    [f.ano, f.cargo, f.uf],
  );

  const ufs = useMemo(
    () => (semCob ? [] : rankingUf(porUfFiltrado, baseFiltros)),
    [porUfFiltrado, baseFiltros, semCob],
  );
  const ev = useMemo(
    () => (semCob ? [] : evolucaoAnual(porUfFiltrado, baseFiltros)),
    [porUfFiltrado, baseFiltros, semCob],
  );
  const cands = useMemo(() => {
    if (semCob) return [];
    const porPartido = filtrarPorPartido(porCand, f.partido);
    if (!f.candidato || f.candidato.trim() === "") {
      return [...porPartido].sort(
        (a, b) => (Number(b.votos) || 0) - (Number(a.votos) || 0),
      );
    }
    const q = f.candidato.trim().toLowerCase();
    return porPartido
      .filter(
        (r) =>
          String(r.nome_urna ?? "").toLowerCase().includes(q) ||
          String(r.partido ?? "").toLowerCase().includes(q),
      )
      .sort((a, b) => (Number(b.votos) || 0) - (Number(a.votos) || 0));
  }, [porCand, f.partido, f.candidato, semCob]);

  const pivoRows: { chave: string; votos: number }[] = useMemo(() => {
    if (pivo === "uf") return ufs.map((r) => ({ chave: r.uf, votos: r.votos }));
    if (pivo === "ano") return ev.map((r) => ({ chave: String(r.ano), votos: r.votos }));
    const acc = new Map<string, number>();
    for (const r of cands) {
      const k = String(r.partido ?? "") || SEM_DADO;
      acc.set(k, (acc.get(k) ?? 0) + (Number(r.votos) || 0));
    }
    return [...acc.entries()]
      .map(([chave, votos]) => ({ chave, votos }))
      .sort((a, b) => b.votos - a.votos);
  }, [pivo, ufs, ev, cands]);

  const sides: { left: CompareSide | null; right: CompareSide | null } =
    useMemo(() => {
      if (compMode === "anos") {
        const byAno = new Map(ev.map((r) => [String(r.ano), r.votos]));
        const mk = (k: string): CompareSide | null => {
          if (!k || !byAno.has(k)) return null;
          return { titulo: k, votos: byAno.get(k) ?? 0, detalhe: "ano" };
        };
        return { left: mk(compA), right: mk(compB) };
      }
      if (compMode === "municipios") return { left: null, right: null };
      const byId = new Map(porCand.map((r) => [r.candidato_id, r]));
      const mk = (k: string): CompareSide | null => {
        const r = k ? byId.get(k) : undefined;
        if (!r) return null;
        return {
          titulo: String(r.nome_urna ?? k),
          votos: Number(r.votos) || 0,
          detalhe: String(r.partido ?? ""),
        };
      };
      return { left: mk(compA), right: mk(compB) };
    }, [compMode, compA, compB, ev, porCand]);

  const dispersao = useMemo(() => {
    const rows = porCand as (PorCandidatoRow & {
      financiamento?: unknown;
      valor_financiamento?: unknown;
    })[];
    return rows
      .filter(
        (r) =>
          typeof r.financiamento === "number" ||
          typeof r.valor_financiamento === "number",
      )
      .map((r) => ({
        nome: String(r.nome_urna ?? r.candidato_id),
        votos: Number(r.votos) || 0,
        financiamento: Number(r.financiamento ?? r.valor_financiamento) || 0,
      }));
  }, [porCand]);

  const res = useMemo(
    () => getResumo(porUfFiltrado, baseFiltros),
    [porUfFiltrado, baseFiltros],
  );
  const hash = audit?.hash ?? "";
  // Contrato de reprodutibilidade: serializa TODA chave que a página hidrata
  // (round-trip: abrir a URL restaura o mesmo estado de filtros).
  const shareUrl = buildShareUrl(
    {
      ano: f.ano,
      cargo: f.cargo,
      uf: f.uf,
      turno: f.turno,
      zona: f.zona,
      partido: f.partido,
      candidato: f.candidato,
    },
    hash,
  );
  const hashDivergente = urlHash !== "" && hash !== "" && urlHash !== hash;

  const badge = audit ? (
    <SourceBadge hash={audit.hash} url={audit.url} date={audit.date} />
  ) : (
    <SourceBadge hash="" url="" date="" />
  );

  const csvRows = useMemo(
    () =>
      pivoRows.map((r) => ({
        chave: r.chave,
        votos: r.votos,
        pivo,
        ano: f.ano ?? "",
        cargo: f.cargo ?? "",
        uf: f.uf ?? "",
      })),
    [pivoRows, pivo, f.ano, f.cargo, f.uf],
  );

  return (
    <>
      <h1>SAD Eleições — analisar</h1>

      {manifestChecked && !audit && (
        <p role="alert" className="badge badge-warn">
          dado não auditado — manifest ausente ou inválido; números abaixo não são oficiais
        </p>
      )}
      {hashDivergente && (
        <p role="alert" className="badge badge-warn">
          hash da URL diverge do manifest atual — revalide a fonte antes de citar
        </p>
      )}
      {audit && <SourceBadge hash={audit.hash} url={audit.url} date={audit.date} />}

      <section aria-label="Filtros">
        <h2>Filtros</h2>
        {badge}
        <form
          onSubmit={(e) => e.preventDefault()}
          style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}
        >
          {(["ano", "cargo", "uf", "turno", "zona", "partido", "candidato"] as const).map(
            (k) => (
              <label key={k}>
                {k}{" "}
                <input
                  value={f[k] ?? ""}
                  onChange={set(k)}
                  placeholder={k}
                  aria-label={k}
                />
              </label>
            ),
          )}
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
        {semCob && (
          <p role="status">
            {SEM_DADO}
            {SEM_COBERTURA_AGG}
          </p>
        )}
      </section>

      <section aria-label="Resumo filtrado">
        <h2>Resumo filtrado</h2>
        {badge}
        {partidoIgnoradoUF && !semCob && <p role="note">{NOTA_PARTIDO}</p>}
        {!resumo || res.vazio || semCob ? (
          <p>{SEM_DADO}</p>
        ) : (
          <p>Total de votos no filtro: {formatVotes(res.totalVotos)}</p>
        )}
      </section>

      <section aria-label="Pivô">
        <h2>Pivô</h2>
        {badge}
        {partidoIgnoradoUF && !semCob && pivo !== "partido" && (
          <p role="note">{NOTA_PARTIDO}</p>
        )}
        <div style={{ display: "flex", gap: "0.5rem" }}>
          {(["uf", "partido", "ano"] as const).map((d) => (
            <label key={d}>
              <input
                type="radio"
                name="pivo"
                checked={pivo === d}
                onChange={() => setPivo(d)}
              />{" "}
              {d}
            </label>
          ))}
        </div>
        {emptyStateFor(pivoRows) ? (
          <p>{emptyStateFor(pivoRows)}</p>
        ) : (
          <table>
            <caption>Pivô por {pivo}</caption>
            <thead>
              <tr>
                <th scope="col">{pivo}</th>
                <th scope="col">Votos</th>
              </tr>
            </thead>
            <tbody>
              {pivoRows.map((r) => (
                <tr key={r.chave}>
                  <td>{r.chave}</td>
                  <td>{formatVotes(r.votos)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section aria-label="Comparador">
        <h2>Comparador lado-a-lado</h2>
        {badge}
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          {(["candidatos", "anos", "municipios"] as const).map((m) => (
            <label key={m}>
              <input
                type="radio"
                name="compMode"
                checked={compMode === m}
                onChange={() => {
                  setCompMode(m);
                  setCompA("");
                  setCompB("");
                }}
              />{" "}
              {m}
            </label>
          ))}
        </div>
        {partidoIgnoradoUF && !semCob && compMode === "anos" && (
          <p role="note">{NOTA_PARTIDO}</p>
        )}
        {compMode === "municipios" ? (
          <>
            <p>
              <label>
                município A{" "}
                <input disabled aria-label="município A" placeholder="município A" />
              </label>{" "}
              <label>
                município B{" "}
                <input disabled aria-label="município B" placeholder="município B" />
              </label>
            </p>
            <p>
              {SEM_DADO} — por município em breve — V1 agrega por UF
            </p>
            <Comparator left={null} right={null} />
          </>
        ) : (
          <>
            <p style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              <label>
                A{" "}
                <input
                  value={compA}
                  onChange={(e) => setCompA(e.target.value)}
                  placeholder={compMode === "anos" ? "ano A (ex. 2022)" : "id candidato A"}
                  aria-label="comparar A"
                />
              </label>
              <label>
                B{" "}
                <input
                  value={compB}
                  onChange={(e) => setCompB(e.target.value)}
                  placeholder={compMode === "anos" ? "ano B (ex. 2018)" : "id candidato B"}
                  aria-label="comparar B"
                />
              </label>
            </p>
            <Comparator left={sides.left} right={sides.right} />
          </>
        )}
      </section>

      <section aria-label="Dispersão votos x financiamento">
        <h2>Dispersão votos × financiamento</h2>
        {badge}
        {emptyStateFor(dispersao) ? (
          <p>
            {SEM_DADO} — financiamento sem fonte no V1 (só votação nominal)
          </p>
        ) : (
          <table>
            <caption>Dispersão votos × financiamento</caption>
            <thead>
              <tr>
                <th scope="col">Candidato</th>
                <th scope="col">Votos</th>
                <th scope="col">Financiamento</th>
              </tr>
            </thead>
            <tbody>
              {dispersao.map((r) => (
                <tr key={r.nome}>
                  <td>{r.nome}</td>
                  <td>{formatVotes(r.votos)}</td>
                  <td>{formatVotes(r.financiamento)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section aria-label="Série histórica">
        <h2>Série histórica</h2>
        {badge}
        {partidoIgnoradoUF && !semCob && <p role="note">{NOTA_PARTIDO}</p>}
        {emptyStateFor(ev) ? (
          <p>{SEM_DADO}</p>
        ) : (
          <table>
            <caption>Série histórica de votos por ano</caption>
            <thead>
              <tr>
                <th scope="col">Ano</th>
                <th scope="col">Votos</th>
              </tr>
            </thead>
            <tbody>
              {ev.map((r) => (
                <tr key={r.ano}>
                  <td>{r.ano}</td>
                  <td>{formatVotes(r.votos)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section aria-label="Export reproduzível">
        <h2>Export reproduzível</h2>
        {badge}
        <p>
          URL compartilhável: <code>{shareUrl}</code>
        </p>
        <p>
          <button
            type="button"
            disabled={!audit}
            title={
              audit
                ? "Baixar CSV com proveniência auditada"
                : "Exportação bloqueada — dado não auditado"
            }
            onClick={() =>
              downloadCsv(
                "analisar.csv",
                buildCsvExport(csvRows, audit),
              )
            }
          >
            Exportar CSV
          </button>
        </p>
        {manifestChecked && !audit && (
          <p role="alert">
            exportação bloqueada — dado não auditado; o CSV só é gerado com
            manifest válido para que o arquivo seja auto-descritivo
          </p>
        )}
        <p>
          <small>
            O CSV inclui header de proveniência <code>fonte,url,hash,data</code>.
          </small>
        </p>
        {emptyStateFor(csvRows) ? <p>{SEM_DADO}</p> : null}
      </section>
    </>
  );
}
