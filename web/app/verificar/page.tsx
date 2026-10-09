"use client";

/** Índice /verificar: destino do link `?regiao=` do painel da região.
 *
 * Com `?regiao=<UF>` (sigla, ex. "SP"), lista só os checks curados daquela
 * UF (`checksParaRegiao`); sem checks p/ a região → sugestão (biblioteca
 * completa), nunca veredito. Códigos IBGE não casam (UF-only, ver
 * `checksParaRegiao`). Sem parâmetro, lista a biblioteca inteira.
 * Os vereditos vivem nas páginas `/verificar/[slug]` — este índice não
 * computa nenhum número (sem fato carregado aqui).
 */

import React, { useEffect, useState } from "react";
import SealSlot from "../../components/SealSlot";
import { getSealState, type SealState } from "../../lib/data";
import { checksParaRegiao, type Check } from "./Verificar";
import checksJson from "../../data/checks.json";

const checks = checksJson as unknown as Check[];

async function fetchJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(path, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export default function PaginaVerificarIndice() {
  const [regiao, setRegiao] = useState("");
  const [seal, setSeal] = useState<SealState>({ official: null, hasFixture: false, fixtureHash: "" });

  useEffect(() => {
    (async () => {
      const manifest = await fetchJson("/data/manifest.json");
      setSeal(getSealState(manifest));
      try {
        setRegiao(new URLSearchParams(window.location.search).get("regiao") ?? "");
      } catch {
        setRegiao("");
      }
    })();
  }, []);

  const badge = <SealSlot seal={seal} />;
  const filtrados = regiao.trim() !== "" ? checksParaRegiao(checks, regiao) : checks;
  const semCobertura = regiao.trim() !== "" && filtrados.length === 0;

  return (
    <>
      <h1>Verificar afirmações</h1>
      <section aria-label="Afirmações curadas">
        <h2>{regiao.trim() !== "" ? `Afirmações sobre ${regiao.trim().toUpperCase()}` : "Biblioteca"}</h2>
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
