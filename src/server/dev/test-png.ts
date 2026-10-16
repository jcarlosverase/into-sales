import { deflateSync } from "node:zlib";

/**
 * 018 — PNG real y pequeño para el wa-mock.
 *
 * La copia del creativo solo acepta imágenes de verdad por su `content-type`,
 * y la tarjeta de la bandeja se revisa en un navegador: con bytes de mentira se
 * vería un ícono roto y no se podría distinguir un anuncio de otro. El color
 * sale de la semilla, así que dos anuncios de prueba se ven distintos.
 */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = (CRC_TABLE[(c ^ b) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function block(kind: string, data: Buffer): Buffer {
  const long = Buffer.alloc(4);
  long.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(kind, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([long, body, crc]);
}

export function testPng(seed: string, side = 96): Buffer {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  const base = [h & 0xff, (h >>> 8) & 0xff, (h >>> 16) & 0xff];

  const width = side * 3 + 1;
  const pixels = Buffer.alloc(width * side);
  for (let y = 0; y < side; y++) {
    const row = y * width;
    pixels[row] = 0; // sin filtro
    for (let x = 0; x < side; x++) {
      const i = row + 1 + x * 3;
      // Degradado hacia el azul de la marca y un rectángulo claro al centro:
      // parece un creativo, no un bloque plano.
      const t = (x + y) / (2 * side);
      const center = x > side * 0.2 && x < side * 0.8 && y > side * 0.38 && y < side * 0.62;
      const brand = [13, 91, 255];
      for (let channel = 0; channel < 3; channel++) {
        pixels[i + channel] = center
          ? 245
          : Math.round((base[channel] ?? 0) * (1 - t) + (brand[channel] ?? 0) * t);
      }
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(side, 0);
  header.writeUInt32BE(side, 4);
  header[8] = 8; // bits por canal
  header[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    block("IHDR", header),
    block("IDAT", deflateSync(pixels)),
    block("IEND", Buffer.alloc(0)),
  ]);
}
