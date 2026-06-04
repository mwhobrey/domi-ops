import sharp from "sharp";

const MAX_INPUT_BYTES = 2 * 1024 * 1024;
const AVATAR_SIZE = 256;

const JPEG_SIG = [0xff, 0xd8, 0xff];
const PNG_SIG = [0x89, 0x50, 0x4e, 0x47];
const WEBP_RIFF = [0x52, 0x49, 0x46, 0x46];

function startsWith(buf: Buffer, sig: number[]): boolean {
  if (buf.length < sig.length) return false;
  return sig.every((b, i) => buf[i] === b);
}

function isWebp(buf: Buffer): boolean {
  return startsWith(buf, WEBP_RIFF) && buf.length >= 12 && buf.toString("ascii", 8, 12) === "WEBP";
}

export function detectAvatarMime(buf: Buffer): "image/jpeg" | "image/png" | "image/webp" | null {
  if (startsWith(buf, JPEG_SIG)) return "image/jpeg";
  if (startsWith(buf, PNG_SIG)) return "image/png";
  if (isWebp(buf)) return "image/webp";
  return null;
}

export async function processAvatarUpload(input: Buffer): Promise<Buffer> {
  if (input.length > MAX_INPUT_BYTES) {
    throw new Error("file_too_large");
  }
  const mime = detectAvatarMime(input);
  if (!mime) throw new Error("invalid_image_type");

  return sharp(input, { failOn: "error" })
    .rotate()
    .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: "cover", position: "centre" })
    .webp({ quality: 82 })
    .toBuffer();
}

export function avatarObjectKey(householdId: string, memberId: string): string {
  return `avatars/${householdId}/${memberId}.webp`;
}
