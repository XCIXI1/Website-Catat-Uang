"use strict";
const { db } = require("./db");

function cleanup() {
  const now = Date.now();
  db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(now);
  db.prepare("DELETE FROM reset_codes WHERE expires_at < ?").run(now);
}

function start() {
  cleanup();
  const timer = setInterval(cleanup, 6 * 3600 * 1000);
  timer.unref();
}

module.exports = { start };
