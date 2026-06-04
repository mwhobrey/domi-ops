const LIGHT_TEXT = "#f1f5f9";
const DARK_TEXT = "#0c0f14";
const LUMINANCE_THRESHOLD = 0.5;

export function parseColor(input: string): { r: number; g: number; b: number } | null {
  const s = input.trim();
  let m = /^#([0-9a-f]{3})$/i.exec(s);
  if (m) {
    const h = m[1];
    return {
      r: parseInt(h[0] + h[0], 16),
      g: parseInt(h[1] + h[1], 16),
      b: parseInt(h[2] + h[2], 16),
    };
  }
  m = /^#([0-9a-f]{6})$/i.exec(s);
  if (m) {
    const h = m[1];
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
    };
  }
  m = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i.exec(s);
  if (m) {
    return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]) };
  }
  return null;
}

function channel(c: number): number {
  const x = c / 255;
  return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(r: number, g: number, b: number): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function textColorForBackground(bg: string): typeof LIGHT_TEXT | typeof DARK_TEXT {
  const rgb = parseColor(bg);
  if (!rgb) return LIGHT_TEXT;
  return relativeLuminance(rgb.r, rgb.g, rgb.b) > 0.5 ? DARK_TEXT : LIGHT_TEXT;
}
