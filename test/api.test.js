"use strict";
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "catatuang-api-"));

const test = require("node:test");
const assert = require("node:assert/strict");

let base;
let cookie = "";

const api = async (method, url, body, extraHeaders = {}) => {
  const res = await fetch(base + url, {
    method,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...extraHeaders,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const set = res.headers.get("set-cookie");
  if (set) cookie = set.split(";")[0];
  const type = res.headers.get("content-type") || "";
  const data = type.includes("json")
    ? await res.json()
    : Buffer.from(await res.arrayBuffer());
  return { status: res.status, data, headers: res.headers };
};

let server;
test.before(async () => {
  const app = require("../server");
  server = await app.start(0, "127.0.0.1");
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => {
  server.close();
  process.exit(0);
});

test("akun: belum ada, daftar, masuk, keluar", async () => {
  let r = await api("GET", "/api/auth/status");
  assert.equal(r.data.hasUser, false);

  r = await api("GET", "/api/recap");
  assert.equal(r.status, 401);

  r = await api("POST", "/api/auth/register", {
    name: "Budi Santoso",
    email: "budi@example.com",
    password: "pendek",
  });
  assert.equal(r.status, 400);

  r = await api("POST", "/api/auth/register", {
    name: "Budi Santoso",
    email: "budi@example.com",
    password: "rahasia123",
  });
  assert.equal(r.status, 201);
  assert.match(cookie, /^sid=/);

  r = await api("POST", "/api/auth/register", {
    name: "Orang Lain",
    email: "x@example.com",
    password: "rahasia123",
  });
  assert.equal(r.status, 403);

  r = await api("GET", "/api/auth/status");
  assert.equal(r.data.loggedIn, true);
  assert.equal(r.data.user.name, "Budi Santoso");

  await api("POST", "/api/auth/logout", {});
  cookie = "";
  r = await api("GET", "/api/recap");
  assert.equal(r.status, 401);

  r = await api("POST", "/api/auth/login", {
    email: "budi@example.com",
    password: "salah-banget",
  });
  assert.equal(r.status, 401);
  r = await api("POST", "/api/auth/login", {
    email: "BUDI@example.com",
    password: "rahasia123",
  });
  assert.equal(r.status, 200);
});

test("kategori bawaan dan kategori buatan sendiri", async () => {
  let r = await api("GET", "/api/categories");
  const names = r.data.items.map((c) => `${c.type}:${c.name}`);
  assert.ok(names.includes("income:Gaji"));
  assert.ok(names.includes("expense:Makan & Minuman"));
  const bawaan = r.data.items.find((c) => c.name === "Gaji");
  assert.equal(bawaan.is_default, true);

  r = await api("DELETE", `/api/categories/${bawaan.id}`);
  assert.equal(r.status, 400);

  r = await api("POST", "/api/categories", {
    name: "Cicilan Motor",
    type: "expense",
  });
  assert.equal(r.status, 201);
  const id = r.data.id;
  r = await api("POST", "/api/categories", {
    name: "cicilan motor",
    type: "expense",
  });
  assert.equal(r.status, 409);

  r = await api("PUT", `/api/categories/${id}`, { name: "Cicilan" });
  assert.equal(r.data.name, "Cicilan");
});

test("transaksi: tambah, ubah, cari, hapus, saldo", async () => {
  const cats = (await api("GET", "/api/categories")).data.items;
  const gaji = cats.find((c) => c.name === "Gaji");
  const makan = cats.find((c) => c.name === "Makan & Minuman");

  let r = await api("POST", "/api/transactions", {
    type: "income",
    amount: 5_000_000,
    category_id: gaji.id,
    note: "Gaji Oktober",
    date: "2026-10-01",
  });
  assert.equal(r.status, 201);
  r = await api("POST", "/api/transactions", {
    type: "expense",
    amount: 25000,
    category_id: makan.id,
    note: "Makan siang",
    date: "2026-10-02",
  });
  const lunch = r.data;
  assert.equal(r.data.balance, 4_975_000);

  // jenis kategori harus cocok
  r = await api("POST", "/api/transactions", {
    type: "expense",
    amount: 1000,
    category_id: gaji.id,
    date: "2026-10-02",
  });
  assert.equal(r.status, 400);
  r = await api("POST", "/api/transactions", {
    type: "expense",
    amount: -5,
    date: "2026-10-02",
  });
  assert.equal(r.status, 400);
  r = await api("POST", "/api/transactions", {
    type: "expense",
    amount: 1000,
    date: "2026-13-45",
  });
  assert.equal(r.status, 400);

  r = await api("PUT", `/api/transactions/${lunch.id}`, {
    type: "expense",
    amount: 30000,
    category_id: makan.id,
    note: "Makan siang + es teh",
    date: "2026-10-02",
  });
  assert.equal(r.data.amount, 30000);

  r = await api("GET", "/api/transactions?type=expense");
  assert.equal(r.data.total, 1);
  r = await api("GET", "/api/transactions?type=income");
  assert.equal(r.data.items[0].note, "Gaji Oktober");
  r = await api("GET", `/api/transactions?q=${encodeURIComponent("es teh")}`);
  assert.equal(r.data.total, 1);
  r = await api("GET", `/api/transactions?q=${encodeURIComponent("makan")}`);
  assert.equal(r.data.total, 1); // cocok lewat nama kategori juga
  r = await api("GET", "/api/transactions?q=5000000");
  assert.equal(r.data.total, 1);
  r = await api("GET", `/api/transactions?q=${encodeURIComponent("100%")}`);
  assert.equal(r.data.total, 0);

  r = await api("DELETE", `/api/transactions/${lunch.id}`);
  assert.equal(r.data.balance, 5_000_000);
  await api("POST", "/api/transactions", {
    type: "expense",
    amount: 30000,
    category_id: makan.id,
    note: "Makan siang",
    date: "2026-10-02",
  });
});

test("recap harian, bulanan, tahunan", async () => {
  let r = await api("GET", "/api/recap?period=month&date=2026-10-15");
  assert.equal(r.data.income, 5_000_000);
  assert.equal(r.data.expense, 30000);
  assert.equal(r.data.net, 4_970_000);
  assert.equal(r.data.balance, 4_970_000);
  assert.equal(r.data.series.length, 31);
  assert.equal(r.data.series[1].expense, 30000);
  assert.equal(r.data.by_category.expense[0].name, "Makan & Minuman");

  r = await api("GET", "/api/recap?period=day&date=2026-10-02");
  assert.equal(r.data.expense, 30000);
  assert.equal(r.data.income, 0);

  r = await api("GET", "/api/recap?period=year&date=2026-06-01");
  assert.equal(r.data.series.length, 12);
  assert.equal(r.data.series[9].income, 5_000_000);

  r = await api("GET", "/api/recap?period=decade");
  assert.equal(r.status, 400);
});

test("ekspor CSV dan PDF", async () => {
  let r = await api(
    "GET",
    "/api/export?period=month&date=2026-10-10&format=csv",
  );
  assert.equal(r.status, 200);
  assert.match(
    r.headers.get("content-disposition"),
    /laporan-bulanan-2026-10\.csv/,
  );
  const csv = r.data.toString("utf8");
  assert.ok(csv.startsWith("﻿Tanggal;Jenis;Kategori;Catatan;Jumlah"));
  assert.ok(csv.includes("2026-10-01;Pemasukan;Gaji;Gaji Oktober;5000000"));

  r = await api(
    "GET",
    "/api/export?period=month&date=2026-10-10&format=csv&sep=comma",
  );
  assert.ok(
    r.data.toString("utf8").includes("Tanggal,Jenis,Kategori,Catatan,Jumlah"),
  );

  for (const period of ["day", "month", "year"]) {
    r = await api(
      "GET",
      `/api/export?period=${period}&date=2026-10-02&format=pdf`,
    );
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("content-type"), "application/pdf");
    assert.equal(r.data.subarray(0, 5).toString(), "%PDF-");
    assert.ok(r.data.toString("latin1").trimEnd().endsWith("%%EOF"));
  }
  r = await api("GET", "/api/export?period=month&date=2026-10-10&format=docx");
  assert.equal(r.status, 400);
});

test("reset password memakai kode di log server", async () => {
  const saved = cookie;
  cookie = "";
  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => logs.push(args.join(" "));
  let r;
  try {
    r = await api("POST", "/api/auth/forgot", { email: "budi@example.com" });
  } finally {
    console.log = originalLog;
  }
  assert.equal(r.status, 200);
  assert.match(r.data.message, /log server/);
  const code = logs
    .join("\n")
    .match(/Kode untuk budi@example\.com: (\d{6})/)[1];

  r = await api("POST", "/api/auth/reset", {
    email: "budi@example.com",
    code: "000000",
    password: "sandibaru123",
  });
  assert.equal(r.status, 400);
  r = await api("POST", "/api/auth/reset", {
    email: "budi@example.com",
    code,
    password: "sandibaru123",
  });
  assert.equal(r.status, 200);
  // kode sekali pakai
  r = await api("POST", "/api/auth/reset", {
    email: "budi@example.com",
    code,
    password: "sandilain123",
  });
  assert.equal(r.status, 400);

  // sesi lama dicabut, sandi lama tidak berlaku
  cookie = saved;
  assert.equal((await api("GET", "/api/recap")).status, 401);
  cookie = "";
  assert.equal(
    (
      await api("POST", "/api/auth/login", {
        email: "budi@example.com",
        password: "rahasia123",
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await api("POST", "/api/auth/login", {
        email: "budi@example.com",
        password: "sandibaru123",
      })
    ).status,
    200,
  );

  r = await api("POST", "/api/auth/change-password", {
    old_password: "salah",
    new_password: "lagi-baru-123",
  });
  assert.equal(r.status, 400);
  r = await api("POST", "/api/auth/change-password", {
    old_password: "sandibaru123",
    new_password: "lagi-baru-123",
  });
  assert.equal(r.status, 200);
});

test("perlindungan dasar", async () => {
  let r = await api(
    "POST",
    "/api/transactions",
    { type: "expense", amount: 1000, date: "2026-10-03" },
    { Origin: "https://situs-jahat.example" },
  );
  assert.equal(r.status, 403);

  const res = await fetch(`${base}/api/transactions`, {
    method: "POST",
    headers: { Cookie: cookie, "Content-Type": "text/plain" },
    body: "{}",
  });
  assert.equal(res.status, 415);

  const trav = await fetch(`${base}/..%2fserver.js`);
  assert.equal(trav.status, 404);
  const sec = await fetch(`${base}/api/health`);
  assert.equal(sec.headers.get("x-content-type-options"), "nosniff");
});
