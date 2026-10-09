import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "SAD Eleições — resultados auditados",
  description: "Frente pública de resultados eleitorais com auditoria visível de fonte.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0, color: "#111" }}>
        <main style={{ maxWidth: 960, margin: "0 auto", padding: "1rem" }}>{children}</main>
      </body>
    </html>
  );
}
