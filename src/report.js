'use strict';
const { db } = require('./db');
const service = require('./service');
const { Pdf, textWidth, fit, PAGE_WIDTH, PAGE_HEIGHT } = require('./pdf');
const {
  HttpError, isValidDate, periodRange, periodLabel, shortDate, formatRp, nowParts, MONTHS_SHORT,
} = require('./util');

const TITLES = { day: 'Laporan Harian', month: 'Laporan Bulanan', year: 'Laporan Tahunan' };
const SLUGS = { day: 'harian', month: 'bulanan', year: 'tahunan' };

function reportData(period, date) {
  if (!TITLES[period]) throw new HttpError(400, 'Periode laporan harus day, month, atau year.');
  if (!isValidDate(date)) throw new HttpError(400, 'Tanggal tidak valid.');
  const { from, to } = periodRange(period, date);
  const t = service.totals(from, to);
  const endBalance = db.prepare(
    "SELECT COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE -amount END), 0) AS b FROM transactions WHERE date <= ?",
  ).get(to).b;
  return {
    period, date, from, to,
    title: TITLES[period],
    label: periodLabel(period, date),
    ...t,
    endBalance,
    byCategory: service.byCategory(from, to),
    transactions: service.allInRange(from, to),
  };
}

function fileBase(period, date) {
  const key = period === 'day' ? date : period === 'month' ? date.slice(0, 7) : date.slice(0, 4);
  return `laporan-${SLUGS[period]}-${key}`;
}

/* ---------- CSV ---------- */

function csvCell(value, sep) {
  let s = String(value ?? '');
  // Cegah sel yang diawali rumus dijalankan spreadsheet.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (s.includes(sep) || /["\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCsv(data, delimiter = ';') {
  const rows = [['Tanggal', 'Jenis', 'Kategori', 'Catatan', 'Jumlah']];
  for (const t of data.transactions) {
    rows.push([
      t.date,
      t.type === 'income' ? 'Pemasukan' : 'Pengeluaran',
      t.category_name || 'Tanpa kategori',
      t.note,
      t.amount,
    ]);
  }
  const body = rows.map((r) => r.map((c) => csvCell(c, delimiter)).join(delimiter)).join('\r\n');
  return Buffer.from('﻿' + body + '\r\n', 'utf8');
}

/* ---------- PDF ---------- */

const INK = [0.09, 0.125, 0.165];
const MUTED = [0.4, 0.44, 0.48];
const RULE = [0.85, 0.87, 0.9];
const BRAND = [0.137, 0.278, 0.659];
const GREEN = [0.07, 0.5, 0.36];
const RED = [0.75, 0.22, 0.17];
const PANEL = [0.95, 0.96, 0.975];

const M = 40;
const CW = PAGE_WIDTH - M * 2;

function sizeToFit(str, width, start, min, bold) {
  let size = start;
  while (size > min && textWidth(str, size, bold) > width) size -= 0.5;
  return size;
}

function timestampLabel() {
  const n = nowParts();
  const [y, m, d] = n.date.split('-').map(Number);
  const hh = String(n.hour).padStart(2, '0');
  const mm = String(n.minute).padStart(2, '0');
  return `${d} ${MONTHS_SHORT[m - 1]} ${y}, ${hh}.${mm} WIB`;
}

function toPdf(data) {
  const pdf = new Pdf();
  const COLS = [
    { key: 'date', label: 'Tanggal', w: 66 },
    { key: 'type', label: 'Jenis', w: 56 },
    { key: 'cat', label: 'Kategori', w: 108 },
    { key: 'note', label: 'Catatan', w: 177 },
    { key: 'amount', label: 'Jumlah', w: CW - 66 - 56 - 108 - 177, right: true },
  ];

  const runningHeader = () => {
    pdf.text('Catatuang', M, 34, { size: 9, bold: true, color: BRAND });
    pdf.text(`${data.title} - ${data.label}`, M, 34, { size: 8, color: MUTED, align: 'right', width: CW });
    pdf.line(M, 42, M + CW, 42, { color: RULE });
  };

  const tableHeader = (y) => {
    pdf.rect(M, y, CW, 20, { fill: PANEL });
    let x = M;
    for (const c of COLS) {
      pdf.text(c.label, x + 6, y + 13.5, { size: 8.5, bold: true, color: INK, align: c.right ? 'right' : 'left', width: c.w - 12 });
      x += c.w;
    }
    return y + 20;
  };

  /* --- halaman pertama --- */
  pdf.addPage();
  pdf.text('Catatuang', M, 50, { size: 10, bold: true, color: BRAND });
  pdf.text(`Dibuat ${timestampLabel()}`, M, 50, { size: 8, color: MUTED, align: 'right', width: CW });
  pdf.text(data.title, M, 84, { size: 24, bold: true, color: INK });
  pdf.text(data.label, M, 104, { size: 12, color: MUTED });
  pdf.line(M, 118, M + CW, 118, { color: RULE });

  // Empat kotak ringkasan.
  const gap = 10;
  const bw = (CW - gap * 3) / 4;
  const boxes = [
    { label: 'Pemasukan', value: formatRp(data.income), color: GREEN },
    { label: 'Pengeluaran', value: formatRp(data.expense), color: RED },
    { label: data.net >= 0 ? 'Selisih (surplus)' : 'Selisih (defisit)', value: formatRp(data.net), color: data.net >= 0 ? GREEN : RED },
    { label: 'Saldo akhir periode', value: formatRp(data.endBalance), color: INK },
  ];
  boxes.forEach((b, i) => {
    const x = M + i * (bw + gap);
    pdf.rect(x, 132, bw, 52, { stroke: RULE });
    pdf.text(b.label, x + 10, 148, { size: 8, color: MUTED });
    const size = sizeToFit(b.value, bw - 20, 13, 7.5, true);
    pdf.text(b.value, x + 10, 171, { size, bold: true, color: b.color });
  });

  // Ringkasan per kategori, dua kolom.
  let y = 212;
  pdf.text('Ringkasan per kategori', M, y, { size: 12, bold: true, color: INK });
  y += 12;
  const colW = (CW - 24) / 2;
  const blocks = [
    { title: 'Pemasukan', rows: data.byCategory.income, total: data.income, color: GREEN, x: M },
    { title: 'Pengeluaran', rows: data.byCategory.expense, total: data.expense, color: RED, x: M + colW + 24 },
  ];
  let blockEnd = y;
  for (const b of blocks) {
    let by = y + 14;
    pdf.text(b.title, b.x, by, { size: 9, bold: true, color: b.color });
    pdf.line(b.x, by + 5, b.x + colW, by + 5, { color: RULE });
    by += 19;
    if (!b.rows.length) {
      pdf.text('Belum ada data.', b.x, by, { size: 9, color: MUTED });
      by += 14;
    }
    for (const r of b.rows.slice(0, 12)) {
      const pct = b.total ? Math.round((r.total / b.total) * 100) : 0;
      pdf.text(fit(r.name, colW - 150, 9), b.x, by, { size: 9, color: INK });
      pdf.text(`${pct}%`, b.x + colW - 130, by, { size: 8.5, color: MUTED, align: 'right', width: 28 });
      pdf.text(formatRp(r.total), b.x + colW - 98, by, { size: 9, color: INK, align: 'right', width: 98 });
      by += 14;
    }
    if (b.rows.length > 12) {
      pdf.text(`dan ${b.rows.length - 12} kategori lain`, b.x, by, { size: 8.5, color: MUTED });
      by += 14;
    }
    blockEnd = Math.max(blockEnd, by);
  }

  // Daftar transaksi.
  y = blockEnd + 18;
  const pageBottom = PAGE_HEIGHT - 56;
  if (y + 80 > pageBottom) {
    pdf.addPage();
    runningHeader();
    y = 64;
  }
  pdf.text('Daftar transaksi', M, y, { size: 12, bold: true, color: INK });
  pdf.text(`${data.count} transaksi`, M, y, { size: 9, color: MUTED, align: 'right', width: CW });
  y = tableHeader(y + 10);

  if (!data.transactions.length) {
    pdf.text('Belum ada transaksi pada periode ini.', M + 6, y + 18, { size: 9.5, color: MUTED });
  }

  for (const t of data.transactions) {
    if (y + 17 > pageBottom) {
      pdf.addPage();
      runningHeader();
      y = tableHeader(64);
    }
    const inc = t.type === 'income';
    const cells = [
      shortDate(t.date),
      inc ? 'Masuk' : 'Keluar',
      t.category_name || 'Tanpa kategori',
      t.note || '-',
      `${inc ? '+' : '-'} ${formatRp(t.amount)}`,
    ];
    let x = M;
    COLS.forEach((c, i) => {
      const color = i === 1 || i === 4 ? (inc ? GREEN : RED) : INK;
      pdf.text(fit(cells[i], c.w - 12, 8.5, false), x + 6, y + 11.5, {
        size: 8.5, color, align: c.right ? 'right' : 'left', width: c.w - 12,
      });
      x += c.w;
    });
    y += 17;
    pdf.line(M, y, M + CW, y, { color: [0.92, 0.93, 0.95] });
  }

  // Nomor halaman.
  const total = pdf.pages.length;
  pdf.pages.forEach((ops, i) => {
    pdf.ops = ops;
    pdf.text(`Halaman ${i + 1} dari ${total}`, M, PAGE_HEIGHT - 28, { size: 8, color: MUTED, align: 'right', width: CW });
    pdf.text('Dibuat dengan Catatuang', M, PAGE_HEIGHT - 28, { size: 8, color: MUTED });
  });

  return pdf.build({ title: `${data.title} ${data.label}` });
}

module.exports = { reportData, toCsv, toPdf, fileBase };
