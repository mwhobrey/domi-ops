#!/usr/bin/env node
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, "..", "fixtures");
const outPath = join(outDir, "minimal-homehub.db");

mkdirSync(outDir, { recursive: true });

const db = new Database(outPath);
db.exec(`
  CREATE TABLE home_status (id INTEGER PRIMARY KEY, name TEXT NOT NULL, status TEXT);
  INSERT INTO home_status (id, name, status) VALUES (1, 'Mom', 'Home');
  INSERT INTO home_status (id, name, status) VALUES (2, 'Kid', 'Away');

  CREATE TABLE reminder (
    id INTEGER PRIMARY KEY, date TEXT, time TEXT, title TEXT, description TEXT,
    category TEXT, color TEXT, all_day INTEGER, end_date TEXT, end_time TEXT,
    source TEXT, google_event_id TEXT, personal_calendar_id INTEGER
  );
  INSERT INTO reminder (id, date, time, title, description, category, color, all_day, end_date, end_time, source)
  VALUES (1, '2026-06-01', '09:00', 'Test', '', 'family', '#000', 0, NULL, NULL, 'local');

  CREATE TABLE school_class (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, subject TEXT, term TEXT,
    teacher_id TEXT NOT NULL, schedule_json TEXT, archived INTEGER DEFAULT 0
  );
  INSERT INTO school_class (id, name, subject, term, teacher_id, schedule_json, archived)
  VALUES (1, 'Math', 'Mathematics', '2026', 'Mom', '{}', 0);

  CREATE TABLE school_enrollment (
    id INTEGER PRIMARY KEY, class_id INTEGER NOT NULL, student_id TEXT NOT NULL,
    role TEXT DEFAULT 'student', active_from TEXT, active_to TEXT
  );
  INSERT INTO school_enrollment (id, class_id, student_id, role)
  VALUES (1, 1, 'Kid', 'student');

  CREATE TABLE file (id INTEGER PRIMARY KEY, filename TEXT NOT NULL, creator TEXT);
  INSERT INTO file (id, filename, creator) VALUES (1, 'sample.txt', 'Mom');
`);
db.close();
console.log("Wrote", outPath);
