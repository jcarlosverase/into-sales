import { describe, expect, it } from "vitest";
import { isPrivateHost, trustedOrigins } from "@/lib/auth/trusted-origins";

const req = (origin: string) => new Request("http://localhost:3000/api/auth/sign-in/email", { headers: { origin } });

describe("trustedOrigins (login desde la red local)", () => {
  it("reconoce localhost y las IP privadas, no las públicas", () => {
    for (const h of ["localhost", "127.0.0.1", "192.168.1.94", "10.0.0.5", "172.16.0.1", "172.31.255.255", "mac.local", "[::1]"]) expect(isPrivateHost(h)).toBe(true);
    for (const h of ["172.32.0.1", "8.8.8.8", "crm.cliente.com", "192.169.1.1"]) expect(isPrivateHost(h)).toBe(false);
  });

  it("en desarrollo confía en el origen de la red local de la petición", () => {
    expect(trustedOrigins(req("http://192.168.1.94:3000"), { NODE_ENV: "development" })).toEqual(["http://192.168.1.94:3000"]);
  });

  it("en desarrollo no confía en un origen público", () => {
    expect(trustedOrigins(req("https://evil.example"), { NODE_ENV: "development" })).toEqual([]);
  });

  it("en producción nunca confía en la red local por sí sola", () => {
    expect(trustedOrigins(req("http://192.168.1.94:3000"), { NODE_ENV: "production" })).toEqual([]);
  });

  it("TRUSTED_ORIGINS agrega dominios en cualquier entorno e ignora lo inválido", () => {
    expect(trustedOrigins(undefined, { NODE_ENV: "production", TRUSTED_ORIGINS: "https://crm.cliente.com/x, no-es-url, ftp://a.b" })).toEqual(["https://crm.cliente.com"]);
  });
});
