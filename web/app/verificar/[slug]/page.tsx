/** Rota /verificar/[slug]: veredito pré-computado no build.
 *
 * `generateStaticParams` publica os 12 slugs de `data/checks.json`;
 * `dynamicParams = false` fecha slugs fora da curadoria (404 — slug
 * desconhecido nunca recebe veredito; a sugestão vive no índice
 * `/verificar` e no componente `VerificarConteudo`). O fato municipal é
 * lido do disco no build (mesmo `fatoDatasetDe` do runtime); sem manifest
 * ou sem fato → `VerificarConteudo` fail-closed ("sem dado oficial",
 * nunca número sem hash). O cálculo usa o motor via `verificarAfirmacao`
 * — implementação única com o runtime e os testes.
 */

import fs from "node:fs";
import path from "node:path";
import { VerificarConteudo, type Check } from "../Verificar";
import SeloStaleness from "../../../components/SeloStaleness";
import { fatoDatasetDe, getSealParaDataset, vereditoTemProva } from "../../../lib/regiao";
import type { FatoRegiao } from "../../../components/PainelRegiao";
import checksJson from "../../../data/checks.json";

const checks = checksJson as unknown as Check[];

export function generateStaticParams() {
  return checks.map((c) => ({ slug: c.slug }));
}

export const dynamicParams = false;

function lerJson(caminho: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(caminho, "utf8"));
  } catch {
    return null;
  }
}

function fatoValido(obj: unknown): FatoRegiao | null {
  const f = obj as FatoRegiao | null;
  if (!f || !Array.isArray(f.candidatos) || !Array.isArray(f.municipios)) return null;
  return f;
}

export default function PaginaVerificar({ params }: { params: { slug: string } }) {
  const check = checks.find((c) => c.slug === params.slug) ?? null;

  const base = path.join(process.cwd(), "public", "data");
  const manifest = lerJson(path.join(base, "manifest.json"));
  const dataset = fatoDatasetDe(manifest, "");
  // Selo do próprio dataset + portão fail-closed: fato sem registro
  // auditado não-fixture nunca alimenta veredito (SEM_DADO, nunca
  // número sem hash — e nunca sob selo de outra ingestão). Fixture com
  // hash alimenta veredito com badge de amostra (nunca selo oficial),
  // conforme o contrato de VerificarConteudo.
  const seal = getSealParaDataset(manifest, dataset);
  const fato =
    vereditoTemProva(seal) && dataset ? fatoValido(lerJson(path.join(base, `${dataset}.json`))) : null;

  return (
    <>
      {/* Congelamento documentado + staleness display-only (EVOLVE-11 Task 6:
          SSG congela o pleito default do build; o alerta abaixo acusa
          divergência do manifest sem tocar em números/selo/fato). */}
      <SeloStaleness dataset={dataset} hashBuild={seal.official?.hash ?? ""} />
      <VerificarConteudo
        check={check}
        slug={params.slug}
        checks={checks}
        fato={fato}
        seal={seal}
        manifestChecked
      />
    </>
  );
}
