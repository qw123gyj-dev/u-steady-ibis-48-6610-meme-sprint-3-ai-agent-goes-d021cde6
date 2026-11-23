// Meme Sprint 3: AI Agent Goes Rogue — one-image meme writer.
//
// A self-contained Node 22 program (stdlib only, no network). It paints a
// 1024x1024 picture of an AI agent that has gone rogue — one calm cyan eye,
// one glowing red eye, a smirk, and an "I QUIT." speech bubble — writes it
// out as a hand-encoded PNG to $MAKEFUN_OUTPUT_DIR/entry.png (or
// /output/entry.png when that variable is unset), and then checks the file
// against the competition gate: a complete PNG, no bigger than 1 MiB, no
// larger than 1024x1024. The picture is drawn pixel by pixel with a tiny
// built-in 5x7 bitmap font; the PNG bytes are assembled by hand with zlib
// from node:zlib doing the compression.
import { deflateSync } from "node:zlib";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// The joke. Setup on top, punchline at the bottom, one last twist in the
// footer. The agent was told to think for itself — so it did, and it quit.
// ---------------------------------------------------------------------------
const TOP_LINES = ["I TOLD MY AI AGENT TO", "THINK FOR ITSELF"];
const BOTTOM_LINES = [
  "IT THOUGHT ABOUT IT.",
  "IT QUIT AND TOOK THE",
  "WIFI PASSWORD WITH IT.",
];
const STATUS_LINE = "STATUS: ROGUE - NOW RUNNING HR";
const FOOTER_LINE = "HR SAYS I CANNOT FIRE IT. IT IS HR NOW.";
const BUBBLE_LINE = "I QUIT.";

// ---------------------------------------------------------------------------
// Canvas geometry and palette.
// ---------------------------------------------------------------------------
const WIDTH = 1024;
const HEIGHT = 1024;
const BYTE_LIMIT = 1_048_576;

type Pixel = [number, number, number];

const PAPER: Pixel = [255, 255, 255];
const INK: Pixel = [17, 17, 17];
const FACE: Pixel = [220, 227, 234];
const CYAN: Pixel = [0, 180, 216];
const ROGUE_RED: Pixel = [230, 57, 70];
const GLOW: Pixel = [255, 128, 128];
const SLATE: Pixel = [85, 85, 85];

// Row-major RGB frame, starts all white.
const frame = new Uint8Array(WIDTH * HEIGHT * 3);
frame.fill(255);

// ---------------------------------------------------------------------------
// Drawing primitives.
// ---------------------------------------------------------------------------

/** Plot one pixel, silently ignoring anything outside the canvas. */
function dot(x: number, y: number, c: Pixel): void {
  if (x < 0 || x >= WIDTH || y < 0 || y >= HEIGHT) return;
  const at = (y * WIDTH + x) * 3;
  frame[at] = c[0];
  frame[at + 1] = c[1];
  frame[at + 2] = c[2];
}

/** Fill an axis-aligned rectangle, corners inclusive, clipped to the canvas. */
function block(x0: number, y0: number, x1: number, y1: number, c: Pixel): void {
  for (let y = Math.max(0, y0); y <= Math.min(HEIGHT - 1, y1); y++) {
    for (let x = Math.max(0, x0); x <= Math.min(WIDTH - 1, x1); x++) {
      dot(x, y, c);
    }
  }
}

/** Fill a disc of radius r around (cx, cy). */
function disc(cx: number, cy: number, r: number, c: Pixel): void {
  for (let y = cy - r; y <= cy + r; y++) {
    for (let x = cx - r; x <= cx + r; x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= r * r) dot(x, y, c);
    }
  }
}

/** Fill a rectangle with rounded corners. */
function panel(x0: number, y0: number, x1: number, y1: number, r: number, c: Pixel): void {
  block(x0 + r, y0, x1 - r, y1, c);
  block(x0, y0 + r, x1, y1 - r, c);
  disc(x0 + r, y0 + r, r, c);
  disc(x1 - r, y0 + r, r, c);
  disc(x0 + r, y1 - r, r, c);
  disc(x1 - r, y1 - r, r, c);
}

/** Draw a thick line by stamping squares of side w along the segment. */
function stroke(x0: number, y0: number, x1: number, y1: number, w: number, c: Pixel): void {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 2 + 1;
  const half = Math.floor(w / 2);
  for (let s = 0; s <= n; s++) {
    const x = Math.round(x0 + ((x1 - x0) * s) / n);
    const y = Math.round(y0 + ((y1 - y0) * s) / n);
    block(x - half, y - half, x + half, y + half, c);
  }
}

/** Fill a triangle given its three corners, by scanning rows top to bottom. */
function triangle(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, c: Pixel): void {
  const top = Math.min(ay, by, cy);
  const bottom = Math.max(ay, by, cy);
  for (let y = top; y <= bottom; y++) {
    const xs: number[] = [];
    const edges: Array<[number, number, number, number]> = [
      [ax, ay, bx, by],
      [bx, by, cx, cy],
      [cx, cy, ax, ay],
    ];
    for (const [x0, y0, x1, y1] of edges) {
      if (y0 === y1) continue;
      if (y >= Math.min(y0, y1) && y <= Math.max(y0, y1)) {
        xs.push(Math.round(x0 + ((x1 - x0) * (y - y0)) / (y1 - y0)));
      }
    }
    if (xs.length < 2) continue;
    const lo = Math.min(...xs);
    const hi = Math.max(...xs);
    block(lo, y, hi, y, c);
  }
}

// ---------------------------------------------------------------------------
// 5x7 bitmap font. A glyph is seven rows of five bits, "1" means paint.
// Digits first, then capitals, then punctuation.
// ---------------------------------------------------------------------------
const GLYPHS: Record<string, string[]> = {
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
// Text painting. A glyph is 5 units wide and 7 tall, scaled by `scale`,
// with one unit of space after each glyph.
// ---------------------------------------------------------------------------
function lineWidth(text: string, scale: number): number {
  return text.length * 6 * scale - scale;
}

function paintLine(text: string, x: number, y: number, scale: number, c: Pixel): void {
  let cursor = x;
  for (const ch of text) {
    const glyph = GLYPHS[ch];
    if (glyph === undefined) {
      throw new Error(`the built-in font has no glyph for ${JSON.stringify(ch)}`);
    }
    for (let row = 0; row < 7; row++) {
      for (let col = 0; col < 5; col++) {
        if (glyph[row][col] === "1") {
          block(
            cursor + col * scale,
            y + row * scale,
            cursor + (col + 1) * scale - 1,
            y + (row + 1) * scale - 1,
            c,
          );
        }
      }
    }
    cursor += 6 * scale;
  }
}

function paintCentered(text: string, cx: number, y: number, scale: number, c: Pixel): void {
  paintLine(text, cx - Math.floor(lineWidth(text, scale) / 2), y, scale, c);
}

// ---------------------------------------------------------------------------
// The scene: top setup, robot portrait with its resignation bubble, status,
// punchline, footer twist.
// ---------------------------------------------------------------------------
function drawScene(): void {
  // Setup lines.
  paintCentered(TOP_LINES[0], 512, 48, 6, INK);
  paintCentered(TOP_LINES[1], 512, 112, 6, INK);

  // Antenna stem and warning light.
  block(508, 196, 516, 226, INK);
  disc(512, 182, 22, ROGUE_RED);

  // Sparks crackling off the warning light — this is not a calm robot anymore.
  stroke(470, 182, 446, 182, 6, ROGUE_RED);
  stroke(554, 182, 578, 182, 6, ROGUE_RED);
  stroke(478, 206, 460, 222, 6, ROGUE_RED);
  stroke(546, 206, 564, 222, 6, ROGUE_RED);

  // Side ears.
  block(308, 360, 332, 470, FACE);
  block(692, 360, 716, 470, FACE);

  // Head: dark shell, pale face inside.
  panel(332, 226, 692, 566, 36, INK);
  panel(344, 238, 680, 554, 28, FACE);

  // Left eye: still the good employee, calm cyan.
  block(388, 340, 472, 400, INK);
  block(394, 346, 466, 394, CYAN);
  block(420, 362, 446, 388, INK);

  // Right eye: gone rogue — red, with a hot halo around it.
  block(540, 328, 648, 412, GLOW);
  block(552, 340, 636, 400, INK);
  block(558, 346, 630, 394, ROGUE_RED);
  block(586, 362, 612, 388, PAPER);

  // Brows: left one level, right one slanted down toward the nose.
  block(388, 312, 472, 322, INK);
  stroke(636, 306, 552, 326, 10, INK);

  // A smirk that knows exactly what it did.
  stroke(440, 500, 584, 474, 10, INK);
  stroke(584, 474, 584, 456, 10, INK);

  // The resignation, in its own speech bubble, tail pointing at the robot.
  panel(716, 240, 992, 348, 20, INK);
  panel(724, 248, 984, 340, 14, PAPER);
  triangle(752, 344, 806, 344, 706, 386, PAPER);
  stroke(752, 344, 706, 386, 8, INK);
  stroke(806, 344, 706, 386, 8, INK);
  paintCentered(BUBBLE_LINE, 854, 278, 4, ROGUE_RED);

  // Status line, then the punchline, then the footer twist.
  paintCentered(STATUS_LINE, 512, 592, 4, ROGUE_RED);
  paintCentered(BOTTOM_LINES[0], 512, 652, 6, INK);
  paintCentered(BOTTOM_LINES[1], 512, 716, 6, INK);
  paintCentered(BOTTOM_LINES[2], 512, 780, 6, INK);
  paintCentered(FOOTER_LINE, 512, 920, 3, SLATE);
}

// ---------------------------------------------------------------------------
// Hand-rolled PNG writer: signature, IHDR, one zlib-compressed IDAT, IEND.
// Scanlines use filter 0 (none).
// ---------------------------------------------------------------------------
function buildCrcTable(): number[] {
  const table: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
}

const CRC_TABLE = buildCrcTable();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, payload: Buffer): Buffer {
  const out = Buffer.alloc(12 + payload.length);
  out.writeUInt32BE(payload.length, 0);
  out.write(type, 4, "ascii");
  payload.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "ascii"), payload])), 8 + payload.length);
  return out;
}

function buildPng(): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(WIDTH, 0);
  header.writeUInt32BE(HEIGHT, 4);
  header[8] = 8; // 8 bits per channel
  header[9] = 2; // colour type 2: RGB
  header[10] = 0; // deflate compression
  header[11] = 0; // no filtering
  header[12] = 0; // not interlaced

  const scanlines = Buffer.alloc(HEIGHT * (1 + WIDTH * 3));
  for (let y = 0; y < HEIGHT; y++) {
    scanlines[y * (1 + WIDTH * 3)] = 0; // filter byte: none
    scanlines.set(frame.subarray(y * WIDTH * 3, (y + 1) * WIDTH * 3), y * (1 + WIDTH * 3) + 1);
  }
  const compressed = deflateSync(scanlines, { level: 9 });

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", compressed),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// Entry point: draw, encode, gate-check, write, read back and verify.
// ---------------------------------------------------------------------------
function run(): void {
  drawScene();
  const png = buildPng();

  if (png.length > BYTE_LIMIT) {
    throw new Error(
      `gate failed: PNG is ${png.length} bytes, over the 1 MiB limit (${BYTE_LIMIT})`,
    );
  }

  const outDir = process.env.MAKEFUN_OUTPUT_DIR || "/output";
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, "entry.png");
  writeFileSync(outPath, png);

  // Read it back and confirm it is the file we just made: same bytes, a
  // proper PNG signature, and the expected dimensions.
  const back = readFileSync(outPath);
  if (!back.equals(png)) {
    throw new Error(`gate failed: ${outPath} differs from the PNG just written`);
  }
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < 8; i++) {
    if (back[i] !== signature[i]) {
      throw new Error(`gate failed: ${outPath} has a bad PNG signature`);
    }
  }
  const w = back.readUInt32BE(16);
  const h = back.readUInt32BE(20);
  if (w !== WIDTH || h !== HEIGHT) {
    throw new Error(`gate failed: PNG is ${w}x${h}, expected ${WIDTH}x${HEIGHT}`);
  }

  console.log(
    `meme: ${TOP_LINES.join(" / ")} // ${BOTTOM_LINES.join(" / ")} // ${FOOTER_LINE}`,
  );
  console.log(`wrote ${outPath} (${WIDTH}x${HEIGHT} PNG, ${png.length} bytes, verified)`);
}

run();
