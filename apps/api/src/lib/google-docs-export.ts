import { decryptSensitive, encryptSensitive, SensitiveDecryptError } from "@domi-ops/crypto";
import { refreshGoogleAccessToken, GoogleOAuthTokenError } from "@domi-ops/auth";
import type { Env } from "@domi-ops/config";
import type { Database } from "@domi-ops/db";
import { googleDocsConnections } from "@domi-ops/db";
import { and, eq } from "drizzle-orm";

export class GoogleDocsCredentialsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoogleDocsCredentialsError";
  }
}

export interface GoogleDocsConnectionRow {
  id: string;
  refreshTokenEnc: string;
  accessTokenEnc: string | null;
  tokenExpiry: Date | null;
}

function getTokens(conn: GoogleDocsConnectionRow, encryptionKey: string) {
  try {
    return {
      refreshToken: decryptSensitive(conn.refreshTokenEnc, encryptionKey),
      accessToken: conn.accessTokenEnc ? decryptSensitive(conn.accessTokenEnc, encryptionKey) : null,
    };
  } catch (e) {
    if (e instanceof SensitiveDecryptError) {
      throw new GoogleDocsCredentialsError(e.message);
    }
    throw e;
  }
}

export async function ensureGoogleDocsAccessToken(
  db: Database,
  env: Env,
  conn: GoogleDocsConnectionRow & { id: string },
): Promise<string> {
  const key = env.ENCRYPTION_KEY;
  if (!key) throw new GoogleDocsCredentialsError("ENCRYPTION_KEY not configured");
  const tokens = getTokens(conn, key);
  const expiry = conn.tokenExpiry;
  if (tokens.accessToken && expiry && expiry.getTime() > Date.now() + 60_000) {
    return tokens.accessToken;
  }
  if (!tokens.refreshToken) {
    throw new GoogleDocsCredentialsError("Missing refresh token — reconnect Google Docs");
  }
  let refreshed;
  try {
    refreshed = await refreshGoogleAccessToken(env, tokens.refreshToken);
  } catch (e) {
    if (e instanceof GoogleOAuthTokenError && e.oauthError === "invalid_grant") {
      throw new GoogleDocsCredentialsError(
        "Google Docs access expired or was revoked — reconnect in profile settings",
      );
    }
    throw e;
  }
  const accessEnc = encryptSensitive(refreshed.access_token, key);
  const tokenExpiry = new Date(Date.now() + (refreshed.expires_in ?? 3600) * 1000);
  await db
    .update(googleDocsConnections)
    .set({ accessTokenEnc: accessEnc, tokenExpiry })
    .where(eq(googleDocsConnections.id, conn.id));
  return refreshed.access_token;
}

export async function loadGoogleDocsConnection(
  db: Database,
  householdId: string,
  userId: string,
): Promise<(GoogleDocsConnectionRow & { id: string }) | null> {
  const [row] = await db
    .select()
    .from(googleDocsConnections)
    .where(
      and(
        eq(googleDocsConnections.householdId, householdId),
        eq(googleDocsConnections.userId, userId),
      ),
    )
    .limit(1);
  return row ?? null;
}

async function googleDriveUpload(params: {
  accessToken: string;
  filename: string;
  mimeType: string;
  body: Buffer;
  convertToGoogleDoc?: boolean;
}): Promise<{ id: string; webViewLink?: string }> {
  const metadata: Record<string, string> = { name: params.filename };
  if (params.convertToGoogleDoc) {
    metadata.mimeType = "application/vnd.google-apps.document";
  } else {
    metadata.mimeType = params.mimeType;
  }

  const boundary = "-------domi-ops-report-boundary";
  const metaPart = JSON.stringify(metadata);
  const multipartBody = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metaPart}\r\n`,
    ),
    Buffer.from(`--${boundary}\r\nContent-Type: ${params.mimeType}\r\n\r\n`),
    params.body,
    Buffer.from(`\r\n--${boundary}--`),
  ]);

  const url = new URL("https://www.googleapis.com/upload/drive/v3/files");
  url.searchParams.set("uploadType", "multipart");
  url.searchParams.set("fields", "id,webViewLink");

  const res = await fetch(url.toString(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
    },
    body: multipartBody,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google Drive upload failed: ${text}`);
  }
  return res.json() as Promise<{ id: string; webViewLink?: string }>;
}

export async function exportToGoogleDocs(params: {
  accessToken: string;
  title: string;
  plainText: string;
  html: string;
  format: "plain" | "styled";
}): Promise<{ documentId: string; url: string }> {
  if (params.format === "styled") {
    const uploaded = await googleDriveUpload({
      accessToken: params.accessToken,
      filename: `${params.title}.html`,
      mimeType: "text/html",
      body: Buffer.from(params.html, "utf-8"),
      convertToGoogleDoc: true,
    });
    const url =
      uploaded.webViewLink ?? `https://docs.google.com/document/d/${uploaded.id}/edit`;
    return { documentId: uploaded.id, url };
  }

  const createRes = await fetch("https://docs.googleapis.com/v1/documents", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ title: params.title }),
  });
  if (!createRes.ok) {
    const text = await createRes.text();
    throw new Error(`Google Docs create failed: ${text}`);
  }
  const created = (await createRes.json()) as { documentId: string };
  const text = params.plainText.endsWith("\n") ? params.plainText : `${params.plainText}\n`;
  const batchRes = await fetch(
    `https://docs.googleapis.com/v1/documents/${created.documentId}:batchUpdate`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${params.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        requests: [{ insertText: { location: { index: 1 }, text } }],
      }),
    },
  );
  if (!batchRes.ok) {
    const errText = await batchRes.text();
    throw new Error(`Google Docs batchUpdate failed: ${errText}`);
  }
  return {
    documentId: created.documentId,
    url: `https://docs.google.com/document/d/${created.documentId}/edit`,
  };
}

export async function exportToGoogleDriveFile(params: {
  accessToken: string;
  filename: string;
  mimeType: string;
  body: Buffer;
}): Promise<{ fileId: string; url: string }> {
  const uploaded = await googleDriveUpload({
    accessToken: params.accessToken,
    filename: params.filename,
    mimeType: params.mimeType,
    body: params.body,
    convertToGoogleDoc: false,
  });
  return {
    fileId: uploaded.id,
    url: uploaded.webViewLink ?? `https://drive.google.com/file/d/${uploaded.id}/view`,
  };
}
