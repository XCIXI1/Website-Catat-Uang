"use strict";
const fs = require("node:fs");
const path = require("node:path");

// node:sqlite masih ditandai eksperimental di Node 22; peringatannya cuma bikin log berisik.
const originalEmit = process.emitWarning;
process.emitWarning = function (warning, ...rest) {
  if (typeof warning === "string" && warning.includes("SQLite")) return;
  return originalEmit.call(process, warning, ...rest);
};
const { DatabaseSync } = require("node:sqlite");

const DATA_DIR = path.resolve(
  process.env.DATA_DIR || path.join(__dirname, "..", "data"),
);
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, "catatuang.db"));
db.exec(
  "PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;",
);

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS reset_codes (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  used INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE,
  type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (name, type)
);
CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
  amount INTEGER NOT NULL CHECK (amount > 0),
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  note TEXT NOT NULL DEFAULT '',
  date TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'web',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_tx_date ON transactions (date);
CREATE INDEX IF NOT EXISTS idx_tx_type_date ON transactions (type, date);
CREATE INDEX IF NOT EXISTS idx_tx_category ON transactions (category_id);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`);
db.exec(`
DROP TABLE IF EXISTS wa_inbox;
DELETE FROM settings WHERE key IN (
  'fonnte_token', 'webhook_secret', 'reminder_enabled', 'reminder_time',
  'reminder_skip_if_recorded', 'weekly_enabled', 'weekly_day', 'weekly_time',
  'notify_on_record', 'last_reminder_date', 'last_weekly_date'
);
`);

const DEFAULT_CATEGORIES = {
  income: ["Gaji", "Bonus", "Usaha", "Hadiah", "Lainnya"],
  expense: [
    "Makan & Minuman",
    "Transportasi",
    "Belanja",
    "Tagihan",
    "Hiburan",
    "Kesehatan",
    "Pendidikan",
    "Lainnya",
  ],
};

function seedCategories() {
  const count = db.prepare("SELECT COUNT(*) AS n FROM categories").get().n;
  if (count > 0) return;
  const ins = db.prepare(
    "INSERT INTO categories (name, type, is_default) VALUES (?, ?, 1)",
  );
  for (const [type, names] of Object.entries(DEFAULT_CATEGORIES)) {
    for (const name of names) ins.run(name, type);
  }
}
seedCategories();

/* ---------- pengaturan ---------- */

function getSetting(key) {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key);
  if (row) return row.value;
  return "";
}

function setSetting(key, value) {
  db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(key, String(value));
}

function transaction(fn) {
  db.exec("BEGIN");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

module.exports = { db, DATA_DIR, getSetting, setSetting, transaction };
