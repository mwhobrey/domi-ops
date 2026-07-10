export function schoolArtifactFileUrl(artifact: {
  id: string;
  artifactType?: string;
  openUrl?: string | null;
}): string {
  if (artifact.artifactType === "google_doc" && artifact.openUrl) {
    return artifact.openUrl;
  }
  return `/api/school/artifacts/${artifact.id}/file`;
}

export function displayArtifactFileName(artifact: {
  s3Key: string | null;
  url: string | null;
  artifactType?: string;
  displayName?: string | null;
  googleFileId?: string | null;
}): string {
  if (artifact.displayName) return artifact.displayName;
  if (artifact.artifactType === "google_doc") return "Google Doc submission";
  const raw = artifact.s3Key?.split("/").pop() ?? artifact.url?.split("/").pop() ?? "Uploaded file";
  return raw.replace(/^\d+-/, "");
}

export function isImageArtifactName(name: string): boolean {
  return /\.(png|jpe?g|gif|webp|svg)$/i.test(name);
}

export function lineageBadgeLabel(status?: string | null): string | null {
  if (!status || status === "unknown") return null;
  if (status === "pass") return "Lineage OK";
  if (status === "warn") return "Review needed";
  if (status === "fail") return "Lineage failed";
  return null;
}

export function lineageBadgeTone(
  status?: string | null,
): "default" | "accent" | "success" | "warning" {
  if (status === "pass") return "success";
  if (status === "warn") return "warning";
  if (status === "fail") return "warning";
  return "default";
}
