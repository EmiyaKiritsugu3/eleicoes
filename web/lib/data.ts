/** Regras de auditoria visível (ledger rulings a/b/c — Task 5, reusado pela Task 6).
 *
 * - Formatação pt-BR de votos: 1234567 -> "1.234.567".
 * - `isAudited(obj)`: true somente se houver `sha256` 64-hex
 *   (sem alias `hash`), espelhando o que o ETL exige na escrita
 *   (`etl/manifest.py:_validate_entry` — 64-hex, maiúsculas aceitas).
 *   Qualquer outra coisa (ex. `"abc123"`, só-`hash`) nega o selo (fail-closed).
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
  date?: string;
  data?: string;
  [key: string]: unknown;
}

/** Hash de um arquivo servido (EVOLVE-2 Task 1): `arquivo` é o nome sob
 *  `/data/`, `sha256`/`size_bytes` medidos dos bytes servidos
 *  (`register_served_artifacts`). Estende sem quebrar: `ingestions`
 *  segue o contrato; `artifacts` é opcional (legado só-ingestions). */
export interface ManifestArtifact {
  source_url?: string;
  sha256?: string;
  arquivo?: string;
  size_bytes?: number;
  date?: string;
  data?: string;
  [key: string]: unknown;
}

export interface Manifest {
  ingestions?: ManifestIngestion[];
  artifacts?: ManifestArtifact[];
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

/** false quando o objeto não carrega `sha256` 64-hex.
 *  Espelho exato do ETL (`etl/manifest.py:_validate_entry`: fullmatch
 *  64-hex após lower — maiúsculas aceitas aqui também, sem trim, como lá).
 *  O alias `hash` NÃO audita: nenhum produtor (build_fato, build_marts,
 *  censo, seed) escreve a chave `hash` — ingestão só-`hash` é rejeitada
 *  pelo ETL na escrita e nunca recebe selo aqui (fail-closed).
 *  Hash curto, só-espaços ou com caractere fora de [0-9a-fA-F] não
 *  audita (F5). */
export function isAudited(obj: unknown): boolean {
  if (!obj || typeof obj !== "object") return false;
  const o = obj as Record<string, unknown>;
  const h = o.sha256;
  return typeof h === "string" && /^[0-9a-fA-F]{64}$/.test(h);
}

/** URL segura p/ links de fonte (M10): só `http(s)`; qualquer outro
 *  esquema (`javascript:`, `data:`, relativo, vazio) vira `""` e o
 *  link nem é renderizado. */
export function safeUrl(url: unknown): string {
  if (typeof url !== "string") return "";
  const t = url.trim();
  return /^https?:\/\//i.test(t) ? t : "";
}

/** true quando a entrada é amostra sintética (seed de CI/dev): tem hash
 *  para transparência, mas NUNCA é exibida como oficial. */
export function isFixtureEntry(obj: unknown): boolean {
  if (!obj || typeof obj !== "object") return false;
  return (obj as Record<string, unknown>).fixture === true;
}

export function fontesDaEntrada(e: ManifestIngestion): string[] {
  const raw = (e as Record<string, unknown>).fontes;
  if (Array.isArray(raw)) {
    const urls = raw.map(safeUrl).filter((u) => u !== "");
    if (urls.length > 0) return urls;
  }
  const url = safeUrl(typeof e.source_url === "string" ? e.source_url : "");
  return url ? [url] : [];
}

/** Data da ingestão p/ a tabela da /auditoria: só ISO (AAAA-MM-DD ou
 *  datetime ISO); raw fora do formato cai p/ "" (fail-closed: a célula
 *  mostra SEM_DADO). Extraída p/ cá p/ ser testável (page não exporta). */
export function entryDate(e: ManifestIngestion): string {
  const raw =
    (typeof e.date === "string" && e.date.trim()) ||
    (typeof e.data === "string" && e.data.trim()) ||
    "";
  if (!raw) return "";
  if (!/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/.test(raw)) return "";
  return Number.isNaN(Date.parse(raw)) ? "" : raw;
}

/** Exibição como oficial: hash válido E não-fixture. */
export function isOfficialDisplay(obj: unknown): boolean {
  return isAudited(obj) && !isFixtureEntry(obj);
}

/** Artifacts com prova de bytes (EVOLVE-2 Task 1): só entries dict com
 *  `arquivo` e hash não-vazios, na ordem do manifest. Legado
 *  só-ingestions (sem chave) devolve [] — a página mostra nota honesta. */
export function getArtifacts(manifest: unknown): ManifestArtifact[] {
  if (!manifest || typeof manifest !== "object") return [];
  const raw = (manifest as Manifest).artifacts;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (e): e is ManifestArtifact =>
      !!e &&
      typeof e === "object" &&
      typeof (e as ManifestArtifact).arquivo === "string" &&
      ((e as ManifestArtifact).arquivo as string).length > 0 &&
      isAudited(e),
  );
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
        hash: String(e.sha256),
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
        fixtureHash = String((entry as ManifestIngestion).sha256);
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

/** `votos` utilizável em somas (M12-finito): número finito ou string
 *  numérica não-vazia. `null`/`undefined`/`""`/boolean/`NaN`/`Infinity`
 *  não sustentam seção — a linha é pulada, nunca somada como zero
 *  (`Number(null)` seria 0 finito e mascararia a linha corrupta).
 */
function votosFinito(v: unknown): boolean {
  if (typeof v === "number") return Number.isFinite(v);
  if (typeof v === "string" && v.trim() !== "") {
    return Number.isFinite(Number(v));
  }
  return false;
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
      votosFinito(r.votos) &&
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
    if (!votosFinito(r.votos)) continue;
    const v = Number(r.votos);
    acc.set(r.uf, (acc.get(r.uf) ?? 0) + v);
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
    if (filtros.ano && !matchAno(r.ano, filtros.ano)) continue;
    if (filtros.cargo && !matchTexto(r.cargo, filtros.cargo)) continue;
    if (filtros.uf && !matchTexto(r.uf, filtros.uf)) continue;
    if (!votosFinito(r.votos)) continue;
    const v = Number(r.votos);
    acc.set(r.ano, (acc.get(r.ano) ?? 0) + v);
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
      votosFinito(r.votos) &&
      (!q ||
        String(r.nome_urna ?? "").toLowerCase().includes(q) ||
        String(r.partido ?? "").toLowerCase().includes(q)),
  );
  return [...out].sort((a, b) => Number(b.votos) - Number(a.votos));
}

/** Lados do comparador lado-a-lado de /analisar (F4).
 *  Resolve ids de candidato a partir de `cands` (já filtrado por
 *  partido/busca) — nunca do agregado cheio — e retorna null nos dois
 *  lados sob `semCob` (filtro turno/zona sem cobertura no agregado V1,
 *  já sinalizado pela nota existente). Modo `municipios` não tem
 *  cobertura no V1 e sempre resolve null.
 */
export interface LadoComparador {
  titulo: string;
  votos: number;
  detalhe?: string;
}

export function resolverComparador(args: {
  compMode: "candidatos" | "anos" | "municipios";
  compA: string;
  compB: string;
  ev: { ano: number; votos: number }[];
  cands: PorCandidatoRow[];
  semCob: boolean;
}): { left: LadoComparador | null; right: LadoComparador | null } {
  if (args.semCob) return { left: null, right: null };
  if (args.compMode === "anos") {
    const byAno = new Map(args.ev.map((r) => [String(r.ano), r.votos]));
    const mk = (k: string): LadoComparador | null => {
      if (!k || !byAno.has(k)) return null;
      return { titulo: k, votos: byAno.get(k) ?? 0, detalhe: "ano" };
    };
    return { left: mk(args.compA), right: mk(args.compB) };
  }
  if (args.compMode === "municipios") return { left: null, right: null };
  const byId = new Map(args.cands.map((r) => [r.candidato_id, r]));
  const mk = (k: string): LadoComparador | null => {
    const r = k ? byId.get(k) : undefined;
    if (!r) return null;
    return {
      titulo: String(r.nome_urna ?? k),
      votos: Number(r.votos) || 0,
      detalhe: String(r.partido ?? ""),
    };
  };
  return { left: mk(args.compA), right: mk(args.compB) };
}
