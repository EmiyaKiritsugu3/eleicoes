"use client";

/** /explorar — montador em blocos (Task 8, spec §3/§8).
 *
 * Blocos: quem · onde · cruzar com · ver como. Qualquer combinação dos
 * blocos computa client-side sobre o fato municipal; combinação sem
 * cobertura → "sem dado oficial" (fail-closed, nunca tela branca); fora
 * dos blocos vira sugestão (input desabilitado, sem texto livre).
 *
 * Consome (sem reinventar): motor completo (`perfilOndeVenceu` +
 * `pesoFonte`, `correlacao` + `quintis` com supressão-`[]`, `VAR_DEMO`),
 * `MapaBrasil` (`onSelectIbge` → foco), `SealSlot`/`SourceBadge` por
 * seção, `ECO_SEAL`/`SEM_DADO`/`NOTA_PESO_MISTO` do painel da região,
 * `fatoDatasetDe` p/ descobrir o fato (na rota), e o padrão de share da casa
 * (`URLSearchParams` + `hash` do manifest, cf. `buildShareUrl` em
 * `lib/export` — prefixo próprio `/explorar`, estado em `?q=`).
 *
 * Limites (spec §8): no máx. 3 visões simultâneas; debounce de 250ms na
 * busca de candidato. O painel da região linka p/ cá via
 * `/explorar?foco=<ibge>` — o foco é honrado (destaque + detalhe).
 */

import React, { useEffect, useMemo, useState } from "react";
import MapaBrasil from "./MapaBrasil";
import SealSlot from "./SealSlot";
import SourceBadge from "./SourceBadge";
import CopyShare from "./CopyShare";
import {
  ECO_SEAL,
  NOTA_PESO_MISTO,
  SEM_DADO,
  type FatoRegiao,
} from "./PainelRegiao";
import { formatVotes, type SealState } from "../lib/data";
import ExportCsv from "./ExportCsv";
import { ENTRADAS_CURADA } from "../lib/export";
import { MALHA_MUNICIPIOS_URL } from "../lib/malha";
import { vereditoTemProva } from "../lib/regiao";
import { MOTIVO_SEM_HASH } from "../lib/textos";
import {
  VAR_DEMO,
  PISO_CORRELACAO_N,
  correlacao,
  indiceVencedor,
  perfilOndeVenceu,
  quintis,
  shareCandidato,
  totalLinha,
  type MunRow,
  type VarDemo,
} from "../lib/motor";

export interface ExplorarSelecao {
  quem: string;
  onde: string;
  cruzar: string;
  ver: string[];
  foco?: string;
}

export const ONDE_OPCOES = [
  { value: "venceu", label: "onde venceu" },
  { value: "segundo", label: "onde foi 2º lugar" },
  { value: "margem_10", label: "onde venceu com margem > 10pp" },
  { value: "participacao_80", label: "onde venceu com participação > 80%" },
] as const;

export const VER_OPCOES = [
  { value: "mapa", label: "mapa" },
  { value: "dispersao", label: "dispersão" },
  { value: "ranking", label: "ranking" },
  { value: "tabela", label: "tabela" },
] as const;

export const MAX_VISOES = 3;
const DEBOUNCE_MS = 250;

/** Valores `ver` conhecidos; `?q=` adulterado com visões fora do set é
 *  descartado no parse (fail-closed) e na renderização (`verSeguro`). */
const VER_VALIDOS = new Set<string>(VER_OPCOES.map((o) => o.value));

const ALERTA_STYLE: React.CSSProperties = {
  background: "#fff3cd",
  border: "1px solid #b45309",
  fontWeight: "bold",
};

function finito(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** Filtro do bloco "onde" sobre as linhas do fato. Desconhecido → []. */
export function aplicarOnde(
  rows: MunRow[],
  candidatos: { id: string }[],
  quem: string,
  onde: string,
): MunRow[] {
  const lista = Array.isArray(rows) ? rows : [];
  const ordem = Array.isArray(candidatos) ? candidatos : [];
  const idx = ordem.findIndex((c) => c?.id === quem);
  if (idx < 0) return [];
  if (onde === "venceu") {
    return lista.filter((r) => indiceVencedor(r?.votos ?? []) === idx);
  }
  if (onde === "segundo") {
    return lista.filter((r) => {
      const comIndice = (r?.votos ?? [])
        .map((v, i) => ({ v, i }))
        .filter((e) => finito(e.v));
      if (comIndice.length < 2) return false;
      const estavel = comIndice.sort((a, b) => (b.v as number) - (a.v as number));
      return estavel[1].i === idx;
    });
  }
  if (onde === "margem_10") {
    return lista.filter((r) => {
      if (indiceVencedor(r?.votos ?? []) !== idx) return false;
      const vals = (r?.votos ?? []).filter(finito).sort((a, b) => b - a) as number[];
      const total = totalLinha(r);
      if (vals.length < 2 || total <= 0) return false;
      return (vals[0] - vals[1]) / total > 0.1;
    });
  }
  if (onde === "participacao_80") {
    return lista.filter((r) => {
      if (indiceVencedor(r?.votos ?? []) !== idx) return false;
      const eleitores = r?.demo?.eleitores;
      if (!finito(eleitores) || (eleitores as number) <= 0) return false;
      const el = eleitores as number;
      // Comparecimento auditado: (eleitorado − abstenções) ÷ eleitorado com
      // abstenções auditadas; sem abstenções, votos nominais ÷ eleitorado
      // (recorte conservador — soma nominal subestima o comparecimento).
      const comp = finito(r?.abst) ? (el - (r.abst as number)) / el : totalLinha(r) / el;
      return comp > 0.8;
    });
  }
  return [];
}

function b64urlEncode(s: string): string {
  const b =
    typeof Buffer !== "undefined"
      ? Buffer.from(s, "utf8").toString("base64")
      : btoa(unescape(encodeURIComponent(s)));
  return b.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): string | null {
  try {
    const b = s.replace(/-/g, "+").replace(/_/g, "/");
    if (typeof Buffer !== "undefined") return Buffer.from(b, "base64").toString("utf8");
    return decodeURIComponent(escape(atob(b)));
  } catch {
    return null;
  }
}

/** Estado → `/explorar?q=<estado>&hash=<manifest>` (mesmo padrão de `buildShareUrl`). */
export function buildExplorarShareUrl(sel: ExplorarSelecao, manifestHash: string): string {
  const params = new URLSearchParams();
  const q = b64urlEncode(
    JSON.stringify({
      quem: sel.quem ?? "",
      onde: sel.onde ?? "",
      cruzar: sel.cruzar ?? "",
      ver: Array.isArray(sel.ver) ? sel.ver : [],
      foco: sel.foco ?? "",
    }),
  );
  if (q) params.set("q", q);
  if (typeof manifestHash === "string" && manifestHash.trim().length > 0) {
    params.set("hash", manifestHash.trim());
  }
  const qs = params.toString();
  return qs ? `/explorar?${qs}` : "/explorar";
}

const SEL_PADRAO: ExplorarSelecao = {
  quem: "",
  onde: "venceu",
  cruzar: "esc_sup",
  ver: ["dispersao"],
  foco: "",
};

/** Linhas do CSV: recorte filtrado + contexto de filtro (`f_*`, paridade
 *  com `/analisar` — o CSV é auto-descritivo) + `entradas` (paridade com a
 *  Curada — fonte única `ENTRADAS_CURADA` em `lib/export`). Células vazias
 *  seguem o contrato blank-cell de `buildCsvExport` (nunca
 *  "null"/"undefined").
 *  `percentual` sai em pontos percentuais (0–100, ×100 sobre a fração
 *  0–1 do display), paridade com ranking/quintis/foco; `null` → blank.
 *  Download via fonte única `downloadCsv` em `lib/export` (dedupe). */
export function explorarCsvRows(
  filtradas: MunRow[],
  sel: Pick<ExplorarSelecao, "quem" | "onde" | "cruzar">,
  ordem: { id: string }[],
): Record<string, unknown>[] {
  const lista = Array.isArray(filtradas) ? filtradas : [];
  const idx = Array.isArray(ordem) ? ordem.findIndex((c) => c?.id === sel.quem) : -1;
  return lista.map((r) => {
    const share = idx >= 0 ? shareCandidato(r, idx) : null;
    return {
      ibge: r?.ibge ?? "",
      nome: r?.nome ?? "",
      uf: r?.uf ?? "",
      percentual: share === null ? null : share * 100,
      [sel.cruzar]: r?.demo ? (r.demo[sel.cruzar as VarDemo] as unknown as number) : null,
      entradas: ENTRADAS_CURADA,
      f_quem: sel.quem ?? "",
      f_onde: sel.onde ?? "",
      f_cruzar: sel.cruzar ?? "",
    };
  });
}

/** Query → seleção: `?q=` vence; `?foco=` (link do painel da região) e
 *  `?hash=` valem mesmo sem `?q=`. `?q=` inválido → padrão (fail-closed). */
export function parseExplorarQuery(search: string): ExplorarSelecao & { hash: string } {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(search ?? "");
  } catch {
    return { ...SEL_PADRAO, hash: "" };
  }
  let sel: ExplorarSelecao = { ...SEL_PADRAO };
  const q = params.get("q");
  if (q && q.trim() !== "") {
    const cru = b64urlDecode(q.trim());
    if (cru) {
      try {
        const obj = JSON.parse(cru) as Partial<ExplorarSelecao>;
        sel = {
          quem: typeof obj.quem === "string" ? obj.quem : "",
          onde: typeof obj.onde === "string" ? obj.onde : SEL_PADRAO.onde,
          cruzar: typeof obj.cruzar === "string" ? obj.cruzar : SEL_PADRAO.cruzar,
          ver: Array.isArray(obj.ver)
            ? obj.ver
                .filter((v) => typeof v === "string" && VER_VALIDOS.has(v))
                .slice(0, MAX_VISOES)
            : [...SEL_PADRAO.ver],
          foco: typeof obj.foco === "string" ? obj.foco : "",
        };
        if (sel.ver.length === 0) sel.ver = [...SEL_PADRAO.ver];
      } catch {
        sel = { ...SEL_PADRAO };
      }
    }
  }
  const foco = params.get("foco");
  if (foco !== null && foco.trim() !== "") sel.foco = foco;
  return { ...sel, hash: params.get("hash") ?? "" };
}

/** Núcleo puro/testável: computa tudo de forma síncrona sobre o fato. */
export function ExplorarConteudo({
  fato,
  seal,
  initial,
}: {
  fato: FatoRegiao | null;
  seal: SealState;
  initial: ExplorarSelecao;
}) {
  const [sel, setSel] = useState<ExplorarSelecao>({ ...SEL_PADRAO, ...initial });
  const [busca, setBusca] = useState("");
  const [buscaDeb, setBuscaDeb] = useState("");
  const [notaTeto, setNotaTeto] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setBuscaDeb(busca), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [busca]);

  const ordem = useMemo(() => fato?.candidatos ?? [], [fato]);
  const linhas = useMemo(() => fato?.municipios ?? [], [fato]);

  const candidatosVisiveis = useMemo(() => {
    const q = buscaDeb.trim().toLowerCase();
    if (!q) return ordem;
    return ordem.filter(
      (c) =>
        String(c?.nome ?? "").toLowerCase().includes(q) ||
        String(c?.id ?? "").toLowerCase().includes(q) ||
        String(c?.partido ?? "").toLowerCase().includes(q),
    );
  }, [ordem, buscaDeb]);

  const quemOk = ordem.some((c) => c?.id === sel.quem);
  const ondeOk = ONDE_OPCOES.some((o) => o.value === sel.onde);
  const cruzarOk = (VAR_DEMO as readonly string[]).includes(sel.cruzar);
  // Fail-closed por hash (paridade com o veredito em Verificar.tsx: sem
  // hash auditado — oficial ou fixture — o fato não sustenta número; sem
  // hash, r/n caem nos ramos SEM_DADO abaixo). Só display é gated; o
  // motor (`lib/motor`) e o selo (`lib/data`, `lib/regiao`) não mudam.
  const hashAuditado = vereditoTemProva(seal);
  const coberto = hashAuditado && fato !== null && quemOk && ondeOk && cruzarOk;

  const filtradas = useMemo(
    () => (coberto ? aplicarOnde(linhas, ordem, sel.quem, sel.onde) : []),
    [coberto, linhas, ordem, sel.quem, sel.onde],
  );

  const idxQuem = ordem.findIndex((c) => c?.id === sel.quem);
  const xs = useMemo(
    () =>
      filtradas.map(
        (r) => (r?.demo ? (r.demo[sel.cruzar as VarDemo] as unknown as number) : null) as unknown as number,
      ),
    [filtradas, sel.cruzar],
  );
  const ys = useMemo(
    () => filtradas.map((r) => shareCandidato(r, idxQuem) as unknown as number),
    [filtradas, idxQuem],
  );
  const corr = useMemo(
    () => (coberto && filtradas.length > 0 ? correlacao(xs, ys, "pearson") : null),
    [coberto, filtradas.length, xs, ys],
  );
  const corrS = useMemo(
    () => (coberto && filtradas.length > 0 ? correlacao(xs, ys, "spearman") : null),
    [coberto, filtradas.length, xs, ys],
  );
  const faixas = useMemo(
    () => (coberto && filtradas.length > 0 ? quintis(xs, ys) : []),
    [coberto, filtradas.length, xs, ys],
  );
  // Pontos do scatter: pares válidos com identidade (nome/IBGE/UF) p/
  // inspeção de distribuição e outliers (spec §4: pontos por UF + reta).
  const pontos = useMemo(() => {
    if (!coberto || idxQuem < 0) return [];
    const out: { x: number; y: number; nome: string; ibge: string; uf: string }[] = [];
    for (const r of filtradas) {
      const x = r?.demo ? (r.demo[sel.cruzar as VarDemo] as unknown as number) : null;
      const y = shareCandidato(r, idxQuem);
      if (finito(x) && finito(y)) {
        out.push({
          x: x as number,
          y: y as number,
          nome: String(r?.nome ?? r?.ibge ?? ""),
          ibge: String(r?.ibge ?? ""),
          uf: String(r?.uf ?? ""),
        });
      }
    }
    return out;
  }, [coberto, filtradas, idxQuem, sel.cruzar]);
  // Reta de mínimos quadrados sobre os pontos (queda p/ média horizontal
  // quando x não varia — nunca NaN no SVG).
  const reta = useMemo(() => {
    const n = pontos.length;
    if (n < 2) return null;
    let sx = 0;
    let sy = 0;
    for (const p of pontos) {
      sx += p.x;
      sy += p.y;
    }
    const mx = sx / n;
    const my = sy / n;
    let sxy = 0;
    let sxx = 0;
    for (const p of pontos) {
      sxy += (p.x - mx) * (p.y - my);
      sxx += (p.x - mx) * (p.x - mx);
    }
    const b = sxx > 0 ? sxy / sxx : 0;
    if (!finito(b)) return null;
    return { a: my - b * mx, b };
  }, [pontos]);
  // Perfil honra o recorte `onde` (mesmo padrão da Curada): filtradas p/
  // o perfil, fato inteiro p/ a base "Brasil".
  const perfil = useMemo(
    () =>
      coberto
        ? perfilOndeVenceu(filtradas, { candidatoId: sel.quem, candidatos: ordem })
        : null,
    [coberto, filtradas, sel.quem, ordem],
  );
  const base = useMemo(
    () =>
      coberto
        ? perfilOndeVenceu(linhas, { candidatoId: sel.quem, candidatos: ordem })
        : null,
    [coberto, linhas, sel.quem, ordem],
  );

  const ranking = useMemo(() => {
    if (!coberto || idxQuem < 0) return [];
    return filtradas
      .map((r) => ({ row: r, share: shareCandidato(r, idxQuem) }))
      .filter((e) => e.share !== null)
      .sort((a, b) => (b.share as number) - (a.share as number))
      .slice(0, 10);
  }, [coberto, filtradas, idxQuem]);

  const cores = useMemo(() => {
    const out: Record<string, string> = {};
    // Fail-closed por hash: sem fato hash-verificado o mapa não colore
    // vencedores (resultado eleitoral nunca sem hash); vazio, sem cores.
    if (!hashAuditado) return out;
    for (const r of linhas) {
      const w = indiceVencedor(r?.votos ?? []);
      if (w >= 0 && w < ordem.length) {
        out[String(r.ibge)] = w === idxQuem ? "#1d4ed8" : "#94a3b8";
      }
    }
    if (sel.foco && sel.foco.trim() !== "") out[sel.foco.trim()] = "#f59e0b";
    return out;
  }, [hashAuditado, linhas, ordem.length, idxQuem, sel.foco]);

  const focoRow = useMemo(() => {
    const f = (sel.foco ?? "").trim();
    if (!f) return undefined;
    return linhas.find((r) => String(r?.ibge ?? "") === f);
  }, [linhas, sel.foco]);

  const toggleVer = (v: string) => {
    setSel((prev) => {
      if (prev.ver.includes(v)) {
        setNotaTeto(false);
        return { ...prev, ver: prev.ver.filter((x) => x !== v) };
      }
      if (prev.ver.length >= MAX_VISOES) {
        setNotaTeto(true);
        return prev;
      }
      setNotaTeto(false);
      return { ...prev, ver: [...prev.ver, v] };
    });
  };

  // Defesa em profundidade: `initial` pode chegar sem passar pelo parse
  // (uso programático); só visões conhecidas renderizam, teto mantido.
  const verSeguro = useMemo(
    () => (Array.isArray(sel.ver) ? sel.ver : []).filter((v) => VER_VALIDOS.has(v)).slice(0, MAX_VISOES),
    [sel.ver],
  );

  const shareUrl = buildExplorarShareUrl({ ...sel, ver: verSeguro }, seal.official?.hash ?? "");
  const badge = <SealSlot seal={seal} />;
  // CSV do recorte filtrado (paridade com `/analisar`: `buildCsvExport`
  // com header de proveniência; botão desabilitado sem `seal.official` —
  // fixture nunca ancora export).
  const csvRows = useMemo(
    () => explorarCsvRows(filtradas, sel, ordem),
    [filtradas, sel, ordem],
  );
  const ondeLabel = ONDE_OPCOES.find((o) => o.value === sel.onde)?.label ?? sel.onde;
  const quemNome = ordem.find((c) => c?.id === sel.quem)?.nome ?? sel.quem;

  return (
    <>
      <h1>Motor Verdade — explorar em blocos</h1>
      {seal.official && (
        <SourceBadge hash={seal.official.hash} url={seal.official.url} date={seal.official.date} />
      )}

      <section aria-label="Blocos">
        <h2>Blocos — quem · onde · cruzar com · ver como</h2>
        {badge}
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <label>
            quem{" "}
            <select
              aria-label="quem"
              value={sel.quem}
              onChange={(e) => setSel((p) => ({ ...p, quem: e.target.value }))}
            >
              <option value="">— escolher —</option>
              {candidatosVisiveis.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome} ({c.partido})
                </option>
              ))}
            </select>
          </label>
          <label>
            buscar candidato{" "}
            <input
              aria-label="buscar candidato"
              placeholder="buscar candidato"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
          </label>
          <label>
            onde{" "}
            <select
              aria-label="onde"
              value={sel.onde}
              onChange={(e) => setSel((p) => ({ ...p, onde: e.target.value }))}
            >
              {ONDE_OPCOES.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            cruzar com{" "}
            <select
              aria-label="cruzar com"
              value={sel.cruzar}
              onChange={(e) => setSel((p) => ({ ...p, cruzar: e.target.value }))}
            >
              {(VAR_DEMO as readonly string[]).map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <fieldset>
            <legend>ver como (máx. {MAX_VISOES})</legend>
            {VER_OPCOES.map((o) => (
              <label key={o.value} style={{ marginRight: "0.5rem" }}>
                <input
                  type="checkbox"
                  checked={verSeguro.includes(o.value)}
                  onChange={() => toggleVer(o.value)}
                  aria-label={`ver ${o.label}`}
                />{" "}
                {o.label}
              </label>
            ))}
          </fieldset>
        </div>
        {notaTeto && <p role="note">máximo {MAX_VISOES} visões simultâneas</p>}
        <p>
          <label>
            pergunta livre{" "}
            <input
              aria-label="pergunta livre"
              placeholder="fora dos blocos vira sugestão"
              disabled
              readOnly
              value=""
            />
          </label>{" "}
          <small>
            fora dos blocos vira sugestão: combine quem · onde · cruzar com · ver como acima —
            sem texto livre
          </small>
        </p>
      </section>

      <section aria-label="Resultado">
        <h2>
          Resultado — {quemNome} · {ondeLabel} · {sel.cruzar}
        </h2>
        {badge}
        {!fato || !hashAuditado ? (
          <p role="alert" style={ALERTA_STYLE}>{SEM_DADO}{!hashAuditado ? ` — ${MOTIVO_SEM_HASH}` : ""}</p>
        ) : !coberto ? (
          <p role="alert" style={ALERTA_STYLE}>
            {SEM_DADO} — combinação sem cobertura nos blocos; ajuste quem · onde · cruzar com
            acima
          </p>
        ) : filtradas.length === 0 ? (
          <p role="alert" style={ALERTA_STYLE}>{SEM_DADO} — nenhum município neste recorte</p>
        ) : (
          <p>
            n = {filtradas.length} municípios
            {corr && corrS ? (
              <>
                {" "}· r (Pearson) = {corr.r.toFixed(3).replace(".", ",")} · r (Spearman) = {corrS.r.toFixed(3).replace(".", ",")}{" "}
                (n = {corr.n})
              </>
            ) : (
              <>
                {" "}· r = {SEM_DADO} —{" "}
                {filtradas.length < PISO_CORRELACAO_N
                  ? "municípios insuficientes (piso n ≥ 30)"
                  : "correlação indefinida (variância zero ou pares válidos abaixo do piso)"}
              </>
            )}
          </p>
        )}
      </section>

      {(sel.foco ?? "").trim() !== "" && (
        <section aria-label="Foco da região">
          <h2>Foco da região</h2>
          {badge}
          {!focoRow ? (
            <p role="alert" style={ALERTA_STYLE}>{SEM_DADO} — foco {(sel.foco ?? "").trim()} fora do fato municipal</p>
          ) : (
            <p>
              {String(focoRow.nome ?? focoRow.ibge)} ({String(focoRow.ibge)}) — UF{" "}
              {String(focoRow.uf ?? "")}
              {idxQuem >= 0 && hashAuditado && shareCandidato(focoRow, idxQuem) !== null
                ? ` · percentual de votos de ${quemNome}: ${((shareCandidato(focoRow, idxQuem) as number) * 100).toFixed(1).replace(".", ",")}%`
                : ""}
            </p>
          )}
        </section>
      )}

      {verSeguro.includes("dispersao") && (
        <section aria-label="Dispersão">
          <h2>Dispersão — {sel.cruzar} × percentual de votos de {quemNome}</h2>
          {badge}
          <p role="note">{ECO_SEAL} — cada ponto é um município, nunca uma pessoa.</p>
          {!coberto ? (
            <p role="alert" style={ALERTA_STYLE}>
              {SEM_DADO}{!hashAuditado ? ` — ${MOTIVO_SEM_HASH}` : " — sem cobertura nos blocos; ajuste quem · onde · cruzar com acima"}
            </p>
          ) : !corr || !corrS ? (
            <p role="alert" style={ALERTA_STYLE}>
              {SEM_DADO} — correlação suprimida (piso n ≥ 30 municípios ou variância zero)
            </p>
          ) : faixas.length === 0 ? (
            <p role="alert" style={ALERTA_STYLE}>
              {SEM_DADO} — sem cobertura neste recorte
            </p>
          ) : (
            <>
              <p>
                r (Pearson) = {corr.r.toFixed(3).replace(".", ",")} · r (Spearman) = {corrS.r.toFixed(3).replace(".", ",")} (n ={" "}
                {corr.n})
              </p>
              {reta !== null && (
                <figure>
                  <figcaption>
                    Dispersão por município com reta de mínimos quadrados — cada ponto é
                    um município; divergência entre Pearson e Spearman denuncia outlier
                    ou relação não-linear.
                  </figcaption>
                  <svg
                    viewBox="0 0 400 300"
                    role="img"
                    aria-label={`Dispersão de ${sel.cruzar} por percentual de votos de ${quemNome}: ${pontos.length} municípios`}
                  >
                    {(() => {
                      const W = 400;
                      const H = 300;
                      const PAD = 34;
                      let minX = Infinity;
                      let maxX = -Infinity;
                      let minY = Infinity;
                      let maxY = -Infinity;
                      for (const p of pontos) {
                        if (p.x < minX) minX = p.x;
                        if (p.x > maxX) maxX = p.x;
                        if (p.y < minY) minY = p.y;
                        if (p.y > maxY) maxY = p.y;
                      }
                      const spanX = maxX - minX > 0 ? maxX - minX : 1;
                      const spanY = maxY - minY > 0 ? maxY - minY : 1;
                      const cx = (x: number) => PAD + ((x - minX) / spanX) * (W - 2 * PAD);
                      const cy = (y: number) => H - PAD - ((y - minY) / spanY) * (H - 2 * PAD);
                      const x1 = cx(minX);
                      const y1 = cy(reta.a + reta.b * minX);
                      const x2 = cx(maxX);
                      const y2 = cy(reta.a + reta.b * maxX);
                      return (
                        <>
                          <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#b3261e" strokeWidth={2} />
                          {pontos.map((p) => (
                            <circle
                              key={p.ibge}
                              cx={cx(p.x)}
                              cy={cy(p.y)}
                              r={3.5}
                              fill="#1d4ed8"
                              opacity={0.7}
                            >
                              <title>
                                {p.nome} ({p.ibge}) — UF {p.uf}
                              </title>
                            </circle>
                          ))}
                        </>
                      );
                    })()}
                  </svg>
                </figure>
              )}
              <div style={{ overflowX: "auto" }} tabIndex={0} role="region" aria-label={`Percentual médio de votos por quintil de ${sel.cruzar}`}>
              <table>
                <caption>Percentual médio de votos por quintil de {sel.cruzar}</caption>
                <thead>
                  <tr>
                    <th scope="col">Faixa</th>
                    <th scope="col">Percentual médio</th>
                    <th scope="col">n</th>
                  </tr>
                </thead>
                <tbody>
                  {faixas.map((f) => (
                    <tr key={f.faixa}>
                      <td>{f.faixa}</td>
                      <td>{(f.mediaY * 100).toFixed(1).replace(".", ",")}%</td>
                      <td>{f.n}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </>
          )}
        </section>
      )}

      {verSeguro.includes("ranking") && (
        <section aria-label="Ranking">
          <h2>Ranking — maior percentual de votos de {quemNome}</h2>
          {badge}
          {!coberto || ranking.length === 0 ? (
            <p role="alert" style={ALERTA_STYLE}>{SEM_DADO}{!hashAuditado ? ` — ${MOTIVO_SEM_HASH}` : " — sem cobertura neste recorte"}</p>
          ) : (
            <div style={{ overflowX: "auto" }} tabIndex={0} role="region" aria-label="Top municípios por percentual de votos">
            <table>
              <caption>Top municípios por percentual de votos</caption>
              <thead>
                <tr>
                  <th scope="col">Município</th>
                  <th scope="col">IBGE</th>
                  <th scope="col">Percentual</th>
                </tr>
              </thead>
              <tbody>
                {ranking.map((e) => (
                  <tr key={String(e.row.ibge)}>
                    <td>{String(e.row.nome ?? "")}</td>
                    <td>{String(e.row.ibge)}</td>
                    <td>{((e.share as number) * 100).toFixed(1).replace(".", ",")}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
        </section>
      )}

      {verSeguro.includes("tabela") && (
        <section aria-label={sel.onde === "segundo" ? "Perfil do recorte" : "Perfil de onde venceu"}>
          <h2>
            {sel.onde === "segundo"
              ? `Perfil — ${quemNome} em 2º lugar (sem perfil de vitória)`
              : `Perfil de onde ${quemNome} venceu`}
          </h2>
          {badge}
          <p role="note">{ECO_SEAL} — médias de municípios, nunca de pessoas.</p>
          {sel.onde === "segundo" ? (
            <p role="note">
              {SEM_DADO} — perfil de vitória não se aplica ao recorte &ldquo;onde foi 2º
              lugar&rdquo;: este recorte lista municípios em que o candidato perdeu, e
              média de derrota não descreve onde venceu.
            </p>
          ) : !perfil || !base || perfil.nMun === 0 ? (
            <p role="alert" style={ALERTA_STYLE}>{SEM_DADO}{!hashAuditado ? ` — ${MOTIVO_SEM_HASH}` : ""}</p>
          ) : (
            <>
              {(perfil.pesoFonte === "misto") && <p role="note">{NOTA_PESO_MISTO}</p>}
              <p>
                n = {formatVotes(perfil.nMun)} municípios · {formatVotes(perfil.nEleitores)}{" "}
                {perfil.pesoFonte === "misto"
                  ? "de peso efetivo (eleitorado, total ou população)"
                  : "eleitores (peso: eleitorado)"}
              </p>
              <div style={{ overflowX: "auto" }} tabIndex={0} role="region" aria-label="Médias ponderadas vs Brasil">
              <table>
                <caption>Médias ponderadas vs Brasil</caption>
                <thead>
                  <tr>
                    <th scope="col">Variável</th>
                    <th scope="col">Onde venceu</th>
                    <th scope="col">Brasil</th>
                  </tr>
                </thead>
                <tbody>
                  {(VAR_DEMO as readonly string[]).map((v) => (
                    <tr key={v}>
                      <td>{v}</td>
                      <td>
                        {Number.isFinite(perfil.medias[v as VarDemo])
                          ? (perfil.medias[v as VarDemo] as number).toFixed(2).replace(".", ",")
                          : SEM_DADO}
                      </td>
                      <td>
                        {Number.isFinite(base.vsBrasil[v as VarDemo])
                          ? (base.vsBrasil[v as VarDemo] as number).toFixed(2).replace(".", ",")
                          : SEM_DADO}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </>
          )}
        </section>
      )}

      {verSeguro.includes("mapa") && (
        <section aria-label="Mapa">
          <h2>Mapa — vencedor por município</h2>
          {badge}
          {!fato || !hashAuditado ? (
            <p role="alert" style={ALERTA_STYLE}>{SEM_DADO}{!hashAuditado ? ` — ${MOTIVO_SEM_HASH}` : ""}</p>
          ) : (
            <MapaBrasil
              malhaUrl={MALHA_MUNICIPIOS_URL}
              nivel="municipio"
              onSelectIbge={(s) => setSel((p) => ({ ...p, foco: String(s) }))}
              cores={cores}
            />
          )}
        </section>
      )}

      <section aria-label="Export reproduzível">
        <h2>Export reproduzível</h2>
        {badge}
        <p>
          <CopyShare url={shareUrl} />
        </p>
        {/* Export em `ExportCsv` (fonte única, paridade com as curadas). */}
        <ExportCsv arquivo="explorar.csv" linhas={csvRows} seal={seal} />
      </section>
    </>
  );
}
