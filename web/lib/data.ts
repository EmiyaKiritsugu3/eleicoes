/** Regras de auditoria visível (ledger rulings a/b/c — Task 5, reusado pela Task 6).
 *
 * - Formatação pt-BR de votos: 1234567 -> "1.234.567".
 * - `isAudited(obj)`: true somente se houver hash não-vazio (`sha256` ou `hash`).
 * - `isOfficialDisplay(obj)`: `isAudited` E não-fixture (`fixture:true` tem hash
 *   para transparência, mas nunca usa o selo oficial — ver /auditoria).
 * - Sem manifest / manifest inválido -> a página mostra banner "dado não auditado"
 *   e nunca apresenta números como oficiais.
 * - Tabelas/JSONs vazios -> a página mostra "sem dado oficial".
 */

/** Decisão travada (F1+F2): busca por candidato é GLOBAL no V1 — o agregado
 *  por UF não tem recorte por candidato e o agregado por candidato não tem
 *  colunas ano/cargo/UF. As seções de / exibem estas notas com role="note"
 *  quando os filtros se misturam (padrão reusado de NOTA_PARTIDO em
 *  /analisar). Vive em lib (não em app/page.tsx) porque o Next só aceita
 *  exports próprios de Page em arquivos de rota.
 */
export const NOTA_CANDIDATO_GLOBAL =
  "Busca por candidato é global no V1: totais por UF/ano ignoram o nome buscado (agregado sem recorte por candidato).";
export const NOTA_RANKING_SEM_COBERTURA =
  "nota: filtros ano/cargo/UF sem cobertura no agregado por candidato (V1) — números desta seção ignoram ano/cargo/UF";

export interface Filtros {
  ano?: string;
  cargo?: string;
  uf?: string;
  municipio?: string;
  candidato?: string;
}

export interface ResumoJson {
  total_votos: number;
  total_linhas: number;
  anos: number[];
  tabelas: string[];
}

export interface PorUfRow {
  ano: number;
  cargo: string;
  uf: string;
  votos: number;
}

export interface PorCandidatoRow {
  candidato_id: string;
  nome_urna: string;
  partido: string;
  votos: number;
}

export interface ManifestIngestion {
  source_url?: string;
  sha256?: string;
  hash?: string;
  date?: string;
  data?: string;
  [key: string]: unknown;
}

export interface Manifest {
  ingestions?: ManifestIngestion[];
  [key: string]: unknown;
}

export interface AuditInfo {
  hash: string;
  url: string;
  date: string;
}

/** 1234567 -> "1.234.567" (pt-BR, sem Intl para manter o bundle leve). */
export function formatVotes(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const neg = n < 0 ? "-" : "";
  return neg + Math.trunc(Math.abs(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/** false quando o objeto não carrega hash (`sha256` ou `hash`). */
export function isAudited(obj: unknown): boolean {
  if (!obj || typeof obj !== "object") return false;
  const o = obj as Record<string, unknown>;
  const hash = o.sha256 ?? o.hash;
  return typeof hash === "string" && hash.length > 0;
}

/** true quando a entrada é amostra sintética (seed de CI/dev): tem hash
 *  para transparência, mas NUNCA é exibida como oficial. */
export function isFixtureEntry(obj: unknown): boolean {
  if (!obj || typeof obj !== "object") return false;
  return (obj as Record<string, unknown>).fixture === true;
}

/** Exibição como oficial: hash válido E não-fixture. */
export function isOfficialDisplay(obj: unknown): boolean {
  return isAudited(obj) && !isFixtureEntry(obj);
}

/** Extrai a primeira ingestão auditada do manifest, ou null (dado não auditado). */
export function getAuditInfo(manifest: unknown): AuditInfo | null {
  if (!manifest || typeof manifest !== "object") return null;
  const ingestions = (manifest as Manifest).ingestions;
  if (!Array.isArray(ingestions)) return null;
  for (const entry of ingestions) {
    if (isAudited(entry)) {
      const e = entry as ManifestIngestion;
      return {
        hash: String(e.sha256 ?? e.hash),
        url: typeof e.source_url === "string" ? e.source_url : "",
        date: typeof e.date === "string" ? e.date : typeof e.data === "string" ? e.data : "",
      };
    }
  }
  return null;
}

/** Primeira ingestão exibível como OFICIAL (audited + não-fixture), ou null.
 *  Usado pela /auditoria (e, via `getSealState`, por / e /analisar): fixture
 *  tem hash mas nunca usa o selo oficial.
 */
export function getOfficialAuditInfo(manifest: unknown): AuditInfo | null {
  if (!manifest || typeof manifest !== "object") return null;
  const ingestions = (manifest as Manifest).ingestions;
  if (!Array.isArray(ingestions)) return null;
  for (const entry of ingestions) {
    if (isOfficialDisplay(entry)) {
      const e = entry as ManifestIngestion;
      return {
        hash: String(e.sha256 ?? e.hash),
        url: typeof e.source_url === "string" ? e.source_url : "",
        date: typeof e.date === "string" ? e.date : typeof e.data === "string" ? e.data : "",
      };
    }
  }
  return null;
}

export interface SealState {
  official: AuditInfo | null;
  hasFixture: boolean;
  fixtureHash: string;
}

/** Estado único do selo p/ /, /analisar e /auditoria, derivado do manifest.
 *  Selo oficial só via `getOfficialAuditInfo`; fixture (`fixture:true`) nunca
 *  é oficial — o hash cheio da primeira fixture auditada é preservado em
 *  `fixtureHash` para transparência (exibido fora do selo oficial).
 */
export function getSealState(manifest: unknown): SealState {
  const official = getOfficialAuditInfo(manifest);
  let hasFixture = false;
  let fixtureHash = "";
  const raw = manifest as Manifest | null;
  const ingestions = raw && Array.isArray(raw.ingestions) ? raw.ingestions : [];
  for (const entry of ingestions) {
    if (isFixtureEntry(entry)) {
      hasFixture = true;
      if (!fixtureHash && isAudited(entry)) {
        const e = entry as ManifestIngestion;
        const h = e.sha256 ?? e.hash;
        if (typeof h === "string" && h.length > 0) fixtureHash = h;
      }
    }
  }
  return { official, hasFixture, fixtureHash };
}

function matchAno(rowAno: number, filtro: string): boolean {
  return String(rowAno) === filtro.trim();
}

function matchTexto(valor: unknown, filtro: string): boolean {
  return String(valor ?? "").toLowerCase().includes(filtro.trim().toLowerCase());
}

/** Total de votos em `por_uf` respeitando ano/cargo/UF.
 *  `municipio`/`candidato` não existem no agregado por UF (V1) e são ignorados
 *  aqui — o filtro de candidato aplica-se ao ranking via `filtrarCandidatos`.
 *  Decisão travada (F1+F2): busca por candidato é GLOBAL no V1; quando
 *  `filtros.candidato` está ativo, a página exibe `NOTA_CANDIDATO_GLOBAL`
 *  (role="note") nas seções Resumo/UF. Comportamento inalterado.
 */
export function getResumo(
  porUf: PorUfRow[],
  filtros: Filtros,
): { totalVotos: number; vazio: boolean } {
  const rows = (Array.isArray(porUf) ? porUf : []).filter(
    (r) =>
      (!filtros.ano || matchAno(r.ano, filtros.ano)) &&
      (!filtros.cargo || matchTexto(r.cargo, filtros.cargo)) &&
      (!filtros.uf || matchTexto(r.uf, filtros.uf)),
  );
  return { totalVotos: rows.reduce((acc, r) => acc + (Number(r.votos) || 0), 0), vazio: rows.length === 0 };
}

/** Ranking de UFs (base da seção "mapa" v1: lista ordenada + tabela acessível).
 *  `candidato` não existe no agregado por UF (V1) e é ignorado aqui — com
 *  `filtros.candidato` ativo, a seção exibe `NOTA_CANDIDATO_GLOBAL`
 *  (role="note"). Comportamento inalterado.
 */
export function rankingUf(
  porUf: PorUfRow[],
  filtros: Filtros,
): { uf: string; votos: number }[] {
  const acc = new Map<string, number>();
  for (const r of Array.isArray(porUf) ? porUf : []) {
    if (filtros.ano && !matchAno(r.ano, filtros.ano)) continue;
    if (filtros.cargo && !matchTexto(r.cargo, filtros.cargo)) continue;
    if (filtros.uf && !matchTexto(r.uf, filtros.uf)) continue;
    acc.set(r.uf, (acc.get(r.uf) ?? 0) + (Number(r.votos) || 0));
  }
  return [...acc.entries()]
    .map(([uf, votos]) => ({ uf, votos }))
    .sort((a, b) => b.votos - a.votos);
}

/** Evolução anual dos votos (base do gráfico de evolução + tabela acessível). */
export function evolucaoAnual(
  porUf: PorUfRow[],
  filtros: Filtros,
): { ano: number; votos: number }[] {
  const acc = new Map<number, number>();
  for (const r of Array.isArray(porUf) ? porUf : []) {
    if (filtros.cargo && !matchTexto(r.cargo, filtros.cargo)) continue;
    if (filtros.uf && !matchTexto(r.uf, filtros.uf)) continue;
    acc.set(r.ano, (acc.get(r.ano) ?? 0) + (Number(r.votos) || 0));
  }
  return [...acc.entries()]
    .map(([ano, votos]) => ({ ano, votos }))
    .sort((a, b) => a.ano - b.ano);
}

/** Ranking de candidatos com busca por nome/partido.
 *  O agregado por candidato (V1) não tem colunas ano/cargo/UF: esses filtros
 *  são ignorados aqui — quando combinados com `filtros.candidato`, a seção
 *  Ranking exibe `NOTA_RANKING_SEM_COBERTURA` (role="note"). Comportamento
 *  inalterado.
 */
export function filtrarCandidatos(
  rows: PorCandidatoRow[],
  filtros: Filtros,
): PorCandidatoRow[] {
  const q = (filtros.candidato ?? "").trim().toLowerCase();
  const out = (Array.isArray(rows) ? rows : []).filter(
    (r) =>
      !q ||
      String(r.nome_urna ?? "").toLowerCase().includes(q) ||
      String(r.partido ?? "").toLowerCase().includes(q),
  );
  return [...out].sort((a, b) => (Number(b.votos) || 0) - (Number(a.votos) || 0));
}
