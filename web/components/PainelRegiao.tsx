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
import { formatVotes, type SealState } from "../lib/data";
import {
  indiceVencedor,
  perfilOndeVenceu,
  type FatoCandidato,
  type MunRow,
} from "../lib/motor";

/** Selo ecológico (spec §7): perfis são SEMPRE de município, nunca de pessoa. */
export const ECO_SEAL = "dado de município, não de pessoa";

/** Nota honesta quando o motor usou pesos de fallback (ledger: pesoFonte). */
export const NOTA_PESO_MISTO =
  "nota: pesos mistos — parte dos municípios usa total/pop como aproximação " +
  "de eleitores; médias aproximadas, não contagem censitária";

export const SEM_DADO = "sem dado oficial";

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

function totalLinha(row: MunRow): number {
  if (finito(row.total)) return row.total;
  let soma = 0;
  let algum = false;
  for (const v of row.votos ?? []) {
    if (finito(v)) {
      soma += v;
      algum = true;
    }
  }
  return algum ? soma : 0;
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
  const total = v1 + (vals.slice(1).reduce((a, b) => a + b, 0) || 0);
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
}

export default function PainelRegiao({ ibge, fato, seal, manifestChecked }: PainelRegiaoProps) {
  const badge = <SealSlot seal={seal} />;
  const cod = String(ibge ?? "").trim().toUpperCase();
  const ehExterior = cod === "EXTERIOR";
  const ehUF = /^[A-Z]{2}$/.test(cod);

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
    const linhasUF = fato.municipios.filter(
      (r) => String(r?.uf ?? "").trim().toUpperCase() === cod,
    );
    const perfil = perfilOndeVenceu(linhasUF, {
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
          {perfil.pesoFonte === "misto" && <p role="note">{NOTA_PESO_MISTO}</p>}
          {perfil.nMun === 0 ? (
            <p>{SEM_DADO}</p>
          ) : (
            <ul>
              <li>Escolaridade superior: {num(perfil.medias.esc_sup)}% (Brasil: {num(perfil.vsBrasil.esc_sup)}%)</li>
              <li>Renda média: R$ {formatVotes(Math.round(perfil.medias.renda_media))} (Brasil: R$ {formatVotes(Math.round(perfil.vsBrasil.renda_media))})</li>
              <li>Pobres: {num(perfil.medias.pobres_pct)}% (Brasil: {num(perfil.vsBrasil.pobres_pct)}%)</li>
              <li>Municípios onde venceu: {formatVotes(perfil.nMun)}</li>
            </ul>
          )}
        </section>
        <section aria-label="Ações">
          <h2>Ações</h2>
          {badge}
          <ul>
            <li><a href="/analisar">Comparar</a></li>
            <li><a href={`/explorar?foco=${encodeURIComponent(cod)}`}>Por quê?</a></li>
            <li><a href={`/verificar?regiao=${encodeURIComponent(cod)}`}>Verificar</a></li>
          </ul>
          {seal.official && (
            <p><small>URL compartilhável: <code>/regiao/{cod}?hash={seal.official.hash}</code></small></p>
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

  return (
    <>
      <h1>Painel da região — {ibge}</h1>
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
        {perfil.pesoFonte === "misto" && <p role="note">{NOTA_PESO_MISTO}</p>}
        {perfil.nMun === 0 ? (
          <p>{SEM_DADO} — Censo sem par para este município; votos acima intactos</p>
        ) : (
          <ul>
            <li>Escolaridade superior: {num(perfil.medias.esc_sup)}% (Brasil: {num(base.vsBrasil.esc_sup)}%)</li>
            <li>Renda média: R$ {formatVotes(Math.round(perfil.medias.renda_media))} (Brasil: R$ {formatVotes(Math.round(base.vsBrasil.renda_media))})</li>
            <li>Pobres: {num(perfil.medias.pobres_pct)}% (Brasil: {num(base.vsBrasil.pobres_pct)}%)</li>
          </ul>
        )}
      </section>
      <section aria-label="Ações">
        <h2>Ações</h2>
        {badge}
        <ul>
          <li><a href="/analisar">Comparar</a></li>
          <li><a href={`/explorar?foco=${foco}`}>Por quê?</a></li>
          <li><a href={`/verificar?regiao=${foco}`}>Verificar</a></li>
        </ul>
        {seal.official && (
          <p><small>URL compartilhável: <code>/regiao/{ibge}?hash={seal.official.hash}</code></small></p>
        )}
      </section>
    </>
  );
}
