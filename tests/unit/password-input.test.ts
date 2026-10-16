import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PasswordInput } from "@/components/ui/password-input";

describe("PasswordInput (spec 1003)", () => {
  const html = renderToStaticMarkup(createElement(PasswordInput, { id: "password", name: "password" }));

  it("empieza oculta, con el botón para mostrarla (AC1, AC2)", () => {
    expect(html).toContain('type="password"');
    expect(html).toContain('aria-label="Mostrar contraseña"');
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain('aria-controls="password"');
  });

  it("el botón no envía el formulario (AC2)", () => {
    expect(html).toMatch(/<button[^>]*type="button"/);
  });

  it("«Entrar» y «Crear la cuenta» la usan, sin un campo de contraseña suelto", () => {
    for (const page of ["src/app/(auth)/login/page.tsx", "src/app/(auth)/register/page.tsx"]) {
      const code = readFileSync(page, "utf8");
      expect(code).toContain("<PasswordInput");
      expect(code).not.toContain('type="password"');
    }
  });
});
