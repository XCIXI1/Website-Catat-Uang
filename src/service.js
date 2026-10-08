'use strict';
const { db, transaction } = require('./db');
const { HttpError, isValidDate, periodRange, periodLabel, pad, daysInMonth } = require('./util');

const MAX_AMOUNT = 999_999_999_999;

/* ---------- kategori ---------- */

function listCategories() {
  return db.prepare(`
    SELECT c.id, c.name, c.type, c.is_default,
           (SELECT COUNT(*) FROM transactions t WHERE t.category_id = c.id) AS usage_count
    FROM categories c
    ORDER BY c.type DESC, c.is_default DESC, c.name COLLATE NOCASE
  `).all().map((c) => ({ ...c, is_default: !!c.is_default }));
}

function cleanName(name) {
  const n = String(name ?? '').replace(/\s+/g, ' ').trim();
  if (!n) throw new HttpError(400, 'Nama kategori belum diisi.');
  if (n.length > 40) throw new HttpError(400, 'Nama kategori maksimal 40 karakter.');
  return n;
}

function createCategory({ name, type }) {
  if (type !== 'income' && type !== 'expense') throw new HttpError(400, 'Jenis kategori harus pemasukan atau pengeluaran.');
  const n = cleanName(name);
  try {
    const r = db.prepare('INSERT INTO categories (name, type, is_default) VALUES (?, ?, 0)').run(n, type);
    return getCategory(Number(r.lastInsertRowid));
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) throw new HttpError(409, `Kategori "${n}" sudah ada.`);
    throw err;
  }
}

function getCategory(id) {
  const c = db.prepare('SELECT id, name, type, is_default FROM categories WHERE id = ?').get(id);
  if (!c) throw new HttpError(404, 'Kategori tidak ditemukan.');
  return { ...c, is_default: !!c.is_default };
}

function renameCategory(id, name) {
  const c = getCategory(id);
  if (c.is_default) throw new HttpError(400, 'Kategori bawaan tidak bisa diubah namanya.');
  const n = cleanName(name);
  try {
    db.prepare('UPDATE categories SET name = ? WHERE id = ?').run(n, id);
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) throw new HttpError(409, `Kategori "${n}" sudah ada.`);
    throw err;
  }
  return getCategory(id);
}

function deleteCategory(id) {
  const c = getCategory(id);
  if (c.is_default) throw new HttpError(400, 'Kategori bawaan tidak bisa dihapus.');
  db.prepare('DELETE FROM categories WHERE id = ?').run(id);
}

/* ---------- transaksi ---------- */

const TX_SELECT = `
  SELECT t.id, t.type, t.amount, t.category_id, c.name AS category_name, t.note, t.date, t.source
  FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
`;

function validateTx(input) {
  const type = input.type;
  if (type !== 'income' && type !== 'expense') throw new HttpError(400, 'Pilih jenis transaksi: pemasukan atau pengeluaran.');
  const amount = Number(input.amount);
  if (!Number.isInteger(amount) || amount < 1) throw new HttpError(400, 'Jumlah harus berupa angka bulat lebih dari 0.');
  if (amount > MAX_AMOUNT) throw new HttpError(400, 'Jumlahnya terlalu besar.');
  if (!isValidDate(input.date)) throw new HttpError(400, 'Tanggal tidak valid.');
  const note = String(input.note ?? '').replace(/\s+/g, ' ').trim();
  if (note.length > 200) throw new HttpError(400, 'Catatan maksimal 200 karakter.');
  let categoryId = null;
  if (input.category_id !== null && input.category_id !== undefined && input.category_id !== '') {
    categoryId = Number(input.category_id);
    const cat = db.prepare('SELECT type FROM categories WHERE id = ?').get(categoryId);
    if (!cat) throw new HttpError(400, 'Kategori tidak ditemukan.');
    if (cat.type !== type) throw new HttpError(400, 'Jenis kategori tidak cocok dengan jenis transaksi.');
  }
  return { type, amount, date: input.date, note, categoryId };
}

function getTransaction(id) {
  const t = db.prepare(`${TX_SELECT} WHERE t.id = ?`).get(id);
  if (!t) throw new HttpError(404, 'Transaksi tidak ditemukan.');
  return { ...t };
}

function createTransaction(input, source = 'web') {
  const v = validateTx(input);
  const r = db.prepare('INSERT INTO transactions (type, amount, category_id, note, date, source) VALUES (?, ?, ?, ?, ?, ?)')
    .run(v.type, v.amount, v.categoryId, v.note, v.date, source);
  return getTransaction(Number(r.lastInsertRowid));
}

function updateTransaction(id, input) {
  getTransaction(id);
  const v = validateTx(input);
  db.prepare('UPDATE transactions SET type = ?, amount = ?, category_id = ?, note = ?, date = ? WHERE id = ?')
    .run(v.type, v.amount, v.categoryId, v.note, v.date, id);
  return getTransaction(id);
}

function deleteTransaction(id) {
  getTransaction(id);
  db.prepare('DELETE FROM transactions WHERE id = ?').run(id);
}

function lastTransaction() {
  const t = db.prepare(`${TX_SELECT} ORDER BY t.id DESC LIMIT 1`).get();
  return t ? { ...t } : null;
}

const escapeLike = (s) => s.replace(/[\\%_]/g, (m) => '\\' + m);

function buildFilter({ type, q, categoryId, from, to }) {
  const where = [];
  const params = [];
  if (type === 'income' || type === 'expense') { where.push('t.type = ?'); params.push(type); }
  if (categoryId) { where.push('t.category_id = ?'); params.push(Number(categoryId)); }
  if (from && isValidDate(from)) { where.push('t.date >= ?'); params.push(from); }
  if (to && isValidDate(to)) { where.push('t.date <= ?'); params.push(to); }
  const text = String(q ?? '').trim();
  if (text) {
    // Setiap kata harus cocok di catatan, nama kategori, jumlah, atau tanggal.
    for (const word of text.split(/\s+/).slice(0, 6)) {
      const like = `%${escapeLike(word.toLowerCase())}%`;
      const digits = word.replace(/[.\s]/g, '');
      where.push(`(lower(t.note) LIKE ? ESCAPE '\\' OR lower(IFNULL(c.name, '')) LIKE ? ESCAPE '\\' OR CAST(t.amount AS TEXT) LIKE ? ESCAPE '\\' OR t.date LIKE ? ESCAPE '\\')`);
      params.push(like, like, `%${escapeLike(digits)}%`, like);
    }
  }
  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

function listTransactions(opts = {}) {
  const limit = Math.min(Math.max(Number(opts.limit) || 30, 1), 500);
  const offset = Math.max(Number(opts.offset) || 0, 0);
  const f = buildFilter(opts);
  const base = 'FROM transactions t LEFT JOIN categories c ON c.id = t.category_id';
  const items = db.prepare(`
    SELECT t.id, t.type, t.amount, t.category_id, c.name AS category_name, t.note, t.date, t.source
    ${base} ${f.sql} ORDER BY t.date DESC, t.id DESC LIMIT ? OFFSET ?
  `).all(...f.params, limit, offset).map((r) => ({ ...r }));
  const sums = db.prepare(`
    SELECT COUNT(*) AS total,
           COALESCE(SUM(CASE WHEN t.type = 'income' THEN t.amount END), 0) AS income,
           COALESCE(SUM(CASE WHEN t.type = 'expense' THEN t.amount END), 0) AS expense
    ${base} ${f.sql}
  `).get(...f.params);
  return { items, total: sums.total, income: sums.income, expense: sums.expense, limit, offset };
}

function allInRange(from, to) {
  return db.prepare(`${TX_SELECT} WHERE t.date >= ? AND t.date <= ? ORDER BY t.date ASC, t.id ASC`)
    .all(from, to).map((r) => ({ ...r }));
}

/* ---------- saldo & recap ---------- */

function balance() {
  return db.prepare("SELECT COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE -amount END), 0) AS b FROM transactions").get().b;
}

function totals(from, to) {
  const r = db.prepare(`
    SELECT COUNT(*) AS count,
           COALESCE(SUM(CASE WHEN type = 'income' THEN amount END), 0) AS income,
           COALESCE(SUM(CASE WHEN type = 'expense' THEN amount END), 0) AS expense
    FROM transactions WHERE date >= ? AND date <= ?
  `).get(from, to);
  return { count: r.count, income: r.income, expense: r.expense, net: r.income - r.expense };
}

function byCategory(from, to) {
  const rows = db.prepare(`
    SELECT t.type, c.id AS category_id, COALESCE(c.name, 'Tanpa kategori') AS name, SUM(t.amount) AS total, COUNT(*) AS count
    FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
    WHERE t.date >= ? AND t.date <= ?
    GROUP BY t.type, c.id ORDER BY total DESC
  `).all(from, to).map((r) => ({ ...r }));
  return {
    income: rows.filter((r) => r.type === 'income'),
    expense: rows.filter((r) => r.type === 'expense'),
  };
}

function series(period, from, to) {
  if (period === 'month') {
    const [y, m] = from.split('-').map(Number);
    const rows = db.prepare(`
      SELECT date, SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END) AS income,
                   SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END) AS expense
      FROM transactions WHERE date >= ? AND date <= ? GROUP BY date
    `).all(from, to);
    const map = new Map(rows.map((r) => [r.date, r]));
    return Array.from({ length: daysInMonth(y, m) }, (_, i) => {
      const date = `${y}-${pad(m)}-${pad(i + 1)}`;
      const r = map.get(date);
      return { key: date, label: String(i + 1), income: r ? r.income : 0, expense: r ? r.expense : 0 };
    });
  }
  if (period === 'year') {
    const y = Number(from.slice(0, 4));
    const rows = db.prepare(`
      SELECT substr(date, 1, 7) AS ym, SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END) AS income,
                                       SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END) AS expense
      FROM transactions WHERE date >= ? AND date <= ? GROUP BY ym
    `).all(from, to);
    const map = new Map(rows.map((r) => [r.ym, r]));
    const short = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
    return short.map((label, i) => {
      const key = `${y}-${pad(i + 1)}`;
      const r = map.get(key);
      return { key, label, income: r ? r.income : 0, expense: r ? r.expense : 0 };
    });
  }
  return [];
}

function recap(period, date) {
  if (!['day', 'month', 'year'].includes(period)) throw new HttpError(400, 'Periode harus day, month, atau year.');
  if (!isValidDate(date)) throw new HttpError(400, 'Tanggal tidak valid.');
  const { from, to } = periodRange(period, date);
  return {
    period, date, from, to,
    label: periodLabel(period, date),
    balance: balance(),
    ...totals(from, to),
    by_category: byCategory(from, to),
    series: series(period, from, to),
    recent: db.prepare(`${TX_SELECT} WHERE t.date >= ? AND t.date <= ? ORDER BY t.date DESC, t.id DESC LIMIT 8`)
      .all(from, to).map((r) => ({ ...r })),
  };
}

module.exports = {
  listCategories, createCategory, renameCategory, deleteCategory, getCategory,
  getTransaction, createTransaction, updateTransaction, deleteTransaction, lastTransaction,
  listTransactions, allInRange, balance, totals, byCategory, recap, transaction,
};
