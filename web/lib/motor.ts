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

function finito(v: unknown): v is number {
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
