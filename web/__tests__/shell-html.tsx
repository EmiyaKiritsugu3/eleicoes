// Render do shell (RootLayout) compartilhado — FONTE ÚNICA do bloco antes
// duplicado entre shell.test.tsx e ux.test.tsx (gate Sonar duplication ≤3%:
// o bloco render + asserts de shell existia 1:1 nos dois arquivos).
// Vive aqui (e não em helpers.ts) porque helpers.ts proíbe import de
// código de produção além de tipos — RootLayout é componente.
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import RootLayout from "../app/layout";

export function htmlShell(): string {
  return renderToStaticMarkup(
    <RootLayout>
      <p>filho</p>
    </RootLayout>,
  );
}
