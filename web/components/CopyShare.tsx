"use client";

import React, { useEffect, useRef, useState } from "react";

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
  // URL exibida/copiada: SSR renderiza `url` como veio (sem window no
  // servidor); no cliente, o efeito abaixo absolutiza contra o origin.
  const [exibida, setExibida] = useState(url);
  // Identidade da última solicitação de cópia: se `url` mudar com um
  // writeText pendente, a escrita obsoleta não atualiza o estado.
  const reqRef = useRef(0);

  // Estado stale se `url` mudar após uma cópia: volta a ocioso (e
  // re-resolve a URL absoluta) a cada `url` nova.
  useEffect(() => {
    reqRef.current++;
    setEstado("ocioso");
    setExibida(paraAbsoluta(url));
  }, [url]);

  async function copiar() {
    const alvo = paraAbsoluta(url);
    const minhaVez = ++reqRef.current;
    try {
      const clip =
        typeof navigator !== "undefined"
          ? (navigator as Navigator & { clipboard?: { writeText?: (s: string) => Promise<void> } })
              .clipboard
          : undefined;
      if (clip?.writeText) {
        await clip.writeText(alvo);
        if (reqRef.current !== minhaVez) return;
        setEstado("copiado");
        return;
      }
    } catch {
      // Queda p/ cópia manual abaixo (fallback select).
    }
    if (reqRef.current !== minhaVez) return;
    setEstado("manual");
  }

  return (
    <span>
      <small>
        URL compartilhável: <code>{exibida}</code>
      </small>{" "}
      <button type="button" onClick={copiar}>
        Copiar link
      </button>
      {estado === "copiado" && (
        <span role="status" style={{ display: "block" }}>
          link copiado
        </span>
      )}
      {estado === "manual" && (
        <>
          <span role="status" style={{ display: "block" }}>
            cópia automática indisponível — selecione e copie manualmente
          </span>
          <input
            readOnly
            value={exibida}
            aria-label="URL compartilhável (cópia manual)"
            onFocus={(e) => e.target.select()}
          />
        </>
      )}
    </span>
  );
}

/** Caminho relativo (`/analisar?…`) → URL absoluta contra o origin, para o
 *  link copiado funcionar fora da página. No servidor (sem window) ou com
 *  URL já absoluta, devolve `url` intacta. */
function paraAbsoluta(url: string): string {
  if (
    typeof window !== "undefined" &&
    typeof url === "string" &&
    url.startsWith("/")
  ) {
    return `${window.location.origin}${url}`;
  }
  return url;
}
