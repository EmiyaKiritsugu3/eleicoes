"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import SourceBadge from "../../components/SourceBadge";
import SealSlot from "../../components/SealSlot";
import CopyShare from "../../components/CopyShare";
import ExportCsv from "../../components/ExportCsv";
import Comparator, { type CompareSide } from "../../components/Comparator";
import {
  evolucaoAnual,
  formatVotes,
  getSealState,
  getResumo,
  rankingUf,
  resolverComparador,
  type Filtros,
  type PorCandidatoRow,
  type PorUfRow,
  type ResumoJson,
  type SealState,
} from "../../lib/data";
import {
  analisarCsvRows,
  buildShareUrl,
  emptyStateFor,
  parseAnalisarSearchParams,
  semCoberturaTurnoZona,
} from "../../lib/export";
import { manifestoValidoParaRotacao, vereditoTemProva } from "../../lib/regiao";
import { fetchJson } from "../../lib/fetchJson";
import { MOTIVO_SEM_HASH, SEM_DADO } from "../../lib/textos";

const SEM_COBERTURA_AGG =
  " — filtro sem cobertura no agregado V1 (só ano/cargo/UF e partido)";

interface AnalisarFiltros extends Filtros {
  turno?: string;
  zona?: string;
  partido?: string;
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

/** Chave interna estável do grupo sem-partido (EVOLVE-9 Task 4b):
 *  o agrupamento usa `chave`, o display usa `rotulo` (SEM_DADO só display).
 *  Categorias reais usam o namespace `partido:<nome>` — nem um partido
 *  chamado literalmente "sem dado oficial" colide com o grupo vazio. */
const CHAVE_SEM_PARTIDO = "__sem_partido__";

function chavePartido(bruto: string): string {
  return bruto === "" ? CHAVE_SEM_PARTIDO : `partido:${bruto}`;
}

export default function Analisar() {
  const [porUf, setPorUf] = useState<PorUfRow[]>([]);
  const [porCand, setPorCand] = useState<PorCandidatoRow[]>([]);
  const [resumo, setResumo] = useState<ResumoJson | null>(null);
  const [seal, setSeal] = useState<SealState>({ official: null, hasFixture: false, fixtureHash: "" });
  const [manifestChecked, setManifestChecked] = useState(false);
  const [f, setF] = useState<AnalisarFiltros>({});
  const [pivo, setPivo] = useState<"uf" | "partido" | "ano">("uf");
  const [compMode, setCompMode] = useState<"candidatos" | "anos" | "municipios">(
    "candidatos",
  );
  const [compA, setCompA] = useState("");
  const [compB, setCompB] = useState("");
  const [urlHash, setUrlHash] = useState("");
  // Trigger vivo de rotação (paridade Home/regiao, EVOLVE-9 Task 3):
  // `seloRef` é a verdade comparável fora do closure (o effect de foco
  // monta uma vez); `ocupadoRef` evita fetch duplicado com um load em voo;
  // `geracaoRef` barra publish de run stale.
  const seloRef = useRef<string | null>(null);
  const ocupadoRef = useRef(false);
  const geracaoRef = useRef(0);

  // Guard de geração partilhado (mount + rotação — sem fork do epílogo):
  // reserva `ocupadoRef`, carimba a geração do run e só libera o flag se o
  // run atual ainda for o dono (finally de run stale nunca solta o flag
  // alheio). `carga` recebe `minha` e barra o próprio publish quando
  // `geracaoRef.current !== minha`.
  const correrSobGuard = useCallback(async (carga: (minha: number) => Promise<void>) => {
    if (ocupadoRef.current) return;
    ocupadoRef.current = true;
    const minha = ++geracaoRef.current;
    try {
      await carga(minha);
    } finally {
      if (geracaoRef.current === minha) ocupadoRef.current = false;
    }
  }, []);

  // Núcleo único de leitura pesada (paridade com `carregarPesados` da Home,
  // webfix Finding 6): mount (`effect` abaixo) e rotação (`aoRetomar`)
  // partilham este helper — a sequência de fetches existe UMA vez (sem
  // fork). Devolve o selo lido; cada chamador aplica o seu epílogo.
  // `manifestJaLido` reaproveita o manifest barato já lido pela rotação
  // (sem fetch duplicado); ausente, o manifest é buscado como antes.
  // Sem mudança de comportamento.
  const carregarPesados = useCallback(async (manifestJaLido?: unknown) => {
    setResumo((await fetchJson<ResumoJson>("/data/resumo.json")).data);
    setPorUf((await fetchJson<PorUfRow[]>("/data/por_uf.json")).data ?? []);
    setPorCand(
      (await fetchJson<PorCandidatoRow[]>("/data/por_candidato.json")).data ?? [],
    );
    const manifest =
      manifestJaLido !== undefined
        ? manifestJaLido
        : (await fetchJson("/data/manifest.json")).data;
    return getSealState(manifest);
  }, []);

  useEffect(() => {
    // Hidrata só chaves do allowlist (parseAnalisarSearchParams): ?modoX=1
    // e afins são ignorados em vez de virarem estado.
    const q = parseAnalisarSearchParams(window.location.search);
    setF({
      ano: q.ano,
      cargo: q.cargo,
      uf: q.uf,
      turno: q.turno,
      zona: q.zona,
      partido: q.partido,
      candidato: q.candidato,
    });
    if (q.pivo === "uf" || q.pivo === "partido" || q.pivo === "ano") {
      setPivo(q.pivo);
    }
    if (
      q.modo === "candidatos" ||
      q.modo === "anos" ||
      q.modo === "municipios"
    ) {
      setCompMode(q.modo);
    }
    setCompA(q.a ?? "");
    setCompB(q.b ?? "");
    setUrlHash(q.hash ?? "");
    void correrSobGuard(async (minha) => {
      const novoSeal = await carregarPesados();
      if (geracaoRef.current !== minha) return;
      seloRef.current = JSON.stringify(novoSeal);
      setSeal(novoSeal);
      setManifestChecked(true);
    });
    return () => {
      ocupadoRef.current = false;
    };
  }, [carregarPesados, correrSobGuard]);

  // Rotação de manifest (paridade Home/regiao): no foco da janela ou na
  // volta de visibilidade, re-lê SÓ o manifest (barato) e só refaz o fetch
  // pesado quando o selo mudou — sem fetch duplicado quando inalterado, sem
  // números stale após rotação. Blip ≠ rotação: manifest ilegível
  // (`status !== "ok"`) OU corpo sem objeto (`200` com `null`/array/texto)
  // sai antes da comparação e mantém o último selo validado
  // (stale-while-revalidate). Troca silenciosa: sem "a carregar",
  // sem tocar nos filtros — só selo + dados assentam juntos.
  useEffect(() => {
    const aoRetomar = async () => {
      await correrSobGuard(async (minha) => {
        const leitura = await fetchJson("/data/manifest.json");
        if (leitura.status !== "ok" || !manifestoValidoParaRotacao(leitura.data)) return;
        if (geracaoRef.current !== minha) return;
        const conferido = getSealState(leitura.data);
        if (JSON.stringify(conferido) === seloRef.current) return;
        const novoSeal = await carregarPesados(leitura.data);
        if (geracaoRef.current !== minha) return;
        seloRef.current = JSON.stringify(novoSeal);
        setSeal(novoSeal);
      });
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
  }, [carregarPesados, correrSobGuard]);

  const set =
    (k: keyof AnalisarFiltros) => (e: React.ChangeEvent<HTMLInputElement>) =>
      setF((prev) => ({ ...prev, [k]: e.target.value }));

  const semCob = useMemo(
    () => semCoberturaTurnoZona(porUf, porCand, f),
    [porUf, porCand, f],
  );
  // Ruling EVOLVE-3 Task 4 (opção a): /analisar suprime como
  // Explorar/Curada — sem prova no selo (nem oficial nem fixture com
  // hash, cf. `vereditoTemProva` em lib/regiao — fonte única do gate),
  // ufs/ev/cands/dispersão esvaziam e as seções caem nos ramos SEM_DADO
  // existentes (fail-closed, paridade com Explorar). Só display é gated;
  // agregação, share e export não mudam (export já bloqueia sem oficial).
  const semProva = manifestChecked && !vereditoTemProva(seal);

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
    () => (semCob || semProva ? [] : rankingUf(porUfFiltrado, baseFiltros)),
    [porUfFiltrado, baseFiltros, semCob, semProva],
  );
  const ev = useMemo(
    () => (semCob || semProva ? [] : evolucaoAnual(porUfFiltrado, baseFiltros)),
    [porUfFiltrado, baseFiltros, semCob, semProva],
  );
  const cands = useMemo(() => {
    if (semCob || semProva) return [];
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
  }, [porCand, f.partido, f.candidato, semCob, semProva]);

  const pivoRows: { chave: string; rotulo: string; votos: number }[] = useMemo(() => {
    if (pivo === "uf") return ufs.map((r) => ({ chave: `uf:${r.uf}`, rotulo: r.uf, votos: r.votos }));
    if (pivo === "ano") return ev.map((r) => ({ chave: `ano:${String(r.ano)}`, rotulo: String(r.ano), votos: r.votos }));
    const acc = new Map<string, number>();
    for (const r of cands) {
      const bruto = String(r.partido ?? "").trim();
      const k = chavePartido(bruto);
      acc.set(k, (acc.get(k) ?? 0) + (Number(r.votos) || 0));
    }
    return [...acc.entries()]
      .map(([chave, votos]) => ({
        chave,
        rotulo: chave === CHAVE_SEM_PARTIDO ? SEM_DADO : chave.slice("partido:".length),
        votos,
      }))
      .sort((a, b) => b.votos - a.votos);
  }, [pivo, ufs, ev, cands]);

  const sides: { left: CompareSide | null; right: CompareSide | null } =
    useMemo(
      () => resolverComparador({ compMode, compA, compB, ev, cands, semCob }),
      [compMode, compA, compB, ev, cands, semCob],
    );

  const dispersao = useMemo(() => {
    if (semProva) return [];
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
  }, [porCand, semProva]);

  const res = useMemo(
    () => getResumo(porUfFiltrado, baseFiltros),
    [porUfFiltrado, baseFiltros],
  );
  // Selo oficial só com ingestão oficial; fixture nunca ancora ?hash= nem
  // export (sem proveniência oficial a citar).
  const hash = seal.official?.hash ?? "";
  // Contrato de reprodutibilidade: serializa TODA chave que a página hidrata
  // (filtros + pivo/modo/a/b do comparador — round-trip: abrir a URL
  // restaura o mesmo estado).
  const shareUrl = buildShareUrl(
    {
      ano: f.ano,
      cargo: f.cargo,
      uf: f.uf,
      turno: f.turno,
      zona: f.zona,
      partido: f.partido,
      candidato: f.candidato,
      pivo,
      modo: compMode,
      a: compA,
      b: compB,
    },
    hash,
  );
  const hashDivergente = urlHash !== "" && hash !== "" && urlHash !== hash;

  const badge = <SealSlot seal={seal} />;
  // Loading honesto (Task 5): fetch pendente mostra "a carregar" com
  // role="status" nas seções de dados; SEM_DADO só após resolve.
  const carregando = !manifestChecked;

  // Contexto de filtro junto dos dados (M13): cada linha carrega os 7
  // filtros ativos como colunas f_* para o CSV ser auto-descritivo.
  // EVOLVE-12: sem as colunas nuas `ano/cargo/uf` (dedupe — repetiam
  // `f_ano/f_cargo/f_uf` com o mesmo valor; uma fonte por filtro).
  // Fonte única `analisarCsvRows` (pura/testável).
  const csvRows = useMemo(
    () => analisarCsvRows(pivoRows, pivo, f),
    [pivoRows, pivo, f.ano, f.cargo, f.uf, f.turno, f.zona, f.partido, f.candidato],
  );

  // Alerta honesto sem depender de CSS externo (M4-web): fundo/borda inline.
  const ALERTA_STYLE: React.CSSProperties = {
    background: "#fff3cd",
    border: "1px solid #b45309",
    fontWeight: "bold",
  };

  return (
    <>
      <h1>SAD Eleições — analisar</h1>

      {manifestChecked && !seal.official && !seal.hasFixture && (
        <p role="alert" className="badge badge-warn" style={ALERTA_STYLE}>
          dado não auditado — manifest ausente ou inválido; números abaixo não são oficiais
        </p>
      )}
      {manifestChecked && !seal.official && seal.hasFixture && (
        <SealSlot seal={seal} />
      )}
      {hashDivergente && (
        <p role="alert" className="badge badge-warn" style={ALERTA_STYLE}>
          hash da URL diverge do manifest atual — revalide a fonte antes de citar
        </p>
      )}
      {seal.official && <SourceBadge hash={seal.official.hash} url={seal.official.url} date={seal.official.date} />}

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
              readOnly
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
        {carregando ? (
          <p role="status">a carregar…</p>
        ) : semProva ? (
          <p>
            {SEM_DADO} — {MOTIVO_SEM_HASH}
          </p>
        ) : !resumo || res.vazio || semCob ? (
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
        {carregando ? (
          <p role="status">a carregar…</p>
        ) : semProva ? (
          <p>
            {SEM_DADO} — {MOTIVO_SEM_HASH}
          </p>
        ) : emptyStateFor(pivoRows) ? (
          <p>{emptyStateFor(pivoRows)}</p>
        ) : (
          <div style={{ overflowX: "auto" }} tabIndex={0} role="region" aria-label={`Pivô por ${pivo}`}>
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
                  <td>{r.rotulo}</td>
                  <td>{formatVotes(r.votos)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </section>

      <section aria-label="Comparador">
        <h2>Comparador lado-a-lado</h2>
        {badge}
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          {(["candidatos", "anos", "municipios"] as const).map((m) => {
            // EVOLVE-11 Task 2: modo `municipios` sem cobertura no V1 (sempre
            // null em `resolverComparador`) — opção desabilitada com título
            // honesto em vez de controle que promete e entrega SEM_DADO.
            // `?modo=municipios` herdado segue no ramo SEM_DADO abaixo.
            const emBreve = m === "municipios";
            return (
              <label key={m}>
                <input
                  type="radio"
                  name="compMode"
                  checked={compMode === m}
                  disabled={emBreve}
                  title={emBreve ? "por município em breve — V1 agrega por UF" : undefined}
                  onChange={() => {
                    setCompMode(m);
                    setCompA("");
                    setCompB("");
                  }}
                />{" "}
                {m}
              </label>
            );
          })}
        </div>
        <p><small>modo municípios em breve — V1 agrega por UF</small></p>
        {partidoIgnoradoUF && !semCob && compMode === "anos" && (
          <p role="note">{NOTA_PARTIDO}</p>
        )}
        {carregando ? (
          <p role="status">a carregar…</p>
        ) : compMode === "municipios" ? (
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
        {carregando ? (
          <p role="status">a carregar…</p>
        ) : semProva ? (
          <p>
            {SEM_DADO} — {MOTIVO_SEM_HASH}
          </p>
        ) : emptyStateFor(dispersao) ? (
          <p>
            {SEM_DADO} — financiamento sem fonte no V1 (só votação nominal)
          </p>
        ) : (
          <div style={{ overflowX: "auto" }} tabIndex={0} role="region" aria-label="Dispersão votos × financiamento">
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
          </div>
        )}
      </section>

      <section aria-label="Série histórica">
        <h2>Série histórica</h2>
        {badge}
        {partidoIgnoradoUF && !semCob && <p role="note">{NOTA_PARTIDO}</p>}
        {carregando ? (
          <p role="status">a carregar…</p>
        ) : semProva ? (
          <p>
            {SEM_DADO} — {MOTIVO_SEM_HASH}
          </p>
        ) : emptyStateFor(ev) ? (
          <p>{SEM_DADO}</p>
        ) : (
          <div style={{ overflowX: "auto" }} tabIndex={0} role="region" aria-label="Série histórica de votos por ano">
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
          </div>
        )}
      </section>

      <section aria-label="Export reproduzível">
        <h2>Export reproduzível</h2>
        {badge}
        {/* Share só após o manifest resolver: com hash="" o ?hash= não
            ancora proveniência nenhuma. */}
        {!carregando ? (
          <p>
            <CopyShare url={shareUrl} />
          </p>
        ) : (
          <p role="status">a carregar…</p>
        )}
        {/* Export em `ExportCsv` (fonte única, inclui motivo de bloqueio). */}
        <ExportCsv arquivo="analisar.csv" linhas={csvRows} seal={seal} pronto={manifestChecked} />
        {carregando ? (
          <p role="status">a carregar…</p>
        ) : emptyStateFor(csvRows) ? (
          <p>{SEM_DADO}</p>
        ) : null}
      </section>
    </>
  );
}
