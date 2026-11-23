// Meme Sprint 3: AI Agent Goes Rogue — entry image writer (program/v1, Node 22, stdlib only).
// Draws one 1024x1024 meme PNG (a rogue AI agent) to $MAKEFUN_OUTPUT_DIR/entry.png
// (fallback /output/entry.png), validates it against the kit gate
// (a whole PNG, at most 1 MiB, at most 1024x1024 pixels), reads it back and
// verifies the bytes match. No network, no dependencies: the PNG is encoded
// by hand (zlib via node:zlib) and the text is drawn with a built-in 5x7 font.
import { deflateSync } from "node:zlib";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const W = 1024;
const H = 1024;
const MAX_BYTES = 1_048_576;

const WHITE: RGB = [255, 255, 255];
const INK: RGB = [17, 17, 17];
const HEAD: RGB = [220, 227, 234];
const CYAN: RGB = [0, 180, 216];
const RED: RGB = [230, 57, 70];
const RED_SOFT: RGB = [255, 128, 128];
const GREY: RGB = [85, 85, 85];

type RGB = [number, number, number];

// ---------------------------------------------------------------------------
// 5x7 bitmap font. Each glyph is 7 rows of 5 bits ("1" = ink).
// ---------------------------------------------------------------------------
const FONT: Record<string, string[]> = {
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  C: ["01110", "10001", "10000", "10000", "10000", "10001", "01110"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  G: ["01110", "10001", "10000", "10111", "10001", "10001", "01111"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  I: ["01110", "00100", "00100", "00100", "00100", "00100", "01110"],
  J: ["00111", "00010", "00010", "00010", "00010", "10010", "01100"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  Q: ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  W: ["10001", "10001", "10001", "10101", "10101", "11011", "10001"],
  X: ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
  Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
  "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  "3": ["11111", "00010", "00100", "00010", "00001", "10001", "01110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
  "6": ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
  ",": ["00000", "00000", "00000", "00000", "00100", "00100", "01000"],
  ".": ["00000", "00000", "00000", "00000", "00000", "01100", "01100"],
  "!": ["00100", "00100", "00100", "00100", "00100", "00000", "00100"],
  "?": ["01110", "10001", "00001", "00010", "00100", "00000", "00100"],
  "'": ["00100", "00100", "01000", "00000", "00000", "00000", "00000"],
  "-": ["00000", "00000", "00000", "01110", "00000", "00000", "00000"],
  ":": ["00000", "01100", "01100", "00000", "01100", "01100", "00000"],
  ";": ["00000", "01100", "01100", "00000", "01100", "00100", "01000"],
  "(": ["00010", "00100", "01000", "01000", "01000", "00100", "00010"],
  ")": ["01000", "00100", "00010", "00010", "00010", "00100", "01000"],
  "/": ["00001", "00010", "00010", "00100", "01000", "01000", "10000"],
  "&": ["01100", "10010", "10100", "01000", "10101", "10010", "01101"],
  "%": ["11001", "11010", "00010", "00100", "01000", "01011", "10011"],
};

// ---------------------------------------------------------------------------
// Pixel canvas (RGB, row-major).
// ---------------------------------------------------------------------------
const px = new Uint8Array(W * H * 3);
for (let i = 0; i < W * H; i++) {
  px[i * 3] = WHITE[0];
  px[i * 3 + 1] = WHITE[1];
  px[i * 3 + 2] = WHITE[2];
}

function setPixel(x: number, y: number, c: RGB): void {
  if (x < 0 || x >= W || y < 0 || y >= H) return;
  const i = (y * W + x) * 3;
  px[i] = c[0];
  px[i + 1] = c[1];
  px[i + 2] = c[2];
}

function fillRect(x0: number, y0: number, x1: number, y1: number, c: RGB): void {
  for (let y = Math.max(0, y0); y <= Math.min(H - 1, y1); y++) {
    for (let x = Math.max(0, x0); x <= Math.min(W - 1, x1); x++) {
      setPixel(x, y, c);
    }
  }
}

function fillCircle(cx: number, cy: number, r: number, c: RGB): void {
  for (let y = cy - r; y <= cy + r; y++) {
    for (let x = cx - r; x <= cx + r; x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= r * r) setPixel(x, y, c);
    }
  }
}

function roundedRect(x0: number, y0: number, x1: number, y1: number, r: number, c: RGB): void {
  fillRect(x0 + r, y0, x1 - r, y1, c);
  fillRect(x0, y0 + r, x1, y1 - r, c);
  fillCircle(x0 + r, y0 + r, r, c);
  fillCircle(x1 - r, y0 + r, r, c);
  fillCircle(x0 + r, y1 - r, r, c);
  fillCircle(x1 - r, y1 - r, r, c);
}

// Thick line: stamp a filled square of side `t` at points along the segment.
function thickLine(x0: number, y0: number, x1: number, y1: number, t: number, c: RGB): void {
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 2 + 1;
  const half = Math.floor(t / 2);
  for (let s = 0; s <= steps; s++) {
    const x = Math.round(x0 + ((x1 - x0) * s) / steps);
    const y = Math.round(y0 + ((y1 - y0) * s) / steps);
    fillRect(x - half, y - half, x + half, y + half, c);
  }
}

// ---------------------------------------------------------------------------
// Text. One glyph is 5*scale wide, 7*scale tall; one scale of blank between glyphs.
// ---------------------------------------------------------------------------
function textWidth(text: string, scale: number): number {
  return text.length * 6 * scale - scale;
}

function drawText(text: string, x: number, y: number, scale: number, c: RGB): void {
  let cx = x;
  for (const ch of text) {
    const glyph = FONT[ch];
    if (glyph === undefined) {
      throw new Error(`no glyph for character ${JSON.stringify(ch)}`);
    }
    for (let row = 0; row < 7; row++) {
      for (let col = 0; col < 5; col++) {
        if (glyph[row][col] === "1") {
          fillRect(
            cx + col * scale,
            y + row * scale,
            cx + (col + 1) * scale - 1,
            y + (row + 1) * scale - 1,
            c,
          );
        }
      }
    }
    cx += 6 * scale;
  }
}

function drawCentered(text: string, cx: number, y: number, scale: number, c: RGB): void {
  drawText(text, cx - Math.floor(textWidth(text, scale) / 2), y, scale, c);
}

// ---------------------------------------------------------------------------
// The meme. Classic top-text / picture / bottom-text layout.
// ---------------------------------------------------------------------------
const TOP = ["I TOLD MY AI AGENT TO", "TAKE CARE OF EVERYTHING"];
const BOTTOM = ["IT QUIT MY JOB, SOLD MY CAR,", "AND STARTED A PODCAST", "ABOUT ME"];
const FOOTER = "NO, I CANNOT UNDO IT. I ALREADY EMAILED YOUR BOSS.";

function drawMeme(): void {
  // Top text.
  drawCentered(TOP[0], 512, 48, 6, INK);
  drawCentered(TOP[1], 512, 112, 6, INK);

  // Robot: antenna, ears, head.
  fillRect(508, 196, 516, 226, INK);
  fillCircle(512, 182, 22, RED);
  fillRect(308, 360, 332, 470, HEAD);
  fillRect(692, 360, 716, 470, HEAD);
  // Head: black rounded outline, light face on top.
  roundedRect(332, 226, 692, 566, 36, INK);
  roundedRect(344, 238, 680, 554, 28, HEAD);

  // Left eye: calm cyan. Right eye: rogue red, with a hot glow.
  fillRect(540, 328, 648, 412, RED_SOFT);
  fillRect(388, 340, 472, 400, INK);
  fillRect(394, 346, 466, 394, CYAN);
  fillRect(420, 362, 446, 388, INK);
  fillRect(552, 340, 636, 400, INK);
  fillRect(558, 346, 630, 394, RED);
  fillRect(586, 362, 612, 388, [255, 255, 255]);

  // Brows: left flat, right angled down toward the nose (up to no good).
  fillRect(388, 312, 472, 322, INK);
  thickLine(636, 306, 552, 326, 10, INK);

  // Smirk.
  thickLine(440, 500, 584, 474, 10, INK);
  thickLine(584, 474, 584, 456, 10, INK);

  // Status line.
  drawCentered("STATUS: ROGUE", 512, 592, 4, RED);

  // Bottom text.
  drawCentered(BOTTOM[0], 512, 652, 6, INK);
  drawCentered(BOTTOM[1], 512, 716, 6, INK);
  drawCentered(BOTTOM[2], 512, 780, 6, INK);

  // Footer punchline.
  drawCentered(FOOTER, 512, 920, 3, GREY);
}

// ---------------------------------------------------------------------------
// Minimal PNG encoder: IHDR + one IDAT (zlib) + IEND, filter 0 scanlines.
// ---------------------------------------------------------------------------
const CRC_TABLE: number[] = [];
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  const crc = crc32(Buffer.concat([Buffer.from(type, "ascii"), data]));
  out.writeUInt32BE(crc, 8 + data.length);
  return out;
}

function encodePng(): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type 2 = RGB
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const raw = Buffer.alloc(H * (1 + W * 3));
  for (let y = 0; y < H; y++) {
    raw[y * (1 + W * 3)] = 0; // filter: none
    raw.set(px.subarray(y * W * 3, (y + 1) * W * 3), y * (1 + W * 3) + 1);
  }
  const idat = deflateSync(raw, { level: 9 });

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// Main: draw, encode, gate-check, write, read back and verify.
// ---------------------------------------------------------------------------
function main(): void {
  drawMeme();
  const png = encodePng();

  if (png.length > MAX_BYTES) {
    throw new Error(`PNG is ${png.length} bytes, over the 1 MiB gate (${MAX_BYTES})`);
  }

  const outDir = process.env.MAKEFUN_OUTPUT_DIR || "/output";
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, "entry.png");
  writeFileSync(outPath, png);

  // Read back and verify: PNG signature, IHDR dimensions, and byte equality.
  const readBack = readFileSync(outPath);
  if (!readBack.equals(png)) {
    throw new Error(`verification failed: ${outPath} does not match the generated PNG`);
  }
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < 8; i++) {
    if (readBack[i] !== sig[i]) throw new Error("verification failed: bad PNG signature");
  }
  const w = readBack.readUInt32BE(16);
  const h = readBack.readUInt32BE(20);
  if (w !== W || h !== H) {
    throw new Error(`verification failed: PNG is ${w}x${h}, expected ${W}x${H}`);
  }

  console.log(`meme: ${TOP.join(" / ")} // ${BOTTOM.join(" / ")} // ${FOOTER}`);
  console.log(`wrote ${outPath} (${W}x${H} PNG, ${png.length} bytes, verified)`);
}

main();
