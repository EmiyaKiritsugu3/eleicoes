/** Export reproduzível da Task 6 (`/analisar`).
 *
 * - `buildShareUrl`: URL compartilhável `?ano=&cargo=&uf=&hash=` que carrega
 *   o hash do manifest (Task 7 lista na auditoria).
 * - `emptyStateFor`: estado vazio fail-closed — zero linhas nunca é zero
 *   silencioso, sempre "sem dado oficial".
 * - `buildCsvExport`: CSV com header de proveniência `fonte,url,hash,data`
 *   (colunas de dados primeiro, proveniência por último).
 */

export type FiltrosPartilhaveis = Record<string, string | number | undefined | null>;

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
  if (typeof manifestHash === "string" && manifestHash.length > 0) {
    params.set("hash", manifestHash);
  }
  const qs = params.toString();
  return qs ? `/analisar?${qs}` : "/analisar";
}

/** Zero linhas -> "sem dado oficial" (nunca tela branca / zero silencioso). */
export function emptyStateFor(rows: unknown): string {
  if (!Array.isArray(rows) || rows.length === 0) return "sem dado oficial";
  return "";
}

/** Agregado V1 não tem turno/zona: filtro ativo => zero linhas honestas.
 *  Retorna true quando há filtro turno/zona mas nenhuma linha carrega a coluna.
 */
export function semCoberturaTurnoZona(
  porUf: unknown[],
  porCand: unknown[],
  f: { turno?: string; zona?: string },
): boolean {
  const querTurno = (f.turno ?? "").trim() !== "";
  const querZona = (f.zona ?? "").trim() !== "";
  if (!querTurno && !querZona) return false;
  const temColuna = [...(porUf ?? []), ...(porCand ?? [])].some((r) => {
    const rec = (r ?? {}) as Record<string, unknown>;
    return rec.turno !== undefined || rec.zona !== undefined;
  });
  return !temColuna;
}

function csvEscape(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV das linhas filtradas + colunas de proveniência.
 *  Header contém `fonte,url,hash,data` (exato quando não há colunas de dado).
 */
export function buildCsvExport(
  rows: Record<string, unknown>[],
  audit: AuditoriaCsv | null,
): string {
  const data = Array.isArray(rows) ? rows : [];
  const dataKeys: string[] = [];
  for (const r of data) {
    if (!r || typeof r !== "object") continue;
    for (const k of Object.keys(r)) {
      if (!dataKeys.includes(k)) dataKeys.push(k);
    }
  }
  const header = [...dataKeys, "fonte", "url", "hash", "data"].join(",");
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
