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
const keyedRaw = Buffer.alloc(data.length);

for (let i = 0; i < data.length; i += channels) {
  const r = data[i];
  const g = data[i + 1];
  const b = data[i + 2];
  const minC = Math.min(r, g, b);
  const alpha = 255 - minC; // pure white -> 0, saturated/dark color -> ~255
  const frac = alpha / 255;
  if (frac < 0.02) {
    keyedRaw[i] = 0;
    keyedRaw[i + 1] = 0;
    keyedRaw[i + 2] = 0;
    keyedRaw[i + 3] = 0;
  } else {
    keyedRaw[i] = Math.min(255, Math.round((r - 255 * (1 - frac)) / frac));
    keyedRaw[i + 1] = Math.min(255, Math.round((g - 255 * (1 - frac)) / frac));
    keyedRaw[i + 2] = Math.min(255, Math.round((b - 255 * (1 - frac)) / frac));
    keyedRaw[i + 3] = alpha;
  }
}

/** Lift the source art's dark-navy roof/shading (~RGB 33,60,76, luminance ~54 — nearly
 *  invisible against this app's own dark surface tokens, ~12-36) toward `target`, leaving
 *  the already-bright teal/cyan portions of the gradient untouched. Smooth (not a hard color
 *  swap) so it reads as a continued gradient rather than a flat patch where it meets the
 *  infinity loop's own dark-navy shading. */
function liftDarkTones(rawBuf, target, threshold = 100) {
  const out = Buffer.from(rawBuf);
  for (let i = 0; i < out.length; i += 4) {
    const a = out[i + 3];
    if (a === 0) continue;
    const r = out[i];
    const g = out[i + 1];
    const b = out[i + 2];
    const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
    if (luminance >= threshold) continue;
    const t = Math.pow((threshold - luminance) / threshold, 0.6);
    out[i] = Math.round(r * (1 - t) + target[0] * t);
    out[i + 1] = Math.round(g * (1 - t) + target[1] * t);
    out[i + 2] = Math.round(b * (1 - t) + target[2] * t);
  }
  return out;
}

// Two roof treatments:
//  - "universal": lifted toward the app's own accent blue (#3b82f6) — one variant that has to
//    work everywhere a favicon/app icon shows up (browser chrome, OS home screen), regardless
//    of that surface's own light/dark theme, since none of those contexts are theme-aware.
//  - "on-dark": lifted toward near-white — for headers, where CSS already knows the theme
//    (prefers-color-scheme), so this only ever gets shown against a dark surface.
// "on-light" is just the original keyed art unmodified — the source was authored against a
// white canvas, so the unlifted navy roof already reads correctly there.
const universalRaw = liftDarkTones(keyedRaw, [59, 130, 246]);
const onDarkRaw = liftDarkTones(keyedRaw, [226, 232, 240]);

async function trim(rawBuf) {
  return sharp(rawBuf, { raw: { width, height, channels } }).png().trim({ threshold: 10 }).toBuffer();
}

const trimmedUniversal = await trim(universalRaw);
const trimmedOnDark = await trim(onDarkRaw);
const trimmedOnLight = await trim(keyedRaw);
console.log("trimmed:", (await sharp(trimmedUniversal).metadata()).width, "x", (await sharp(trimmedUniversal).metadata()).height);

/** Composite `source` (a trimmed logo buffer) onto a transparent square canvas at `size`, with
 *  `paddingPct` margin on each side (matches the existing icon set's ~8-10% breathing room). */
async function squareIcon(source, size, paddingPct = 0.09) {
  const inner = Math.round(size * (1 - paddingPct * 2));
  const resized = await sharp(source)
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
async function maskableIcon(source, size) {
  return squareIcon(source, size, 0.18);
}

// Android status-bar / notification badge (`ServiceWorkerRegistration.showNotification`'s
// `badge` option — the small monochrome mark in the collapsed status bar; distinct from
// `icon`, the full-colour art in the expanded shade). Android and Chrome render ONLY the alpha
// channel, tinted to the system colour, so it has to be one flat hard-edged glyph with no
// interior detail. The full logo (roof + spiderweb gable + infinity loop) turns to mud at
// 24dp, so the badge is its own simplified source — a plain house silhouette,
// docs/brand/notification-badge.svg. Without a `badge` at all, Android falls back to a generic
// bell, indistinguishable from every other app's (the original complaint).
async function badgeIcon(svgPath, size) {
  return sharp(svgPath, { density: 600 })
    .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
}

const jobs = [
  ["apps/web/public/icons/icon-main.png", squareIcon(trimmedUniversal, 1024, 0.08)],
  ["apps/web/public/icons/icon-512.png", maskableIcon(trimmedUniversal, 512)],
  ["apps/web/public/icons/icon-192.png", squareIcon(trimmedUniversal, 192, 0.09)],
  ["apps/web/public/icons/apple-touch-icon.png", squareIcon(trimmedUniversal, 180, 0.12)],
  ["apps/web/public/favicon.png", squareIcon(trimmedUniversal, 32, 0.06)],
  ["apps/web/public/icons/badge-96.png", badgeIcon("docs/brand/notification-badge.svg", 96)],
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

const ico16 = await squareIcon(trimmedUniversal, 16, 0.04);
ico16._iconDim = 16;
const ico32 = await squareIcon(trimmedUniversal, 32, 0.06);
ico32._iconDim = 32;
const ico48 = await squareIcon(trimmedUniversal, 48, 0.06);
ico48._iconDim = 48;
writeFileSync("apps/web/public/favicon.ico", buildIco([ico16, ico32, ico48]));
console.log("wrote apps/web/public/favicon.ico");

// icon.svg / icon-on-light.svg: the source art is AI-generated raster, not vector, so there's no
// true vector to extract — embed the raster as a data URI inside a valid SVG document instead.
// icon.svg carries the universal (accent-blue roof) treatment, used wherever there's no theme
// context to react to (manifest.ts "any" purpose, non-picture <img> fallbacks). icon-on-light.svg
// is the unmodified original, paired with icon.svg via a <picture>/prefers-color-scheme swap in
// headers (MarketingShell, AppChrome, the login page) — see those files for the pairing.
async function writeEmbeddedSvg(path, source) {
  const buf = await squareIcon(source, 512, 0.08);
  const b64 = buf.toString("base64");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <image href="data:image/png;base64,${b64}" width="512" height="512" />
</svg>
`;
  writeFileSync(path, svg);
  console.log("wrote", path, "(raster-embedded)");
}

await writeEmbeddedSvg("apps/web/public/icon.svg", trimmedUniversal);
await writeEmbeddedSvg("apps/web/public/icon-on-light.svg", trimmedOnLight);
await writeEmbeddedSvg("apps/web/public/icon-on-dark.svg", trimmedOnDark);

console.log("done");
