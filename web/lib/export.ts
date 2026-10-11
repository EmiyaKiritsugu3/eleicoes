/** Export reproduzível da Task 6 (`/analisar`).
 *
 * - `buildShareUrl`: URL compartilhável `?ano=&cargo=&uf=&hash=` que carrega
 *   o hash do manifest (Task 7 lista na auditoria).
 * - `emptyStateFor`: estado vazio fail-closed — zero linhas nunca é zero
 *   silencioso, sempre "sem dado oficial".
 * - `buildCsvExport`: CSV com header de proveniência `fonte,url,hash,data`
 *   (colunas de dados primeiro, proveniência por último).
 */

import { SEM_DADO } from "./textos";

export type FiltrosPartilhaveis = Record<string, string | number | undefined | null>;

/** Chaves que `/analisar` hidrata da query (M13): qualquer outra chave
 *  (ex. `?modoX=1`) é ignorada na hidratação em vez de vazar p/ estado. */
export const ANALISAR_QUERY_ALLOWLIST = [
  "ano",
  "cargo",
  "uf",
  "turno",
  "zona",
  "partido",
  "candidato",
  "pivo",
  "modo",
  "a",
  "b",
  "hash",
] as const;

/** Extrai só as chaves do allowlist da query (valores vazios omitidos).
 *  Usada pelo `useEffect` de `/analisar`; desconhecidas nunca viram estado. */
export function parseAnalisarSearchParams(search: string): Record<string, string> {
  const out: Record<string, string> = {};
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(search ?? "");
  } catch {
    return out;
  }
  for (const k of ANALISAR_QUERY_ALLOWLIST) {
    const v = params.get(k);
    if (v !== null && v.trim() !== "") out[k] = v;
  }
  return out;
}

export interface AuditoriaCsv {
  hash: string;
  url: string;
  date: string;
}

/** Monta `/analisar?ano=&cargo=&uf=&hash=`; filtros vazios são omitidos. */
export function buildShareUrl(
  filtros: FiltrosPartilhaveis,
  manifestHash: string,
): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(filtros ?? {})) {
    if (v === undefined || v === null) continue;
    const s = String(v).trim();
    if (s !== "") params.set(k, s);
  }
  if (typeof manifestHash === "string" && manifestHash.trim().length > 0) {
    params.set("hash", manifestHash.trim());
  }
  const qs = params.toString();
  return qs ? `/analisar?${qs}` : "/analisar";
}

/** Famílias de entrada da resposta (fonte única — Curada, Explorar e
 *  Verificar importam daqui; antes só a Curada definia e o CSV das demais
 *  atribuía tudo ao TSE — votos/eleitorado vêm do fato TSE, a demografia
 *  do Censo IBGE via `dim_municipio`; header fonte/url/hash/data segue do
 *  artefato auditado). */
export const ENTRADAS_CURADA = "votos TSE + demografia Censo IBGE (via fato auditado)";

/** Famílias de entrada do ranking por UF da Home (fonte única): só votos
 *  TSE do agregado por UF — sem demografia do Censo (o ranking não cruza
 *  com `demo`; `ENTRADAS_CURADA` aqui super-reivindicaria). */
export const ENTRADAS_HOME = "votos TSE (agregado por UF)";

/** Filtros que o CSV do `/analisar` carrega como contexto (`f_*`). */
export interface FiltrosCsvAnalisar {
  ano?: string;
  cargo?: string;
  uf?: string;
  turno?: string;
  zona?: string;
  partido?: string;
  candidato?: string;
}

/** Linhas do CSV do pivô do `/analisar` (fonte única — a página memoiza
 *  sobre ela; pura/testável). Sem as colunas nuas `ano/cargo/uf` (dedupe
 *  EVOLVE-12 — repetiam `f_ano/f_cargo/f_uf` com o mesmo valor; uma fonte
 *  por filtro). */
export function analisarCsvRows(
  pivoRows: { rotulo: string; votos: number }[],
  pivo: string,
  f: FiltrosCsvAnalisar,
): Record<string, unknown>[] {
  return (Array.isArray(pivoRows) ? pivoRows : []).map((r) => ({
    chave: r.rotulo,
    votos: r.votos,
    pivo,
    f_ano: f.ano ?? "",
    f_cargo: f.cargo ?? "",
    f_uf: f.uf ?? "",
    f_turno: f.turno ?? "",
    f_zona: f.zona ?? "",
    f_partido: f.partido ?? "",
    f_candidato: f.candidato ?? "",
  }));
}

/** Download client-side do CSV (fonte única — Analisar, Explorar e
 *  PainelRegiao importam daqui em vez de forkar; gate Sonar duplication).
 *  Só executa em handler de clique (DOM), nunca em SSR. A revogação do
 *  Blob URL é diferida (cubic P1: revogar logo após `click()` pode
 *  invalidar antes do navegador consumir o CSV). */
export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 100);
}

/** Zero linhas -> "sem dado oficial" (nunca tela branca / zero silencioso). */
export function emptyStateFor(rows: unknown): string {
  if (!Array.isArray(rows) || rows.length === 0) return SEM_DADO;
  return "";
}

/** Agregado V1 não tem turno/zona: filtro ativo sem a coluna => zero linhas honestas.
 *  Cobertura é por-chave (M9): cada filtro ativo exige a própria coluna —
 *  `turno` com coluna só-`zona` (ou vice-versa) continua sem cobertura.
 *  Retorna true quando há filtro turno/zona sem a coluna correspondente.
 */
export function semCoberturaTurnoZona(
  porUf: unknown[],
  porCand: unknown[],
  f: { turno?: string; zona?: string },
): boolean {
  const querTurno = (f.turno ?? "").trim() !== "";
  const querZona = (f.zona ?? "").trim() !== "";
  if (!querTurno && !querZona) return false;
  const rows = [...(porUf ?? []), ...(porCand ?? [])];
  const hasTurnoCol = rows.some(
    (r) => ((r ?? {}) as Record<string, unknown>).turno !== undefined,
  );
  const hasZonaCol = rows.some(
    (r) => ((r ?? {}) as Record<string, unknown>).zona !== undefined,
  );
  const coberto = (!querTurno || hasTurnoCol) && (!querZona || hasZonaCol);
  return !coberto;
}

function csvEscape(v: unknown): string {
  // Contrato blank-cell (deliberado): null/undefined viram célula vazia "" —
  // nunca os literais "null"/"undefined" (planilha lê como vazio honesto).
  const s0 = v === null || v === undefined ? "" : String(v);
  // Neutraliza fórmula de planilha (M12): apóstrofo ANTES do quote CSV,
  // senão `'"=a,b"'` quebra em dois campos — o correto é `"'=a,b"`.
  // Inclui tab/CR inicial (fórmula com prefixo `\t=`/`\r=` passaria pelo
  // teste só de `=+-@` e chegaria à planilha sem neutralização).
  const s = /^[=+\-@\t\r]/.test(s0) ? `'${s0}` : s0;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV das linhas filtradas + colunas de proveniência.
 *  Header contém `fonte,url,hash,data` (exato quando não há colunas de dado).
 *  Sem hash auditado, levanta em vez de gerar (M11): a UI já desabilita
 *  o botão, mas a lib não confia na UI.
 */
export function buildCsvExport(
  rows: Record<string, unknown>[],
  audit: AuditoriaCsv | null,
): string {
  if (!audit?.hash?.trim()) throw new Error("export bloqueado: dado não auditado");
  const data = Array.isArray(rows) ? rows : [];
  const dataKeys: string[] = [];
  for (const r of data) {
    if (!r || typeof r !== "object") continue;
    for (const k of Object.keys(r)) {
      if (!dataKeys.includes(k)) dataKeys.push(k);
    }
  }
  const header = [...dataKeys.map(csvEscape), "fonte", "url", "hash", "data"].join(",");
  const fonte = "tse";
  const url = audit?.url ?? "";
  const hash = audit?.hash ?? "";
  const dataStr = audit?.date ?? "";
  const lines = data.map((r) =>
    [
      ...dataKeys.map((k) => csvEscape(r?.[k])),
      csvEscape(fonte),
      csvEscape(url),
      csvEscape(hash),
      csvEscape(dataStr),
    ].join(","),
  );
  return [header, ...lines].join("\n");
}
