'use strict';
// Penulis PDF kecil tanpa dependensi: teks, garis, dan kotak di halaman A4.
// Font memakai Helvetica bawaan PDF, jadi tidak ada file font yang perlu disematkan.

const W = 595.28;
const H = 841.89;

// Lebar karakter Helvetica (per 1000 satuan) untuk kode 32..126.
const HELV = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const HELV_BOLD = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
  975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
  333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
  611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584];

function toLatin1(str) {
  let out = '';
  for (const ch of String(str)) {
    const c = ch.codePointAt(0);
    if (c === 0x2013 || c === 0x2014) out += '-';
    else if (c === 0x2018 || c === 0x2019) out += "'";
    else if (c === 0x201c || c === 0x201d) out += '"';
    else if (c < 32) out += ' ';
    else if (c <= 255) out += ch;
    else out += '?';
  }
  return out;
}

function textWidth(str, size, bold = false) {
  const table = bold ? HELV_BOLD : HELV;
  let w = 0;
  for (const ch of toLatin1(str)) {
    const c = ch.charCodeAt(0);
    w += c >= 32 && c <= 126 ? table[c - 32] : 556;
  }
  return (w * size) / 1000;
}

function fit(str, maxWidth, size, bold = false) {
  const s = toLatin1(str);
  if (textWidth(s, size, bold) <= maxWidth) return s;
  let out = s;
  while (out.length > 1 && textWidth(out + '...', size, bold) > maxWidth) out = out.slice(0, -1);
  return out.trimEnd() + '...';
}

const escapePdf = (s) => toLatin1(s).replace(/[\\()]/g, (m) => '\\' + m);
const num = (n) => (Math.round(n * 100) / 100).toString();
const rgb = (c) => c.map((v) => num(v)).join(' ');

class Pdf {
  constructor() {
    this.width = W;
    this.height = H;
    this.pages = [];
    this.ops = null;
  }

  addPage() {
    this.ops = [];
    this.pages.push(this.ops);
    return this.pages.length;
  }

  // y dihitung dari tepi atas halaman (lebih mudah dipikirkan daripada sistem PDF asli).
  text(str, x, y, { size = 10, bold = false, color = [0, 0, 0], align = 'left', width = 0 } = {}) {
    let px = x;
    if (align === 'right') px = x + width - textWidth(str, size, bold);
    else if (align === 'center') px = x + (width - textWidth(str, size, bold)) / 2;
    this.ops.push(`BT /${bold ? 'F2' : 'F1'} ${num(size)} Tf ${rgb(color)} rg ${num(px)} ${num(H - y)} Td (${escapePdf(str)}) Tj ET`);
  }

  rect(x, y, w, h, { fill, stroke, lineWidth = 0.6 } = {}) {
    const parts = [];
    if (fill) parts.push(`${rgb(fill)} rg`);
    if (stroke) parts.push(`${rgb(stroke)} RG ${num(lineWidth)} w`);
    parts.push(`${num(x)} ${num(H - y - h)} ${num(w)} ${num(h)} re ${fill && stroke ? 'B' : fill ? 'f' : 'S'}`);
    this.ops.push(parts.join(' '));
  }

  line(x1, y1, x2, y2, { color = [0.8, 0.8, 0.8], lineWidth = 0.6 } = {}) {
    this.ops.push(`${rgb(color)} RG ${num(lineWidth)} w ${num(x1)} ${num(H - y1)} m ${num(x2)} ${num(H - y2)} l S`);
  }

  build({ title = '', author = 'Catatuang' } = {}) {
    const objects = [];
    const add = (body) => { objects.push(body); return objects.length; };

    add('<< /Type /Catalog /Pages 2 0 R >>');
    add(''); // Pages, diisi setelah id halaman diketahui
    add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    const infoId = add(`<< /Title (${escapePdf(title)}) /Author (${escapePdf(author)}) /Producer (Catatuang) >>`);

    const pageIds = [];
    for (const ops of this.pages) {
      const stream = ops.join('\n');
      const contentId = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
      const pageId = add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(W)} ${num(H)}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>`);
      pageIds.push(pageId);
    }
    objects[1] = `<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map((i) => `${i} 0 R`).join(' ')}] >>`;

    let out = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
    const offsets = [];
    objects.forEach((body, i) => {
      offsets.push(out.length);
      out += `${i + 1} 0 obj\n${body}\nendobj\n`;
    });
    const xref = out.length;
    out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const off of offsets) out += `${String(off).padStart(10, '0')} 00000 n \n`;
    out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info ${infoId} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return Buffer.from(out, 'latin1');
  }
}

module.exports = { Pdf, textWidth, fit, toLatin1, PAGE_WIDTH: W, PAGE_HEIGHT: H };
