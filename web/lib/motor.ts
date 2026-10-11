/** Motor de respostas — perfil de onde um candidato venceu (Task 3).
 *
 * Opera sobre o shape de `fato_<ano>_<turno>_<cargo>.json` (Task 2, ETL em
 * `etl/build_fato.py`): `{candidatos: [{id, nome, partido}], municipios:
 * [{ibge, uf, nome, votos, total, abst, demo | null}]}` onde `votos` é um
 * array posicional na ordem de `candidatos`.
 *
 * Desvio documentado do brief: `cond` carrega `candidatos` além de
 * `candidatoId`. O `candidatoId` sozinho não resolve a posição no array
 * `votos` — sem a ordem de `candidatos` a regra "vencedor = argmax de
 * `votos` na ordem de `candidatos`" é inimplementável. Aceita
 * `Array<{id: string}>` para que o `candidatos` do fato passe direto.
 *
 * Regras:
 * - Vencedor da linha = argmax de `votos`; `null` nunca vence (vale
 *   -Infinity); empate = primeiro na ordem (determinístico).
 * - Linha com `demo: null` é excluída do perfil E do baseline; `nMun` e
 *   `nEleitores` contam só válidos ("excluída com contagem").
 * - Peso = `demo.eleitores` quando finito; fallback `total`, depois `pop`
 *   (v1 pode não ter `fato_eleitorado` → `eleitores` null), senão 0.
 *   O fallback NUNCA é silencioso: `pesoFonte` = "eleitores" quando TODA
 *   linha vencedora foi ponderada por `demo.eleitores`, "misto" se QUALQUER
 *   linha vencedora caiu no fallback (`total`/`pop`) — a Task 7 renderiza a
 *   nota honesta a partir daí.
 * - `nEleitores` = soma dos pesos EFETIVOS das linhas vencedoras válidas
 *   (eleitores quando há, fallback quando não) — não é contagem de
 *   eleitores censitários quando `pesoFonte` = "misto".
 * - Campos demo `null` dentro de demo não-nula são pulados por variável.
 * - Sem peso válido na variável → `NaN` (fail-closed: nunca zero
 *   silencioso). `candidatoId` desconhecido → perfil vazio, baseline
 *   nacional mantido.
 */

export type VarDemo =
  | "esc_sup"
  | "esc_med"
  | "esc_fund"
  | "renda_media"
  | "pobres_pct"
  | "idade_mediana"
  | "urbanizacao"
  | "pop"
  | "eleitores";

export const VAR_DEMO: readonly VarDemo[] = [
  "esc_sup",
  "esc_med",
  "esc_fund",
  "renda_media",
  "pobres_pct",
  "idade_mediana",
  "urbanizacao",
  "pop",
  "eleitores",
];

export interface FatoCandidato {
  id: string;
  nome: string;
  partido: string;
}

export interface MunRow {
  ibge: string;
  uf: string;
  nome: string;
  votos: (number | null)[];
  total: number | null;
  abst: number | null;
  demo: Record<VarDemo, number | null> | null;
}

export type PesoFonte = "eleitores" | "misto";

export interface PerfilResult {
  nMun: number;
  nEleitores: number;
  pesoFonte: PesoFonte;
  medias: Record<VarDemo, number>;
  vsBrasil: Record<VarDemo, number>;
}

/** Predicado numérico (fonte única, EVOLVE-13 — dedupe dos forks em
 *  Verificar/Curada/Explorar/PainelRegiao; mesmo contrato). */
export function finito(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** Índice do vencedor na ordem de `votos`; -1 quando indeterminável. */
export function indiceVencedor(votos: (number | null)[]): number {
  let best = -1;
  let bestV = -Infinity;
  for (let i = 0; i < votos.length; i++) {
    const v = votos[i];
    const n = finito(v) ? (v as number) : -Infinity;
    if (n > bestV) {
      bestV = n;
      best = i;
    }
  }
  return bestV === -Infinity ? -1 : best;
}

/** Origem do peso de uma linha na cadeia eleitores → total → pop. */
export type FontePesoLinha = "eleitores" | "total" | "pop" | "nenhuma";

export function fontePeso(row: MunRow): FontePesoLinha {
  if (row.demo && finito(row.demo.eleitores)) return "eleitores";
  if (finito(row.total)) return "total";
  if (row.demo && finito(row.demo.pop)) return "pop";
  return "nenhuma";
}

/** Peso eleitoral da linha p/ médias ponderadas (eleitores → total → pop). */
export function pesoEleitoral(row: MunRow): number {
  switch (fontePeso(row)) {
    case "eleitores":
      return row.demo!.eleitores as number;
    case "total":
      return row.total as number;
    case "pop":
      return row.demo!.pop as number;
    default:
      return 0;
  }
}

function mediaPonderada(
  rows: MunRow[],
  variavel: VarDemo,
): number {
  let soma = 0;
  let pesoTotal = 0;
  for (const row of rows) {
    if (!row.demo) continue;
    const v = row.demo[variavel];
    if (!finito(v)) continue;
    const w = pesoEleitoral(row);
    soma += (v as number) * w;
    pesoTotal += w;
  }
  return pesoTotal > 0 ? soma / pesoTotal : NaN;
}

function perfilVazio(): Record<VarDemo, number> {
  return Object.fromEntries(VAR_DEMO.map((v) => [v, NaN])) as Record<VarDemo, number>;
}

export function perfilOndeVenceu(
  rows: MunRow[],
  cond: { candidatoId: string; candidatos: { id: string }[] },
): PerfilResult {
  const lista = Array.isArray(rows) ? rows : [];
  const ordem = Array.isArray(cond?.candidatos) ? cond.candidatos : [];
  const alvo = ordem.findIndex((c) => c?.id === cond?.candidatoId);

  const validas = lista.filter((r) => r?.demo != null);
  const vencidas =
    alvo < 0 ? [] : validas.filter((r) => indiceVencedor(r.votos ?? []) === alvo);

  const medias =
    vencidas.length === 0
      ? perfilVazio()
      : (Object.fromEntries(
          VAR_DEMO.map((v) => [v, mediaPonderada(vencidas, v)]),
        ) as Record<VarDemo, number>);
  const vsBrasil =
    validas.length === 0
      ? perfilVazio()
      : (Object.fromEntries(
          VAR_DEMO.map((v) => [v, mediaPonderada(validas, v)]),
        ) as Record<VarDemo, number>);

  return {
    nMun: vencidas.length,
    nEleitores: vencidas.reduce((acc, r) => acc + pesoEleitoral(r), 0),
    pesoFonte: vencidas.every((r) => fontePeso(r) === "eleitores")
      ? "eleitores"
      : "misto",
    medias,
    vsBrasil,
  };
}

/** Piso amostral honesto (spec §4): abaixo de 30 municípios, suprime. */
export const PISO_CORRELACAO_N = 30;

export type MetodoCorrelacao = "pearson" | "spearman";

export interface CorrelacaoResult {
  r: number;
  n: number;
}

/** Pares válidos: trunca no menor comprimento, exclui não-finitos (null/NaN). */
function paresValidos(xs: number[], ys: number[]): [number, number][] {
  const n = Math.min(xs?.length ?? 0, ys?.length ?? 0);
  const pares: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const x = xs[i];
    const y = ys[i];
    if (finito(x) && finito(y)) pares.push([x as number, y as number]);
  }
  return pares;
}

function pearsonDePares(pares: [number, number][]): number {
  const n = pares.length;
  let sx = 0;
  let sy = 0;
  for (const [x, y] of pares) {
    sx += x;
    sy += y;
  }
  const mx = sx / n;
  const my = sy / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (const [x, y] of pares) {
    const dx = x - mx;
    const dy = y - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  return sxy / Math.sqrt(sxx * syy);
}

/** Ranks médios (empates dividem o rank médio). */
function ranksMedios(valores: number[]): number[] {
  const ordem = valores.map((_, i) => i).sort((a, b) => valores[a] - valores[b]);
  const ranks = new Array<number>(valores.length);
  let i = 0;
  while (i < ordem.length) {
    let j = i;
    while (j + 1 < ordem.length && valores[ordem[j + 1]] === valores[ordem[i]]) j++;
    const medio = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[ordem[k]] = medio;
    i = j + 1;
  }
  return ranks;
}

/**
 * Correlação honesta (spec §4): Pearson direto ou Spearman por ranks médios.
 * Pares com null/NaN são excluídos ANTES de contar `n`; `n < 30` → `null`
 * (supressão, nunca zero silencioso). Variância zero → `null` (indefinida).
 * Os dois `r` (pearson + spearman) devem ser reportados juntos no front —
 * divergência entre eles denuncia outlier / não-linearidade.
 */
export function correlacao(
  xs: number[],
  ys: number[],
  metodo: MetodoCorrelacao,
): CorrelacaoResult | null {
  const pares = paresValidos(xs, ys);
  if (pares.length < PISO_CORRELACAO_N) return null;
  const dados =
    metodo === "spearman"
      ? (() => {
          const rx = ranksMedios(pares.map(([x]) => x));
          const ry = ranksMedios(pares.map(([, y]) => y));
          return rx.map((x, i) => [x, ry[i]] as [number, number]);
        })()
      : pares;
  const r = pearsonDePares(dados);
  if (!finito(r)) return null;
  return { r, n: pares.length };
}

export interface Quintil {
  faixa: string;
  mediaY: number;
  n: number;
}

/**
 * Tabela por quintis (spec §4): ordena pares válidos por x, divide em 5
 * faixas contíguas tão iguais quanto possível (as primeiras absorvem o
 * resto) e reporta a média de y por faixa. `n` das faixas soma o total.
 *
 * Supressão aplicada UMA VEZ na fonte (decisão do controller): abaixo de
 * `PISO_CORRELACAO_N` pares válidos retorna `[]` — o mesmo sinal de
 * `correlacao() === null`. Suprimido ≡ sem dados p/ renderização.
 *
 * Contrato p/ Tasks 7–9: `quintis(...).length === 0` → o front renderiza a
 * nota de supressão ("municípios insuficientes"), NUNCA tabela vazia ou
 * zeros silenciosos. Consumidores NÃO rechecam o piso.
 */
export function quintis(xs: number[], ys: number[]): Quintil[] {
  const pares = paresValidos(xs, ys).sort((a, b) => a[0] - b[0]);
  if (pares.length < PISO_CORRELACAO_N) return [];
  const n = pares.length;
  const K = 5;
  const base = Math.floor(n / K);
  const resto = n % K;
  const faixas: Quintil[] = [];
  let ini = 0;
  for (let q = 0; q < K; q++) {
    // Com n >= piso (30), base >= 6: toda faixa é não-vazia.
    const tam = base + (q < resto ? 1 : 0);
    const fatia = pares.slice(ini, ini + tam);
    ini += tam;
    faixas.push({
      faixa: `Q${q + 1}`,
      mediaY: fatia.reduce((acc, [, y]) => acc + y, 0) / fatia.length,
      n: fatia.length,
    });
  }
  return faixas;
}

/**
 * Estratificação do "por quê?" (spec §4, Task 5): repete a correlação de
 * Pearson dentro de cada estrato. Piso `n >= 30` herdado de `correlacao()`
 * (estrato suprimido → `r: null`, nunca zero silencioso).
 *
 * Desvio documentado do brief: `varY = {candidatoId}` aceita `candidatos?:
 * {id}[]` opcional — mesma razão da Task 3 (`votos` é posicional; sem a
 * ordem id→índice é irresolvível). Sem `candidatos` ou com id desconhecido,
 * Y é indefinido em toda linha → estratos com `n: 0, r: null` (fail-closed).
 *
 * Semântica de Y candidato: share = `votos[idx] / soma(votos finitos)` da
 * linha; linha sem votos finitos ou soma ≤ 0 tem Y indefinido (excluída dos
 * pares, mas segue contando p/ pertencimento ao estrato). `n` = nº de pares
 * válidos do estrato (mesmo filtro de `correlacao()`, por construção).
 *
 * Estratos:
 * - `regiao`: prefixo UF → N/NE/CO/SE/S (mapa abaixo); UF desconhecida é
 *   excluída (sem estrato inventado p/ dado sujo). Ordem fixa
 *   N, NE, CO, SE, S, só regiões presentes.
 * - `faixa_renda`: tercis de `renda_media` (ordenação estável por
 *   renda, desempate por ibge; primeiros absorvem o resto, como `quintis`),
 *   rótulos `baixa/media/alta`. Linha sem `renda_media` finita é excluída.
 */

export type EstratoPor = "regiao" | "faixa_renda";

export interface Estrato {
  estrato: string;
  r: number | null;
  n: number;
}

const UF_REGIAO: Record<string, string> = {
  AC: "N",
  AP: "N",
  AM: "N",
  PA: "N",
  RO: "N",
  RR: "N",
  TO: "N",
  AL: "NE",
  BA: "NE",
  CE: "NE",
  MA: "NE",
  PB: "NE",
  PE: "NE",
  PI: "NE",
  RN: "NE",
  SE: "NE",
  DF: "CO",
  GO: "CO",
  MT: "CO",
  MS: "CO",
  ES: "SE",
  MG: "SE",
  RJ: "SE",
  SP: "SE",
  PR: "S",
  RS: "S",
  SC: "S",
};

const ORDEM_REGIAO = ["N", "NE", "CO", "SE", "S"];

const FAIXAS_RENDA = ["baixa", "media", "alta"];

/** Total de votos da linha: `total` finito vence; senão soma dos votos
 *  finitos; 0 sem nenhum finito. Mesma cadeia do painel da região e do
 *  `/explorar` (fonte única contra deriva de fórmula). */
export function totalLinha(row: MunRow): number {
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

/** Região da UF (`null` quando UF desconhecida — linha excluída). */
export function regiaoDeUF(uf: unknown): string | null {
  if (typeof uf !== "string") return null;
  return UF_REGIAO[uf.trim().toUpperCase()] ?? null;
}

/** Share do candidato na linha; `null` quando indefinido (alvo não-finito,
 *  sem votos finitos ou soma ≤ 0). Centraliza a fórmula usada por
 *  `estratificar()` e pelo `/explorar` (sem duplicatas que derivem). */
export function shareCandidato(row: MunRow, indice: number): number | null {
  const votos = row?.votos ?? [];
  const alvo = votos[indice];
  if (!finito(alvo)) return null;
  let soma = 0;
  let algum = false;
  for (const v of votos) {
    if (finito(v)) {
      soma += v as number;
      algum = true;
    }
  }
  if (!algum || soma <= 0) return null;
  return (alvo as number) / soma;
}

export function estratificar(
  rows: MunRow[],
  varX: VarDemo,
  varY: VarDemo | { candidatoId: string; candidatos?: { id: string }[] },
  por: EstratoPor,
): Estrato[] {
  const lista = Array.isArray(rows) ? rows : [];

  let yDe: ((row: MunRow) => number | null) | null = null;
  if (typeof varY === "string") {
    yDe = (row) => (row?.demo ? row.demo[varY] : null);
  } else if (varY && typeof (varY as { candidatoId?: unknown }).candidatoId === "string") {
    const cond = varY as { candidatoId: string; candidatos?: { id: string }[] };
    const ordem = Array.isArray(cond.candidatos) ? cond.candidatos : [];
    const indice = ordem.findIndex((c) => c?.id === cond.candidatoId);
    yDe = indice < 0 ? null : (row) => shareCandidato(row, indice);
  }

  const grupos = new Map<string, MunRow[]>();
  if (por === "regiao") {
    for (const regiao of ORDEM_REGIAO) grupos.set(regiao, []);
    for (const row of lista) {
      const regiao = regiaoDeUF(row?.uf);
      if (regiao === null) continue;
      grupos.get(regiao)!.push(row);
    }
    for (const [chave, membros] of [...grupos]) {
      if (membros.length === 0) grupos.delete(chave);
    }
  } else {
    const comRenda = lista.filter((r) => r?.demo && finito(r.demo.renda_media));
    const ordenadas = [...comRenda].sort((a, b) => {
      const d = (a.demo!.renda_media as number) - (b.demo!.renda_media as number);
      return d !== 0 ? d : String(a.ibge ?? "").localeCompare(String(b.ibge ?? ""));
    });
    const K = 3;
    const base = Math.floor(ordenadas.length / K);
    const resto = ordenadas.length % K;
    let ini = 0;
    for (let t = 0; t < K; t++) {
      const tam = base + (t < resto ? 1 : 0);
      const fatia = ordenadas.slice(ini, ini + tam);
      ini += tam;
      if (fatia.length > 0) grupos.set(FAIXAS_RENDA[t], fatia);
    }
  }

  const saida: Estrato[] = [];
  for (const [estrato, membros] of grupos) {
    const xs = membros.map((r) => (r?.demo ? r.demo[varX] : null) as unknown as number);
    const ys = yDe ? membros.map((r) => yDe!(r) as unknown as number) : membros.map(() => NaN);
    const pares = paresValidos(xs, ys);
    const c = correlacao(xs, ys, "pearson");
    saida.push({ estrato, r: c ? c.r : null, n: pares.length });
  }
  return saida;
}

/**
 * Veredito em linguagem leiga sobre a estratificação (spec §4: "por quê?" =
 * estratificação; o veredito é sustentado/misto/não sustentado — NUNCA
 * causal; correlação não implica causa).
 *
 * Regra exata (brief Task 5):
 * - elegíveis = estratos com `n >= 30`; fortes = elegíveis com `|r| >= 0,3`;
 * - fortes com ambos os sinais → "misto" (evidência contraditória);
 * - fortes de um só sinal em MAIORIA estrita dos elegíveis → "sustentado",
 *   salvo global forte (`|global| >= 0,3`) de sinal oposto → "misto";
 * - resto (sem fortes, ou fortes em minoria) → "nao_sustentado".
 */
export const LIMIAR_EFEITO_R = 0.3;

export type ConclusaoLeiga = "sustentado" | "misto" | "nao_sustentado";

export function conclusaoLeiga(
  global: number | null,
  estratos: Estrato[],
): ConclusaoLeiga {
  const lista = Array.isArray(estratos) ? estratos : [];
  const elegiveis = lista.filter((e) => e && (e.n ?? 0) >= PISO_CORRELACAO_N);
  const fortes = elegiveis.filter(
    (e) => finito(e.r) && Math.abs(e.r as number) >= LIMIAR_EFEITO_R,
  );
  const positivos = fortes.filter((e) => (e.r as number) > 0).length;
  const negativos = fortes.filter((e) => (e.r as number) < 0).length;
  if (positivos > 0 && negativos > 0) return "misto";
  if (fortes.length > 0 && fortes.length > elegiveis.length / 2) {
    if (
      finito(global) &&
      Math.abs(global as number) >= LIMIAR_EFEITO_R &&
      Math.sign(global as number) !== Math.sign(fortes[0].r as number)
    ) {
      return "misto";
    }
    return "sustentado";
  }
  return "nao_sustentado";
}
