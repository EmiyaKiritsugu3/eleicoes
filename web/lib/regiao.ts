/** Seleção do fato municipal da /regiao (Task 7).
 *
 * Vive em lib (não em `app/regiao/[ibge]/page.tsx`) porque o Next só
 * aceita exports próprios de Page em arquivos de rota — mesmo padrão
 * de `NOTA_CANDIDATO_GLOBAL` em `lib/data.ts`.
 */

export interface ManifestFato {
  tipo?: string;
  dataset?: string;
}

/** Allowlist de datasets de fato municipal (`etl/build_fato.py` escreve
 *  `fato_<ano>_<turno>_<cargo_slug>`). Rejeita traversal (`fato_../…`) e
 *  qualquer nome fora do shape — a rota monta `/data/${dataset}.json`.
 */
export function isFatoDataset(s: unknown): boolean {
  return typeof s === "string" && /^fato_\d+_\d+_[a-z0-9_]+$/.test(s);
}

function defaultFatoDataset(manifest: unknown): string | null {
  const ing = (manifest as { ingestions?: ManifestFato[] } | null)?.ingestions;
  if (!Array.isArray(ing)) return null;
  const entry = ing.find(
    (e) => e?.tipo === "fato_municipal" && typeof e?.dataset === "string" && e.dataset.startsWith("fato_"),
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
