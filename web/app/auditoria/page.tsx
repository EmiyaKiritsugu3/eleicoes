"use client";

import React, { useEffect, useState } from "react";
import SourceBadge from "../../components/SourceBadge";
import {
  getAuditInfo,
  isAudited,
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

function isFixture(e: ManifestIngestion): boolean {
  return (e as Record<string, unknown>).fixture === true;
}

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
  const [audit, setAudit] = useState<AuditInfo | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    (async () => {
      const m = await fetchJson<Manifest>("/data/manifest.json");
      setManifest(m);
      setAudit(getAuditInfo(m));
      setChecked(true);
    })();
  }, []);

  const ingestions = Array.isArray(manifest?.ingestions)
    ? (manifest?.ingestions ?? [])
    : [];

  return (
    <>
      <h1>SAD Eleições — auditoria</h1>

      {checked && !audit && (
        <p role="alert" className="badge badge-warn">
          dado não auditado — manifest ausente ou inválido; números abaixo não são oficiais
        </p>
      )}
      {audit && <SourceBadge hash={audit.hash} url={audit.url} date={audit.date} />}

      <section aria-label="Ingestões registradas">
        <h2>Ingestões registradas</h2>
        {audit ? (
          <SourceBadge hash={audit.hash} url={audit.url} date={audit.date} />
        ) : (
          <SourceBadge hash="" url="" date="" />
        )}
        {!checked ? (
          <p>carregando manifest…</p>
        ) : ingestions.length === 0 ? (
          <p>{SEM_DADO} — nenhuma ingestão registrada no manifest</p>
        ) : (
          <table>
            <caption>Ingestões do manifest com fonte, hash, linhas e data</caption>
            <thead>
              <tr>
                <th scope="col">Fonte oficial (TSE)</th>
                <th scope="col">Hash (sha256)</th>
                <th scope="col">Linhas</th>
                <th scope="col">Data</th>
              </tr>
            </thead>
            <tbody>
              {ingestions.map((e, i) => {
                const hash = String(e.sha256 ?? e.hash ?? "");
                const url = typeof e.source_url === "string" ? e.source_url : "";
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
                      {isFixture(e) && (
                        <p role="note">
                          amostra sintética p/ CI — sem valor oficial
                        </p>
                      )}
                    </td>
                    <td>
                      {isAudited(e) ? (
                        <code title={hash}>{hash}</code>
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
        )}
      </section>

      <section aria-label="Baixar manifest">
        <h2>Baixar manifest</h2>
        <p>
          <button
            type="button"
            disabled={!audit}
            title={
              audit
                ? "Baixar manifest.json com proveniência auditada"
                : "Download bloqueado — dado não auditado"
            }
            onClick={downloadManifest}
          >
            Baixar manifest
          </button>
        </p>
        {checked && !audit && (
          <p role="alert">
            download bloqueado — dado não auditado; o manifest só é oferecido
            com hash válido para que o arquivo seja auto-descritivo
          </p>
        )}
      </section>

      <section aria-label="Como auditar">
        <h2>Como auditar</h2>
        <p>
          Cada ingestão registra a URL oficial do TSE e o sha256 do conteúdo. Um
          número só é apresentado como oficial quando há hash válido — sem hash,
          a página mostra “dado não auditado” e nunca apresenta números como
          oficiais. Detalhes do pipeline em <a href="/metodologia">/metodologia</a>.
        </p>
      </section>
    </>
  );
}
