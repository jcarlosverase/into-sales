import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  apiRoot,
  chatCompletionsUrl,
  last4,
  modelsUrl,
  OPENROUTER_BASE_URL,
  presetFromBaseUrl,
} from "@/lib/ai/presets";
import {
  envAiProvider,
  interpretCredential,
  statusMessage,
  resolve,
  type AiProvider,
} from "@/lib/ai/provider";
import { statusFromResponse } from "@/server/ai/credentials";
import {
  aiModelsSchema,
  aiProbeSchema,
  aiSettingsPutSchema,
  baseUrlEffective,
} from "@/server/ai/settings";
import type { AiCredentialSecret } from "@/server/ai/credentials";

/**
 * #85 — Ajustes → IA. Las reglas puras: con quién habla el adaptador (la fila
 * manda, el entorno es respaldo), qué hace cada código del proveedor con el
 * estado, y qué acepta el `PUT`.
 */

const ROW: AiCredentialSecret = {
  provider: "openrouter",
  baseUrl: OPENROUTER_BASE_URL,
  model: "org/modelo",
  tokenLast4: "1234",
  status: "active",
  statusReason: null,
  statusChangedAt: new Date("2026-10-01T00:00:00Z"),
  updatedAt: new Date("2026-10-01T00:00:00Z"),
  token: "sk-or-fila-1234",
};

const ENVIRONMENT: AiProvider = {
  source: "env",
  baseUrl: "https://entorno.test",
  model: "env/modelo",
  judgeModel: "env/juez",
  token: "tok-entorno-9999",
};

describe("URLs del proveedor", () => {
  it("añade /v1 a la base del repo y no lo duplica si ya viene", () => {
    expect(apiRoot("https://openrouter.ai/api")).toBe("https://openrouter.ai/api/v1");
    expect(apiRoot("https://openrouter.ai/api/")).toBe("https://openrouter.ai/api/v1");
    expect(apiRoot("https://api.groq.com/openai/v1")).toBe("https://api.groq.com/openai/v1");
    expect(apiRoot("https://api.groq.com/openai/v1/")).toBe("https://api.groq.com/openai/v1");
    expect(chatCompletionsUrl("http://localhost:3000/api/dev/ai-mock")).toBe(
      "http://localhost:3000/api/dev/ai-mock/v1/chat/completions"
    );
    expect(modelsUrl("https://api.openai.com")).toBe("https://api.openai.com/v1/models");
  });

  it("reconoce el preset por la base URL", () => {
    expect(presetFromBaseUrl("https://openrouter.ai/api")).toBe("openrouter");
    expect(presetFromBaseUrl("https://openrouter.ai/api/v1/")).toBe("openrouter");
    expect(presetFromBaseUrl("https://api.openai.com")).toBe("openai_compatible");
  });

  it("last4 expone solo los últimos 4", () => {
    expect(last4("sk-or-abcdefgh-wxyz")).toBe("wxyz");
  });
});

describe("resolución: la fila manda, el entorno es respaldo", () => {
  it("fila activa → la fila, aunque el entorno tenga su propio token", () => {
    const r = resolve(ROW, ENVIRONMENT);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.provider.source).toBe("org");
      expect(r.provider.token).toBe(ROW.token);
      expect(r.provider.model).toBe("org/modelo");
      // Un solo modelo en la UI: el juez usa el mismo.
      expect(r.provider.judgeModel).toBe("org/modelo");
    }
  });

  it("sin fila → el entorno tal cual (con su juez aparte)", () => {
    const r = resolve(null, ENVIRONMENT);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.provider).toEqual(ENVIRONMENT);
  });

  it("sin nada → no configurado", () => {
    const r = resolve(null, null);
    expect(r).toEqual({ ok: false, status: { active: false, reason: "sin_configurar" } });
  });

  it("fila pausada NO cae al entorno: el dueño configuró su llave y debe ver el problema", () => {
    const r = resolve({ ...ROW, status: "paused_invalid_token" }, ENVIRONMENT);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toEqual({
        active: false,
        reason: "token_invalido",
        last4: "1234",
        since: ROW.statusChangedAt,
      });
    }
    const withoutBalance = resolve({ ...ROW, status: "paused_no_credit" }, null);
    expect(withoutBalance.ok).toBe(false);
    if (!withoutBalance.ok) expect(withoutBalance.status.reason).toBe("sin_saldo");
  });

  it("interpretarCredencial distingue el origen", () => {
    expect(interpretCredential(ROW, { last4: "9999" })).toEqual({
      active: true,
      source: "org",
      last4: "1234",
    });
    expect(interpretCredential(null, { last4: "9999" })).toEqual({
      active: true,
      source: "env",
      last4: "9999",
    });
    expect(interpretCredential(null, null)).toEqual({
      active: false,
      reason: "sin_configurar",
    });
  });
});

describe("la máquina de estados la dicta quien cobra", () => {
  it("401 pausa por llave, 402 por saldo; 429 y 500 no pausan", () => {
    expect(statusFromResponse(401)).toBe("paused_invalid_token");
    expect(statusFromResponse(402)).toBe("paused_no_credit");
    expect(statusFromResponse(429)).toBeNull();
    expect(statusFromResponse(500)).toBeNull();
    expect(statusFromResponse(200)).toBeNull();
  });

  it("cada motivo manda a Ajustes → IA; activa no dice nada", () => {
    expect(statusMessage({ active: true, source: "org", last4: "1234" })).toBeNull();
    for (const reason of ["sin_configurar", "token_invalido", "sin_saldo"] as const) {
      const status =
        reason === "sin_configurar"
          ? { active: false as const, reason: reason }
          : { active: false as const, reason: reason, last4: "1234", since: null };
      expect(statusMessage(status)).toContain("Ajustes → IA");
    }
  });
});

describe("validación del PUT /api/settings/ai", () => {
  it("OpenRouter: proveedor + modelo + llave; la base URL la pone el preset", () => {
    const r = aiSettingsPutSchema.safeParse({
      provider: "openrouter",
      model: " anthropic/claude-sonnet-4.5 ",
      token: "sk-or-llave-larga",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.model).toBe("anthropic/claude-sonnet-4.5");
      expect(baseUrlEffective(r.data.provider, "https://otra.cosa")).toBe(OPENROUTER_BASE_URL);
    }
  });

  it("«Otro compatible» exige base URL http(s); se le quita la barra final", () => {
    const sin = aiSettingsPutSchema.safeParse({
      provider: "openai_compatible",
      model: "gpt-4.1-mini",
      token: "sk-llave-larga",
    });
    expect(sin.success).toBe(false);
    if (!sin.success) {
      expect(sin.error.issues.some((i) => i.path.join(".") === "baseUrl")).toBe(true);
    }
    const ftp = aiSettingsPutSchema.safeParse({
      provider: "openai_compatible",
      baseUrl: "ftp://api.x.com",
      model: "m",
      token: "sk-llave-larga",
    });
    expect(ftp.success).toBe(false);
    const ok = aiSettingsPutSchema.safeParse({
      provider: "openai_compatible",
      baseUrl: "https://api.x.com/",
      model: "m",
    });
    expect(ok.success).toBe(true);
    if (ok.success) {
      expect(baseUrlEffective(ok.data.provider, ok.data.baseUrl)).toBe("https://api.x.com");
    }
  });

  it("la llave es opcional (solo cambia proveedor/modelo), pero si viene tiene mínimo 8", () => {
    expect(
      aiSettingsPutSchema.safeParse({ provider: "openrouter", model: "m" }).success
    ).toBe(true);
    expect(
      aiSettingsPutSchema.safeParse({ provider: "openrouter", model: "m", token: "corta" })
        .success
    ).toBe(false);
    expect(
      aiSettingsPutSchema.safeParse({ provider: "openrouter", model: "", token: "sk-llave-larga" })
        .success
    ).toBe(false);
    expect(
      aiSettingsPutSchema.safeParse({ provider: "otro", model: "m", token: "sk-llave-larga" })
        .success
    ).toBe(false);
  });

  it("probar exige modelo; traer modelos no", () => {
    expect(aiProbeSchema.safeParse({ provider: "openrouter" }).success).toBe(false);
    expect(aiProbeSchema.safeParse({ provider: "openrouter", model: "m" }).success).toBe(true);
    expect(aiModelsSchema.safeParse({ provider: "openrouter" }).success).toBe(true);
    expect(
      aiModelsSchema.safeParse({ provider: "openai_compatible", token: "sk-llave-larga" }).success
    ).toBe(false);
  });
});

describe("el respaldo del entorno", () => {
  const original = { ...process.env };

  beforeAll(() => {
    vi.stubEnv("APP_BASE_URL", "http://localhost:3000");
    vi.stubEnv("DATABASE_URL", "postgresql://t:t@localhost:5432/t");
    vi.stubEnv("BETTER_AUTH_SECRET", "secret-de-test-suficiente");
    vi.stubEnv("ENCRYPTION_KEY", Buffer.alloc(32, 3).toString("base64"));
    vi.stubEnv("META_WEBHOOK_VERIFY_TOKEN", "verify-test");
  });

  afterAll(() => {
    vi.unstubAllEnvs();
    process.env = { ...original };
  });

  it("sin OPENROUTER_API_TOKEN → null, sin validar el resto del entorno", () => {
    vi.stubEnv("OPENROUTER_API_TOKEN", "");
    expect(envAiProvider()).toBeNull();
  });

  it("con token → proveedor del entorno; el juez cae al modelo principal", () => {
    vi.stubEnv("OPENROUTER_API_TOKEN", "tok-entorno-9999");
    vi.stubEnv("OPENROUTER_MODEL", "env/modelo");
    const p = envAiProvider();
    expect(p).toMatchObject({
      source: "env",
      baseUrl: "https://openrouter.ai/api",
      model: "env/modelo",
      judgeModel: "env/modelo",
      token: "tok-entorno-9999",
    });
  });
});
