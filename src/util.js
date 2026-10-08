"use strict";
const crypto = require("node:crypto");

const TZ = "Asia/Jakarta";
const MONTHS = [
  "Januari",
  "Februari",
  "Maret",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Agustus",
  "September",
  "Oktober",
  "November",
  "Desember",
];
const MONTHS_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "Mei",
  "Jun",
  "Jul",
  "Agu",
  "Sep",
  "Okt",
  "Nov",
  "Des",
];
const DAYS = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/* ---------- waktu (selalu Asia/Jakarta) ---------- */

const clock = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  weekday: "short",
});
const WD = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function nowParts(d = new Date()) {
  const p = {};
  for (const x of clock.formatToParts(d)) p[x.type] = x.value;
  const hour = Number(p.hour);
  const minute = Number(p.minute);
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    hour,
    minute,
    minutes: hour * 60 + minute,
    weekday: WD[p.weekday],
  };
}

const today = () => nowParts().date;
const pad = (n) => String(n).padStart(2, "0");

function isValidDate(s) {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  if (y < 1990 || y > 2100) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

function addDays(s, n) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const weekdayOf = (s) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
};

function periodRange(period, date) {
  const [y, m] = date.split("-").map(Number);
  if (period === "day") return { from: date, to: date };
  if (period === "week") return { from: addDays(date, -6), to: date };
  if (period === "month")
    return {
      from: `${y}-${pad(m)}-01`,
      to: `${y}-${pad(m)}-${pad(daysInMonth(y, m))}`,
    };
  if (period === "year") return { from: `${y}-01-01`, to: `${y}-12-31` };
  throw new HttpError(400, "Periode tidak dikenal.");
}

function periodLabel(period, date) {
  const [y, m, d] = date.split("-").map(Number);
  if (period === "day")
    return `${DAYS[weekdayOf(date)]}, ${d} ${MONTHS[m - 1]} ${y}`;
  if (period === "month") return `${MONTHS[m - 1]} ${y}`;
  if (period === "year") return String(y);
  const r = periodRange(period, date);
  return `${shortDate(r.from)} - ${shortDate(r.to)}`;
}

function shortDate(s) {
  const [y, m, d] = s.split("-").map(Number);
  return `${d} ${MONTHS_SHORT[m - 1]} ${y}`;
}

/* ---------- uang ---------- */

function formatRp(n) {
  const neg = n < 0;
  const s = String(Math.abs(Math.round(n))).replace(
    /\B(?=(\d{3})+(?!\d))/g,
    ".",
  );
  return `${neg ? "-" : ""}Rp ${s}`;
}

/* ---------- keamanan ---------- */

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync(pw, salt, 64);
  return `scrypt$${salt.toString("hex")}$${h.toString("hex")}`;
}

function verifyPassword(pw, stored) {
  try {
    const [, saltHex, hashHex] = String(stored).split("$");
    const expected = Buffer.from(hashHex, "hex");
    const got = crypto.scryptSync(
      pw,
      Buffer.from(saltHex, "hex"),
      expected.length,
    );
    return crypto.timingSafeEqual(got, expected);
  } catch {
    return false;
  }
}

const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
const randomToken = (bytes = 32) =>
  crypto.randomBytes(bytes).toString("base64url");

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

module.exports = {
  TZ,
  MONTHS,
  MONTHS_SHORT,
  DAYS,
  HttpError,
  nowParts,
  today,
  pad,
  isValidDate,
  addDays,
  daysInMonth,
  weekdayOf,
  periodRange,
  periodLabel,
  shortDate,
  formatRp,
  hashPassword,
  verifyPassword,
  sha256,
  randomToken,
  safeEqual,
};
