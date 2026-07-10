export type SchoolMaterialFreezeErrorCode =
  | "material_freeze_failed"
  | "google_docs_not_connected"
  | "google_docs_token_revoked";

export class SchoolMaterialFreezeError extends Error {
  readonly code: SchoolMaterialFreezeErrorCode;

  constructor(code: SchoolMaterialFreezeErrorCode, message?: string) {
    super(message ?? code);
    this.name = "SchoolMaterialFreezeError";
    this.code = code;
  }
}
