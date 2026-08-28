import sharp from "sharp";
import { writeFileSync } from "node:fs";

// Run from the repo root: node scripts/process-logo.mjs
const SRC = "docs/brand/domi-ops-logo-source.png";

// 1. Load raw RGB pixels, key out the white background, and un-premultiply the anti-aliased
//    edges (a naive "min(r,g,b)" alpha alone leaves a light halo on curved/diagonal edges,
//    since those pixels are a blend of logo-color and white — dividing the observed color by
//    the alpha fraction recovers the true underlying color instead of a washed-out version).
const { data, info } = await sharp(SRC).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const { width, height, channels } = info;
const out = Buffer.alloc(data.length);

for (let i = 0; i < data.length; i += channels) {
  const r = data[i];
  const g = data[i + 1];
  const b = data[i + 2];
  const minC = Math.min(r, g, b);
  const alpha = 255 - minC; // pure white -> 0, saturated/dark color -> ~255
  const frac = alpha / 255;
  if (frac < 0.02) {
    out[i] = 0;
    out[i + 1] = 0;
    out[i + 2] = 0;
    out[i + 3] = 0;
  } else {
    out[i] = Math.min(255, Math.round((r - 255 * (1 - frac)) / frac));
    out[i + 1] = Math.min(255, Math.round((g - 255 * (1 - frac)) / frac));
    out[i + 2] = Math.min(255, Math.round((b - 255 * (1 - frac)) / frac));
    out[i + 3] = alpha;
  }
}

const keyed = sharp(out, { raw: { width, height, channels } });

// 2. Trim the now-transparent canvas down to the actual artwork bounding box.
const trimmed = await keyed.png().trim({ threshold: 10 }).toBuffer();
const trimmedMeta = await sharp(trimmed).metadata();
console.log("trimmed to", trimmedMeta.width, "x", trimmedMeta.height);

/** Composite the trimmed logo onto a transparent square canvas at `size`, with `paddingPct`
 *  margin on each side (matches the existing icon set's ~8-10% breathing room). */
async function squareIcon(size, paddingPct = 0.09) {
  const inner = Math.round(size * (1 - paddingPct * 2));
  const resized = await sharp(trimmed)
    .resize(inner, inner, { fit: "inside", withoutEnlargement: false })
    .toBuffer();
  const resizedMeta = await sharp(resized).metadata();
  const left = Math.round((size - resizedMeta.width) / 2);
  const top = Math.round((size - resizedMeta.height) / 2);
  return sharp({
    create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{ input: resized, left, top }])
    .png()
    .toBuffer();
}

// Maskable icons need a bigger safe margin (~20%) so platform masking (circle/squircle) doesn't
// clip the artwork — separate from the "any"-purpose padding the rest of the set uses.
async function maskableIcon(size) {
  return squareIcon(size, 0.18);
}

const jobs = [
  ["apps/web/public/icons/icon-main.png", squareIcon(1024, 0.08)],
  ["apps/web/public/icons/icon-512.png", maskableIcon(512)],
  ["apps/web/public/icons/icon-192.png", squareIcon(192, 0.09)],
  ["apps/web/public/icons/apple-touch-icon.png", squareIcon(180, 0.12)],
  ["apps/web/public/favicon.png", squareIcon(32, 0.06)],
];

for (const [path, bufPromise] of jobs) {
  const buf = await bufPromise;
  writeFileSync(path, buf);
  console.log("wrote", path);
}

// favicon.ico: Next.js serves public/favicon.ico automatically. Sharp can't write .ico, but
// modern browsers (and Windows since Vista) accept an ICO container wrapping raw PNG frames
// directly, so hand-build a minimal single-frame ICONDIR instead of pulling in a dependency.
function buildIco(pngBuffers) {
  const count = pngBuffers.length;
  const headerSize = 6 + 16 * count;
  let offset = headerSize;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(count, 4);

  const entries = [];
  for (const png of pngBuffers) {
    const entry = Buffer.alloc(16);
    const dim = png._iconDim >= 256 ? 0 : png._iconDim;
    entry.writeUInt8(dim, 0); // width (0 = 256)
    entry.writeUInt8(dim, 1); // height
    entry.writeUInt8(0, 2); // color palette
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // color planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(png.length, 8); // data size
    entry.writeUInt32LE(offset, 12); // data offset
    offset += png.length;
    entries.push(entry);
  }
  return Buffer.concat([header, ...entries, ...pngBuffers]);
}

const ico16 = await squareIcon(16, 0.04);
ico16._iconDim = 16;
const ico32 = await squareIcon(32, 0.06);
ico32._iconDim = 32;
const ico48 = await squareIcon(48, 0.06);
ico48._iconDim = 48;
writeFileSync("apps/web/public/favicon.ico", buildIco([ico16, ico32, ico48]));
console.log("wrote apps/web/public/favicon.ico");

// icon.svg: the source art is AI-generated raster, not vector, so there's no true vector to
// extract — embed the raster as a data URI inside a valid SVG document instead. Every consumer
// that requests "/icon.svg" (metadata icons list, manifest.ts's "any" purpose) still gets a
// working image; it just isn't infinitely scalable the way a hand-drawn vector would be.
const svgSourceBuf = await squareIcon(512, 0.08);
const b64 = svgSourceBuf.toString("base64");
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <image href="data:image/png;base64,${b64}" width="512" height="512" />
</svg>
`;
writeFileSync("apps/web/public/icon.svg", svg);
console.log("wrote apps/web/public/icon.svg (raster-embedded)");

console.log("done");
