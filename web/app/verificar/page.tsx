"use client";

/** Índice /verificar: destino do link `?regiao=` do painel da região.
 *
 * Com `?regiao=<UF>` (sigla, ex. "SP"), lista só os checks curados daquela
 * UF (`checksParaRegiao`); deep links com código IBGE de município (7
 * dígitos, ex. "3550308") normalizam para a UF pelo prefixo
 * (`normalizarRegiao`) antes de filtrar. Sem checks p/ a região → sugestão
 * (biblioteca completa), nunca veredito. Sem parâmetro, lista a biblioteca
 * inteira. Os vereditos vivem nas páginas `/verificar/[slug]` — este índice
 * não computa nenhum número (sem fato carregado aqui).
 */

import React, { useEffect, useState } from "react";
import SealSlot from "../../components/SealSlot";
import { getSealState, type SealState } from "../../lib/data";
import { fetchJson } from "../../lib/fetchJson";
import { checksParaRegiao, type Check } from "./Verificar";
import checksJson from "../../data/checks.json";

const checks = checksJson as unknown as Check[];

/** Prefixo IBGE (2 primeiros dígitos do código do município) → sigla da UF.
 *  Tabela oficial: 11–17 Norte, 21–29 Nordeste, 31–33/35 Sudeste, 41–43 Sul,
 *  50–53 Centro-Oeste. */
const UF_POR_PREFIXO_IBGE: Record<string, string> = {
  "11": "RO", "12": "AC", "13": "AM", "14": "RR", "15": "PA", "16": "AP",
  "17": "TO", "21": "MA", "22": "PI", "23": "CE", "24": "RN", "25": "PB",
  "26": "PE", "27": "AL", "28": "SE", "29": "BA", "31": "MG", "32": "ES",
  "33": "RJ", "35": "SP", "41": "PR", "42": "SC", "43": "RS", "50": "MS",
  "51": "MT", "52": "GO", "53": "DF",
};

/** Normaliza `?regiao=` para o filtro: sigla passa intacta (maiúscula,
 *  aparada); código IBGE todo-numérico vira a UF do prefixo. Prefixo
 *  desconhecido mantém o valor cru → sem match → sugestão (fail-closed:
 *  nunca atribui UF errada a um município).
 *
 *  Vive como estático do componente (não export nomeado): arquivos de rota
 *  do Next só aceitam `default` — export nomeado quebra o `tsc`/build
 *  (`.next/types` exige `{ [x: string]: never }` nos demais exports).
 */
function normalizarRegiao(raw: unknown): string {
  const r = String(raw ?? "").trim().toUpperCase();
  const m = r.match(/^(\d{2})\d*$/);
  if (m) return UF_POR_PREFIXO_IBGE[m[1]] ?? r;
  return r;
}

function lerRegiaoDaUrl(): string {
  try {
    return new URLSearchParams(window.location.search).get("regiao") ?? "";
  } catch {
    return "";
  }
}

function PaginaVerificarIndice() {
  const [regiao, setRegiao] = useState("");
  const [seal, setSeal] = useState<SealState>({ official: null, hasFixture: false, fixtureHash: "" });

  useEffect(() => {
    // ?regiao= lido ANTES do fetch do manifest: com manifest lento, o filtro
    // regional aplica de imediato em vez de exibir a biblioteca inteira.
    setRegiao(lerRegiaoDaUrl());
    (async () => {
      const manifest = (await fetchJson("/data/manifest.json")).data;
      setSeal(getSealState(manifest));
    })();
  }, []);

  const badge = <SealSlot seal={seal} />;
  const filtro = normalizarRegiao(regiao);
  const filtrados = filtro !== "" ? checksParaRegiao(checks, filtro) : checks;
  const semCobertura = filtro !== "" && filtrados.length === 0;

  return (
    <>
      <h1>Verificar afirmações</h1>
      <section aria-label="Afirmações curadas">
        <h2>{filtro !== "" ? `Afirmações sobre ${filtro}` : "Biblioteca"}</h2>
        {badge}
        {semCobertura ? (
          <p role="note">
            Nenhuma afirmação curada para esta região — sugestão a partir da biblioteca auditada:
          </p>
        ) : null}
        <ul>
          {filtrados.map((c) => (
            <li key={c.slug}>
              <a href={`/verificar/${encodeURIComponent(c.slug)}`}>{c.titulo ?? c.frase}</a>
            </li>
          ))}
        </ul>
        {semCobertura ? (
          <ul>
            {checks.map((c) => (
              <li key={c.slug}>
                <a href={`/verificar/${encodeURIComponent(c.slug)}`}>{c.titulo ?? c.frase}</a>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </>
  );
}

export default Object.assign(PaginaVerificarIndice, { normalizarRegiao });
