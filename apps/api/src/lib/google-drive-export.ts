export const GOOGLE_FORMS_MIME = "application/vnd.google-apps.form";

const GOOGLE_DOC_MIME = "application/vnd.google-apps.document";
const GOOGLE_SHEET_MIME = "application/vnd.google-apps.spreadsheet";
const GOOGLE_SLIDES_MIME = "application/vnd.google-apps.presentation";

export interface GoogleDriveFileMetadata {
  id: string;
  name: string;
  mimeType: string;
  headRevisionId?: string;
}

export async function fetchGoogleDriveFileMetadata(
  accessToken: string,
  fileId: string,
): Promise<GoogleDriveFileMetadata | null> {
  const url = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`);
  url.searchParams.set("fields", "id,name,mimeType,headRevisionId");
  url.searchParams.set("supportsAllDrives", "true");

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 404 || res.status === 403) return null;
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google Drive files.get failed: ${text}`);
  }
  return res.json() as Promise<GoogleDriveFileMetadata>;
}

async function driveExport(
  accessToken: string,
  fileId: string,
  exportMime: string,
): Promise<Buffer> {
  const url = new URL(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/export`,
  );
  url.searchParams.set("mimeType", exportMime);
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google Drive export failed (${exportMime}): ${text}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

async function driveDownloadMedia(accessToken: string, fileId: string): Promise<{
  body: Buffer;
  contentType: string;
}> {
  const url = new URL(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`,
  );
  url.searchParams.set("alt", "media");
  url.searchParams.set("supportsAllDrives", "true");
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google Drive download failed: ${text}`);
  }
  const contentType =
    res.headers.get("content-type")?.split(";")[0]?.trim() || "application/octet-stream";
  return { body: Buffer.from(await res.arrayBuffer()), contentType };
}

export async function exportGoogleFileForSnapshot(
  accessToken: string,
  params: { fileId: string; mimeType: string | null },
): Promise<{ binary: Buffer; contentType: string; plainText: string }> {
  const mime = params.mimeType ?? GOOGLE_DOC_MIME;

  if (mime === GOOGLE_FORMS_MIME) {
    throw new Error("Google Forms cannot be snapshotted");
  }

  if (mime === GOOGLE_DOC_MIME) {
    const [binary, textBuf] = await Promise.all([
      driveExport(accessToken, params.fileId, "application/pdf"),
      driveExport(accessToken, params.fileId, "text/plain"),
    ]);
    return {
      binary,
      contentType: "application/pdf",
      plainText: textBuf.toString("utf-8"),
    };
  }

  if (mime === GOOGLE_SHEET_MIME) {
    const [binary, textBuf] = await Promise.all([
      driveExport(accessToken, params.fileId, "application/pdf"),
      driveExport(accessToken, params.fileId, "text/csv"),
    ]);
    return {
      binary,
      contentType: "application/pdf",
      plainText: textBuf.toString("utf-8"),
    };
  }

  if (mime === GOOGLE_SLIDES_MIME) {
    const binary = await driveExport(accessToken, params.fileId, "application/pdf");
    return { binary, contentType: "application/pdf", plainText: "" };
  }

  const downloaded = await driveDownloadMedia(accessToken, params.fileId);
  let plainText = "";
  if (downloaded.contentType.startsWith("text/")) {
    plainText = downloaded.body.toString("utf-8");
  }
  return {
    binary: downloaded.body,
    contentType: downloaded.contentType,
    plainText,
  };
}

export function googleFileWebUrl(fileId: string, mimeType: string | null): string {
  if (mimeType === GOOGLE_SHEET_MIME) {
    return `https://docs.google.com/spreadsheets/d/${fileId}/edit`;
  }
  if (mimeType === GOOGLE_SLIDES_MIME) {
    return `https://docs.google.com/presentation/d/${fileId}/edit`;
  }
  if (mimeType === GOOGLE_DOC_MIME) {
    return `https://docs.google.com/document/d/${fileId}/edit`;
  }
  return `https://drive.google.com/file/d/${fileId}/view`;
}
