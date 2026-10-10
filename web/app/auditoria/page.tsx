"use client";

import React, { useEffect, useState } from "react";
import { ArtifactsTable } from "../../components/ArtifactsTable";
import SourceBadge from "../../components/SourceBadge";
import FixtureBadge from "../../components/FixtureBadge";
import {
  getArtifacts,
  getOfficialAuditInfo,
  isAudited,
  isFixtureEntry,
  isOfficialDisplay,
  safeUrl,
  type AuditInfo,
  type Manifest,
  type ManifestIngestion,
} from "../../lib/data";

const SEM_DADO = "sem dado oficial";

async function fetchJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(path, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function entryDate(e: ManifestIngestion): string {
  if (typeof e.date === "string" && e.date) return e.date;
  if (typeof e.data === "string" && e.data) return e.data;
  return "";
}

/** Selo de amostra sintética compartilhado (components/FixtureBadge):
 *  tratamento de aviso, NUNCA o selo oficial — mesmo com hash presente.
 *  O hash segue visível na tabela (transparência).
 */

function downloadManifest() {
  fetch("/data/manifest.json", { cache: "no-store" })
    .then((res) => {
      if (!res.ok) throw new Error("manifest ausente");
      return res.blob();
    })
    .then((blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "manifest.json";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    })
    .catch(() => {});
}

export default function Auditoria() {
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [official, setOfficial] = useState<AuditInfo | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    (async () => {
      const m = await fetchJson<Manifest>("/data/manifest.json");
      setManifest(m);
      setOfficial(getOfficialAuditInfo(m));
      setChecked(true);
    })();
  }, []);

  const ingestions = Array.isArray(manifest?.ingestions)
    ? (manifest?.ingestions ?? [])
    : [];
  const artifacts = getArtifacts(manifest);
  // Alerta honesto sem depender de CSS externo (M4-web): fundo/borda inline.
  const ALERTA_STYLE: React.CSSProperties = {
    background: "#fff3cd",
    border: "1px solid #b45309",
    fontWeight: "bold",
  };
  const hasFixture = ingestions.some(isFixtureEntry);
  const canDownload = ingestions.some(isAudited);

  return (
    <>
      <h1>SAD Eleições — auditoria</h1>

      {checked && !official && !hasFixture && (
        <p role="alert" className="badge badge-warn" style={ALERTA_STYLE}>
          dado não auditado — manifest ausente ou inválido; números abaixo não são oficiais
        </p>
      )}
      {checked && !official && hasFixture && <FixtureBadge />}
      {official && (
        <SourceBadge hash={official.hash} url={official.url} date={official.date} />
      )}

      <section aria-label="Ingestões registradas">
        <h2>Ingestões registradas</h2>
        {official ? (
          <SourceBadge hash={official.hash} url={official.url} date={official.date} />
        ) : checked && hasFixture ? (
          <FixtureBadge />
        ) : (
          <SourceBadge hash="" url="" date="" />
        )}
        {!checked ? (
          <p>carregando manifest…</p>
        ) : ingestions.length === 0 ? (
          <p>{SEM_DADO} — nenhuma ingestão registrada no manifest</p>
        ) : (
          <div style={{ overflowX: "auto" }} tabIndex={0} role="region" aria-label="Ingestões do manifest com fonte, hash, linhas e data">
          <table>
            <caption>Ingestões do manifest com fonte, hash, linhas e data</caption>
            <thead>
              <tr>
                <th scope="col">Fonte oficial (TSE/IBGE)</th>
                <th scope="col">Conjunto (dataset/tipo)</th>
                <th scope="col">Hash (sha256)</th>
                <th scope="col">Linhas</th>
                <th scope="col">Data</th>
              </tr>
            </thead>
            <tbody>
              {ingestions.map((e, i) => {
                const hash = String(e.sha256 ?? e.hash ?? "");
                const rawUrl = typeof e.source_url === "string" ? e.source_url : "";
                // Link só com esquema http(s) (M10): safeUrl barra javascript:/data:/relativo.
                const url = safeUrl(rawUrl);
                const conjunto = ((): string => {
                  const d =
                    typeof (e as Record<string, unknown>).dataset === "string"
                      ? String((e as Record<string, unknown>).dataset)
                      : "";
                  const t =
                    typeof (e as Record<string, unknown>).tipo === "string"
                      ? String((e as Record<string, unknown>).tipo)
                      : "";
                  // Fato municipal (TSE × Censo) e ingestões do Censo IBGE
                  // 2022 aparecem aqui pelo dataset/tipo — mesma tabela,
                  // mesmo contrato de hash.
                  if (d && t) return `${d} (${t})`;
                  return d || t || SEM_DADO;
                })();
                const rows =
                  typeof (e as Record<string, unknown>).rows === "number"
                    ? String((e as Record<string, unknown>).rows)
                    : SEM_DADO;
                return (
                  <tr key={i}>
                    <td>
                      {url ? (
                        <a href={url} target="_blank" rel="noreferrer">
                          {url}
                        </a>
                      ) : (
                        SEM_DADO
                      )}
                      {isFixtureEntry(e) && <FixtureBadge />}
                    </td>
                    <td>{conjunto}</td>
                    <td>
                      {isOfficialDisplay(e) ? (
                        <code title={hash}>{hash}</code>
                      ) : isFixtureEntry(e) && isAudited(e) ? (
                        <>
                          <code title={hash}>{hash}</code>
                          <p role="note">hash de amostra — sem valor oficial</p>
                        </>
                      ) : (
                        <span role="alert">dado não auditado</span>
                      )}
                    </td>
                    <td>{rows}</td>
                    <td>{entryDate(e) || SEM_DADO}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        )}
      </section>

      <section aria-label="Arquivos servidos">
        <h2>Arquivos servidos</h2>
        {!checked ? (
          <p>carregando manifest…</p>
        ) : (
          <ArtifactsTable artifacts={artifacts} />
        )}
      </section>

      <section aria-label="Baixar manifest">
        <h2>Baixar manifest</h2>
        <p>
          <button
            type="button"
            disabled={!canDownload}
            title={
              canDownload
                ? "Baixar manifest.json (verifique o selo: oficial ou amostra sintética)"
                : "O download está bloqueado — sem ingestão auditada (manifest ausente, vazio ou sem hash)"
            }
            onClick={downloadManifest}
          >
            Baixar manifest
          </button>
        </p>
        {checked && !canDownload && (
          <p role="alert">
            O download está bloqueado — sem ingestão auditada; sem hash válido não há
            proveniência a oferecer
          </p>
        )}
        {checked && canDownload && !official && (
          <p role="note">
            O download está permitido por transparência — o manifest disponível é
            amostra sintética, sem valor oficial
          </p>
        )}
      </section>

      <section aria-label="Como auditar">
        <h2>Como auditar</h2>
        <p>
          Cada ingestão registra a URL oficial (TSE ou IBGE) e o sha256 do conteúdo. Um
          número só é apresentado como oficial quando há hash válido em ingestão
          não-sintética — sem hash, a página mostra “dado não auditado” e nunca
          apresenta números como oficiais. O fato municipal (join TSE × Censo
          IBGE 2022, <code>tipo: fato_municipal</code>) e as ingestões do Censo
          aparecem na tabela acima pelo conjunto (dataset/tipo), com fonte
          dupla registrada em <code>fontes</code>. Amostras sintéticas (<code>fixture:true</code>,
          geradas pelo seed de CI) exibem o hash para transparência, mas usam o
          selo “amostra sintética — não oficial”, nunca o selo oficial. Detalhes
          do pipeline em <a href="/metodologia">/metodologia</a>.
        </p>
      </section>
    </>
  );
}
