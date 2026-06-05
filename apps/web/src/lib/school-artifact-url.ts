export function schoolArtifactFileUrl(artifactId: string): string {
  return `/api/school/artifacts/${artifactId}/file`;
}

export function displayArtifactFileName(artifact: {
  s3Key: string | null;
  url: string | null;
}): string {
  const raw = artifact.s3Key?.split("/").pop() ?? artifact.url?.split("/").pop() ?? "Uploaded file";
  return raw.replace(/^\d+-/, "");
}

export function isImageArtifactName(name: string): boolean {
  return /\.(png|jpe?g|gif|webp|svg)$/i.test(name);
}
