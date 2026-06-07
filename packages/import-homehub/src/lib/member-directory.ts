import type Database from "better-sqlite3";
import {
  collectRosterNames,
  householdRoleForLegacyName,
  legacyNameForEmail,
  type HomeHubConfig,
} from "./homehub-config.js";
import { sqliteTableExists } from "./sqlite.js";

export type StubRole = "owner" | "admin" | "member" | "child";

export type DirectoryMember = {
  legacyName: string;
  claimEmails: Set<string>;
  role: StubRole;
};

function roleForName(config: HomeHubConfig, legacyName: string): StubRole {
  return householdRoleForLegacyName(config, legacyName);
}

function ensureMember(
  map: Map<string, DirectoryMember>,
  config: HomeHubConfig,
  legacyName: string,
): DirectoryMember {
  const trimmed = legacyName.trim();
  const key = trimmed.toLowerCase();
  let entry = map.get(key);
  if (!entry) {
    entry = {
      legacyName: trimmed,
      claimEmails: new Set<string>(),
      role: roleForName(config, trimmed),
    };
    map.set(key, entry);
  }
  return entry;
}

function addClaimEmail(map: Map<string, DirectoryMember>, config: HomeHubConfig, email: string) {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return;
  const legacyName = legacyNameForEmail(config, normalized);
  const entry = ensureMember(map, config, legacyName);
  entry.claimEmails.add(normalized);
}

/** Union of config.yml roster + SQLite calendar connections → claim emails per legacy name. */
export function buildMemberDirectory(
  config: HomeHubConfig,
  sqlite?: Database.Database,
): Map<string, DirectoryMember> {
  const map = new Map<string, DirectoryMember>();

  for (const name of collectRosterNames(config)) {
    ensureMember(map, config, name);
  }

  for (const email of config.allowedEmails) {
    addClaimEmail(map, config, email);
  }

  for (const email of config.displayNames.keys()) {
    addClaimEmail(map, config, email);
  }

  if (sqlite && sqliteTableExists(sqlite, "calendar_connection")) {
    const rows = sqlite
      .prepare(
        "SELECT firebase_email FROM calendar_connection WHERE firebase_email IS NOT NULL AND TRIM(firebase_email) != ''",
      )
      .all() as Array<{ firebase_email: string | null }>;
    for (const row of rows) {
      if (row.firebase_email) addClaimEmail(map, config, row.firebase_email);
    }
  }

  return map;
}
