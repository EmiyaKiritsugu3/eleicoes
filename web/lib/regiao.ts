/** Seleção do fato municipal da /regiao (Task 7).
 *
 * Vive em lib (não em `app/regiao/[ibge]/page.tsx`) porque o Next só
 * aceita exports próprios de Page em arquivos de rota — mesmo padrão
 * de `NOTA_CANDIDATO_GLOBAL` em `lib/data.ts`.
 */

import { getArtifacts, isAudited, isFixtureEntry, type ManifestArtifact, type SealState } from "./data";

export interface ManifestFato {
  tipo?: string;
  dataset?: string;
  sha256?: string;
  source_url?: string;
  date?: string;
  data?: string;
  fixture?: boolean;
}

/** Allowlist de datasets de fato municipal (`etl/build_fato.py` escreve
 *  `fato_<ano>_<turno>_<cargo_slug>`). Rejeita traversal (`fato_../…`) e
 *  qualquer nome fora do shape — a rota monta `/data/${dataset}.json`.
 */
export function isFatoDataset(s: unknown): boolean {
  return typeof s === "string" && /^fato_\d+_\d+_[a-z0-9_]+$/.test(s);
}

function ingestoesFato(manifest: unknown): ManifestFato[] {
  const ing = (manifest as { ingestions?: ManifestFato[] } | null)?.ingestions;
  return Array.isArray(ing) ? ing : [];
}

function defaultFatoDataset(manifest: unknown): string | null {
  const entry = ingestoesFato(manifest).find(
    (e) => e?.tipo === "fato_municipal" && isFatoDataset(e?.dataset),
  );
  return entry?.dataset ?? null;
}

/** Dataset do fato: `?fato=` válido vence; override inválido é rejeitado
 *  → default do manifest (fail-closed: nunca monta fetch com string
 *  arbitrária); sem manifest → null ("sem dado oficial", nunca vazio).
 */
export function fatoDatasetDe(manifest: unknown, override?: string): string | null {
  const over = (override ?? "").trim();
  if (over !== "" && isFatoDataset(over)) return over;
  return defaultFatoDataset(manifest);
}

/** Registro auditado do dataset selecionado: ingestão `fato_municipal`
 *  com este `dataset`, hash válido e não-fixture (mesma semântica de
 *  `isAudited`/`isOfficialDisplay` de `lib/data.ts`). Qualquer outra
 *  coisa (fixture, sem hash, outro dataset) → null: o fato selecionado
 *  não sustenta veredito nem selo oficial.
 */
export function entradaFatoAuditada(
  manifest: unknown,
  dataset: string | null,
): ManifestFato | null {
  if (typeof dataset !== "string" || dataset === "") return null;
  const entry = ingestoesFato(manifest).find(
    (e) => e?.tipo === "fato_municipal" && e?.dataset === dataset,
  );
  if (!entry || !isAudited(entry) || isFixtureEntry(entry)) return null;
  return entry;
}

/** Selo ligado ao dataset selecionado (nunca à primeira ingestão do
 *  manifest): oficial só via `entradaFatoAuditada`; fixture do dataset
 *  sinaliza fixture sem selo oficial; sem registro → selo vazio
 *  (fail-closed: a página exibe "dado não auditado", nunca hash alheio).
 */
export function getSealParaDataset(manifest: unknown, dataset: string | null): SealState {
  const vazio: SealState = { official: null, hasFixture: false, fixtureHash: "" };
  if (typeof dataset !== "string" || dataset === "") return vazio;
  const auditada = entradaFatoAuditada(manifest, dataset);
  if (auditada) {
    return {
      official: {
        hash: String(auditada.sha256),
        url: typeof auditada.source_url === "string" ? auditada.source_url : "",
        date:
          typeof auditada.date === "string"
            ? auditada.date
            : typeof auditada.data === "string"
              ? auditada.data
              : "",
      },
      hasFixture: false,
      fixtureHash: "",
    };
  }
  const fixture = ingestoesFato(manifest).find(
    (e) => e?.tipo === "fato_municipal" && e?.dataset === dataset && isFixtureEntry(e),
  );
  if (fixture) {
    return {
      official: null,
      hasFixture: true,
      fixtureHash: isAudited(fixture) ? String(fixture.sha256) : "",
    };
  }
  return vazio;
}

/** Há prova para veredito com este selo: hash oficial 64-hex ou hash
 *  de fixture 64-hex (transparência, sem selo oficial) — fonte única da
 *  verdade do gate de hash de Verificar/Explorar/Curada, delegando a
 *  `isAudited` de `lib/data.ts` (mesmo 64-hex que o ETL exige na escrita).
 *  Selo hand-built com hash fora do formato (ex. `"abc"`, vazio ou
 *  só-espaços) nega prova (fail-closed). Selos legítimos passam
 *  inalterados: os produtores (`getSealState`/`getSealParaDataset`) só
 *  armazenam hashes já auditados. Sem nenhum dos dois, nenhum fato
 *  alimenta veredito.
 */
export function vereditoTemProva(seal: SealState): boolean {
  if (seal.official !== null && isAudited({ sha256: seal.official.hash })) return true;
  return seal.hasFixture && isAudited({ sha256: seal.fixtureHash });
}

/** Arquivo servido do Censo (espelho de
 *  `etl/censo.py::CENSO_ARTIFACT_FILENAME`): a entry `artifacts` do manifest
 *  grava este basename (`register_censo_artifact`/`register_served_artifacts`).
 */
export const CENSO_ARQUIVO = "censo_municipios.json";

/** Entry auditada do Censo no manifest: `artifacts` com basename do Censo
 *  e sha256 64-hex (mesma strictness de `isAudited` do gate do fato —
 *  delega a `getArtifacts`, sem fork de validador). Fixture com hash
 *  válido CONTA como prova (paridade com `vereditoTemProva`: o seed
 *  legítimo marca tudo fixture:true — pin de `test_seed_artifact_entries`).
 *  Qualquer outra coisa (sem entry, hash curto, alias `hash`) → null:
 *  JSON forjado no path servido não sustenta a pop.
 */
export function entradaCensoAuditada(manifest: unknown): ManifestArtifact | null {
  const arts = getArtifacts(manifest);
  const entry = arts.find(
    (a) => String(a?.arquivo ?? "").split("/").pop() === CENSO_ARQUIVO,
  );
  return entry ?? null;
}

/** Há prova para exibir a pop do Censo: entry `artifacts` auditada
 *  (fonte única da verdade do selo runtime do Censo, paridade com
 *  `vereditoTemProva` do fato). Sem entry → SEM_DADO, nunca número. */
export function censoTemProva(manifest: unknown): boolean {
  return entradaCensoAuditada(manifest) !== null;
}

/** Divergência entre o hash da URL compartilhada e o hash oficial atual.
 *  Manifest só-fixture (sem hash oficial) com hash na URL também diverge:
 *  o link foi criado sobre dado auditado e a página não tem hash oficial
 *  para sustentar. Antes do manifest carregar, nunca alerta (sem flash).
 */
export function isHashDivergente(
  urlHash: string,
  officialHash: string,
  manifestChecked: boolean,
): boolean {
  if (!manifestChecked || urlHash === "") return false;
  return officialHash === "" || urlHash !== officialHash;
}
