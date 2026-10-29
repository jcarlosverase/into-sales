import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readLocalPref, writeLocalPref } from "@/lib/local-prefs";
import { LEGACY_THEME_COOKIE, THEME_COOKIE, themeCookieValue } from "@/lib/theme";

/**
 * Spec 1013: la cookie del tema y las claves del navegador cambiaron de
 * nombre. Quien actualiza no pierde su tema ni sus vistas: se lee el nombre
 * viejo cuando el nuevo aún no existe.
 */

const cookies = (entries: Record<string, string>) => ({
  get: (name: string) => (name in entries ? { value: entries[name]! } : undefined),
});

describe("cookie del tema", () => {
  it("la nueva manda; sin ella, se lee la vieja", () => {
    expect(THEME_COOKIE).toBe("intosales-theme");
    expect(themeCookieValue(cookies({ [THEME_COOKIE]: "dark", [LEGACY_THEME_COOKIE]: "light" }))).toBe("dark");
    expect(themeCookieValue(cookies({ [LEGACY_THEME_COOKIE]: "dark" }))).toBe("dark");
    expect(themeCookieValue(cookies({}))).toBeUndefined();
  });
});

describe("preferencias del navegador", () => {
  let store: Map<string, string>;
  beforeEach(() => {
    store = new Map();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
      },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("migra la clave vieja a la nueva y la borra", () => {
    store.set("vocero.panelOpen", "false");
    expect(readLocalPref("intosales.panelOpen", "vocero.panelOpen")).toBe("false");
    expect(store.get("intosales.panelOpen")).toBe("false");
    expect(store.has("vocero.panelOpen")).toBe(false);
  });

  it("la nueva manda y escribir usa la nueva", () => {
    store.set("vocero.panelOpen", "false");
    writeLocalPref("intosales.panelOpen", "true");
    expect(readLocalPref("intosales.panelOpen", "vocero.panelOpen")).toBe("true");
  });

  it("sin almacenamiento no lanza", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => {
          throw new Error("blocked");
        },
        setItem: () => {
          throw new Error("blocked");
        },
      },
    });
    expect(readLocalPref("a", "b")).toBeNull();
    expect(() => writeLocalPref("a", "1")).not.toThrow();
  });
});
