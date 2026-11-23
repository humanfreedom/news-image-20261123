// news-image-20261123 — "The World in One Day"
// A code-drawn newspaper front page summing up Monday 23 November 2026.
// 100% original: own PNG encoder, own 5x7 bitmap font, own layout.
// Deterministic: no clock, no randomness, no network. Stdlib only.
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------- PNG ----
// CRC32 (IEEE, reflected, poly 0xEDB88320), table built once.
const CRC_TABLE: Uint32Array = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function u32be(n: number): Uint8Array {
  const b = new Uint8Array(4);
  b[0] = (n >>> 24) & 0xff;
  b[1] = (n >>> 16) & 0xff;
  b[2] = (n >>> 8) & 0xff;
  b[3] = n & 0xff;
  return b;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  out.set(u32be(data.length), 0);
  const typeBytes = new TextEncoder().encode(type);
  out.set(typeBytes, 4);
  out.set(data, 8);
  const crcData = new Uint8Array(4 + data.length);
  crcData.set(typeBytes, 0);
  crcData.set(data, 4);
  out.set(u32be(crc32(crcData)), 8 + data.length);
  return out;
}

// Encode an RGB buffer (w*h*3) as a PNG (8-bit, colour type 2, no interlace).
function encodePNG(w: number, h: number, rgb: Uint8Array): Uint8Array {
  const ihdr = new Uint8Array(13);
  ihdr.set(u32be(w), 0);
  ihdr.set(u32be(h), 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: RGB
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  // Raw scanlines: filter byte 0 (None) + RGB bytes per row.
  const raw = new Uint8Array(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 3)] = 0;
    raw.set(rgb.subarray(y * w * 3, (y + 1) * w * 3), y * (1 + w * 3) + 1);
  }
  const idat = deflateSync(raw, { level: 9 });
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const parts = [
    sig,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", new Uint8Array(0)),
  ];
  const total = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

// ------------------------------------------------------------- Canvas ----
const W = 1024;
const H = 1024;
type RGB = [number, number, number];
const PAPER: RGB = [252, 250, 246]; // warm paper white
const INK: RGB = [18, 18, 18];
const RED: RGB = [176, 32, 32]; // deep red accent
const GRAY: RGB = [110, 108, 104];

const canvas = new Uint8Array(W * H * 3);
for (let i = 0; i < W * H; i++) {
  canvas[i * 3] = PAPER[0];
  canvas[i * 3 + 1] = PAPER[1];
  canvas[i * 3 + 2] = PAPER[2];
}

function setPixel(x: number, y: number, c: RGB): void {
  if (x < 0 || x >= W || y < 0 || y >= H) return;
  const i = (y * W + x) * 3;
  canvas[i] = c[0];
  canvas[i + 1] = c[1];
  canvas[i + 2] = c[2];
}

function fillRect(x: number, y: number, w: number, h: number, c: RGB): void {
  const x0 = Math.max(0, Math.floor(x));
  const y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(W, Math.ceil(x + w));
  const y1 = Math.min(H, Math.ceil(y + h));
  for (let yy = y0; yy < y1; yy++) {
    for (let xx = x0; xx < x1; xx++) {
      const i = (yy * W + xx) * 3;
      canvas[i] = c[0];
      canvas[i + 1] = c[1];
      canvas[i + 2] = c[2];
    }
  }
}

function hline(x: number, y: number, w: number, c: RGB): void {
  fillRect(x, y, w, 1, c);
}

// Bresenham line.
function line(x0: number, y0: number, x1: number, y1: number, c: RGB): void {
  let dx = Math.abs(x1 - x0);
  let dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0;
  let y = y0;
  for (;;) {
    setPixel(x, y, c);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}

// Filled circle (scanline).
function fillCircle(cx: number, cy: number, r: number, c: RGB): void {
  for (let dy = -r; dy <= r; dy++) {
    const dx = Math.floor(Math.sqrt(r * r - dy * dy));
    fillRect(cx - dx, cy + dy, dx * 2 + 1, 1, c);
  }
}

// Circle outline (parametric, 1px).
function circleOutline(cx: number, cy: number, r: number, c: RGB): void {
  for (let a = 0; a < 360; a += 1) {
    const rad = (a * Math.PI) / 180;
    setPixel(Math.round(cx + r * Math.cos(rad)), Math.round(cy + r * Math.sin(rad)), c);
  }
}

// Ellipse outline (parametric, 1px).
function ellipseOutline(cx: number, cy: number, rx: number, ry: number, c: RGB): void {
  for (let a = 0; a < 360; a += 1) {
    const rad = (a * Math.PI) / 180;
    setPixel(Math.round(cx + rx * Math.cos(rad)), Math.round(cy + ry * Math.sin(rad)), c);
  }
}

// Filled triangle (scanline over bounding box, barycentric sign test).
function fillTriangle(
  x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, c: RGB,
): void {
  const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2)));
  const maxX = Math.min(W - 1, Math.ceil(Math.max(x0, x1, x2)));
  const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2)));
  const maxY = Math.min(H - 1, Math.ceil(Math.max(y0, y1, y2)));
  const d = (x1 - x0) * (y2 - y0) - (y1 - y0) * (x2 - x0);
  if (d === 0) return;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const s = ((x - x0) * (y2 - y0) - (y - y0) * (x2 - x0)) / d;
      const t = ((y - y0) * (x1 - x0) - (x - x0) * (y1 - y0)) / d;
      if (s >= 0 && t >= 0 && s + t <= 1) setPixel(x, y, c);
    }
  }
}

// --------------------------------------------------------------- Font ----
// Hand-drawn 5x7 bitmap font. '#' = ink, '.' = blank. All caps by design:
// the page is set in capitals, like a newspaper front page.
const FONT: Record<string, string[]> = {
  A: [".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  B: ["####.", "#...#", "#...#", "####.", "#...#", "#...#", "####."],
  C: [".####", "#....", "#....", "#....", "#....", "#....", ".####"],
  D: ["####.", "#...#", "#...#", "#...#", "#...#", "#...#", "####."],
  E: ["#####", "#....", "#....", "####.", "#....", "#....", "#####"],
  F: ["#####", "#....", "#....", "####.", "#....", "#....", "#...."],
  G: [".####", "#....", "#....", "#..##", "#...#", "#...#", ".###."],
  H: ["#...#", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  I: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "#####"],
  J: ["..###", "...#.", "...#.", "...#.", "...#.", "#..#.", ".##.."],
  K: ["#...#", "#..#.", "#.#..", "##...", "#.#..", "#..#.", "#...#"],
  L: ["#....", "#....", "#....", "#....", "#....", "#....", "#####"],
  M: ["#...#", "##.##", "#.#.#", "#.#.#", "#...#", "#...#", "#...#"],
  N: ["#...#", "##..#", "##..#", "#.#.#", "#..##", "#..##", "#...#"],
  O: [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  P: ["####.", "#...#", "#...#", "####.", "#....", "#....", "#...."],
  Q: [".###.", "#...#", "#...#", "#...#", "#.#.#", "#..#.", ".##.#"],
  R: ["####.", "#...#", "#...#", "####.", "#.#..", "#..#.", "#...#"],
  S: [".####", "#....", "#....", ".###.", "....#", "....#", "####."],
  T: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."],
  U: ["#...#", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  V: ["#...#", "#...#", "#...#", "#...#", "#...#", ".#.#.", "..#.."],
  W: ["#...#", "#...#", "#...#", "#.#.#", "#.#.#", "##.##", "#...#"],
  X: ["#...#", "#...#", ".#.#.", "..#..", ".#.#.", "#...#", "#...#"],
  Y: ["#...#", "#...#", ".#.#.", "..#..", "..#..", "..#..", "..#.."],
  Z: ["#####", "....#", "...#.", "..#..", ".#...", "#....", "#####"],
  "0": [".###.", "#...#", "#..##", "#.#.#", "##..#", "#...#", ".###."],
  "1": ["..#..", ".##..", "..#..", "..#..", "..#..", "..#..", ".###."],
  "2": [".###.", "#...#", "....#", "...#.", "..#..", ".#...", "#####"],
  "3": ["####.", "....#", "....#", ".###.", "....#", "....#", "####."],
  "4": ["...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#."],
  "5": ["#####", "#....", "####.", "....#", "....#", "#...#", ".###."],
  "6": [".###.", "#....", "#....", "####.", "#...#", "#...#", ".###."],
  "7": ["#####", "....#", "...#.", "...#.", "..#..", "..#..", "..#.."],
  "8": [".###.", "#...#", "#...#", ".###.", "#...#", "#...#", ".###."],
  "9": [".###.", "#...#", "#...#", ".####", "....#", "....#", ".###."],
  " ": [".....", ".....", ".....", ".....", ".....", ".....", "....."],
  ".": [".....", ".....", ".....", ".....", ".....", ".##..", ".##.."],
  ",": [".....", ".....", ".....", ".....", ".##..", ".##..", ".#..."],
  ":": [".....", ".##..", ".##..", ".....", ".##..", ".##..", "....."],
  ";": [".....", ".##..", ".##..", ".....", ".##..", ".##..", ".#..."],
  "'": ["..#..", "..#..", ".#...", ".....", ".....", ".....", "....."],
  "!": ["..#..", "..#..", "..#..", "..#..", "..#..", ".....", "..#.."],
  "?": [".###.", "#...#", "....#", "...#.", "..#..", ".....", "..#.."],
  "-": [".....", ".....", ".....", ".###.", ".....", ".....", "....."],
  "—": [".....", ".....", ".....", "#####", ".....", ".....", "....."],
  "(": ["...##", "..#..", ".#...", ".#...", ".#...", "..#..", "...##"],
  ")": ["##...", "..#..", "...#.", "...#.", "...#.", "..#..", "##..."],
  "/": ["....#", "....#", "...#.", "...#.", "..#..", ".#...", "#...."],
  "%": ["##..#", "##.#.", "...#.", "..#..", ".#...", "#.##.", "#..##"],
  "&": [".###.", "#...#", "#.#..", ".#...", "#.#.#", "#..#.", ".##.#"],
  "+": [".....", "..#..", "..#..", ".###.", "..#..", "..#..", "....."],
  "=": [".....", ".....", ".###.", ".....", ".###.", ".....", "....."],
  '"': [".#.#.", ".#.#.", ".....", ".....", ".....", ".....", "....."],
};

function normalizeText(s: string): string {
  return s
    .toUpperCase()
    .replace(/[’‘]/g, "'")
    .replace(/[–]/g, "-");
}

// Pixel width of a string at a given scale (5px glyph + 1px gap per char).
function textWidth(s: string, scale: number): number {
  const n = normalizeText(s).length;
  return n === 0 ? 0 : n * 6 * scale - scale;
}

function drawText(s: string, x: number, y: number, scale: number, c: RGB): void {
  const t = normalizeText(s);
  let cx = x;
  for (const ch of t) {
    const g = FONT[ch] || FONT[" "];
    for (let r = 0; r < 7; r++) {
      const row = g[r];
      for (let col = 0; col < 5; col++) {
        if (row[col] === "#") fillRect(cx + col * scale, y + r * scale, scale, scale, c);
      }
    }
    cx += 6 * scale;
  }
}

function drawTextCentered(s: string, cx: number, y: number, scale: number, c: RGB): void {
  drawText(s, Math.round(cx - textWidth(s, scale) / 2), y, scale, c);
}

// Greedy word wrap. Returns lines whose pixel width fits maxW.
function wrapText(s: string, maxW: number, scale: number): string[] {
  const words = normalizeText(s).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const test = cur ? cur + " " + w : w;
    if (textWidth(test, scale) <= maxW) {
      cur = test;
    } else {
      if (cur) lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

// -------------------------------------------------------------- Icons ----
// Simple geometric pictograms, drawn in a (bx, by, bw, bh) box.
// Abstract and clean: the text carries the meaning, the icon anchors it.
function iconShip(bx: number, by: number): void {
  // Tanker: containers, bridge, long hull, waves.
  fillRect(bx + 8, by + 6, 22, 12, INK); // bridge
  fillRect(bx + 34, by + 12, 52, 8, RED); // containers
  fillRect(bx + 90, by + 4, 10, 16, INK); // funnel
  fillRect(bx, by + 20, 108, 10, INK); // deck
  fillTriangle(bx + 108, by + 20, bx + 122, by + 26, bx + 108, by + 32, INK); // bow
  fillRect(bx + 4, by + 30, 104, 8, INK); // hull
  for (let i = 0; i < 3; i++) {
    const wy = by + 46 + i * 5;
    for (let wx = bx; wx < bx + 122; wx += 18) fillRect(wx, wy, 11, 3, INK);
  }
}

function iconBlast(bx: number, by: number): void {
  // Warship: hull + superstructure, hit by a large blast starburst.
  fillRect(bx + 10, by + 36, 102, 10, INK); // hull
  fillTriangle(bx + 112, by + 36, bx + 122, by + 41, bx + 112, by + 46, INK); // bow
  fillRect(bx + 48, by + 26, 26, 10, INK); // superstructure
  line(bx + 61, by + 26, bx + 61, by + 18, INK); // mast
  // Blast starburst above the mast: 12 alternating long/short rays.
  const cx = bx + 61;
  const cy = by + 10;
  for (let a = 0; a < 12; a++) {
    const rad = (a * Math.PI) / 6;
    const len = a % 2 === 0 ? 16 : 10;
    line(cx, cy, Math.round(cx + len * Math.cos(rad)), Math.round(cy + len * Math.sin(rad)), RED);
  }
  fillCircle(cx, cy, 6, RED);
  fillCircle(cx, cy, 3, PAPER); // hot core
  // smoke puffs flanking the blast
  fillCircle(bx + 24, by + 14, 6, INK);
  fillCircle(bx + 100, by + 16, 5, INK);
}

function iconBuilding(bx: number, by: number): void {
  // Apartment block with a jagged broken top, rubble, a small drone above.
  fillRect(bx + 30, by + 14, 60, 40, INK); // block
  fillTriangle(bx + 30, by + 14, bx + 45, by + 4, bx + 60, by + 14, PAPER); // broken notch
  fillTriangle(bx + 60, by + 14, bx + 75, by + 6, bx + 90, by + 14, PAPER); // broken notch
  // windows (paper cutouts)
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 4; c++) {
      fillRect(bx + 36 + c * 13, by + 20 + r * 11, 7, 6, PAPER);
    }
  }
  // rubble at the base
  fillRect(bx + 22, by + 54, 10, 4, INK);
  fillRect(bx + 88, by + 54, 12, 4, INK);
  fillRect(bx + 56, by + 56, 8, 3, RED);
  // drone above (small quadcopter: body, rotor bar, red light)
  const dx = bx + 105;
  const dy = by + 8;
  fillRect(dx - 5, dy - 3, 10, 6, INK);
  hline(dx - 12, dy - 6, 24, INK); // rotor bar
  fillCircle(dx, dy, 2, RED);
}

function iconBallot(bx: number, by: number): void {
  // Ballot box with a slot, a ballot paper going in, a check mark.
  fillRect(bx + 34, by + 22, 54, 32, INK); // box
  fillRect(bx + 44, by + 18, 34, 4, PAPER); // slot
  fillRect(bx + 50, by + 0, 22, 18, RED); // ballot paper
  fillRect(bx + 54, by + 5, 14, 2, PAPER); // text lines on the ballot
  fillRect(bx + 54, by + 10, 14, 2, PAPER);
  // check mark on the box (two passes for a bolder stroke)
  line(bx + 42, by + 38, bx + 52, by + 48, PAPER);
  line(bx + 52, by + 48, bx + 74, by + 28, PAPER);
  line(bx + 42, by + 39, bx + 52, by + 49, PAPER);
  line(bx + 52, by + 49, bx + 74, by + 29, PAPER);
}

function iconGlobe(bx: number, by: number): void {
  // Globe with a bold crack through it.
  const cx = bx + 56;
  const cy = by + 28;
  circleOutline(cx, cy, 23, INK);
  ellipseOutline(cx, cy, 23, 10, INK); // equator
  ellipseOutline(cx, cy, 10, 23, INK); // meridian
  // crack: zigzag across the globe, drawn twice for a 2px stroke
  line(cx - 21, cy - 15, cx - 9, cy - 3, RED);
  line(cx - 9, cy - 3, cx - 15, cy + 9, RED);
  line(cx - 15, cy + 9, cx + 1, cy + 17, RED);
  line(cx + 1, cy + 17, cx + 15, cy + 21, RED);
  line(cx - 21, cy - 14, cx - 9, cy - 2, RED);
  line(cx - 9, cy - 2, cx - 15, cy + 10, RED);
  line(cx - 15, cy + 10, cx + 1, cy + 18, RED);
  line(cx + 1, cy + 18, cx + 15, cy + 22, RED);
}

function iconPlanet(bx: number, by: number): void {
  // Mercury with craters, an orbit ellipse, a small spacecraft, stars.
  const cx = bx + 52;
  const cy = by + 30;
  ellipseOutline(cx, cy, 56, 18, GRAY); // orbit
  fillCircle(cx, cy, 20, INK); // planet
  fillCircle(cx - 7, cy - 5, 4, PAPER); // crater
  fillCircle(cx + 6, cy + 6, 3, PAPER); // crater
  fillCircle(cx + 9, cy - 8, 2, PAPER); // crater
  // spacecraft on the orbit (top right)
  fillRect(bx + 96, by + 6, 10, 8, RED);
  fillRect(bx + 88, by + 8, 8, 4, INK);
  fillRect(bx + 106, by + 8, 8, 4, INK);
  // stars
  fillRect(bx + 4, by + 4, 3, 3, INK);
  fillRect(bx + 14, by + 52, 3, 3, INK);
  fillRect(bx + 112, by + 48, 3, 3, INK);
}

const ICONS: Record<string, (bx: number, by: number) => void> = {
  ship: iconShip,
  blast: iconBlast,
  building: iconBuilding,
  ballot: iconBallot,
  globe: iconGlobe,
  planet: iconPlanet,
};

// ------------------------------------------------------------ Content ----
// Verified facts only (reported 22-23 Nov 2026, AP / Reuters / AFP /
// Al Jazeera / UKMTO). No hype, no speculation.
type Story = { kicker: string; headline: string; summary: string; icon: string };
const STORIES: Story[] = [
  {
    kicker: "STRAIT OF HORMUZ",
    headline: "TANKERS HIT IN STRAIT OF HORMUZ",
    summary: "AT LEAST THREE HIT FRI-SAT. TWO MORE ON FIRE SUNDAY AFTER MINES.",
    icon: "ship",
  },
  {
    kicker: "BENGHAZI, LIBYA",
    headline: "DRONE STRIKE HITS RUSSIAN WARSHIP",
    summary: "SUSPECTED UKRAINIAN DRONES HIT THE MERKURY. IT CAPSIZED; 10 INJURED.",
    icon: "blast",
  },
  {
    kicker: "DYMER, UKRAINE",
    headline: "DRONE HITS FLATS NORTH OF KYIV",
    summary: "A RUSSIAN DRONE HIT A BLOCK IN DYMER. 2 KILLED, 11 MISSING, 2 CHILDREN.",
    icon: "building",
  },
  {
    kicker: "UNITED STATES",
    headline: "DEMOCRATS WIN HOUSE MAJORITY",
    summary: "THEIR LARGEST SINCE 1992, AFTER FLIPPING A NORTH CAROLINA SEAT.",
    icon: "ballot",
  },
  {
    kicker: "CLIMATE TALKS",
    headline: "COP31 CLIMATE TALKS COLLAPSE",
    summary: "TALKS ENDED WITH NO DEAL. ALBANESE CITED DIFFICULT GEOPOLITICAL TIMES.",
    icon: "globe",
  },
  {
    kicker: "SPACE — MERCURY",
    headline: "BEPICOLOMBO REACHES MERCURY",
    summary: "AFTER EIGHT YEARS, IT ENTERED ORBIT ON 21 NOV. ONLY THE SECOND EVER.",
    icon: "planet",
  },
];

// ------------------------------------------------------------- Layout ----
const MARGIN_X = 40;
const CONTENT_W = W - MARGIN_X * 2; // 944
const COL_W = 460;
const COL_GAP = CONTENT_W - COL_W * 2; // 24
const ROW_H = 258;
const ROW_GAP = 12;
const STORIES_Y = 158;

function drawStoryBlock(s: Story, bx: number, by: number): void {
  // Kicker (red, small caps).
  drawText(s.kicker, bx, by, 2, RED);
  // Headline, up to 2 lines, large.
  const headLines = wrapText(s.headline, COL_W, 4).slice(0, 2);
  headLines.forEach((ln, i) => drawText(ln, bx, by + 22 + i * 34, 4, INK));
  // Summary, up to 3 lines, smaller.
  const sumLines = wrapText(s.summary, COL_W, 3).slice(0, 3);
  sumLines.forEach((ln, i) => drawText(ln, bx, by + 96 + i * 26, 3, INK));
  // Divider, then the pictogram centred in the strip.
  hline(bx, by + 182, COL_W, GRAY);
  hline(bx, by + 183, COL_W, GRAY);
  const iconFn = ICONS[s.icon];
  if (iconFn) iconFn(bx + Math.round((COL_W - 122) / 2), by + 192);
}

function drawPage(): void {
  // Masthead.
  drawTextCentered("THE WORLD IN ONE DAY", W / 2, 34, 4, INK);
  drawTextCentered("MONDAY 23 NOVEMBER 2026", W / 2, 74, 6, INK);
  // Rules under the masthead.
  fillRect(MARGIN_X, 130, CONTENT_W, 6, RED);
  fillRect(MARGIN_X, 140, CONTENT_W, 2, INK);
  // Six stories: 2 columns x 3 rows.
  for (let i = 0; i < STORIES.length; i++) {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const bx = MARGIN_X + col * (COL_W + COL_GAP);
    const by = STORIES_Y + row * (ROW_H + ROW_GAP);
    drawStoryBlock(STORIES[i], bx, by);
  }
  // Footer.
  fillRect(MARGIN_X, 962, CONTENT_W, 2, INK);
  drawTextCentered("23 NOVEMBER 2026 — THE DAY IN WORLD NEWS", W / 2, 972, 2, INK);
  drawTextCentered("SOURCES: AP, REUTERS, AFP, AL JAZEERA, UKMTO", W / 2, 992, 2, GRAY);
}

// --------------------------------------------------------------- Main ----
drawPage();
const png = encodePNG(W, H, canvas);
const outDir = process.env.MAKEFUN_OUTPUT_DIR || "/output";
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "entry.png"), png);
