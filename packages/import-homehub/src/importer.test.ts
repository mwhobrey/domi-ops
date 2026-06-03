import Database from "better-sqlite3";
import { createDb } from "@whome/db";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { importCalendar } from "./mappers/calendar.js";
import { importHousehold } from "./mappers/household.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturePath =
  process.env.WHOME_FIXTURE_DB ?? join(__dirname, "..", "fixtures", "minimal-homehub.db");

function ensureFixture() {
  if (!existsSync(fixturePath)) {
    const db = new Database(fixturePath);
    db.exec(`
      CREATE TABLE home_status (id INTEGER PRIMARY KEY, name TEXT NOT NULL, status TEXT);
      INSERT INTO home_status VALUES (1, 'Mom', 'Home');
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

const testDb = createDb("postgresql://whome:whome@127.0.0.1:5432/whome_unused");

describe("import mappers dry-run", () => {
  beforeAll(() => {
    ensureFixture();
  });

  it("counts home_status without writing", async () => {
    const sqlite = new Database(fixturePath, { readonly: true });
    try {
      const { result } = await importHousehold(
        {
          sqlite,
          dryRun: true,
          householdId: "",
          databaseUrl: "postgresql://whome:whome@127.0.0.1:5432/whome_unused",
          idMap: new Map(),
          db: testDb,
        },
        "Test Household",
      );
      expect(result.imported).toBeGreaterThan(0);
    } finally {
      sqlite.close();
    }
  });

  it("counts reminders without writing", async () => {
    const sqlite = new Database(fixturePath, { readonly: true });
    try {
      const result = await importCalendar({
        sqlite,
        dryRun: true,
        householdId: "00000000-0000-0000-0000-000000000001",
        databaseUrl: "postgresql://whome:whome@127.0.0.1:5432/whome_unused",
        idMap: new Map(),
        db: testDb,
      });
      expect(result.imported).toBeGreaterThan(0);
    } finally {
      sqlite.close();
    }
  });
});
