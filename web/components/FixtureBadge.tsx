import React from "react";

/** Selo de amostra sintética: tratamento de aviso, NUNCA o selo oficial —
 *  mesmo com hash presente. Compartilhado por /auditoria, / e /analisar
 *  (mesmo visual/role em todas as páginas).
 */
export default function FixtureBadge() {
  return (
    <p
      role="note"
      className="badge"
      style={{
        display: "inline-block",
        padding: "0.25rem 0.5rem",
        borderRadius: 4,
        fontSize: "0.85rem",
        background: "#fff3cd",
        border: "2px dashed #b45309",
        color: "#7c2d12",
        fontWeight: "bold",
      }}
    >
      amostra sintética — não oficial
    </p>
  );
}

/** Selo de fixture com hash CHEIO visível (transparência) + nota de que o
 *  hash não tem valor oficial. Nunca usa o selo oficial (SourceBadge).
 */
export function FixtureSeal({ hash }: { hash: string }) {
  return (
    <>
      <FixtureBadge />
      {hash ? (
        <p>
          <small>
            hash de amostra — sem valor oficial:{" "}
            <code title={hash}>{hash}</code>
          </small>
        </p>
      ) : null}
    </>
  );
}
