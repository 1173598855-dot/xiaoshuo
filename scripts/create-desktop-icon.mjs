import { Buffer } from "node:buffer";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

import pngToIco from "png-to-ico";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const assetsDirectory = path.join(root, "assets");
const buildDirectory = path.join(root, "build");
const pngPath = path.join(assetsDirectory, "desktop-icon.png");
const icoPath = path.join(buildDirectory, "icon.ico");
const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

await mkdir(assetsDirectory, { recursive: true });
await mkdir(buildDirectory, { recursive: true });

const png = createIconPng(1024);
await writeFile(pngPath, png);
await writeFile(icoPath, await pngToIco(pngPath));

console.log(
  "Created " + path.relative(root, pngPath) + " and " + path.relative(root, icoPath),
);

function createIconPng(size) {
  const pixels = Buffer.alloc(size * size * 4);
  fillRoundedRect(pixels, size, 64, 64, size - 128, size - 128, 132, [28, 67, 58, 255]);
  fillRoundedRect(pixels, size, 166, 118, 692, 790, 56, [15, 43, 38, 255]);
  fillRoundedRect(pixels, size, 214, 166, 596, 690, 34, [247, 250, 242, 255]);
  fillRoundedRect(pixels, size, 214, 166, 596, 104, 34, [210, 230, 213, 255]);

  drawLine(pixels, size, 380, 300, 512, 238, 38, [28, 67, 58, 255]);
  drawLine(pixels, size, 512, 238, 644, 300, 38, [28, 67, 58, 255]);
  drawLine(pixels, size, 512, 238, 512, 610, 38, [28, 67, 58, 255]);
  drawLine(pixels, size, 342, 490, 682, 490, 38, [28, 67, 58, 255]);
  drawLine(pixels, size, 386, 650, 512, 560, 38, [28, 67, 58, 255]);
  drawLine(pixels, size, 638, 650, 512, 560, 38, [28, 67, 58, 255]);
  drawLine(pixels, size, 512, 610, 512, 716, 38, [28, 67, 58, 255]);

  for (let index = 0; index < 4; index += 1) {
    drawLine(
      pixels,
      size,
      282,
      746 + index * 48,
      742,
      746 + index * 48,
      12,
      [145, 174, 151, 255],
    );
  }

  return encodePng(size, size, pixels);
}

function fillRoundedRect(pixels, size, x, y, width, height, radius, color) {
  for (let py = y; py < y + height; py += 1) {
    for (let px = x; px < x + width; px += 1) {
      const dx = Math.max(x + radius - px, 0, px - (x + width - radius - 1));
      const dy = Math.max(y + radius - py, 0, py - (y + height - radius - 1));
      if (dx * dx + dy * dy <= radius * radius) {
        setPixel(pixels, size, px, py, color);
      }
    }
  }
}

function drawLine(pixels, size, x1, y1, x2, y2, thickness, color) {
  const radius = Math.max(1, Math.floor(thickness / 2));
  const distance = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
  for (let step = 0; step <= distance; step += 1) {
    const ratio = distance === 0 ? 0 : step / distance;
    const x = Math.round(x1 + (x2 - x1) * ratio);
    const y = Math.round(y1 + (y2 - y1) * ratio);
    fillCircle(pixels, size, x, y, radius, color);
  }
}

function fillCircle(pixels, size, centerX, centerY, radius, color) {
  for (let y = centerY - radius; y <= centerY + radius; y += 1) {
    for (let x = centerX - radius; x <= centerX + radius; x += 1) {
      if ((x - centerX) ** 2 + (y - centerY) ** 2 <= radius ** 2) {
        setPixel(pixels, size, x, y, color);
      }
    }
  }
}

function setPixel(pixels, size, x, y, color) {
  if (x < 0 || y < 0 || x >= size || y >= size) {
    return;
  }

  const offset = (y * size + x) * 4;
  pixels.set(color, offset);
}

function encodePng(width, height, pixels) {
  const scanlines = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * (width * 4 + 1);
    scanlines[rowOffset] = 0;
    pixels.copy(scanlines, rowOffset + 1, y * width * 4, (y + 1) * width * 4);
  }

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const header = pngChunk("IHDR", Buffer.from([
    (width >>> 24) & 255,
    (width >>> 16) & 255,
    (width >>> 8) & 255,
    width & 255,
    (height >>> 24) & 255,
    (height >>> 16) & 255,
    (height >>> 8) & 255,
    height & 255,
    8,
    6,
    0,
    0,
    0,
  ]));
  const data = pngChunk("IDAT", deflateSync(scanlines));
  const end = pngChunk("IEND", Buffer.alloc(0));
  return Buffer.concat([signature, header, data, end]);
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) {
    value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  }
  return (value ^ 0xffffffff) >>> 0;
}
