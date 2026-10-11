/** Rota /perguntas/[slug]: resposta curada pré-computada no build.
 *
 * `generateStaticParams` publica os 30 slugs de `data/perguntas.json`;
 * `dynamicParams = false` fecha slugs fora da curadoria (404). O fato
 * municipal é lido do disco no build (mesmo `fatoDatasetDe` do runtime);
 * sem manifest ou sem fato → `CuradaConteudo` fail-closed ("sem dado
 * oficial", nunca número sem hash). O cálculo usa o motor via
 * `CuradaConteudo` — implementação única com o runtime e os testes.
 */

import fs from "node:fs";
import path from "node:path";
import { notFound } from "next/navigation";
import { CuradaConteudo, type PerguntaCurada } from "../Curada";
import SeloStaleness from "../../../components/SeloStaleness";
import { fatoDatasetDe, getSealParaDataset, hashResumoSeal } from "../../../lib/regiao";
import type { FatoRegiao } from "../../../components/PainelRegiao";
import perguntasJson from "../../../data/perguntas.json";

const perguntas = perguntasJson as unknown as PerguntaCurada[];

export function generateStaticParams() {
  return perguntas.map((p) => ({ slug: p.slug }));
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

export default function PaginaPergunta({ params }: { params: { slug: string } }) {
  const pergunta = perguntas.find((p) => p.slug === params.slug);
  if (!pergunta) notFound();

  const base = path.join(process.cwd(), "public", "data");
  const manifest = lerJson(path.join(base, "manifest.json"));
  // Selo do próprio dataset exibido abaixo (nunca hash de outra ingestão);
  // sem registro auditado → "dado não auditado" no conteúdo curado.
  const dataset = fatoDatasetDe(manifest, "");
  const seal = getSealParaDataset(manifest, dataset);
  const fato = dataset ? fatoValido(lerJson(path.join(base, `${dataset}.json`))) : null;

  return (
    <>
      {/* Congelamento documentado + staleness display-only (EVOLVE-11 Task 6:
          SSG congela o pleito default do build; o alerta abaixo acusa
          divergência do manifest sem tocar em números/selo/fato). */}
      <SeloStaleness dataset={dataset} hashBuild={hashResumoSeal(seal)} />
      <CuradaConteudo pergunta={pergunta} fato={fato} seal={seal} manifestChecked />
    </>
  );
}
