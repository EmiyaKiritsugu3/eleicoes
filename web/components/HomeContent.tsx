"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MapaBrasil from "./MapaBrasil";
import { UF_POR_PREFIXO_IBGE } from "./PainelRegiao";
import { loadMalha, MALHA_MUNICIPIOS_URL, UFS, type MalhaFeature } from "../lib/malha";
import SourceBadge from "./SourceBadge";
import SealSlot from "./SealSlot";
import CopyShare from "./CopyShare";
import ExportCsv from "./ExportCsv";
import { ENTRADAS_HOME } from "../lib/export";
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
import { isHashDivergente, manifestoValidoParaRotacao, vereditoTemProva } from "../lib/regiao";
import { fetchJson } from "../lib/fetchJson";
import { ALERTA_STYLE, MOTIVO_SEM_HASH, SEM_DADO } from "../lib/textos";
import { tokens } from "../lib/tokens";

const [giganteSize, giganteLine] = tokens.texto.gigante.split("/");
const [tituloSize, tituloLine] = tokens.texto.titulo.split("/");
const [secaoSize, secaoLine] = tokens.texto.secao.split("/");
const [miudoSize, miudoLine] = tokens.texto.miudo.split("/");
const FILETE = `1px solid ${tokens.cor.linha}`;

// Task 5 (display-only): cabeçalhos de tabela editoriais + células
// numéricas tabulares. Constantes de estilo puras, sem estado semântico.
const TH_EDITORIAL: React.CSSProperties = {
  textTransform: "uppercase",
  fontSize: miudoSize,
  lineHeight: miudoLine,
  borderBottom: `3px double ${tokens.cor.linha}`,
};
const NUM_TABULAR: React.CSSProperties = {
  fontVariantNumeric: "tabular-nums",
};
const INPUT_EDITORIAL: React.CSSProperties = {
  border: `1px solid ${tokens.cor.linha}`,
  borderRadius: tokens.raio.sm,
};
// Inline styles não fazem :focus — onFocus/onBlur alternam o outline
// direto no nó (display-only, sem estado semântico).
const focaInput = (e: React.FocusEvent<HTMLInputElement>) => {
  e.currentTarget.style.outline = `2px solid ${tokens.cor.destaqueVerde}`;
};
const desfocaInput = (e: React.FocusEvent<HTMLInputElement>) => {
  e.currentTarget.style.outline = "";
};

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

/** Linhas do CSV da Home (EVOLVE-12, última superfície sem export):
 *  ranking por UF exibido no mapa + contexto dos filtros que o ranking
 *  aplica (`f_ano/f_cargo/f_uf`, paridade com `/analisar`) + `entradas`
 *  (fonte única `ENTRADAS_HOME` em `lib/export` — só votos TSE, sem
 *  demografia do Censo que o ranking não usa). Sem `f_candidato`: o
 *  `rankingUf` ignora candidato no V1 (cf. `NOTA_CANDIDATO_GLOBAL`), então
 *  a coluna implicaria filtragem que não houve. Proveniência via
 *  `buildCsvExport` (gate oficial no botão — sem hash, desabilitado). */
export function homeCsvRows(
  ufs: { uf: string; votos: number }[],
  filtros: Filtros,
): Record<string, unknown>[] {
  return (Array.isArray(ufs) ? ufs : []).map((r) => ({
    uf: r?.uf ?? "",
    votos: r?.votos ?? null,
    entradas: ENTRADAS_HOME,
    f_ano: filtros?.ano ?? "",
    f_cargo: filtros?.cargo ?? "",
    f_uf: filtros?.uf ?? "",
  }));
}

function Bar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div
      role="img"
      aria-label={`${pct}% do máximo`}
      style={{ background: tokens.cor.linha, height: 10, minWidth: 120 }}
    >
      <div style={{ background: tokens.cor.graficoBarra, height: 10, width: `${pct}%` }} />
    </div>
  );
}

/** Conteúdo de / extraído da rota para aceitar `initialFiltros` (seam de
 *  teste): o tipo Page do Next (`Diff<PageProps, FirstArg>`) proíbe props
 *  extras no default export da rota, então a rota (`app/page.tsx`) é um
 *  `Home()` sem args que delega para cá. Em produção monta com `{}`.
 */

// Fonte única do predicado de manifest p/ rotação: `manifestoValidoParaRotacao`
// em `lib/regiao` (dedupe R4 — sem fork local).
export function HomeContent({ initialFiltros }: { initialFiltros?: Filtros }) {
  const [resumo, setResumo] = useState<ResumoJson | null>(null);
  const [porUf, setPorUf] = useState<PorUfRow[]>([]);
  const [porCand, setPorCand] = useState<PorCandidatoRow[]>([]);
  const [seal, setSeal] = useState<SealState>({ official: null, hasFixture: false, fixtureHash: "" });
  const [manifestChecked, setManifestChecked] = useState(false);
  const [malhaFeatures, setMalhaFeatures] = useState<MalhaFeature[] | null>(null);
  const [f, setF] = useState<Filtros>(initialFiltros ?? {});
  // Hash da URL compartilhada (`/?hash=` do CopyShare — cubic R3): sem
  // hidratação de filtros na Home, o link ainda é verificável — divergente
  // do manifest atual, alerta em vez de citar número stale.
  const [urlHash, setUrlHash] = useState("");
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
  // rotação: só entra aqui com selo mudado). `manifestJaLido` reaproveita o
  // manifest barato já lido pela rotação (sem fetch duplicado); ausente, o
  // manifest é buscado como antes. Sem mudança de comportamento.
  const carregarPesados = useCallback(async (manifestJaLido?: unknown) => {
    setResumo((await fetchJson<ResumoJson>("/data/resumo.json")).data);
    setPorUf((await fetchJson<PorUfRow[]>("/data/por_uf.json")).data ?? []);
    setPorCand((await fetchJson<PorCandidatoRow[]>("/data/por_candidato.json")).data ?? []);
    const manifest =
      manifestJaLido !== undefined
        ? manifestJaLido
        : (await fetchJson("/data/manifest.json")).data;
    return getSealState(manifest);
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
    try {
      setUrlHash(new URLSearchParams(window.location.search).get("hash") ?? "");
    } catch {
      setUrlHash("");
    }
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
        // Blip ≠ rotação: manifest ilegível (`status !== "ok"`) OU corpo
        // sem objeto (`200` com `null`/array/texto — derivaria selo vazio)
        // sai ANTES da comparação e mantém os números validados
        // (stale-while-revalidate); só fetch OK com objeto e selo diferente
        // refaz o pesado.
        const leitura = await fetchJson("/data/manifest.json");
        if (leitura.status !== "ok" || !manifestoValidoParaRotacao(leitura.data)) return;
        const novoSeal = getSealState(leitura.data);
        if (JSON.stringify(novoSeal) === JSON.stringify(sealRef.current)) return;
        sealRef.current = await carregarPesados(leitura.data);
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
  // CSV do ranking por UF (paridade com Analisar/Explorar/Curadas).
  const csvRows = useMemo(() => homeCsvRows(ufs, f), [ufs, f]);
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
  // `ALERTA_STYLE` vive em `lib/textos` (fonte única, EVOLVE-13).
  const escopoIgnoradoNoRanking =
    (f.ano ?? "").trim() !== "" ||
    (f.cargo ?? "").trim() !== "" ||
    (f.uf ?? "").trim() !== "";

  return (
    <>
      <h1
        style={{
          fontFamily: tokens.fonte.display,
          fontSize: giganteSize,
          lineHeight: giganteLine,
          color: tokens.cor.tinta,
        }}
      >
        SAD Eleições — resultados
      </h1>

      {manifestChecked && !seal.official && !seal.hasFixture && (
        <p role="alert" className="badge badge-warn" style={ALERTA_STYLE}>
          dado não auditado — manifest ausente ou inválido; números abaixo não são oficiais
        </p>
      )}
      {manifestChecked && !seal.official && seal.hasFixture && (
        <SealSlot seal={seal} />
      )}
      {seal.official && <SourceBadge hash={seal.official.hash} url={seal.official.url} date={seal.official.date} />}
      {/* Share de proveniência (EVOLVE-11 Task 3, paridade Analisar/
          Explorar): âncora `/?hash=` do manifest oficial. Só com oficial —
          a Home não hidrata filtros da query, então link sem hash não
          reproduziria nada (fail-closed, sem link vazio). */}
      {manifestChecked && seal.official && (
        <p><CopyShare url={`/?hash=${seal.official.hash}`} /></p>
      )}
      {isHashDivergente(urlHash, seal.official?.hash ?? "", manifestChecked) && (
        <p role="alert" className="badge badge-warn" style={ALERTA_STYLE}>
          hash da URL diverge do manifest atual — revalide a fonte antes de citar
        </p>
      )}

      <section
        aria-label="Busca"
        style={{ borderTop: FILETE, paddingTop: tokens.espaco[4] }}
      >
        <h2
          style={{
            fontFamily: tokens.fonte.display,
            fontSize: secaoSize,
            lineHeight: secaoLine,
          }}
        >
          Busca
        </h2>
        <form onSubmit={(e) => e.preventDefault()} style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          {(["ano", "cargo", "uf", "candidato"] as const).map((k) => (
            <label key={k}>
              {k}{" "}
              <input
                value={f[k] ?? ""}
                onChange={set(k)}
                placeholder={k}
                aria-label={k}
                style={INPUT_EDITORIAL}
                onFocus={focaInput}
                onBlur={desfocaInput}
              />
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
              style={INPUT_EDITORIAL}
              onFocus={focaInput}
              onBlur={desfocaInput}
            />
            <small>por município em breve — V1 agrega por UF</small>
          </label>
        </form>
      </section>

      <section
        aria-label="Resumo"
        style={{ borderTop: FILETE, paddingTop: tokens.espaco[4], marginTop: tokens.espaco[6] }}
      >
        <h2
          style={{
            fontFamily: tokens.fonte.display,
            fontSize: secaoSize,
            lineHeight: secaoLine,
          }}
        >
          Resumo
        </h2>
        {candidatoAtivo && <p role="note">{NOTA_CANDIDATO_GLOBAL}</p>}
        {carregando ? (
          <p role="status">a carregar…</p>
        ) : semDados || semProva ? (
          /* Alerta vivo único do estado sem-prova (compartilhado pelas 4
             seções — as demais anunciam como texto comum, cf. Mapa). */
          <p role="alert">{SEM_DADO}{semProva ? ` — ${MOTIVO_SEM_HASH}` : ""}</p>
        ) : (
          <ul>
            <li
              style={{
                fontSize: tituloSize,
                lineHeight: tituloLine,
                color: tokens.cor.destaqueVerde,
              }}
            >
              Total de votos: {formatVotes(res.totalVotos)}
            </li>
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

      <section
        aria-label="Mapa por UF"
        style={{ borderTop: FILETE, paddingTop: tokens.espaco[4], marginTop: tokens.espaco[6] }}
      >
        <h2
          style={{
            fontFamily: tokens.fonte.display,
            fontSize: secaoSize,
            lineHeight: secaoLine,
          }}
        >
          Mapa por UF
        </h2>
        {candidatoAtivo && <p role="note">{NOTA_CANDIDATO_GLOBAL}</p>}
        {badge}
        {carregando ? (
          <p role="status">a carregar…</p>
        ) : semProva || ufs.length === 0 ? (
          /* Alerta só no vazio local (cubic R2): com sem-prova, o alerta
             vivo do Resumo já cobre o estado compartilhado; sem ele, a
             seção anuncia o próprio vazio (ex. busca sem match). */
          <p role={semProva ? undefined : "alert"}>{SEM_DADO}{semProva ? ` — ${MOTIVO_SEM_HASH}` : ""}</p>
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
              <tr><th scope="col" style={TH_EDITORIAL}>UF</th><th scope="col" style={TH_EDITORIAL}>Votos</th></tr>
            </thead>
            <tbody>
              {ufs.map((r) => (
                <tr key={r.uf}><td><a href={`/regiao/${r.uf}`}>{r.uf}</a></td><td style={NUM_TABULAR}>{formatVotes(r.votos)}</td></tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
        {/* Export do ranking por UF (EVOLVE-12, última superfície sem
            export — paridade Analisar/Explorar/Regiao/Curadas). Bloco em
            `ExportCsv` (fonte única); gate oficial dentro dele. */}
        <ExportCsv
          arquivo="home.csv"
          linhas={csvRows}
          seal={seal}
          pronto={manifestChecked}
        />
      </section>

      <section
        aria-label="Ranking de candidatos"
        style={{ borderTop: FILETE, paddingTop: tokens.espaco[4], marginTop: tokens.espaco[6] }}
      >
        <h2
          style={{
            fontFamily: tokens.fonte.display,
            fontSize: secaoSize,
            lineHeight: secaoLine,
          }}
        >
          Ranking de candidatos
        </h2>
        {candidatoAtivo && escopoIgnoradoNoRanking && (
          <p role="note">{NOTA_RANKING_SEM_COBERTURA}</p>
        )}
        {badge}
        {carregando ? (
          <p role="status">a carregar…</p>
        ) : semProva || cands.length === 0 ? (
          /* Alerta só no vazio local (cubic R2, paridade Mapa/Evolução). */
          <p role={semProva ? undefined : "alert"}>{SEM_DADO}{semProva ? ` — ${MOTIVO_SEM_HASH}` : ""}</p>
        ) : (
          <div style={{ overflowX: "auto" }} tabIndex={0} role="region" aria-label="Ranking de candidatos por votos">
          <table>
            <caption>Ranking de candidatos por votos</caption>
            <thead>
              <tr><th scope="col" style={TH_EDITORIAL}>Nome</th><th scope="col" style={TH_EDITORIAL}>Partido</th><th scope="col" style={TH_EDITORIAL}>Votos</th></tr>
            </thead>
            <tbody>
              {cands.map((r) => (
                <tr key={r.candidato_id}>
                  <td>{r.nome_urna}</td><td>{r.partido}</td><td style={NUM_TABULAR}>{formatVotes(r.votos)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </section>

      <section
        aria-label="Evolução"
        style={{ borderTop: FILETE, paddingTop: tokens.espaco[4], marginTop: tokens.espaco[6] }}
      >
        <h2
          style={{
            fontFamily: tokens.fonte.display,
            fontSize: secaoSize,
            lineHeight: secaoLine,
          }}
        >
          Evolução anual
        </h2>
        {badge}
        {carregando ? (
          <p role="status">a carregar…</p>
        ) : semProva || ev.length === 0 ? (
          /* Alerta só no vazio local (cubic R2, paridade Mapa/Ranking). */
          <p role={semProva ? undefined : "alert"}>{SEM_DADO}{semProva ? ` — ${MOTIVO_SEM_HASH}` : ""}</p>
        ) : (
          <>
            <ul aria-hidden="true" style={{ listStyle: "none", padding: 0 }}>
              {ev.map((r) => (
                <li key={r.ano} style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                  <span style={{ width: 48 }}>{r.ano}</span>
                  <Bar value={r.votos} max={maxEv} />
                  <span style={NUM_TABULAR}>{formatVotes(r.votos)}</span>
                </li>
              ))}
            </ul>
            <div style={{ overflowX: "auto" }} tabIndex={0} role="region" aria-label="Evolução anual de votos (tabela equivalente)">
            <table>
              <caption>Evolução anual de votos (tabela equivalente)</caption>
              <thead>
                <tr><th scope="col" style={TH_EDITORIAL}>Ano</th><th scope="col" style={TH_EDITORIAL}>Votos</th></tr>
              </thead>
              <tbody>
                {ev.map((r) => (
                  <tr key={r.ano}><td style={NUM_TABULAR}>{r.ano}</td><td style={NUM_TABULAR}>{formatVotes(r.votos)}</td></tr>
                ))}
              </tbody>
            </table>
            </div>
          </>
        )}
      </section>

      <section
        aria-label="Biblioteca curada"
        style={{ borderTop: FILETE, paddingTop: tokens.espaco[4], marginTop: tokens.espaco[6] }}
      >
        <h2
          style={{
            fontFamily: tokens.fonte.display,
            fontSize: secaoSize,
            lineHeight: secaoLine,
          }}
        >
          Biblioteca curada — 30 perguntas
        </h2>
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

      <section
        aria-label="Abstenção, nulos e brancos"
        style={{ borderTop: FILETE, paddingTop: tokens.espaco[4], marginTop: tokens.espaco[6] }}
      >
        <h2
          style={{
            fontFamily: tokens.fonte.display,
            fontSize: secaoSize,
            lineHeight: secaoLine,
          }}
        >
          Abstenção / nulos / brancos
        </h2>
        <p>{SEM_DADO} — fato_eleitorado sem fonte no V1 (só votação nominal)</p>
      </section>
    </>
  );
}
