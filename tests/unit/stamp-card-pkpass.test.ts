import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assemblePkpass,
  buildManifest,
  buildPassJson,
  crc32,
  hexToRgb,
  readZipStore,
  zipStore,
  type PassInput,
} from "@/server/stamp-card/pkpass";

/** 1023, corte 2 — Las piezas puras del `.pkpass` (D8, D11). */

const input: PassInput = {
  passTypeId: "pass.center.into.stamps",
  teamId: "ABCDE12345",
  serialNumber: "cmocktest-AAAAAAAAAAAAAAAAAAAAAA",
  organizationName: "Café La Esquina",
  programName: "Café La Esquina",
  reward: "1 bebida gratis",
  terms: null,
  color: "#0070e0",
  ink: "#ffffff",
  stamps: 4,
  stampsRequired: 10,
  rewardsRedeemed: 0,
  paused: false,
  staffUrl: "https://crm.example/s/AAAAAAAAAAAAAAAAAAAAAA",
  publicUrl: "https://crm.example/c/BBBBBBBBBBBBBBBBBBBBBB",
  webService: null,
};

type Field = { key: string; label: string; value: string };
type Pass = Record<string, unknown> & {
  storeCard: { headerFields: Field[]; auxiliaryFields: Field[] };
  barcodes: unknown[];
  webServiceURL?: string;
  authenticationToken?: string;
};

function hasUnzip(): boolean {
  try {
    execFileSync("unzip", ["-v"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

describe("1023 — pkpass", () => {
  it("pass.json: storeCard con sellos, premio y lo que falta", () => {
    const pass = buildPassJson(input) as Pass;
    expect(pass).toMatchObject({
      formatVersion: 1,
      passTypeIdentifier: "pass.center.into.stamps",
      serialNumber: "cmocktest-AAAAAAAAAAAAAAAAAAAAAA",
      backgroundColor: "rgb(0, 112, 224)",
      foregroundColor: "rgb(255, 255, 255)",
      sharingProhibited: true,
    });
    expect(pass.storeCard.headerFields[0]).toMatchObject({ key: "stamps", value: "4/10" });
    expect(pass.storeCard.auxiliaryFields[0]).toMatchObject({ label: "TE FALTAN", value: "6 sellos" });
    expect(pass.barcodes[0]).toEqual({ format: "PKBarcodeFormatQR", message: input.staffUrl, messageEncoding: "iso-8859-1" });
    // Sin HTTPS público no hay servicio web: el pase no se actualiza solo (riesgo del plan).
    expect(pass.webServiceURL).toBeUndefined();
    expect(pass.authenticationToken).toBeUndefined();
  });

  it("pass.json: completa, en pausa y con servicio web", () => {
    const done = buildPassJson({ ...input, stamps: 12 }) as Pass;
    expect(done.storeCard.headerFields[0]!.value).toBe("10/10");
    expect(done.storeCard.auxiliaryFields[0]!.value).toMatch(/Completa/);
    const paused = buildPassJson({ ...input, paused: true }) as Pass;
    expect(paused.storeCard.auxiliaryFields[0]!.value).toBe("En pausa");
    const live = buildPassJson({
      ...input,
      webService: { url: "https://crm.example/api/wallet/apple", authenticationToken: "t".repeat(22) },
    }) as Pass;
    expect(live.webServiceURL).toBe("https://crm.example/api/wallet/apple");
    expect(live.authenticationToken).toBe("t".repeat(22));
  });

  it("hexToRgb y crc32", () => {
    expect(hexToRgb("#0B1220")).toBe("rgb(11, 18, 32)");
    expect(hexToRgb("nada")).toBe("rgb(0, 0, 0)");
    expect(crc32(Buffer.from("123456789"))).toBe(0xcbf43926);
  });

  it("manifiesto con SHA-1 y zip «store» que se vuelve a leer", () => {
    const files = { "pass.json": Buffer.from("{}"), "icon.png": Buffer.from("png") };
    const manifest = buildManifest(files);
    expect(JSON.parse(manifest.toString())).toEqual({
      "icon.png": expect.stringMatching(/^[0-9a-f]{40}$/),
      "pass.json": "bf21a9e8fbc5a3846fb05b4fa0859e0917b2202f",
    });
    const zip = assemblePkpass(files, manifest, Buffer.from("sig"));
    const back = readZipStore(zip);
    expect([...back.keys()]).toEqual(["icon.png", "pass.json", "manifest.json", "signature"]);
    expect(back.get("signature")!.toString()).toBe("sig");
  });

  it.skipIf(!hasUnzip())("unzip lo da por bueno", () => {
    const dir = mkdtempSync(join(tmpdir(), "pkpass-"));
    const file = join(dir, "t.pkpass");
    writeFileSync(file, zipStore([["pass.json", Buffer.from('{"a":1}')], ["ñandú.png", Buffer.alloc(1000, 7)]]));
    const out = execFileSync("unzip", ["-t", file]).toString();
    expect(out).toMatch(/No errors detected/);
  });
});
