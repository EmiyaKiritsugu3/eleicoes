"use client";

/** Painel da região (Task 7): vencedor/margem/participação/perfil + ações.
 *
 * Consome (sem reinventar): `perfilOndeVenceu`/`indiceVencedor` do motor,
 * `MapaSelecao` (IBGE7 | UF | EXTERIOR), `SourceBadge`+`SealSlot`, `formatVotes`.
 * Regras herdadas: selo ecológico em toda seção de perfil; nota honesta
 * quando `pesoFonte === "misto"`; `demo: null` → perfil em "sem dado
 * oficial" com votos intactos; fail-closed com `role="alert"`; badge de
 * proveniência em TODAS as seções (teste pixel-mentiroso).
 */

import React from "react";
import SourceBadge from "./SourceBadge";
import SealSlot from "./SealSlot";
import CopyShare from "./CopyShare";
import { formatVotes, type SealState } from "../lib/data";
import { isFatoDataset } from "../lib/regiao";
import { SEM_DADO } from "../lib/textos";
import {
  indiceVencedor,
  perfilOndeVenceu,
  totalLinha,
  type FatoCandidato,
  type MunRow,
} from "../lib/motor";

/** Selo ecológico (spec §7): perfis são SEMPRE de município, nunca de pessoa. */
export const ECO_SEAL = "dado de município, não de pessoa";

/** Caminho canônico do artefato do Censo servido (EVOLVE-7 Task 2): mesmo
 *  prefixo `/data/` de resumo/por_uf/fato (arquivo
 *  `web/public/data/censo_municipios.json`, gitignore como os demais
 *  servidos). Emissão: `etl.censo.ingerir_censo` escreve direto no served
 *  dir (sad-etl + seed); `build_all` o preserva no staging e
 *  `register_served_artifacts` atesta
 *  os bytes com entry de fonte do Censo (nunca fan-out TSE) — a
 *  proveniência da pop vive nessa entry `artifacts`, não no gate do fato.
 *  SELO RUNTIME (EVOLVE-8 Task 1): o runtime CHECA a entry antes de
 *  renderizar — `censoTemProva(manifest)` (entry `censo_municipios.json`
 *  com sha256 64-hex, mesma strictness de `isAudited` do gate do fato;
 *  fixture com hash válido conta, paridade com `vereditoTemProva`).
 *  Sem entry → mapa null e a linha exibe SEM_DADO (fail-closed: JSON
 *  forjado neste path nunca vira número). */
export const CENSO_URL = "/data/censo_municipios.json";

/** Rótulo pt-BR da linha de população real (Censo 2022). */
export const CENSO_ROTULO = "População (Censo 2022)";

/** Mapa `{ibge7: pop}` do artefato `censo_municipios.json` (Task 1). */
export type CensoMapa = Record<string, number>;

/** Valida o JSON do artefato: objeto plano com valores numéricos finitos.
 *  Qualquer outro shape (null, array, string, fetch que devolveu fato) →
 *  null fail-closed. Valores não-numéricos são descartados por chave
 *  (nunca viram zero). */
export function parseCensoMapa(json: unknown): CensoMapa | null {
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  const mapa: CensoMapa = {};
  for (const [k, v] of Object.entries(json as Record<string, unknown>)) {
    if (typeof v === "number" && Number.isFinite(v)) mapa[k] = v;
  }
  return mapa;
}

/** Pop do IBGE no mapa; null sem par ou valor inválido (fail-closed:
 *  nunca 0 inventado, nunca `demo.pop` fixture do fato). */
export function popNoCenso(mapa: CensoMapa | null | undefined, ibge: string): number | null {
  if (!mapa || typeof mapa !== "object") return null;
  const v = (mapa as Record<string, unknown>)[String(ibge ?? "")];
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
}

/** Baseline Brasil: soma das pops válidas do mapa (padrão das demais
 *  seções: "(Brasil: …)" inline na mesma linha). Null sem nenhuma pop
 *  válida — baseline nunca inventado. */
export function totalBrasilCenso(mapa: CensoMapa | null | undefined): number | null {
  if (!mapa || typeof mapa !== "object") return null;
  let soma = 0;
  let n = 0;
  for (const v of Object.values(mapa)) {
    if (typeof v === "number" && Number.isFinite(v) && v > 0) {
      soma += v;
      n++;
    }
  }
  return n > 0 ? soma : null;
}

/** Soma da pop dos IBGEs da UF (ramo agregado UF, Task 3): reusa
 *  `popNoCenso` por chave (fail-closed por chave, nunca zero inventado).
 *  Null sem nenhuma pop válida — agregado nunca inventado. */
export function totalUFCenso(
  mapa: CensoMapa | null | undefined,
  ibges: Array<string | number> | null | undefined,
): number | null {
  if (!mapa || typeof mapa !== "object" || !Array.isArray(ibges)) return null;
  let soma = 0;
  let n = 0;
  for (const ibge of ibges) {
    const v = popNoCenso(mapa, String(ibge ?? ""));
    if (v !== null) {
      soma += v;
      n++;
    }
  }
  return n > 0 ? soma : null;
}

/** Prefixo IBGE de 2 dígitos → sigla UF (códigos estáveis do IBGE).
 *  FONTE ÚNICA da tabela (webfix Finding 1/6): `HomeContent.ufDeSelecaoMapa`
 *  importa daqui em vez de forkar — um prefixo, um significado. */
export const UF_POR_PREFIXO_IBGE: Record<string, string> = {
  "11": "RO", "12": "AC", "13": "AM", "14": "RR", "15": "PA", "16": "AP", "17": "TO",
  "21": "MA", "22": "PI", "23": "CE", "24": "RN", "25": "PB", "26": "PE", "27": "AL",
  "28": "SE", "29": "BA", "31": "MG", "32": "ES", "33": "RJ", "35": "SP",
  "41": "PR", "42": "SC", "43": "RS", "50": "MS", "51": "MT", "52": "GO", "53": "DF",
};

/** Chaves IBGE7 do mapa do Censo pertencentes à UF (webfix Finding 1):
 *  o agregado UF deriva do ARTEFATO (fato-independente), nunca da lista
 *  de municípios do fato (fato null/parcial subestimava ou zerava).
 *  Chave fora do shape IBGE7 ou prefixo fora da tabela → ignorada. */
export function ibgesDaUFNoCenso(
  mapa: CensoMapa | null | undefined,
  uf: string,
): string[] {
  const alvo = String(uf ?? "").trim().toUpperCase();
  if (!mapa || typeof mapa !== "object" || alvo === "") return [];
  const out: string[] = [];
  for (const k of Object.keys(mapa)) {
    const m = /^(\d{2})\d{5}$/.exec(k.trim());
    if (m && UF_POR_PREFIXO_IBGE[m[1]] === alvo) out.push(k);
  }
  return out;
}

/** Pop da UF direto do mapa do Censo (chaves por prefixo IBGE→UF):
 *  fato-independente — fato null ou parcial não altera a soma. */
export function popUFNoCenso(
  mapa: CensoMapa | null | undefined,
  uf: string,
): number | null {
  return totalUFCenso(mapa, ibgesDaUFNoCenso(mapa, uf));
}

/** Nota honesta quando o motor usou pesos de fallback (ledger: pesoFonte). */
export const NOTA_PESO_MISTO =
  "nota: pesos mistos — parte dos municípios usa total/pop como aproximação " +
  "de eleitores; médias aproximadas, não contagem censitária";

// Fonte única vive em `lib/textos` (EVOLVE-5 Task 4, S1192); re-export por
// compatibilidade com os importadores existentes (sem fork).
export { SEM_DADO };

export interface FatoRegiao {
  candidatos: FatoCandidato[];
  municipios: MunRow[];
}

export interface ResumoVencedor {
  vencedorId: string;
  vencedorNome: string;
  vencedorPartido: string;
  v1: number;
  v2: number;
  total: number;
  /** (v1-v2)/total; null quando total <= 0 (fail-closed). */
  margem: number | null;
  /** total/eleitores; null sem eleitores finitos (fail-closed). */
  participacao: number | null;
}

function finito(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function eleitoresLinha(row: MunRow): number | null {
  const e = row.demo?.eleitores;
  return finito(e) && e > 0 ? e : null;
}

/** Vencedor de UMA linha municipal (argmax na ordem de `candidatos`). */
export function resumoMunicipio(
  row: MunRow,
  candidatos: FatoCandidato[],
): ResumoVencedor | null {
  const ordem = Array.isArray(candidatos) ? candidatos : [];
  const idx = indiceVencedor(row?.votos ?? []);
  if (idx < 0 || idx >= ordem.length) return null;
  const vals = (row.votos ?? []).filter(finito).sort((a, b) => b - a) as number[];
  const v1 = vals[0] ?? 0;
  const v2 = vals[1] ?? 0;
  const total = totalLinha(row);
  const eleitores = eleitoresLinha(row);
  const cand = ordem[idx];
  return {
    vencedorId: String(cand?.id ?? ""),
    vencedorNome: String(cand?.nome ?? cand?.id ?? ""),
    vencedorPartido: String(cand?.partido ?? ""),
    v1,
    v2,
    total,
    margem: total > 0 ? (v1 - v2) / total : null,
    participacao: eleitores !== null && total >= 0 ? total / eleitores : null,
  };
}

export interface AgregadoUF extends ResumoVencedor {
  nMun: number;
}

/** Agregação da UF clicada no fallback em lista (soma finita por candidato). */
export function agregarUF(
  rows: MunRow[],
  uf: string,
  candidatos: FatoCandidato[],
): AgregadoUF | null {
  const ordem = Array.isArray(candidatos) ? candidatos : [];
  const alvo = String(uf ?? "").trim().toUpperCase();
  const linhas = (Array.isArray(rows) ? rows : []).filter(
    (r) => String(r?.uf ?? "").trim().toUpperCase() === alvo,
  );
  if (linhas.length === 0 || ordem.length === 0) return null;
  const somas = ordem.map((c) => {
    const i = ordem.findIndex((k) => k?.id === c?.id);
    let s = 0;
    let algum = false;
    for (const r of linhas) {
      const v = r?.votos?.[i];
      if (finito(v)) {
        s += v;
        algum = true;
      }
    }
    return algum ? s : -Infinity;
  });
  let best = -1;
  let bestV = -Infinity;
  somas.forEach((s, i) => {
    if (s > bestV) {
      bestV = s;
      best = i;
    }
  });
  if (best < 0 || bestV === -Infinity) return null;
  const vals = somas.filter((s) => s !== -Infinity).sort((a, b) => b - a);
  const v1 = vals[0] ?? 0;
  const v2 = vals[1] ?? 0;
  // Mesmo denominador do painel municipal: soma `totalLinha` (row.total
  // inclui brancos/nulos fora de `votos`) em vez de só votos nominais.
  const total = linhas.reduce((acc, r) => acc + totalLinha(r), 0);
  const eleitores = linhas.map(eleitoresLinha);
  const todosComEleitores = eleitores.every((e) => e !== null);
  const cand = ordem[best];
  return {
    vencedorId: String(cand?.id ?? ""),
    vencedorNome: String(cand?.nome ?? cand?.id ?? ""),
    vencedorPartido: String(cand?.partido ?? ""),
    v1,
    v2,
    total,
    margem: total > 0 ? (v1 - v2) / total : null,
    participacao:
      todosComEleitores && eleitores.length > 0
        ? total / (eleitores as number[]).reduce((a, b) => a + b, 0)
        : null,
    nMun: linhas.length,
  };
}

/** 0.2 -> "20,0%" (pt-BR, sem Intl para manter o bundle leve). */
export function pct(v: number | null): string {
  if (!finito(v)) return SEM_DADO;
  return `${((v as number) * 100).toFixed(1).replace(".", ",")}%`;
}

function num(v: number): string {
  return Number.isFinite(v) ? String(Math.round(v * 10) / 10) : SEM_DADO;
}

/** Renda média fail-closed: NaN do motor (sem renda no fato) nunca vira
 *  "R$ 0" — mesmo tratamento de `num()` para as demais variáveis. */
function renda(v: number): string {
  return finito(v) ? `R$ ${formatVotes(Math.round(v))}` : SEM_DADO;
}

const ALERTA_STYLE: React.CSSProperties = {
  background: "#fff3cd",
  border: "1px solid #b45309",
  fontWeight: "bold",
};

interface PainelRegiaoProps {
  ibge: string;
  fato: FatoRegiao | null;
  seal: SealState;
  manifestChecked?: boolean;
  /** Dataset selecionado (`?fato=` resolvido pela página): preservado no
   *  link "Por quê?" para analisar o pleito exibido, não o default. */
  fatoDataset?: string | null;
  /** Mapa `{ibge7: pop}` do Censo (artefato servido, dado pós-gate: a
   *  página `/regiao/[ibge]` detém o mapa e o repassa (null inicial =
   *  fail-closed, SEM_DADO transitório). `undefined` (omitido) → SEM_DADO
   *  sem nenhum fetch: o self-fetch client-side foi removido (EVOLVE-9
   *  Task 3 — morto em prod: o único call site produtivo sempre passa a
   *  prop, então `censo===undefined` nunca ocorria fora de testes; o
   *  artefato segue buscado uma única vez pela página via `fetchJson`).
   *  A pop NUNCA vem de `demo.pop` do fato (fixture). */
  censo?: CensoMapa | null;
}

export default function PainelRegiao({ ibge, fato, seal, manifestChecked, fatoDataset, censo }: PainelRegiaoProps) {
  const badge = <SealSlot seal={seal} />;
  const cod = String(ibge ?? "").trim().toUpperCase();
  const ehExterior = cod === "EXTERIOR";
  const ehUF = /^[A-Z]{2}$/.test(cod);
  // Censo fato-independente COM selo runtime (EVOLVE-8 Task 1): resolve SÓ
  // da prop (dado pós-gate da página; determinístico p/ SSR/testes, sem
  // fetch no Painel). `undefined`/null → mapa ausente e a linha exibe
  // SEM_DADO (fail-closed: nunca throw nem número forjado).
  const mapa = censo;
  // Linha da pop real (ramo município + fallbacks fato-independentes; o
  // agregado UF usa `popUFNoCenso` + mesma linha pt-BR — Task 3).
  // Baseline Brasil inline, padrão das demais linhas.
  const pop = popNoCenso(mapa, String(ibge ?? ""));
  const brasilPop = totalBrasilCenso(mapa);
  const liPop = (
    <li>{CENSO_ROTULO}: {pop !== null ? formatVotes(pop) : SEM_DADO} (Brasil: {brasilPop !== null ? formatVotes(brasilPop) : SEM_DADO})</li>
  );
  // Agregado UF direto do mapa (webfix Finding 1): deriva das chaves do
  // artefato por prefixo IBGE→UF — fato null/parcial não zera nem
  // subestima. Calculado aqui p/ servir o ramo UF E o fallback sem-fato.
  const popUF = ehUF && !ehExterior ? popUFNoCenso(mapa, cod) : null;
  const liPopUF = (
    <li>{CENSO_ROTULO}: {popUF !== null ? formatVotes(popUF) : SEM_DADO} (Brasil: {brasilPop !== null ? formatVotes(brasilPop) : SEM_DADO})</li>
  );
  // Sufixo ?fato= validado pelo mesmo allowlist da rota (nunca traversal).
  const fatoQ =
    typeof fatoDataset === "string" && isFatoDataset(fatoDataset.trim())
      ? `&fato=${encodeURIComponent(fatoDataset.trim())}`
      : "";

  const topo = (
    <>
      {manifestChecked && !seal.official && !seal.hasFixture && (
        <p role="alert" className="badge badge-warn" style={ALERTA_STYLE}>
          dado não auditado — manifest ausente ou inválido; números abaixo não são oficiais
        </p>
      )}
      {manifestChecked && !seal.official && seal.hasFixture && <SealSlot seal={seal} />}
      {seal.official && (
        <SourceBadge hash={seal.official.hash} url={seal.official.url} date={seal.official.date} />
      )}
    </>
  );

  if (ehExterior || !fato) {
    return (
      <>
        <h1>Painel da região — {ibge}</h1>
        {topo}
        <section aria-label="Resultado">
          <h2>Resultado</h2>
          {badge}
          <p role="alert" style={ALERTA_STYLE}>
            {SEM_DADO}
            {ehExterior ? " — votos do exterior fora do fato municipal" : ""}
          </p>
        </section>
        <section aria-label="Perfil do lugar">
          <h2>Perfil do lugar</h2>
          {badge}
          <p role="note">{ECO_SEAL}</p>
          {/* Pop fato-independente (proveniência na entry `artifacts` do Censo):
              sem fato, só a pop real pode aparecer — resto segue SEM_DADO.
              UF sem fato agrega do mapa (liPopUF); município usa o lookup
              por IBGE (liPop). Exterior fora do Censo municipal: nada. */}
          {!ehExterior && <ul>{ehUF ? liPopUF : liPop}</ul>}
          <p>{SEM_DADO}</p>
        </section>
        <section aria-label="Ações">
          <h2>Ações</h2>
          {badge}
          <p>{SEM_DADO}</p>
        </section>
      </>
    );
  }

  if (ehUF) {
    const ag = agregarUF(fato.municipios, cod, fato.candidatos);
    const linhasUF = fato.municipios.filter(
      (r) => String(r?.uf ?? "").trim().toUpperCase() === cod,
    );
    if (!ag) {
      return (
        <>
          <h1>Painel da região — {cod}</h1>
          {topo}
          <section aria-label="Resultado">
            <h2>Resultado</h2>
            {badge}
            <p role="alert" style={ALERTA_STYLE}>{SEM_DADO}</p>
          </section>
          <section aria-label="Perfil do lugar">
            <h2>Perfil do lugar</h2>
            {badge}
            <p role="note">{ECO_SEAL}</p>
            <ul>{liPopUF}</ul>
            <p>{SEM_DADO}</p>
          </section>
          <section aria-label="Ações">
            <h2>Ações</h2>
            {badge}
            <p>{SEM_DADO}</p>
          </section>
        </>
      );
    }
    const perfil = perfilOndeVenceu(linhasUF, {
      candidatoId: ag.vencedorId,
      candidatos: fato.candidatos,
    });
    // Baseline nacional usa o fato inteiro (não só a UF) — rótulo "Brasil" honesto.
    const baseUF = perfilOndeVenceu(fato.municipios, {
      candidatoId: ag.vencedorId,
      candidatos: fato.candidatos,
    });
    return (
      <>
        <h1>Painel da região — {cod}</h1>
        {topo}
        <section aria-label="Resultado">
          <h2>Resultado — {ag.vencedorNome} ({ag.vencedorPartido})</h2>
          {badge}
          <ul>
            <li>Votos do vencedor: {formatVotes(ag.v1)}</li>
            <li>Margem sobre o 2º: {pct(ag.margem)}</li>
            <li>Participação: {ag.participacao !== null ? pct(ag.participacao) : SEM_DADO}</li>
            <li>Municípios: {formatVotes(ag.nMun)}</li>
          </ul>
        </section>
        <section aria-label="Perfil do lugar">
          <h2>Perfil do lugar</h2>
          {badge}
          <p role="note">{ECO_SEAL} — médias de municípios onde {ag.vencedorNome} venceu, nunca de pessoas.</p>
          {(perfil.pesoFonte === "misto" || baseUF.pesoFonte === "misto") && <p role="note">{NOTA_PESO_MISTO}</p>}
          {perfil.nMun === 0 ? (
            <>
              <ul>{liPopUF}</ul>
              <p>{SEM_DADO}</p>
            </>
          ) : (
            <ul>
              <li>Escolaridade superior: {num(perfil.medias.esc_sup)}% (Brasil: {num(baseUF.vsBrasil.esc_sup)}%)</li>
              <li>Renda média: {renda(perfil.medias.renda_media)} (Brasil: {renda(baseUF.vsBrasil.renda_media)})</li>
              <li>Pobres: {num(perfil.medias.pobres_pct)}% (Brasil: {num(baseUF.vsBrasil.pobres_pct)}%)</li>
              {liPopUF}
              <li>Municípios onde venceu: {formatVotes(perfil.nMun)}</li>
            </ul>
          )}
        </section>
        <section aria-label="Ações">
          <h2>Ações</h2>
          {badge}
          <ul>
            <li><a href="/analisar">Comparar</a></li>
            <li><a href={`/explorar?foco=${encodeURIComponent(cod)}${fatoQ}`}>Por quê?</a></li>
            <li><a href={`/verificar?regiao=${encodeURIComponent(cod)}`}>Verificar</a></li>
          </ul>
          {seal.official && (
            <p><CopyShare url={`/regiao/${cod}?hash=${seal.official.hash}`} /></p>
          )}
        </section>
      </>
    );
  }

  const row = fato.municipios.find((r) => String(r?.ibge ?? "") === String(ibge ?? ""));
  const res = row ? resumoMunicipio(row, fato.candidatos) : null;
  if (!row || !res) {
    return (
      <>
        <h1>Painel da região — {ibge}</h1>
        {topo}
        <section aria-label="Resultado">
          <h2>Resultado</h2>
          {badge}
          <p role="alert" style={ALERTA_STYLE}>{SEM_DADO}</p>
        </section>
        <section aria-label="Perfil do lugar">
          <h2>Perfil do lugar</h2>
          {badge}
          <p role="note">{ECO_SEAL}</p>
          <ul>{liPop}</ul>
          <p>{SEM_DADO}</p>
        </section>
        <section aria-label="Ações">
          <h2>Ações</h2>
          {badge}
          <p>{SEM_DADO}</p>
        </section>
      </>
    );
  }

  const perfil = perfilOndeVenceu([row], {
    candidatoId: res.vencedorId,
    candidatos: fato.candidatos,
  });
  const base = perfilOndeVenceu(fato.municipios, {
    candidatoId: res.vencedorId,
    candidatos: fato.candidatos,
  });
  const foco = encodeURIComponent(String(ibge));
  // O índice /verificar filtra por sigla de UF: emite a UF da linha para
  // cair nos checks da região em vez da sugestão (contrato documentado
  // em `checksParaRegiao`; IBGE7 nunca casa lá).
  const ufLinha = String(row?.uf ?? "").trim().toUpperCase();
  const regiaoQ = encodeURIComponent(/^[A-Z]{2}$/.test(ufLinha) ? ufLinha : String(ibge));
  // H1 legível (Task 5): nome do município + UF quando houver; IBGE em
  // <small>. Sem nome no fato, menção única ao IBGE (sem duplicar o código).
  const nomeMun = String(row?.nome ?? "").trim();
  const ufMun = String(row?.uf ?? "").trim().toUpperCase();

  return (
    <>
      {/* Sem nome no fato (build_fato sempre escreve "nome": ""): rótulo
          com menção única ao IBGE. */}
      <h1>{nomeMun ? `${nomeMun} (${ufMun})` : "Painel da região"} <small>IBGE {ibge}</small></h1>
      {topo}
      <section aria-label="Resultado">
        <h2>Resultado — {res.vencedorNome} ({res.vencedorPartido})</h2>
        {badge}
        <ul>
          <li>Votos do vencedor: {formatVotes(res.v1)}</li>
          <li>Margem sobre o 2º: {pct(res.margem)}</li>
          <li>Participação: {res.participacao !== null ? pct(res.participacao) : `${SEM_DADO} — eleitorado sem fonte`}</li>
          <li>Total de votos: {formatVotes(res.total)}</li>
        </ul>
      </section>
      <section aria-label="Perfil do lugar">
        <h2>Perfil do lugar</h2>
        {badge}
        <p role="note">{ECO_SEAL} — médias do município, nunca de pessoas.</p>
        {(perfil.pesoFonte === "misto" || base.pesoFonte === "misto") && <p role="note">{NOTA_PESO_MISTO}</p>}
        {perfil.nMun === 0 ? (
          <>
            <ul>{liPop}</ul>
            <p>{SEM_DADO} — perfil sem par para este município; votos acima intactos</p>
          </>
        ) : (
          <ul>
            <li>Escolaridade superior: {num(perfil.medias.esc_sup)}% (Brasil: {num(base.vsBrasil.esc_sup)}%)</li>
            <li>Renda média: {renda(perfil.medias.renda_media)} (Brasil: {renda(base.vsBrasil.renda_media)})</li>
            <li>Pobres: {num(perfil.medias.pobres_pct)}% (Brasil: {num(base.vsBrasil.pobres_pct)}%)</li>
            {liPop}
          </ul>
        )}
      </section>
      <section aria-label="Ações">
        <h2>Ações</h2>
        {badge}
        <ul>
          <li><a href="/analisar">Comparar</a></li>
          <li><a href={`/explorar?foco=${foco}${fatoQ}`}>Por quê?</a></li>
          <li><a href={`/verificar?regiao=${regiaoQ}`}>Verificar</a></li>
        </ul>
        {seal.official && (
          <p><CopyShare url={`/regiao/${ibge}?hash=${seal.official.hash}`} /></p>
        )}
      </section>
    </>
  );
}
