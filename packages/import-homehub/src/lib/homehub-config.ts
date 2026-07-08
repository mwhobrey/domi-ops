import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseDocument } from "yaml";

export type HomeHubConfig = {
  instanceName?: string;
  familyMembers: string[];
  allowedEmails: string[];
  adminEmails: string[];
  /** email (lower) → legacy display name */
  displayNames: Map<string, string>;
  schoolTeachers: string[];
  schoolStudents: string[];
};

function asStringList(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  return [];
}

function parseDisplayNames(raw: unknown): Map<string, string> {
  const map = new Map<string, string>();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return map;
  for (const [email, name] of Object.entries(raw as Record<string, unknown>)) {
    const legacy = String(name ?? "").trim();
    const normalizedEmail = email.trim().toLowerCase();
    if (legacy && normalizedEmail) map.set(normalizedEmail, legacy);
  }
  return map;
}

function inferLegacyNameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? "member";
  const token = local.split(/[._+-]/)[0] ?? local;
  if (!token) return "Member";
  return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
}

/** Parse HomeHub operator `config.yml` (Firebase auth + school roster). */
export function parseHomeHubConfig(yamlText: string): HomeHubConfig {
  const doc = parseDocument(yamlText, { uniqueKeys: false });
  if (doc.errors.length > 0) {
    throw new Error(doc.errors.map((e) => e.message).join("; "));
  }
  const raw = doc.toJS() as Record<string, unknown> | null;
  if (!raw || typeof raw !== "object") {
    throw new Error("config.yml must be a YAML object");
  }

  const auth = (raw.auth ?? {}) as Record<string, unknown>;
  const school = (raw.school ?? {}) as Record<string, unknown>;
  const displayNames = parseDisplayNames(auth.display_names);

  return {
    instanceName: typeof raw.instance_name === "string" ? raw.instance_name.trim() : undefined,
    familyMembers: asStringList(raw.family_members),
    allowedEmails: asStringList(auth.allowed_emails).map((e) => e.toLowerCase()),
    adminEmails: asStringList(auth.admin_emails).map((e) => e.toLowerCase()),
    displayNames,
    schoolTeachers: asStringList(school.teachers),
    schoolStudents: asStringList(school.students),
  };
}

export function loadHomeHubConfig(configPath: string): HomeHubConfig {
  const text = readFileSync(configPath, "utf8");
  return parseHomeHubConfig(text);
}

export function legacyNameForEmail(config: HomeHubConfig, email: string): string {
  const normalized = email.trim().toLowerCase();
  return config.displayNames.get(normalized) ?? inferLegacyNameFromEmail(normalized);
}

export function ownerLegacyName(config: HomeHubConfig): string | null {
  if (config.adminEmails[0]) {
    return legacyNameForEmail(config, config.adminEmails[0]);
  }
  return null;
}

/** Map HomeHub `admin_emails` → Domi Ops household role (first admin = owner, rest = admin). */
export function householdRoleForLegacyName(
  config: HomeHubConfig,
  legacyName: string,
): "owner" | "admin" | "member" | "child" {
  const key = legacyName.trim().toLowerCase();
  if (config.schoolStudents.some((s) => s.trim().toLowerCase() === key)) return "child";

  const ownerKey = ownerLegacyName(config)?.trim().toLowerCase() ?? null;
  if (ownerKey === key) return "owner";

  for (const email of config.adminEmails) {
    if (legacyNameForEmail(config, email).trim().toLowerCase() === key) return "admin";
  }

  if (config.schoolTeachers.some((s) => s.trim().toLowerCase() === key)) return "member";
  return "member";
}

export function collectRosterNames(config: HomeHubConfig): string[] {
  const names = new Set<string>();
  const add = (value: string) => {
    const trimmed = value.trim();
    if (trimmed) names.add(trimmed);
  };

  for (const name of config.familyMembers) add(name);
  for (const name of config.schoolTeachers) add(name);
  for (const name of config.schoolStudents) add(name);
  for (const name of config.displayNames.values()) add(name);

  return [...names];
}

export function resolveConfigPath(sqlitePath: string, explicitPath?: string): string | null {
  if (explicitPath?.trim()) return explicitPath.trim();

  const sqliteDir = dirname(sqlitePath);
  const candidates = [join(sqliteDir, "config.yml"), join(sqliteDir, "..", "config.yml")];
  for (const candidate of candidates) {
    try {
      readFileSync(candidate);
      return candidate;
    } catch {
      /* try next */
    }
  }
  return null;
}
