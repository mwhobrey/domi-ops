import Database from "better-sqlite3";
import { createDb } from "@domi-ops/db";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { buildMemberDirectory } from "./lib/member-directory.js";
import { loadHomeHubConfig } from "./lib/homehub-config.js";
import { importCalendar } from "./mappers/calendar.js";
import { importHouseholdMembers } from "./mappers/household-members.js";
import { importHousehold } from "./mappers/household.js";
import { importNotices } from "./mappers/notices.js";
import { importNotes } from "./mappers/notes.js";
import { importTasks } from "./mappers/tasks.js";
import type { ImportContext } from "./mappers/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturePath =
  process.env.DOMI_OPS_FIXTURE_DB ?? join(__dirname, "..", "fixtures", "minimal-homehub.db");
const fixtureConfigPath = join(__dirname, "..", "fixtures", "config.yml");

function ensureFixture() {
  if (!existsSync(fixturePath)) {
    mkdirSync(dirname(fixturePath), { recursive: true });
    const db = new Database(fixturePath);
    db.exec(`
      CREATE TABLE home_status (id INTEGER PRIMARY KEY, name TEXT NOT NULL, status TEXT);
      INSERT INTO home_status VALUES (1, 'Mom', 'Home');
      CREATE TABLE notice (id INTEGER PRIMARY KEY, content TEXT, updated_by TEXT);
      INSERT INTO notice VALUES (1, 'Hello', 'Mom');
      CREATE TABLE todo_list (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
      INSERT INTO todo_list VALUES (1, 'Todos');
      CREATE TABLE todo_item (
        id INTEGER PRIMARY KEY, description TEXT, done INTEGER, due_date TEXT,
        creator TEXT, tags TEXT, todo_list_id INTEGER
      );
      INSERT INTO todo_item (id, description, done, due_date, creator, tags, todo_list_id)
      VALUES (1, 'Task', 0, NULL, 'Mom', '[]', 1);
      CREATE TABLE chore (
        id INTEGER PRIMARY KEY, description TEXT, done INTEGER, due_date TEXT, creator TEXT, tags TEXT
      );
      INSERT INTO chore VALUES (1, 'Dishes', 0, NULL, 'Kid', '[]');
      CREATE TABLE note (
        id INTEGER PRIMARY KEY, content TEXT NOT NULL, creator TEXT, timestamp TEXT
      );
      INSERT INTO note (id, content, creator, timestamp)
      VALUES (1, 'Fixture note', 'Mom', '2026-06-01 12:00:00');
      CREATE TABLE reminder (
        id INTEGER PRIMARY KEY, date TEXT, time TEXT, title TEXT, description TEXT,
        category TEXT, color TEXT, all_day INTEGER, end_date TEXT, end_time TEXT,
        source TEXT, google_event_id TEXT, personal_calendar_id INTEGER
      );
      INSERT INTO reminder (id, date, time, title, description, category, color, all_day, end_date, end_time, source)
      VALUES (1, '2026-06-01', '09:00', 'Test', '', 'family', '#000', 0, NULL, NULL, 'local');
    `);
    db.close();
  }
}

const testDb = createDb("postgresql://domi_ops:domi_ops@127.0.0.1:5432/domi_ops_unused");
const homeHubConfig = loadHomeHubConfig(fixtureConfigPath);

function testContext(sqlite: Database.Database, overrides: Partial<ImportContext> = {}): ImportContext {
  const memberDirectory = buildMemberDirectory(homeHubConfig, sqlite);
  return {
    sqlite,
    dryRun: true,
    householdId: "00000000-0000-0000-0000-000000000001",
    databaseUrl: "postgresql://domi_ops:domi_ops@127.0.0.1:5432/domi_ops_unused",
    idMap: new Map(),
    db: testDb,
    homeHubConfig,
    memberDirectory,
    configPath: fixtureConfigPath,
    ...overrides,
  };
}

describe("import mappers dry-run", () => {
  beforeAll(() => {
    ensureFixture();
  });

  it("counts home_status without writing", async () => {
    const sqlite = new Database(fixturePath, { readonly: true });
    try {
      const { result } = await importHousehold(
        testContext(sqlite, { householdId: "" }),
        "Test Household",
      );
      expect(result.imported).toBeGreaterThan(0);

      const homeStatusCount = (
        sqlite.prepare("SELECT COUNT(*) as c FROM home_status").get() as { c: number }
      ).c;
      const members = await importHouseholdMembers(testContext(sqlite));
      expect(members.imported).toBeGreaterThanOrEqual(homeStatusCount);
      expect(homeStatusCount).toBeGreaterThan(0);
    } finally {
      sqlite.close();
    }
  });

  it("counts reminders without writing", async () => {
    const sqlite = new Database(fixturePath, { readonly: true });
    try {
      const result = await importCalendar(testContext(sqlite));
      expect(result.imported).toBeGreaterThan(0);
    } finally {
      sqlite.close();
    }
  });

  it("counts notices without writing", async () => {
    const sqlite = new Database(fixturePath, { readonly: true });
    try {
      const result = await importNotices(testContext(sqlite));
      expect(result.imported).toBeGreaterThan(0);
    } finally {
      sqlite.close();
    }
  });

  it("counts chores and todo_item without writing", async () => {
    const sqlite = new Database(fixturePath, { readonly: true });
    try {
      const result = await importTasks(testContext(sqlite));
      expect(result.imported).toBeGreaterThan(0);
    } finally {
      sqlite.close();
    }
  });

  it("counts notes without writing", async () => {
    const sqlite = new Database(fixturePath, { readonly: true });
    try {
      const result = await importNotes(testContext(sqlite));
      expect(result.imported).toBeGreaterThan(0);
    } finally {
      sqlite.close();
    }
  });
});
