"use strict";
const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

const DATA_DIR = process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname, "..", "data");
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new Database(path.join(DATA_DIR, "assessment.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS invites (
  id            TEXT PRIMARY KEY,
  token         TEXT UNIQUE NOT NULL,
  name          TEXT DEFAULT '',
  contact       TEXT DEFAULT '',
  role          TEXT DEFAULT '',
  language      TEXT DEFAULT '',
  lang_code     TEXT DEFAULT '',
  source        TEXT DEFAULT 'invite',       -- invite | open
  status        TEXT NOT NULL DEFAULT 'unused', -- unused | in_progress | completed | expired
  created_at    INTEGER NOT NULL,
  started_at    INTEGER,
  completed_at  INTEGER,
  test_json     TEXT,                         -- full test incl. answer keys (server only)
  result_id     TEXT
);
CREATE TABLE IF NOT EXISTS results (
  id               TEXT PRIMARY KEY,
  invite_id        TEXT,
  name             TEXT,
  contact          TEXT,
  role             TEXT,
  language         TEXT,
  lang_code        TEXT,
  started_at       INTEGER,
  finished_at      INTEGER,
  duration_sec     INTEGER,
  time_up          INTEGER DEFAULT 0,
  tab_switches     INTEGER DEFAULT 0,
  listen_fallback  INTEGER DEFAULT 0,
  overall_cefr     TEXT,
  overall_score    INTEGER,
  result_json      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS results_finished ON results(finished_at DESC);
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`);

const DEFAULT_SETTINGS = { timeLimitMin: 40, showResults: true, allowOpenLink: false, orgName: "" };

function getSettings() {
  const rows = db.prepare("SELECT key, value FROM settings").all();
  const s = { ...DEFAULT_SETTINGS };
  for (const r of rows) { try { s[r.key] = JSON.parse(r.value); } catch { /* ignore */ } }
  return s;
}
function saveSettings(patch) {
  const allowed = Object.keys(DEFAULT_SETTINGS);
  const up = db.prepare("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value");
  const tx = db.transaction((p) => { for (const k of allowed) if (k in p) up.run(k, JSON.stringify(p[k])); });
  tx(patch);
  return getSettings();
}

module.exports = { db, getSettings, saveSettings, DATA_DIR };
