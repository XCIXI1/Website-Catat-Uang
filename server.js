"use strict";
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const crypto = require("node:crypto");

/* ---------- konfigurasi (.env sederhana, tanpa library) ---------- */

(function loadEnv() {
  const file = path.join(__dirname, ".env");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || line.trim().startsWith("#")) continue;
    let v = m[2];
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    )
      v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
})();
process.env.TZ = "Asia/Jakarta";

const { db, getSetting, setSetting, transaction } = require("./src/db");
const service = require("./src/service");
const report = require("./src/report");
const scheduler = require("./src/scheduler");
const {
  HttpError,
  today,
  isValidDate,
  hashPassword,
  verifyPassword,
  sha256,
  randomToken,
  safeEqual,
} = require("./src/util");

const PUBLIC_DIR = path.join(__dirname, "public");
const SESSION_MS = 30 * 24 * 3600 * 1000;
const MAX_BODY = 100 * 1024;

/* ---------- pembatas percobaan ---------- */

const buckets = new Map();
function rateLimit(key, max, windowMs) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || b.reset < now) {
    b = { count: 0, reset: now + windowMs };
    buckets.set(key, b);
  }
  b.count += 1;
  if (b.count > max)
    throw new HttpError(
      429,
      "Terlalu banyak percobaan. Coba lagi beberapa menit lagi.",
    );
}
setInterval(
  () => {
    const now = Date.now();
    for (const [k, b] of buckets) if (b.reset < now) buckets.delete(k);
  },
  10 * 60 * 1000,
).unref();

/* ---------- helper request ---------- */

const trustProxy = () => process.env.TRUST_PROXY === "1";

function clientIp(req) {
  if (trustProxy()) {
    const xff = String(req.headers["x-forwarded-for"] || "")
      .split(",")[0]
      .trim();
    if (xff) return xff;
  }
  return req.socket.remoteAddress || "unknown";
}

function isLocalRequest(req) {
  const addr = req.socket.remoteAddress || "";
  const loopback =
    addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1";
  return (
    loopback &&
    !req.headers["x-forwarded-for"] &&
    !req.headers["x-forwarded-host"]
  );
}

function isHttps(req) {
  return (
    Boolean(req.socket.encrypted) ||
    String(req.headers["x-forwarded-proto"] || "").split(",")[0] === "https" ||
    process.env.COOKIE_SECURE === "1"
  );
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0)
      out[part.slice(0, i).trim()] = decodeURIComponent(
        part.slice(i + 1).trim(),
      );
  }
  return out;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new HttpError(413, "Data yang dikirim terlalu besar."));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function parseBody(req) {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "DELETE")
    return {};
  const raw = await readBody(req);
  if (!raw) return {};
  const type = String(req.headers["content-type"] || "");
  if (type.includes("application/x-www-form-urlencoded"))
    return Object.fromEntries(new URLSearchParams(raw));
  try {
    const data = JSON.parse(raw);
    return data && typeof data === "object" ? data : {};
  } catch {
    throw new HttpError(400, "Format data tidak valid.");
  }
}

function sendJson(res, status, data, headers = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(body);
}

/* ---------- sesi ---------- */

function createSession(userId) {
  const token = randomToken(32);
  db.prepare(
    "INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
  ).run(sha256(token), userId, Date.now() + SESSION_MS, Date.now());
  return token;
}

function sessionCookie(req, token, maxAgeSec) {
  const parts = [
    `sid=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSec}`,
  ];
  if (isHttps(req)) parts.push("Secure");
  return parts.join("; ");
}

function userFromRequest(req) {
  const token = parseCookies(req.headers.cookie).sid;
  if (!token) return null;
  const row = db
    .prepare(
      `
    SELECT u.id, u.name, u.email FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ?
  `,
    )
    .get(sha256(token), Date.now());
  return row ? { ...row } : null;
}

const hasUser = () => Boolean(db.prepare("SELECT 1 FROM users LIMIT 1").get());

function ensureSetupCode() {
  if (hasUser()) return null;
  let code = getSetting("setup_code");
  if (!code) {
    code = String(crypto.randomInt(100000, 1000000));
    setSetting("setup_code", code);
  }
  return code;
}

/* ---------- validasi ---------- */

function cleanEmail(v) {
  const e = String(v ?? "")
    .trim()
    .toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) || e.length > 120)
    throw new HttpError(400, "Format email belum benar.");
  return e;
}
function cleanName(v) {
  const n = String(v ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!n || n.length > 60)
    throw new HttpError(400, "Nama wajib diisi (maksimal 60 karakter).");
  return n;
}
function cleanPassword(v) {
  const p = String(v ?? "");
  if (p.length < 8) throw new HttpError(400, "Kata sandi minimal 8 karakter.");
  if (p.length > 200) throw new HttpError(400, "Kata sandi terlalu panjang.");
  return p;
}
function periodParams(q) {
  const period = q.period || "month";
  const date = q.date || today();
  return { period, date };
}

/* ---------- rute ---------- */

const routes = [];
const route = (method, pattern, opts, handler) => {
  if (typeof opts === "function") {
    handler = opts;
    opts = {};
  }
  const keys = [];
  const re = new RegExp(
    "^" +
      pattern.replace(/:(\w+)/g, (_, k) => {
        keys.push(k);
        return "([^/]+)";
      }) +
      "$",
  );
  routes.push({ method, re, keys, auth: opts.auth !== false, handler });
};

const idParam = (v) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1)
    throw new HttpError(400, "ID tidak valid.");
  return n;
};

/* auth */
route("GET", "/api/auth/status", { auth: false }, (c) => ({
  hasUser: hasUser(),
  loggedIn: Boolean(c.user),
  user: c.user,
  needsSetupCode: !hasUser() && !isLocalRequest(c.req),
}));

route("POST", "/api/auth/register", { auth: false }, (c) => {
  rateLimit(`register:${c.ip}`, 10, 3600_000);
  if (hasUser()) throw new HttpError(403, "Akun sudah dibuat. Silakan masuk.");
  const setup = ensureSetupCode();
  if (
    !isLocalRequest(c.req) &&
    !safeEqual(String(c.body.setup_code ?? ""), setup)
  ) {
    throw new HttpError(
      403,
      "Kode setup salah. Kode itu tercetak di log server saat aplikasi pertama kali dijalankan.",
    );
  }
  const name = cleanName(c.body.name);
  const email = cleanEmail(c.body.email);
  const password = cleanPassword(c.body.password);
  const r = db
    .prepare("INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)")
    .run(name, email, hashPassword(password));
  setSetting("setup_code", "");
  const token = createSession(Number(r.lastInsertRowid));
  return {
    status: 201,
    data: { ok: true },
    headers: { "Set-Cookie": sessionCookie(c.req, token, SESSION_MS / 1000) },
  };
});

route("POST", "/api/auth/login", { auth: false }, (c) => {
  rateLimit(`login:${c.ip}`, 10, 15 * 60_000);
  const email = String(c.body.email ?? "")
    .trim()
    .toLowerCase();
  const user = db
    .prepare("SELECT id, password_hash FROM users WHERE email = ?")
    .get(email);
  const ok = user
    ? verifyPassword(String(c.body.password ?? ""), user.password_hash)
    : (verifyPassword("x", "scrypt$00$00"), false);
  if (!ok) throw new HttpError(401, "Email atau kata sandi salah.");
  const token = createSession(user.id);
  return {
    data: { ok: true },
    headers: { "Set-Cookie": sessionCookie(c.req, token, SESSION_MS / 1000) },
  };
});

route("POST", "/api/auth/logout", { auth: false }, (c) => {
  const token = parseCookies(c.req.headers.cookie).sid;
  if (token)
    db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(sha256(token));
  return {
    data: { ok: true },
    headers: { "Set-Cookie": sessionCookie(c.req, "", 0) },
  };
});

route("POST", "/api/auth/forgot", { auth: false }, (c) => {
  rateLimit(`forgot:${c.ip}`, 5, 3600_000);
  const email = String(c.body.email ?? "")
    .trim()
    .toLowerCase();
  const user = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
  if (user) {
    db.prepare("UPDATE reset_codes SET used = 1 WHERE user_id = ?").run(
      user.id,
    );
    const code = String(crypto.randomInt(100000, 1000000));
    db.prepare(
      "INSERT INTO reset_codes (user_id, code_hash, expires_at) VALUES (?, ?, ?)",
    ).run(user.id, sha256(code), Date.now() + 15 * 60_000);
    console.log(
      `[reset kata sandi] Kode untuk ${email}: ${code} (berlaku 15 menit)`,
    );
  }
  return {
    ok: true,
    message: "Jika email terdaftar, kode reset akan tercetak di log server.",
  };
});

route("POST", "/api/auth/reset", { auth: false }, (c) => {
  rateLimit(`reset:${c.ip}`, 10, 3600_000);
  const email = String(c.body.email ?? "")
    .trim()
    .toLowerCase();
  const password = cleanPassword(c.body.password);
  const user = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
  const bad = new HttpError(
    400,
    "Kode salah atau sudah kedaluwarsa. Minta kode baru.",
  );
  if (!user) throw bad;
  const row = db
    .prepare(
      "SELECT id, code_hash, attempts FROM reset_codes WHERE user_id = ? AND used = 0 AND expires_at > ? ORDER BY id DESC LIMIT 1",
    )
    .get(user.id, Date.now());
  if (!row || row.attempts >= 5) throw bad;
  if (!safeEqual(sha256(String(c.body.code ?? "").trim()), row.code_hash)) {
    db.prepare(
      "UPDATE reset_codes SET attempts = attempts + 1 WHERE id = ?",
    ).run(row.id);
    throw bad;
  }
  transaction(() => {
    db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(
      hashPassword(password),
      user.id,
    );
    db.prepare("UPDATE reset_codes SET used = 1 WHERE user_id = ?").run(
      user.id,
    );
    db.prepare("DELETE FROM sessions WHERE user_id = ?").run(user.id);
  });
  return { ok: true };
});

route("POST", "/api/auth/change-password", (c) => {
  rateLimit(`chpw:${c.user.id}`, 10, 15 * 60_000);
  const row = db
    .prepare("SELECT password_hash FROM users WHERE id = ?")
    .get(c.user.id);
  if (!verifyPassword(String(c.body.old_password ?? ""), row.password_hash))
    throw new HttpError(400, "Kata sandi lama salah.");
  const next = cleanPassword(c.body.new_password);
  const current = sha256(parseCookies(c.req.headers.cookie).sid || "");
  transaction(() => {
    db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(
      hashPassword(next),
      c.user.id,
    );
    db.prepare(
      "DELETE FROM sessions WHERE user_id = ? AND token_hash != ?",
    ).run(c.user.id, current);
  });
  return { ok: true };
});

route("PUT", "/api/me", (c) => {
  const name = cleanName(c.body.name);
  db.prepare("UPDATE users SET name = ? WHERE id = ?").run(name, c.user.id);
  return { ok: true, user: { ...c.user, name } };
});

/* data */
route("GET", "/api/recap", (c) => {
  const { period, date } = periodParams(c.query);
  return service.recap(period, date);
});

route("GET", "/api/transactions", (c) =>
  service.listTransactions({
    type: c.query.type,
    q: c.query.q,
    categoryId: c.query.category_id,
    from: c.query.from,
    to: c.query.to,
    limit: c.query.limit,
    offset: c.query.offset,
  }),
);

route("POST", "/api/transactions", (c) => {
  const tx = service.createTransaction(
    { ...c.body, date: c.body.date || today() },
    "web",
  );
  return { status: 201, data: { ...tx, balance: service.balance() } };
});
route("PUT", "/api/transactions/:id", (c) =>
  service.updateTransaction(idParam(c.params.id), c.body),
);
route("DELETE", "/api/transactions/:id", (c) => {
  service.deleteTransaction(idParam(c.params.id));
  return { ok: true, balance: service.balance() };
});

route("GET", "/api/categories", () => ({ items: service.listCategories() }));
route("POST", "/api/categories", (c) => ({
  status: 201,
  data: service.createCategory(c.body),
}));
route("PUT", "/api/categories/:id", (c) =>
  service.renameCategory(idParam(c.params.id), c.body.name),
);
route("DELETE", "/api/categories/:id", (c) => {
  service.deleteCategory(idParam(c.params.id));
  return { ok: true };
});

route("GET", "/api/export", (c) => {
  const { period, date } = periodParams(c.query);
  const format =
    c.query.format === "csv"
      ? "csv"
      : c.query.format === "pdf" || !c.query.format
        ? "pdf"
        : null;
  if (!format) throw new HttpError(400, "Format file harus pdf atau csv.");
  const data = report.reportData(period, date);
  const base = report.fileBase(period, date);
  if (format === "csv") {
    const delimiter = c.query.sep === "comma" ? "," : ";";
    return {
      raw: report.toCsv(data, delimiter),
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${base}.csv"`,
      },
    };
  }
  return {
    raw: report.toPdf(data),
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${base}.pdf"`,
    },
  };
});

route("GET", "/api/health", { auth: false }, () => ({ ok: true }));

/* ---------- file statis ---------- */

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
};

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === "/") rel = "/index.html";
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return false;
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    return false;
  }
  if (!stat.isFile()) return false;
  const etag = `"${stat.size.toString(16)}-${Math.round(stat.mtimeMs).toString(16)}"`;
  const headers = {
    "Content-Type": MIME[path.extname(file)] || "application/octet-stream",
    "Cache-Control": "no-cache",
    ETag: etag,
  };
  if (req.headers["if-none-match"] === etag) {
    res.writeHead(304, headers);
    res.end();
    return true;
  }
  res.writeHead(200, { ...headers, "Content-Length": stat.size });
  if (req.method === "HEAD") res.end();
  else fs.createReadStream(file).pipe(res);
  return true;
}

/* ---------- server ---------- */

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
  "X-Frame-Options": "DENY",
  "Content-Security-Policy":
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
};

const server = http.createServer(async (req, res) => {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
  try {
    const url = new URL(req.url, "http://localhost");
    const pathname = url.pathname;

    if (!pathname.startsWith("/api/")) {
      if (
        (req.method === "GET" || req.method === "HEAD") &&
        serveStatic(req, res, pathname)
      )
        return;
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Halaman tidak ditemukan.");
      return;
    }

    let matched = null;
    let methodMismatch = false;
    for (const r of routes) {
      const m = r.re.exec(pathname);
      if (!m) continue;
      if (r.method !== req.method) {
        methodMismatch = true;
        continue;
      }
      matched = {
        r,
        params: Object.fromEntries(
          r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]),
        ),
      };
      break;
    }
    if (!matched)
      throw new HttpError(
        methodMismatch ? 405 : 404,
        methodMismatch ? "Metode tidak diizinkan." : "Tidak ditemukan.",
      );

    if (req.method !== "GET" && req.method !== "HEAD") {
      const origin = req.headers.origin;
      if (origin) {
        let host = "";
        try {
          host = new URL(origin).host;
        } catch {
          /* abaikan */
        }
        const expected = String(
          req.headers["x-forwarded-host"] || req.headers.host || "",
        );
        if (host !== expected) throw new HttpError(403, "Permintaan ditolak.");
      }
      if (
        req.method !== "DELETE" &&
        !String(req.headers["content-type"] || "").includes("application/json")
      ) {
        throw new HttpError(415, "Gunakan Content-Type application/json.");
      }
    }

    const user = userFromRequest(req);
    if (matched.r.auth && !user)
      throw new HttpError(401, "Silakan masuk dulu.");

    const ctx = {
      req,
      res,
      user,
      params: matched.params,
      ip: clientIp(req),
      query: Object.fromEntries(url.searchParams),
      body: await parseBody(req),
    };
    let out = await matched.r.handler(ctx);

    if (out && out.raw) {
      res.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Length": out.raw.length,
        ...out.headers,
      });
      res.end(out.raw);
      return;
    }
    if (out && out.data !== undefined && (out.status || out.headers)) {
      sendJson(res, out.status || 200, out.data, out.headers || {});
      return;
    }
    sendJson(res, 200, out ?? { ok: true });
  } catch (err) {
    if (err instanceof HttpError) {
      sendJson(res, err.status, { error: err.message });
      return;
    }
    console.error("Error tak terduga:", err);
    if (!res.headersSent)
      sendJson(res, 500, { error: "Terjadi kesalahan di server. Coba lagi." });
    else res.end();
  }
});

function start(
  port = Number(process.env.PORT) || 3000,
  host = process.env.HOST || "0.0.0.0",
) {
  return new Promise((resolve) => {
    server.listen(port, host, () => {
      const code = ensureSetupCode();
      console.log(
        `Catatuang jalan di http://localhost:${server.address().port}`,
      );
      if (code) {
        console.log(
          `Belum ada akun. Kode setup untuk mendaftar dari alamat selain localhost: ${code}`,
        );
      }
      scheduler.start();
      resolve(server);
    });
  });
}

if (require.main === module) start();

module.exports = { server, start };
