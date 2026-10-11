"use client";

/** Verificação de afirmações (Task 10, spec §4/§7): veredito tricolor.
 *
 * Implementação ÚNICA consumida pela página estática
 * (`app/verificar/[slug]/page.tsx`, via `generateStaticParams` no build),
 * pelo índice `/verificar?regiao=` e pelos testes sobre MunRow sintéticas
 * (`__tests__/verificar.test.ts`).
 *
 * Consome (sem reinventar): motor completo (`perfilOndeVenceu`,
 * `correlacao` Pearson + Spearman com piso n ≥ 30, `shareCandidato`,
 * `totalLinha`, `LIMIAR_EFEITO_R`), `resolverCandidato` da Curada
 * (tokens `@vencedor`/`@vice`), `ECO_SEAL`/`SEM_DADO` e `SealSlot`/
 * `SourceBadge` por seção (pixel-mentiroso).
 *
 * Tipos de computação (1 por check, regra de veredito própria):
 * - `vencedor_regiao`: agregado de votos no recorte (BR ou UF); falso se
 *   outro candidato venceu ou se a margem ficou abaixo da `margem_min`
 *   explícita do check (número afirmado contradito); enganoso se venceu
 *   mas abaixo só do piso padrão de 1% quando o check não fixa margem —
 *   vitória no fio nunca é "sem ressalva".
 * - `comparar_medias`: média ponderada onde `quem` venceu vs Brasil;
 *   direção errada → falso; direção certa com diferença relativa < 5% →
 *   enganoso (tecnicamente na direção, mas irrelevante).
 * - `correlacao_sinal`: Pearson E Spearman com piso n ≥ 30; sustentado
 *   e falso exigem concordância dos dois r em sinal e força (|r| ≥ 0,3);
 *   divergência → enganoso (possível outlier). |r| < 0,3 p/ qualquer lado →
 *   enganoso (ruído, nunca falso sobre ruído).
 * - `serie_temporal`: SEMPRE fora de escopo (fato cobre um pleito) →
 *   fail-closed, nunca veredito.
 * - `soma_condicional`: fração de municípios com medida acima/abaixo do
 *   limiar; maioria observada ≠ afirmada → falso; maioria apertada
 *   (50–60%) → enganoso (a afirmação exagera a certeza).
 *
 * Fail-closed: fato null, recorte vazio, correlação suprimida (n < 30) ou
 * série temporal → `veredito: null` + "sem dado oficial", nunca número sem
 * hash. Slug fora da lib → sugestão (lista curada), nunca veredito.
 */

import React from "react";
import CopyShare from "../../components/CopyShare";
import SealSlot from "../../components/SealSlot";
import SourceBadge from "../../components/SourceBadge";
import { ECO_SEAL, SEM_DADO, type FatoRegiao } from "../../components/PainelRegiao";
import ExportCsv from "../../components/ExportCsv";
import type { SealState } from "../../lib/data";
import {
  LIMIAR_EFEITO_R,
  correlacao,
  perfilOndeVenceu,
  shareCandidato,
  totalLinha,
  type MunRow,
  type VarDemo,
} from "../../lib/motor";
import { resolverCandidato } from "../perguntas/Curada";
import { MOTIVO_SEM_HASH } from "../../lib/textos";
import { vereditoTemProva } from "../../lib/regiao";

export type Veredito = "sustentado" | "enganoso" | "falso";

export type TipoComputacao =
  | "vencedor_regiao"
  | "comparar_medias"
  | "correlacao_sinal"
  | "serie_temporal"
  | "soma_condicional";

export interface Check {
  slug: string;
  frase: string;
  titulo?: string;
  computacao: { tipo: TipoComputacao; params: Record<string, unknown> };
  fontes: string[];
  /** UF da afirmação (`null`/ausente = nacional). Usado pelo filtro `?regiao=`. */
  regiao?: string | null;
}

export interface NumeroDecisivo {
  rotulo: string;
  /** null = indeterminável (fail-closed: renderiza "sem dado oficial"). */
  valor: number | null;
  formato?: "contagem" | "pct" | "r" | "n";
}

export interface Verificacao {
  /** null = sem prova (fail-closed); só há veredito com os 3 números. */
  veredito: Veredito | null;
  numeros: NumeroDecisivo[];
  metodo: string;
  /** Explicação do engano (obrigatória quando `enganoso`). */
  engano?: string;
  /** Nota de escopo/supressão (fail-closed honesto). */
  nota?: string;
  /** Nome resolvido do candidato afirmado (para a frase). */
  nomeQuem?: string;
}

/** Diferença relativa mínima p/ `comparar_medias` sustentar (5%). */
const LIMIAR_RELEVANCIA_MEDIA = 0.05;

/** Maioria folgada p/ `soma_condicional` sustentar (≥ 60%). */
const MAIORIA_FOLGADA = 0.6;

/** Piso de margem padrão p/ `vencedor_regiao` quando o check não fixa
 *  `margem_min` (1% — judgment call como os 5%/60% acima: abaixo disso a
 *  vitória é no fio e nunca sai como sustentado "sem ressalva"). */
const MARGEM_MIN_PADRAO = 0.01;

const NOTA_SERIE_TEMPORAL =
  "série temporal fora do escopo: o fato municipal cobre um pleito — evolução exige múltiplos pleitos auditados";

const VEREDITO_LABEL: Record<Veredito, string> = {
  sustentado: "sustentado",
  enganoso: "enganoso",
  falso: "falso",
};

const VEREDITO_STYLE: Record<Veredito, React.CSSProperties> = {
  sustentado: { background: "#e6f4ea", border: "2px solid #1e7e34", color: "#145214" },
  enganoso: { background: "#fff3cd", border: "2px solid #b45309", color: "#7c2d12" },
  falso: { background: "#fdecea", border: "2px solid #b3261e", color: "#7a1a14" },
};

const ALERTA_STYLE: React.CSSProperties = {
  background: "#fff3cd",
  border: "1px solid #b45309",
  fontWeight: "bold",
};

function finito(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function linhasDoRecorte(linhas: MunRow[], regiao: string): MunRow[] {
  const r = str(regiao).trim().toUpperCase();
  if (r === "" || r === "BR") return linhas;
  return linhas.filter((l) => str(l?.uf).trim().toUpperCase() === r);
}

function semProva(nota: string, metodo: string): Verificacao {
  return { veredito: null, numeros: [], metodo, nota };
}

function verificarVencedorRegiao(
  params: Record<string, unknown>,
  fato: FatoRegiao,
): Verificacao {
  const metodo =
    "Agregado de votos no recorte (soma finita por candidato; vencedor = maior soma). " +
    "Veredito: outro vencedor → falso; venceu mas abaixo da margem mínima afirmada " +
    "no check → falso (número afirmado contradito); venceu abaixo só do piso padrão " +
    `de ${MARGEM_MIN_PADRAO * 100}% (check sem margem explícita) → enganoso.`;
  const linhas = linhasDoRecorte(fato.municipios ?? [], str(params.regiao) || "BR");
  if (linhas.length === 0) return semProva("nenhum município neste recorte", metodo);
  const ordem = fato.candidatos ?? [];
  const somas = ordem.map((_c, i) => {
    let s = 0;
    let algum = false;
    for (const r of linhas) {
      const v = r?.votos?.[i];
      if (finito(v)) {
        s += v as number;
        algum = true;
      }
    }
    return algum ? s : -Infinity;
  });
  const rank = somas
    .map((s, i) => ({ s, i }))
    .filter((e) => e.s !== -Infinity)
    .sort((a, b) => b.s - a.s);
  if (rank.length === 0) return semProva("nenhum voto finito neste recorte", metodo);
  const v1 = rank[0].s;
  const v2 = rank.length > 1 ? rank[1].s : 0;
  const total = rank.reduce((acc, e) => acc + e.s, 0);
  const margem = total > 0 ? (v1 - v2) / total : null;
  const vencedor = ordem[rank[0].i];
  const afirmado = resolverCandidato(fato, str(params.quem));
  const numeros: NumeroDecisivo[] = [
    { rotulo: "Votos do vencedor no recorte", valor: v1, formato: "contagem" },
    { rotulo: "Margem sobre o 2º colocado", valor: margem, formato: "pct" },
    { rotulo: "Municípios no recorte", valor: linhas.length, formato: "n" },
  ];
  if (!afirmado) return semProva("candidato afirmado fora do fato auditado", metodo);
  if (String(vencedor?.id) !== afirmado.id) {
    return {
      veredito: "falso",
      numeros,
      metodo,
      nomeQuem: afirmado.nome,
    };
  }
  const pisoMargem = finito(params.margem_min)
    ? (params.margem_min as number)
    : MARGEM_MIN_PADRAO;
  const pisoRotulo = finito(params.margem_min)
    ? `dos ${(params.margem_min as number) * 100}% afirmados`
    : `do piso padrão de ${MARGEM_MIN_PADRAO * 100}%`;
  // Margem explícita afirmada e descumprida contradiz o número do check →
  // falso. O enganoso fica só p/ o piso padrão (vitória no fio sem número
  // afirmado). Margem indeterminada (total zerado) segue enganoso.
  if (
    finito(params.margem_min) &&
    margem !== null &&
    (margem as number) < (params.margem_min as number)
  ) {
    return { veredito: "falso", numeros, metodo, nomeQuem: afirmado.nome };
  }
  if (margem === null || (margem as number) < pisoMargem) {
    return {
      veredito: "enganoso",
      numeros,
      metodo,
      nomeQuem: afirmado.nome,
      engano:
        margem === null
          ? "venceu, mas a margem é indeterminada (total de votos zerado) — vitória sem número que a sustente."
          : `venceu por margem de ${((margem as number) * 100).toFixed(1).replace(".", ",")}% ` +
            `— abaixo ${pisoRotulo}: a vitória existe, mas é no fio, insuficiente para "sem ressalva".`,
    };
  }
  return { veredito: "sustentado", numeros, metodo, nomeQuem: afirmado.nome };
}

const VAR_DEMO_SET = new Set([
  "esc_sup",
  "esc_med",
  "esc_fund",
  "renda_media",
  "pobres_pct",
  "idade_mediana",
  "urbanizacao",
  "pop",
  "eleitores",
]);

function verificarCompararMedias(
  params: Record<string, unknown>,
  fato: FatoRegiao,
): Verificacao {
  const metodo =
    "Médias ponderadas pelo eleitorado: onde o candidato venceu vs Brasil. " +
    `Diferença relativa ≥ ${LIMIAR_RELEVANCIA_MEDIA * 100}% na direção afirmada → sustentado; ` +
    "direção certa com diferença menor → enganoso; direção errada → falso.";
  const variavel = str(params.variavel);
  if (!VAR_DEMO_SET.has(variavel)) return semProva("variável sem cobertura auditada", metodo);
  const afirmado = resolverCandidato(fato, str(params.quem));
  if (!afirmado) return semProva("candidato afirmado fora do fato auditado", metodo);
  const linhas = fato.municipios ?? [];
  const perfil = perfilOndeVenceu(linhas, { candidatoId: afirmado.id, candidatos: fato.candidatos ?? [] });
  if (perfil.nMun === 0) return semProva("nenhum município onde o candidato venceu", metodo);
  const g = perfil.medias[variavel as VarDemo];
  const b = perfil.vsBrasil[variavel as VarDemo];
  const numeros: NumeroDecisivo[] = [
    { rotulo: "Média onde venceu", valor: finito(g) ? g : null },
    { rotulo: "Média no Brasil", valor: finito(b) ? b : null },
    {
      rotulo: "Diferença relativa",
      valor: finito(g) && finito(b) && b !== 0 ? (g - b) / Math.abs(b) : null,
      formato: "pct",
    },
  ];
  if (!finito(g) || !finito(b)) return semProva("médias indeterminadas neste recorte", metodo);
  const direcao = str(params.direcao) === "menor" ? "menor" : "maior";
  const naDirecao = direcao === "maior" ? g > b : g < b;
  if (!naDirecao) return { veredito: "falso", numeros, metodo, nomeQuem: afirmado.nome };
  const rel = b !== 0 ? Math.abs((g - b) / Math.abs(b)) : g === b ? 0 : Infinity;
  if (rel < LIMIAR_RELEVANCIA_MEDIA) {
    return {
      veredito: "enganoso",
      numeros,
      metodo,
      nomeQuem: afirmado.nome,
      engano:
        `a direção está certa, mas a diferença é de apenas ${(rel * 100).toFixed(1).replace(".", ",")}% ` +
        "— tecnicamente na direção afirmada, porém pequena demais para sustentar a leitura sugerida.",
    };
  }
  return { veredito: "sustentado", numeros, metodo, nomeQuem: afirmado.nome };
}

function verificarCorrelacaoSinal(
  params: Record<string, unknown>,
  fato: FatoRegiao,
): Verificacao {
  const metodo =
    "Correlação de Pearson e Spearman entre a variável e o share do candidato, " +
    `com piso n ≥ 30. Sinal afirmado com |r| ≥ ${String(LIMIAR_EFEITO_R).replace(".", ",")} nos dois r → sustentado; ` +
    `|r| < ${String(LIMIAR_EFEITO_R).replace(".", ",")} em qualquer um ou divergência de sinal entre eles → enganoso ` +
    "(ruído ou possível outlier: nunca falso sem concordância); " +
    "sinal oposto com efeito claro nos dois r → falso. Correlação não implica causa.";
  const variavel = str(params.variavel);
  if (!VAR_DEMO_SET.has(variavel)) return semProva("variável sem cobertura auditada", metodo);
  const ordem = fato.candidatos ?? [];
  const afirmado = resolverCandidato(fato, str(params.quem));
  if (!afirmado) return semProva("candidato afirmado fora do fato auditado", metodo);
  const idx = ordem.findIndex((c) => c?.id === afirmado.id);
  const linhas = fato.municipios ?? [];
  const xs = linhas.map((r) => (r?.demo ? r.demo[variavel as VarDemo] : null) as unknown as number);
  const ys = linhas.map((r) => shareCandidato(r, idx) as unknown as number);
  const corrP = correlacao(xs, ys, "pearson");
  const corrS = correlacao(xs, ys, "spearman");
  if (!corrP || !corrS) {
    return semProva("correlação suprimida (piso n ≥ 30 municípios ou variância zero)", metodo);
  }
  const numeros: NumeroDecisivo[] = [
    { rotulo: "r (Pearson)", valor: corrP.r, formato: "r" },
    { rotulo: "r (Spearman)", valor: corrS.r, formato: "r" },
    { rotulo: "Municípios (n)", valor: corrP.n, formato: "n" },
  ];
  const esperado = str(params.sinal) === "negativo" ? -1 : 1;
  const sinalP = Math.sign(corrP.r);
  const sinalS = Math.sign(corrS.r);
  const forteP = Math.abs(corrP.r) >= LIMIAR_EFEITO_R;
  const forteS = Math.abs(corrS.r) >= LIMIAR_EFEITO_R;
  const concordaSinal = sinalP === esperado && sinalS === esperado;
  const discordaAmbos = sinalP !== esperado && sinalS !== esperado;
  // Sem penhasco de sinal em r≈0 e sem veredito sobre outlier: falso e
  // sustentado exigem concordância de Pearson E Spearman em sinal e força;
  // divergência (sinal ou força) → enganoso, nunca falso/sustentado.
  if (discordaAmbos && forteP && forteS) {
    return { veredito: "falso", numeros, metodo, nomeQuem: afirmado.nome };
  }
  if (!(concordaSinal && forteP && forteS)) {
    const divergeSinal = sinalP !== sinalS;
    return {
      veredito: "enganoso",
      numeros,
      metodo,
      nomeQuem: afirmado.nome,
      engano: divergeSinal
        ? `Pearson (r = ${corrP.r.toFixed(3).replace(".", ",")}) e Spearman (r = ${corrS.r.toFixed(3).replace(".", ",")}) ` +
          `divergem em sinal com n = ${corrP.n}: possível outlier ou relação não-linear — ` +
          "os números não sustentam a direção afirmada com segurança, nem a derrubam."
        : sinalP !== esperado
          ? `r = ${corrP.r.toFixed(3).replace(".", ",")} — efeito fraco (|r| abaixo de ` +
            `${String(LIMIAR_EFEITO_R).replace(".", ",")}), indistinguível de ruído com n = ${corrP.n}: ` +
            "os números não derrubam a direção afirmada com segurança, mas a certeza sugerida não existe."
          : `o sinal é o afirmado, mas r = ${corrP.r.toFixed(3).replace(".", ",")} (efeito fraco, abaixo de ` +
            `${String(LIMIAR_EFEITO_R).replace(".", ",")}) — a relação existe nos números, mas é pequena ` +
            "demais para sustentar a leitura sugerida. Cada ponto é um município, nunca uma pessoa.",
    };
  }
  return { veredito: "sustentado", numeros, metodo, nomeQuem: afirmado.nome };
}

function eleitoresDe(row: MunRow): number | null {
  const e = row?.demo?.eleitores;
  return finito(e) && (e as number) > 0 ? (e as number) : null;
}

function verificarSomaCondicional(
  params: Record<string, unknown>,
  fato: FatoRegiao,
): Verificacao {
  const metodo =
    "Fração de municípios onde a medida ficou acima/abaixo do limiar. " +
    "Maioria observada ≠ afirmada → falso; maioria apertada (50–60%) → enganoso " +
    "(a afirmação exagera a certeza); maioria folgada (≥ 60%) no sentido afirmado → sustentado.";
  const medida = str(params.medida);
  const limiar = params.limiar;
  const lado = str(params.lado) === "abaixo" ? "abaixo" : "acima";
  const afirmaMaioria = params.afirma_maioria !== false;
  if (!["abst", "margem", "participacao"].includes(medida) || !finito(limiar)) {
    return semProva("medida ou limiar sem cobertura auditada", metodo);
  }
  const valores: number[] = [];
  for (const r of fato.municipios ?? []) {
    if (medida === "margem") {
      const vals = (r?.votos ?? []).filter(finito).sort((a, b) => (b as number) - (a as number)) as number[];
      const total = totalLinha(r);
      if (vals.length > 0 && total > 0) valores.push(((vals[0] ?? 0) - (vals[1] ?? 0)) / total);
    } else {
      const eleitores = eleitoresDe(r);
      if (eleitores === null) continue;
      if (medida === "abst") {
        if (finito(r?.abst)) valores.push((r.abst as number) / eleitores);
      } else {
        // Participação (comparecimento): (eleitorado − abstenções) ÷
        // eleitorado com abstenções auditadas; sem abstenções, votos
        // nominais ÷ eleitorado (mesma regra do filtro participacao_80).
        valores.push(
          finito(r?.abst)
            ? ((eleitores as number) - (r.abst as number)) / (eleitores as number)
            : totalLinha(r) / (eleitores as number),
        );
      }
    }
  }
  if (valores.length === 0) return semProva("medida indeterminada (sem eleitorado auditado)", metodo);
  const nCond = valores.filter((v) => (lado === "acima" ? v > (limiar as number) : v < (limiar as number))).length;
  const share = nCond / valores.length;
  const numeros: NumeroDecisivo[] = [
    { rotulo: "Municípios na condição", valor: nCond, formato: "n" },
    { rotulo: "Municípios avaliados", valor: valores.length, formato: "n" },
    { rotulo: "Fração na condição", valor: share, formato: "pct" },
  ];
  // Limiares no lado afirmado: afirma_maioria:false valida a minoria, então
  // a régua (50%/60%) corre sobre a fração alinhada (share ou 1 − share).
  const alinhado = afirmaMaioria ? share : 1 - share;
  if (!(alinhado > 0.5)) return { veredito: "falso", numeros, metodo };
  if (alinhado < MAIORIA_FOLGADA) {
    return {
      veredito: "enganoso",
      numeros,
      metodo,
      engano:
        `a maioria existe (${(alinhado * 100).toFixed(1).replace(".", ",")}%), mas é apertada — ` +
        "a afirmação sugere uma regra geral que os números sustentam só por pouco.",
    };
  }
  return { veredito: "sustentado", numeros, metodo };
}

/** Núcleo puro/testável: computa o veredito de forma síncrona sobre o fato. */
export function verificarAfirmacao(check: Check, fato: FatoRegiao | null): Verificacao {
  const tipo = check?.computacao?.tipo;
  const params = (check?.computacao?.params ?? {}) as Record<string, unknown>;
  if (!fato) {
    return semProva(
      "sem fato auditado",
      "Veredito só com prova: sem fato municipal auditado, nenhuma afirmação recebe veredito.",
    );
  }
  switch (tipo) {
    case "vencedor_regiao":
      return verificarVencedorRegiao(params, fato);
    case "comparar_medias":
      return verificarCompararMedias(params, fato);
    case "correlacao_sinal":
      return verificarCorrelacaoSinal(params, fato);
    case "serie_temporal":
      return semProva(
        NOTA_SERIE_TEMPORAL,
        "Série temporal exige comparar múltiplos pleitos auditados; o fato municipal cobre um pleito por vez.",
      );
    case "soma_condicional":
      return verificarSomaCondicional(params, fato);
    default:
      return semProva(
        "tipo de computação sem cobertura nos blocos",
        "Veredito só com prova: computação desconhecida nunca gera veredito.",
      );
  }
}

/** Frase com tokens `@vencedor`/`@vice` resolvidos p/ nomes do fato. */
export function resolverFrase(check: Check, fato: FatoRegiao | null): string {
  let frase = str(check?.frase);
  if (!fato) return frase;
  for (const token of ["@vencedor", "@vice"]) {
    if (frase.includes(token)) {
      const c = resolverCandidato(fato, token);
      frase = frase.split(token).join(c ? c.nome : token);
    }
  }
  return frase;
}

/** Filtro do link `/verificar?regiao=` do painel: checks daquela UF
 *  (sigla, ex. "SP"). Códigos IBGE de município NÃO casam aqui — o painel
 *  emite a UF no link; mapear IBGE→UF é fora de escopo (sem tabela UF no
 *  front). Sem match → lista vazia e o índice sugere a biblioteca. */
export function checksParaRegiao(checks: Check[], regiao: string): Check[] {
  const r = str(regiao).trim().toUpperCase();
  if (r === "") return [];
  return (Array.isArray(checks) ? checks : []).filter(
    (c) => str(c?.regiao).trim().toUpperCase() === r,
  );
}

/** Slug → `/verificar/<slug>?hash=<manifest>` (mesmo padrão de
 *  `buildExplorarShareUrl`: `hash` só com valor não-branco; slug vazio →
 *  `/verificar`). Recebe a URL pronta o `<CopyShare>` — nunca reconstrói. */
export function buildVerificarShareUrl(slug: string, manifestHash: string): string {
  const limpo = (slug ?? "").trim();
  const base = limpo !== "" ? `/verificar/${encodeURIComponent(limpo)}` : "/verificar";
  const params = new URLSearchParams();
  if (typeof manifestHash === "string" && manifestHash.trim().length > 0) {
    params.set("hash", manifestHash.trim());
  }
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

/** Linhas do CSV do veredito (EVOLVE-11 Task 5, paridade Analisar/Explorar):
 *  os números que decidem + slug/veredito como contexto; proveniência via
 *  `buildCsvExport` (gate oficial no botão — sem hash, desabilitado). */
export function verificarCsvRows(
  slug: string,
  veredito: string,
  numeros: NumeroDecisivo[],
): Record<string, unknown>[] {
  return (Array.isArray(numeros) ? numeros : []).map((n) => ({
    verificacao: slug,
    veredito,
    numero: n?.rotulo ?? "",
    valor: n?.valor ?? null,
    formato: n?.formato ?? "",
  }));
}

function fmtNumero(n: NumeroDecisivo): string {
  if (n.valor === null || !finito(n.valor)) return SEM_DADO;
  const v = n.valor as number;
  switch (n.formato) {
    case "pct":
      return `${(v * 100).toFixed(1).replace(".", ",")}%`;
    case "r":
      return v.toFixed(3).replace(".", ",");
    case "n":
      return String(Math.round(v));
    default:
      return String(Math.round(v * 10) / 10);
  }
}

/** Núcleo puro/testável: conteúdo completo de um check (ou sugestão). */
export function VerificarConteudo({
  check,
  slug,
  checks,
  fato,
  seal,
  manifestChecked,
}: {
  check: Check | null;
  slug: string;
  checks: Check[];
  fato: FatoRegiao | null;
  seal: SealState;
  manifestChecked?: boolean;
}) {
  const badge = <SealSlot seal={seal} />;
  const lista = Array.isArray(checks) ? checks : [];

  // Ramificação de segurança testada por `unknown_claim_suggests`: em rota,
  // slugs fora da lib caem no 404 do Next (`dynamicParams = false` em
  // `[slug]/page.tsx`), então este ramo nunca executa em produção — a
  // propriedade "slug desconhecido nunca recebe veredito" vale por 404, e
  // este ramo a preserva onde o componente é reusado (índice, testes).
  if (!check) {
    return (
      <>
        <h1>Verificar afirmação — sugestão</h1>
        {seal.official && (
          <SourceBadge hash={seal.official.hash} url={seal.official.url} date={seal.official.date} />
        )}
        <section aria-label="Sugestão">
          <h2>Sugestão</h2>
          {badge}
          <p>
            Nenhuma afirmação curada com este nome (“{slug}”). Esta é uma sugestão a partir da
            biblioteca auditada — escolha uma afirmação abaixo para ver o veredito com prova:
          </p>
          <ul>
            {lista.map((c) => (
              <li key={c.slug}>
                <a href={`/verificar/${encodeURIComponent(c.slug)}`}>{c.titulo ?? c.frase}</a>
              </li>
            ))}
          </ul>
        </section>
      </>
    );
  }

  // Fail-closed por hash: fato carregado de ingestão sem hash não gera
  // veredito (`MOTIVO_SEM_HASH` em lib/textos, paridade Explorar/Curada).
  // Só há veredito com hash
  // oficial ou hash de fixture (transparência, sem selo oficial).
  // Predicado único em `vereditoTemProva` (lib/regiao) — mesma fonte de
  // Explorar/Curada, sem drift entre telas.
  const hashAuditado = vereditoTemProva(seal);
  const v = hashAuditado
    ? verificarAfirmacao(check, fato)
    : semProva(
        MOTIVO_SEM_HASH,
        "Veredito só com prova auditada: sem hash válido no manifest, nenhuma afirmação recebe veredito.",
      );
  const frase = resolverFrase(check, fato);
  // Paridade Explorar/Curada: URL reproduzível com o hash do manifest
  // (oficial; sem hash → sem `hash=`, nunca número sem prova). O mesmo
  // `<CopyShare>` — absolutização, stale-guard e fallback vêm de graça.
  const shareUrl = buildVerificarShareUrl(check.slug, seal.official?.hash ?? "");
  // Linhas do CSV do veredito (EVOLVE-11 Task 5): só com veredito; o botão
  // abaixo gateia o hash oficial (sem oficial, desabilitado).
  const csvRows = v.veredito !== null ? verificarCsvRows(check.slug, v.veredito, v.numeros) : [];

  return (
    <>
      <h1>{check.titulo ?? check.frase}</h1>
      {seal.official && (
        <SourceBadge hash={seal.official.hash} url={seal.official.url} date={seal.official.date} />
      )}
      {manifestChecked && !seal.official && !seal.hasFixture && (
        <p role="alert" className="badge badge-warn" style={ALERTA_STYLE}>
          dado não auditado — manifest ausente ou inválido; números abaixo não são oficiais
        </p>
      )}
      {manifestChecked && !seal.official && seal.hasFixture && <SealSlot seal={seal} />}

      <section aria-label="Afirmação">
        <h2>Afirmação</h2>
        {badge}
        <p>“{frase}”</p>
      </section>

      <section aria-label="Veredito">
        <h2>Veredito</h2>
        {badge}
        {v.veredito === null ? (
          <p role="alert" style={ALERTA_STYLE}>
            {SEM_DADO}
            {v.nota ? ` — ${v.nota}` : ""}
          </p>
        ) : (
          <p role="status" style={{ ...VEREDITO_STYLE[v.veredito], padding: "0.5rem", fontWeight: "bold" }}>
            Veredito: {VEREDITO_LABEL[v.veredito]}
          </p>
        )}
        {v.veredito === "enganoso" && v.engano && <p role="note">{v.engano}</p>}
        {v.veredito !== null && (
          <p role="note">
            {ECO_SEAL} — números de municípios, nunca de pessoas; correlação não implica causa.
          </p>
        )}
      </section>

      <section aria-label="Números que decidem">
        <h2>Números que decidem</h2>
        {badge}
        {v.veredito === null ? (
          <p role="alert" style={ALERTA_STYLE}>
            {SEM_DADO}
            {v.nota ? ` — ${v.nota}` : ""}
          </p>
        ) : (
          <table>
            <caption>Os 3 números que sustentam o veredito</caption>
            <thead>
              <tr>
                <th scope="col">Número</th>
                <th scope="col">Valor</th>
              </tr>
            </thead>
            <tbody>
              {v.numeros.map((n) => (
                <tr key={n.rotulo}>
                  <td>{n.rotulo}</td>
                  <td>{fmtNumero(n)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section aria-label="Método">
        <h2>Método</h2>
        {badge}
        <p>{v.metodo}</p>
      </section>

      <section aria-label="Fonte e reprodução">
        <h2>Fonte e reprodução</h2>
        {badge}
        <ul>
          {check.fontes.map((f) => (
            <li key={f}>
              <a href={f} target="_blank" rel="noreferrer">
                {f}
              </a>
            </li>
          ))}
        </ul>
        <p>
          <CopyShare url={shareUrl} />
        </p>
        {/* Export do veredito (EVOLVE-11 Task 5, paridade Analisar/Explorar/
            Regiao): os números que decidem + proveniência do fato. Só com
            veredito (sem prova → sem números, sem botão). Bloco em
            `ExportCsv` (fonte única); gate oficial dentro dele. */}
        {v.veredito !== null && (
          <ExportCsv
            arquivo={`verificar-${check.slug}.csv`}
            linhas={csvRows}
            seal={seal}
          />
        )}
      </section>
    </>
  );
}
