import React from "react";

interface SourceBadgeProps {
  hash: string;
  url: string;
  date: string;
}

const baseStyle: React.CSSProperties = {
  display: "inline-block",
  padding: "0.25rem 0.5rem",
  borderRadius: 4,
  fontSize: "0.85rem",
};

/** Selo de auditoria visível: hash curto + link da fonte oficial + data.
 *  Sem hash, mostra o banner "dado não auditado" (ruling c).
 */
export default function SourceBadge({ hash, url, date }: SourceBadgeProps) {
  if (!hash) {
    return (
      <p
        role="alert"
        className="badge badge-warn"
        style={{
          ...baseStyle,
          background: "#fff3cd",
          border: "2px solid #b45309",
          color: "#7c2d12",
          fontWeight: "bold",
        }}
      >
        dado não auditado
      </p>
    );
  }
  const short = hash.length > 12 ? `${hash.slice(0, 12)}…` : hash;
  return (
    <p
      className="badge"
      title={`sha256: ${hash}`}
      style={{ ...baseStyle, background: "#e6f4ea", border: "1px solid #1e7e34", color: "#145214" }}
    >
      fonte auditada · <code>{short}</code>
      {url ? (
        <>
          {" · "}
          <a href={url} target="_blank" rel="noreferrer">
            fonte oficial
          </a>
        </>
      ) : null}
      {date ? ` · ${date}` : null}
    </p>
  );
}
