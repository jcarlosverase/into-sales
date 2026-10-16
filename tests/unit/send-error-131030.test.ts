import { describe, expect, it } from "vitest";
import { describeSendError } from "@/lib/meta/send-errors";

/** #131030 — the test-number allow list, explained in Spanish with where to fix it. */
describe("describeSendError 131030", () => {
  it("says where the allow list lives and keeps the code", () => {
    const text = describeSendError(131030, "(#131030) Recipient phone number not in allowed list");
    expect(text).toContain("lista de permitidos");
    expect(text).toContain("Configuración de la API");
    expect(text).toContain("(Meta 131030)");
    expect(text).not.toContain("Recipient phone number");
  });
});
