interface SourceBadgeProps {
  hash: string;
  url: string;
  date: string;
}

/** Selo de auditoria visível: hash curto + link da fonte oficial + data.
 *  Sem hash, mostra o banner "dado não auditado" (ruling c).
 */
export default function SourceBadge({ hash, url, date }: SourceBadgeProps) {
  if (!hash) {
    return (
      <p role="alert" className="badge badge-warn">
        dado não auditado
      </p>
    );
  }
  const short = hash.length > 12 ? `${hash.slice(0, 12)}…` : hash;
  return (
    <p className="badge" title={`sha256: ${hash}`}>
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
