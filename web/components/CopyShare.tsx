"use client";

import React, { useState } from "react";

/** Botão copiar p/ URLs compartilháveis (Task 5, UX).
 *
 * Consome (sem reinventar): os builders existentes (`buildShareUrl`,
 * `buildExplorarShareUrl`, `/regiao/<ibge>?hash=`) — recebe a URL pronta
 * via `url`, nunca reconstrói. Sem mudança de dados/selos.
 *
 * Clipboard API quando disponível; sem ela (ou com falha) exibe input
 * readonly selecionável (fallback select) + `role="status"` honesto.
 */
export default function CopyShare({ url }: { url: string }) {
  const [estado, setEstado] = useState<"ocioso" | "copiado" | "manual">("ocioso");

  async function copiar() {
    try {
      const clip =
        typeof navigator !== "undefined"
          ? (navigator as Navigator & { clipboard?: { writeText?: (s: string) => Promise<void> } })
              .clipboard
          : undefined;
      if (clip?.writeText) {
        await clip.writeText(url);
        setEstado("copiado");
        return;
      }
    } catch {
      // Queda p/ cópia manual abaixo (fallback select).
    }
    setEstado("manual");
  }

  return (
    <span>
      <small>
        URL compartilhável: <code>{url}</code>
      </small>{" "}
      <button type="button" onClick={copiar}>
        Copiar link
      </button>
      {estado === "copiado" && <p role="status">link copiado</p>}
      {estado === "manual" && (
        <>
          <p role="status">cópia automática indisponível — selecione e copie manualmente</p>
          <input
            readOnly
            value={url}
            aria-label="URL compartilhável (cópia manual)"
            onFocus={(e) => e.target.select()}
          />
        </>
      )}
    </span>
  );
}
