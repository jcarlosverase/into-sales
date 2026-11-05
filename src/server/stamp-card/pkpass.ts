import { createHash } from "node:crypto";

/**
 * 1023, D8 — Las piezas puras de un `.pkpass`: el `pass.json`, el manifiesto
 * con los SHA-1 y el zip «store» (sin compresión). Sin red ni base: se prueban
 * directo. Ningún campo lleva datos del cliente del negocio (AC11): solo el
 * programa, los sellos y el serial.
 */

export type PassFiles = Record<string, Buffer>;

export type PassInput = {
  passTypeId: string;
  teamId: string;
  /** `<scope>-<serial>`: el central exige el prefijo del cliente. */
  serialNumber: string;
  organizationName: string;
  programName: string;
  reward: string;
  terms: string | null;
  color: string;
  ink: string;
  stamps: number;
  stampsRequired: number;
  rewardsRedeemed: number;
  paused: boolean;
  /** Lo que codifica el QR: la pantalla del equipo para sellar (D6). */
  staffUrl: string;
  /** La página web de la tarjeta, al dorso. */
  publicUrl: string;
  /** Solo con un dominio HTTPS: Apple no acepta otro (riesgo del plan). */
  webService: { url: string; authenticationToken: string } | null;
};

/** `#0070e0` → `rgb(0, 112, 224)`, el formato de color que pide Apple. */
export function hexToRgb(hex: string): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return "rgb(0, 0, 0)";
  return `rgb(${parseInt(m[1]!, 16)}, ${parseInt(m[2]!, 16)}, ${parseInt(m[3]!, 16)})`;
}

/** D11 — Pase `storeCard`: los sellos arriba (con aviso al cambiar), premio y lo que falta abajo. */
export function buildPassJson(input: PassInput): Record<string, unknown> {
  const shown = Math.min(input.stamps, input.stampsRequired);
  const left = Math.max(0, input.stampsRequired - input.stamps);
  const back: { key: string; label: string; value: string }[] = [
    { key: "how", label: "Cómo sumar", value: "Muestra el código en caja y el equipo suma tu sello." },
    { key: "web", label: "Tu tarjeta en la web", value: input.publicUrl },
  ];
  if (input.rewardsRedeemed > 0) {
    back.unshift({ key: "redeemed", label: "Premios canjeados", value: String(input.rewardsRedeemed) });
  }
  if (input.terms) back.push({ key: "terms", label: "Condiciones", value: input.terms });
  const barcode = {
    format: "PKBarcodeFormatQR",
    message: input.staffUrl,
    messageEncoding: "iso-8859-1",
  };
  return {
    formatVersion: 1,
    passTypeIdentifier: input.passTypeId,
    teamIdentifier: input.teamId,
    serialNumber: input.serialNumber,
    organizationName: input.organizationName,
    description: `Tarjeta de sellos de ${input.programName}`,
    logoText: input.programName,
    backgroundColor: hexToRgb(input.color),
    foregroundColor: hexToRgb(input.ink),
    labelColor: hexToRgb(input.ink),
    sharingProhibited: true,
    storeCard: {
      headerFields: [
        {
          key: "stamps",
          label: "SELLOS",
          value: `${shown}/${input.stampsRequired}`,
          changeMessage: "Tu tarjeta ahora tiene %@ sellos",
        },
      ],
      secondaryFields: [{ key: "reward", label: "PREMIO", value: input.reward }],
      auxiliaryFields: [
        input.paused
          ? { key: "left", label: "ESTADO", value: "En pausa" }
          : left === 0
            ? { key: "left", label: "ESTADO", value: "¡Completa! Pide tu premio", changeMessage: "%@" }
            : { key: "left", label: "TE FALTAN", value: `${left} sello${left === 1 ? "" : "s"}` },
      ],
      backFields: back,
    },
    barcodes: [barcode],
    barcode,
    ...(input.webService
      ? { webServiceURL: input.webService.url, authenticationToken: input.webService.authenticationToken }
      : {}),
  };
}

/** `manifest.json`: cada archivo con su SHA-1. Es lo único que ve el central (D8). */
export function buildManifest(files: PassFiles): Buffer {
  const out: Record<string, string> = {};
  for (const name of Object.keys(files).sort()) {
    out[name] = createHash("sha1").update(files[name]!).digest("hex");
  }
  return Buffer.from(JSON.stringify(out));
}

// ── Zip «store» ──────────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Buffer): number {
  let c = 0xffffffff;
  for (const byte of data) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Fecha y hora en formato DOS. Fija: el mismo pase da los mismos bytes. */
const DOS_TIME = 0;
const DOS_DATE = (2026 - 1980) << 9 | (1 << 5) | 1;

/**
 * Un zip sin compresión (método 0), suficiente para un `.pkpass`: Wallet
 * acepta «store», y así no hace falta una dependencia.
 */
export function zipStore(entries: [name: string, data: Buffer][]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, data] of entries) {
    const nameBytes = Buffer.from(name, "utf8");
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // versión necesaria
    local.writeUInt16LE(0x0800, 6); // nombres en UTF-8
    local.writeUInt16LE(0, 8); // store
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBytes, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // hecho por
    central.writeUInt16LE(20, 6); // versión necesaria
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    // extra, comentario, disco, atributos internos y externos: 0
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBytes);

    offset += 30 + nameBytes.length + data.length;
  }
  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

/** Lee un zip «store» (para las pruebas y el e2e): nombre → bytes. */
export function readZipStore(zip: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  let i = 0;
  while (i + 30 <= zip.length && zip.readUInt32LE(i) === 0x04034b50) {
    const method = zip.readUInt16LE(i + 8);
    const size = zip.readUInt32LE(i + 18);
    const nameLength = zip.readUInt16LE(i + 26);
    const extra = zip.readUInt16LE(i + 28);
    const name = zip.subarray(i + 30, i + 30 + nameLength).toString("utf8");
    const start = i + 30 + nameLength + extra;
    if (method !== 0) throw new Error(`compressed entry: ${name}`);
    out.set(name, zip.subarray(start, start + size));
    i = start + size;
  }
  return out;
}

/** El `.pkpass` entero: archivos, manifiesto y la firma que devolvió el central. */
export function assemblePkpass(files: PassFiles, manifest: Buffer, signature: Buffer): Buffer {
  const names = Object.keys(files).sort();
  return zipStore([
    ...names.map((n): [string, Buffer] => [n, files[n]!]),
    ["manifest.json", manifest],
    ["signature", signature],
  ]);
}
