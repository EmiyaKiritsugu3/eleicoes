import React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import RootLayout from "../app/layout";

describe("shell editorial", () => {
  it("marca + tokens aplicados no layout", () => {
    const html = renderToStaticMarkup(
      <RootLayout>
        <p>filho</p>
      </RootLayout>,
    );
    expect(html).toContain("SAD Eleições");
    expect(html).toContain("resultados auditados");
    expect(html).toContain("#FAF7F0");
    expect(html).toContain("Georgia");
  });
});
