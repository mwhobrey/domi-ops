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

  CREATE TABLE notice (id INTEGER PRIMARY KEY, content TEXT, updated_by TEXT);
  INSERT INTO notice (id, content, updated_by) VALUES (1, 'Welcome home!', 'Mom');

  CREATE TABLE todo_list (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
  INSERT INTO todo_list (id, name) VALUES (1, 'Weekend');

  CREATE TABLE todo_item (
    id INTEGER PRIMARY KEY, description TEXT, done INTEGER, due_date TEXT,
    creator TEXT, tags TEXT, todo_list_id INTEGER
  );
  INSERT INTO todo_item (id, description, done, due_date, creator, tags, todo_list_id)
  VALUES (1, 'Vacuum', 0, '2026-06-05', 'Mom', '[]', 1);

  CREATE TABLE chore (
    id INTEGER PRIMARY KEY, description TEXT, done INTEGER, due_date TEXT, creator TEXT, tags TEXT
  );
  INSERT INTO chore (id, description, done, due_date, creator, tags)
  VALUES (1, 'Dishes', 0, NULL, 'Kid', '[]');

  CREATE TABLE personal_calendar (id INTEGER PRIMARY KEY, name TEXT, color TEXT, visibility TEXT);
  INSERT INTO personal_calendar (id, name, color, visibility) VALUES (1, 'Family', '#3366cc', 'household');

  CREATE TABLE reminder (
    id INTEGER PRIMARY KEY, date TEXT, time TEXT, title TEXT, description TEXT,
    category TEXT, color TEXT, all_day INTEGER, end_date TEXT, end_time TEXT,
    source TEXT, google_event_id TEXT, personal_calendar_id INTEGER
  );
  INSERT INTO reminder (id, date, time, title, description, category, color, all_day, end_date, end_time, source, personal_calendar_id)
  VALUES (1, '2026-06-01', '09:00', 'Test', '', 'family', '#000', 0, NULL, NULL, 'local', 1);

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

  CREATE TABLE school_assignment (
    id INTEGER PRIMARY KEY, class_id INTEGER NOT NULL, category_id INTEGER,
    title TEXT NOT NULL, instructions_html TEXT, due_at TEXT, points_possible REAL,
    allow_late INTEGER, visibility TEXT, created_by TEXT
  );
  INSERT INTO school_assignment (id, class_id, title, instructions_html, points_possible, allow_late, visibility)
  VALUES (1, 1, 'Chapter 1', '', 100, 1, 'assigned');

  CREATE TABLE school_submission (
    id INTEGER PRIMARY KEY, assignment_id INTEGER NOT NULL, student_id TEXT NOT NULL,
    status TEXT, submitted_at TEXT, is_late INTEGER, attempt_number TEXT, student_note TEXT
  );
  INSERT INTO school_submission (id, assignment_id, student_id, status, attempt_number, student_note)
  VALUES (1, 1, 'Kid', 'not_started', '1', '');

  CREATE TABLE school_submission_artifact (
    id INTEGER PRIMARY KEY, submission_id INTEGER NOT NULL, artifact_type TEXT,
    file_id INTEGER, url TEXT, note TEXT
  );

  CREATE TABLE file (id INTEGER PRIMARY KEY, filename TEXT NOT NULL, creator TEXT);
  INSERT INTO file (id, filename, creator) VALUES (1, 'sample.txt', 'Mom');
`);
db.close();
console.log("Wrote", outPath);
