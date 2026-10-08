(() => {
  "use strict";

  /* ---------- alat kecil ---------- */

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const ESC = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ESC[c]);
  const num = (n) => Math.abs(Math.round(n)).toLocaleString("id-ID");
  const rp = (n) => `${n < 0 ? "-" : ""}Rp ${num(n)}`;

  const ICONS = {
    home: "M3 11l9-7 9 7M5 10v10h14V10",
    list: "M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01",
    file: "M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 13h6M9 17h6",
    tag: "M3 12V4h8l10 10-8 8zM7.5 8h.01",
    user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0",
    down: "M12 5v14M6 13l6 6 6-6",
    up: "M12 19V5M6 11l6-6 6 6",
    left: "M15 6l-6 6 6 6",
    right: "M9 6l6 6-6 6",
    edit: "M4 20h4L19 9l-4-4L4 16zM13 7l4 4",
    x: "M6 6l12 12M18 6L6 18",
    sun: "M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4",
    moon: "M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z",
  };
  const svg = (name) =>
    `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS[name]}"/></svg>`;

  const state = {
    user: null,
    recap: { period: "month", date: null },
    hist: {
      type: "all",
      q: "",
      cat: "",
      items: [],
      total: 0,
      income: 0,
      expense: 0,
    },
    report: { period: "month", format: "pdf", sep: "semicolon" },
    cats: [],
  };

  const todayStr = () =>
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(
      new Date(),
    );

  function shiftDate(period, date, dir) {
    const [y, m, d] = date.split("-").map(Number);
    if (period === "day")
      return new Date(Date.UTC(y, m - 1, d + dir)).toISOString().slice(0, 10);
    if (period === "month")
      return new Date(Date.UTC(y, m - 1 + dir, 1)).toISOString().slice(0, 10);
    return `${y + dir}-01-01`;
  }
  const keyOf = (period, date) =>
    period === "day"
      ? date
      : period === "month"
        ? date.slice(0, 7)
        : date.slice(0, 4);

  function longDate(date) {
    return new Date(`${date}T12:00:00Z`).toLocaleDateString("id-ID", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    });
  }

  let toastTimer;
  function toast(msg) {
    const el = $("#toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 3200);
  }

  async function api(method, url, body) {
    const res = await fetch(url, {
      method,
      credentials: "same-origin",
      headers: body !== undefined ? { "Content-Type": "application/json" } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try {
      data = await res.json();
    } catch {
      /* bukan JSON */
    }
    if (!res.ok) {
      if (res.status === 401 && state.user && !url.startsWith("/api/auth/")) {
        state.user = null;
        showAuth("login", "Sesi sudah habis. Silakan masuk lagi.");
      }
      const err = new Error(
        (data && data.error) || "Terjadi kesalahan. Coba lagi.",
      );
      err.status = res.status;
      throw err;
    }
    return data;
  }

  /* ---------- dialog ---------- */

  const dlg = $("#dlg");
  dlg.addEventListener("click", (e) => {
    if (e.target === dlg) dlg.close();
  });

  function openDlg(html) {
    dlg.innerHTML = `<div class="dlg-body">${html}</div>`;
    if (!dlg.open) dlg.showModal();
    return dlg;
  }

  function confirmBox({ title, text, ok = "Ya", danger = false }) {
    return new Promise((resolve) => {
      openDlg(`
        <h2>${esc(title)}</h2>
        ${text ? `<p class="muted">${esc(text)}</p>` : ""}
        <div class="dlg-actions">
          <button class="btn" type="button" data-no>Batal</button>
          <button class="btn ${danger ? "danger" : "primary"}" type="button" data-yes>${esc(ok)}</button>
        </div>`);
      let done = false;
      const finish = (v) => {
        if (done) return;
        done = true;
        dlg.close();
        resolve(v);
      };
      $("[data-yes]", dlg).onclick = () => finish(true);
      $("[data-no]", dlg).onclick = () => finish(false);
      dlg.addEventListener("close", () => finish(false), { once: true });
    });
  }

  function promptBox({ title, value = "", ok = "Simpan", label }) {
    return new Promise((resolve) => {
      openDlg(`
        <form id="pf" class="form-grid">
          <h2>${esc(title)}</h2>
          <label class="field"><span>${esc(label)}</span><input type="text" name="v" maxlength="40" value="${esc(value)}" required></label>
          <div class="dlg-actions">
            <button class="btn" type="button" data-no>Batal</button>
            <button class="btn primary" type="submit">${esc(ok)}</button>
          </div>
        </form>`);
      let done = false;
      const finish = (v) => {
        if (done) return;
        done = true;
        dlg.close();
        resolve(v);
      };
      const input = $("input", dlg);
      input.focus();
      input.select();
      $("#pf", dlg).onsubmit = (e) => {
        e.preventDefault();
        finish(input.value.trim() || null);
      };
      $("[data-no]", dlg).onclick = () => finish(null);
      dlg.addEventListener("close", () => finish(null), { once: true });
    });
  }

  /* ---------- masuk & daftar ---------- */

  const authEl = $("#auth");
  const appEl = $("#app");

  function showAuth(mode, notice = "") {
    $("#boot").hidden = true;
    appEl.hidden = true;
    authEl.hidden = false;
    if (dlg.open) dlg.close();
    renderAuth(mode, notice);
  }

  function renderAuth(mode, notice = "", prefill = {}) {
    const brand = `<div class="brandmark"><img src="/icons/icon.svg" alt="" width="36" height="36">Catatuang</div>`;
    const err = '<p class="err" role="alert" id="err"></p>';
    const pw = (id, label, extra = "") =>
      `<label class="field"><span>${label}</span><input type="password" name="${id}" autocomplete="${extra || "current-password"}" minlength="8" required></label>`;
    let body = "";

    if (mode === "setup") {
      body = `
        <div><h1>Buat akun kamu</h1><p class="lead">Satu akun untuk mencatat keuanganmu sendiri.</p></div>
        <form id="f" class="form">
          <label class="field"><span>Nama</span><input type="text" name="name" autocomplete="name" maxlength="60" required></label>
          <label class="field"><span>Email</span><input type="email" name="email" autocomplete="email" required></label>
          ${pw("password", "Kata sandi", "new-password")}
          ${
            state.needsSetupCode
              ? `<label class="field"><span>Kode setup</span><input type="text" name="setup_code" inputmode="numeric" autocomplete="off" required>
            <small>Kode 6 angka ini tercetak di log server saat aplikasi pertama kali dijalankan.</small></label>`
              : ""
          }
          ${err}
          <button class="btn primary" type="submit">Buat akun</button>
        </form>`;
    } else if (mode === "forgot") {
      body = `
        <div><h1>Lupa kata sandi</h1><p class="lead">Masukkan email akunmu. Kode reset akan dicetak di log server.</p></div>
        <form id="f" class="form">
          <label class="field"><span>Email</span><input type="email" name="email" autocomplete="email" value="${esc(prefill.email || "")}" required></label>
          ${err}
          <button class="btn primary" type="submit">Kirim kode</button>
          <div class="alt"><button class="link" type="button" data-go="login">Kembali masuk</button></div>
        </form>`;
    } else if (mode === "reset") {
      body = `
        <div><h1>Atur kata sandi baru</h1><p class="lead">${esc(notice || "Masukkan kode 6 angka dari log server.")}</p></div>
        <form id="f" class="form">
          <label class="field"><span>Email</span><input type="email" name="email" value="${esc(prefill.email || "")}" required></label>
          <label class="field"><span>Kode reset</span><input type="text" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required></label>
          ${pw("password", "Kata sandi baru", "new-password")}
          ${err}
          <button class="btn primary" type="submit">Simpan kata sandi</button>
          <div class="alt"><button class="link" type="button" data-go="forgot">Kirim ulang kode</button></div>
        </form>`;
    } else {
      body = `
        <div><h1>Masuk</h1><p class="lead">${esc(notice || "Lanjutkan mencatat keuanganmu.")}</p></div>
        <form id="f" class="form">
          <label class="field"><span>Email</span><input type="email" name="email" autocomplete="username" required></label>
          ${pw("password", "Kata sandi")}
          ${err}
          <button class="btn primary" type="submit">Masuk</button>
          <div class="alt"><button class="link" type="button" data-go="forgot">Lupa kata sandi?</button></div>
        </form>`;
    }

    authEl.innerHTML = `<div class="auth-card">${brand}${body}</div>`;
    $$("[data-go]", authEl).forEach((b) => {
      b.onclick = () =>
        renderAuth(b.dataset.go, "", {
          email: $("[name=email]", authEl)?.value || "",
        });
    });
    const first = $("input", authEl);
    if (first) first.focus();

    $("#f", authEl).onsubmit = async (e) => {
      e.preventDefault();
      const form = e.target;
      const data = Object.fromEntries(new FormData(form));
      const btn = $("button[type=submit]", form);
      const errEl = $("#err", form);
      errEl.textContent = "";
      btn.disabled = true;
      try {
        if (mode === "setup") {
          await api("POST", "/api/auth/register", data);
          await startApp();
        } else if (mode === "forgot") {
          const r = await api("POST", "/api/auth/forgot", {
            email: data.email,
          });
          renderAuth("reset", r.message, { email: data.email });
        } else if (mode === "reset") {
          await api("POST", "/api/auth/reset", data);
          renderAuth("login", "Kata sandi sudah diganti. Silakan masuk.");
          toast("Kata sandi sudah diganti");
        } else {
          await api("POST", "/api/auth/login", data);
          await startApp();
        }
      } catch (ex) {
        errEl.textContent = ex.message;
        btn.disabled = false;
      }
    };
  }

  /* ---------- kerangka aplikasi ---------- */

  const TABS = [
    { id: "ringkasan", label: "Ringkasan", icon: "home" },
    { id: "riwayat", label: "Riwayat", icon: "list" },
    { id: "laporan", label: "Laporan", icon: "file" },
    { id: "kategori", label: "Kategori", icon: "tag" },
  ];
  const VIEWS = {
    ringkasan: viewRingkasan,
    riwayat: viewRiwayat,
    laporan: viewLaporan,
    kategori: viewKategori,
    profil: viewProfil,
  };

  async function startApp() {
    const st = await api("GET", "/api/auth/status");
    if (!st.loggedIn) {
      state.user = null;
      showAuth(st.hasUser ? "login" : "setup");
      return;
    }
    state.user = st.user;
    state.recap.date = state.recap.date || todayStr();
    $("#boot").hidden = true;
    authEl.hidden = true;
    appEl.hidden = false;
    $("#nav").innerHTML =
      `<div class="logo"><img src="/icons/icon.svg" alt="" width="30" height="30">Catatuang</div>` +
      TABS.map(
        (t) =>
          `<a href="#/${t.id}" data-tab="${t.id}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS[t.icon]}"/></svg><span>${t.label}</span></a>`,
      ).join("") +
      `<div class="nav-foot">
        <a href="#/profil" data-tab="profil" class="me" aria-label="Profil">
          <svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS.user}"/></svg><span class="lbl">Profil</span>
          <span class="avatar" aria-hidden="true"></span><span class="who"><b></b><small>Pengaturan</small></span>
        </a>
        <button class="theme-btn" type="button"></button>
      </div>`;
    refreshMe();
    $(".theme-btn").onclick = toggleTheme;
    updateThemeButtons();
    if (!location.hash || !VIEWS[location.hash.slice(2)])
      location.hash = "#/ringkasan";
    route();
  }

  let routeToken = 0;
  async function route() {
    if (!state.user) return;
    const id = location.hash.slice(2);
    const tab = VIEWS[id] ? id : "ringkasan";
    $$("#nav a").forEach((a) =>
      a.dataset.tab === tab
        ? a.setAttribute("aria-current", "page")
        : a.removeAttribute("aria-current"),
    );
    const token = ++routeToken;
    const view = $("#view");
    try {
      await VIEWS[tab](view, token);
    } catch (ex) {
      if (token !== routeToken || !state.user) return;
      view.innerHTML = `<div class="card empty"><b>Data belum bisa dimuat</b><p>${esc(ex.message)}</p><button class="btn primary" id="retry">Coba lagi</button></div>`;
      $("#retry").onclick = route;
    }
  }
  window.addEventListener("hashchange", () => {
    route();
    window.scrollTo(0, 0);
  });

  /* ---------- tema & transparansi ---------- */

  const THEMES = {
    light: {
      label: "Terang",
      meta: "#e3eeff",
      sw: "linear-gradient(135deg,#7fb0ff,#eef4ff)",
    },
    dark: {
      label: "Gelap",
      meta: "#0b1220",
      sw: "linear-gradient(135deg,#2a52c8,#0b1220)",
    },
    green: {
      label: "Hijau tua",
      meta: "#0a0f0d",
      sw: "linear-gradient(135deg,#14644a,#0a0f0d)",
    },
  };
  const store = {
    get(k) {
      try {
        return localStorage.getItem(k);
      } catch {
        return null;
      }
    },
    set(k, v) {
      try {
        localStorage.setItem(k, v);
      } catch {
        /* abaikan */
      }
    },
  };
  const currentTheme = () => document.documentElement.dataset.theme || "light";

  function updateThemeButtons() {
    const light = currentTheme() === "light";
    const label = light ? "Ganti ke tema gelap" : "Ganti ke tema terang";
    $$(".theme-btn, #themefab").forEach((b) => {
      b.setAttribute("aria-label", label);
      b.title = label;
      b.innerHTML = svg(light ? "moon" : "sun");
    });
    $$("[data-theme-opt]").forEach((b) =>
      b.setAttribute(
        "aria-pressed",
        String(b.dataset.themeOpt === currentTheme()),
      ),
    );
  }

  function setTheme(name) {
    if (!THEMES[name]) name = "light";
    document.documentElement.dataset.theme = name;
    store.set("ct-theme", name);
    const meta = $('meta[name="theme-color"]');
    if (meta) meta.content = THEMES[name].meta;
    updateThemeButtons();
  }
  const toggleTheme = () =>
    setTheme(currentTheme() === "light" ? "dark" : "light");

  const glassSupported = Boolean(
    window.CSS &&
    CSS.supports &&
    CSS.supports(
      "(backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))",
    ),
  );
  function clearLevel() {
    const n = parseInt(store.get("ct-clear"), 10);
    return n >= 0 && n <= 70 ? n : 38;
  }
  function setClear(percent) {
    document.documentElement.style.setProperty(
      "--glass",
      (1 - percent / 100).toFixed(2),
    );
  }

  function refreshMe() {
    const name = (state.user && state.user.name) || "";
    const av = $(".nav .avatar");
    if (av) av.textContent = (name.trim()[0] || "?").toUpperCase();
    const who = $(".nav .who b");
    if (who) who.textContent = name;
  }

  async function loadCats(force) {
    if (force || !state.cats.length)
      state.cats = (await api("GET", "/api/categories")).items;
    return state.cats;
  }

  /* ---------- bagian bersama ---------- */

  function txRow(t) {
    const inc = t.type === "income";
    const sub = t.category_name || "Tanpa kategori";
    return `<button class="tx ${t.type}" type="button" data-id="${t.id}">
      <span class="dot">${svg(inc ? "down" : "up")}</span>
      <span class="t"><b>${esc(t.note || t.category_name || "Tanpa catatan")}</b><small>${esc(sub)}</small></span>
      <span class="amt ${inc ? "in" : "out"}">${inc ? "+" : "-"}${rp(t.amount).replace("-", "")}</span>
    </button>`;
  }

  function bindTxRows(root, items) {
    $$(".tx", root).forEach((b) => {
      b.onclick = () =>
        openTxDialog(items.find((t) => t.id === Number(b.dataset.id)));
    });
  }

  function catList(rows, kind) {
    if (!rows.length) return '<p class="muted">Belum ada data.</p>';
    const total = rows.reduce((s, r) => s + r.total, 0);
    return `<ul class="cats ${kind}">${rows
      .map((r) => {
        const pct = total ? Math.round((r.total / total) * 100) : 0;
        return `<li><div class="row"><span>${esc(r.name)}</span><b>${rp(r.total)}</b></div>
        <div class="track" role="img" aria-label="${pct}% dari total"><div class="fill" style="width:${Math.max(pct, 2)}%"></div></div></li>`;
      })
      .join("")}</ul>`;
  }

  function chartSvg(series, period) {
    const max = Math.max(0, ...series.flatMap((s) => [s.income, s.expense]));
    if (!max) return '<p class="muted">Belum ada transaksi di periode ini.</p>';
    const W = 600,
      H = 190,
      top = 10,
      base = 160,
      plot = base - top;
    const n = series.length;
    const slot = W / n;
    const bw = Math.max(2, Math.min(14, slot * 0.34));
    let out = `<line class="grid" x1="0" x2="${W}" y1="${base}" y2="${base}"/>`;
    series.forEach((s, i) => {
      const cx = slot * i + slot / 2;
      const hi = (s.income / max) * plot;
      const ho = (s.expense / max) * plot;
      if (s.income)
        out += `<rect class="bar-in" x="${(cx - bw - 0.5).toFixed(1)}" y="${(base - hi).toFixed(1)}" width="${bw.toFixed(1)}" height="${hi.toFixed(1)}" rx="2"><title>${esc(s.label)}: masuk ${rp(s.income)}</title></rect>`;
      if (s.expense)
        out += `<rect class="bar-out" x="${(cx + 0.5).toFixed(1)}" y="${(base - ho).toFixed(1)}" width="${bw.toFixed(1)}" height="${ho.toFixed(1)}" rx="2"><title>${esc(s.label)}: keluar ${rp(s.expense)}</title></rect>`;
      const show = period === "year" || i === 0 || (i + 1) % 5 === 0;
      if (show)
        out += `<text x="${cx.toFixed(1)}" y="${base + 18}" text-anchor="middle">${esc(s.label)}</text>`;
    });
    const sumIn = series.reduce((s, r) => s + r.income, 0);
    const sumOut = series.reduce((s, r) => s + r.expense, 0);
    const label = `Grafik ${period === "year" ? "per bulan" : "per hari"}: total masuk ${rp(sumIn)}, total keluar ${rp(sumOut)}`;
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">${out}</svg>
      <div class="legend"><span><i style="background:var(--in)"></i>Pemasukan</span><span><i style="background:var(--out)"></i>Pengeluaran</span></div>`;
  }

  /* ---------- ringkasan (fitur 1) ---------- */

  async function viewRingkasan(view, token) {
    const { period, date } = state.recap;
    const r = await api("GET", `/api/recap?period=${period}&date=${date}`);
    if (token !== routeToken) return;
    const isNow = keyOf(period, date) >= keyOf(period, todayStr());
    const hello = state.user ? state.user.name.split(" ")[0] : "";
    view.innerHTML = `
      <div class="balance">
        <p class="label">Saldo saat ini${hello ? `, ${esc(hello)}` : ""}</p>
        <p class="num ${r.balance < 0 ? "neg" : ""}"><small>Rp</small>${r.balance < 0 ? "-" : ""}${num(r.balance)}</p>
      </div>

      <div class="period-bar">
        <div class="seg" role="group" aria-label="Periode">
          ${[
            ["day", "Harian"],
            ["month", "Bulanan"],
            ["year", "Tahunan"],
          ]
            .map(
              ([k, l]) =>
                `<button type="button" data-p="${k}" aria-pressed="${k === period}">${l}</button>`,
            )
            .join("")}
        </div>
        <div class="stepper">
          <button type="button" id="prev" aria-label="Periode sebelumnya">${svg("left")}</button>
          <span class="cur" aria-live="polite">${esc(r.label)}</span>
          <button type="button" id="next" aria-label="Periode berikutnya" ${isNow ? "disabled" : ""}>${svg("right")}</button>
        </div>
      </div>

      <div class="tiles">
        <div class="tile"><div class="k">Pemasukan</div><div class="v in">${rp(r.income)}</div></div>
        <div class="tile"><div class="k">Pengeluaran</div><div class="v out">${rp(r.expense)}</div></div>
        <div class="tile"><div class="k">Selisih</div><div class="v ${r.net < 0 ? "out" : ""}">${r.net > 0 ? "+" : ""}${rp(r.net)}</div></div>
      </div>

      ${period !== "day" ? `<section class="card"><h2>${period === "year" ? "Per bulan" : "Per hari"}</h2>${chartSvg(r.series, period)}</section>` : ""}

      <div class="two">
        <section class="card"><h2>Pemasukan per kategori</h2>${catList(r.by_category.income, "income")}</section>
        <section class="card"><h2>Pengeluaran per kategori</h2>${catList(r.by_category.expense, "expense")}</section>
      </div>

      <section>
        <div class="page-head"><h2>Transaksi di periode ini</h2><a href="#/riwayat">Lihat semua</a></div>
        ${
          r.recent.length
            ? `<div class="group" id="recent" style="margin-top:10px">${r.recent.map(txRow).join("")}</div>`
            : `<div class="card empty" style="margin-top:10px"><b>Belum ada transaksi</b><p>Catat yang pertama lewat tombol Catat.</p></div>`
        }
      </section>`;

    $$("[data-p]", view).forEach((b) => {
      b.onclick = () => {
        state.recap = { period: b.dataset.p, date: todayStr() };
        route();
      };
    });
    $("#prev", view).onclick = () => {
      state.recap.date = shiftDate(period, date, -1);
      route();
    };
    $("#next", view).onclick = () => {
      state.recap.date = shiftDate(period, date, 1);
      route();
    };
    if (r.recent.length) bindTxRows($("#recent", view), r.recent);
  }

  /* ---------- riwayat (fitur 3) ---------- */

  const HIST_PAGE = 30;

  async function viewRiwayat(view, token) {
    const h = state.hist;
    const cats = await loadCats(true);
    if (token !== routeToken) return;
    const typeCats = cats.filter((c) => h.type === "all" || c.type === h.type);
    view.innerHTML = `
      <div class="page-head"><h1>Riwayat</h1></div>
      <div class="filters">
        <div class="seg wide" role="group" aria-label="Jenis transaksi">
          ${[
            ["all", "Semua"],
            ["income", "Pemasukan"],
            ["expense", "Pengeluaran"],
          ]
            .map(
              ([k, l]) =>
                `<button type="button" data-t="${k}" aria-pressed="${k === h.type}">${l}</button>`,
            )
            .join("")}
        </div>
        <div class="row">
          <label class="grow"><span class="sr">Cari transaksi</span><input type="search" id="q" placeholder="Cari catatan, kategori, atau jumlah" value="${esc(h.q)}"></label>
          <label><span class="sr">Kategori</span>
            <select id="cat"><option value="">Semua kategori</option>
              ${typeCats.map((c) => `<option value="${c.id}" ${String(c.id) === String(h.cat) ? "selected" : ""}>${esc(c.name)}${h.type === "all" ? ` (${c.type === "income" ? "masuk" : "keluar"})` : ""}</option>`).join("")}
            </select></label>
        </div>
      </div>
      <p class="sum-line" id="sums" aria-live="polite"></p>
      <div id="list"></div>`;

    $$("[data-t]", view).forEach((b) => {
      b.onclick = () => {
        h.type = b.dataset.t;
        h.cat = "";
        route();
      };
    });
    $("#cat", view).onchange = (e) => {
      h.cat = e.target.value;
      loadHist(true);
    };
    let timer;
    $("#q", view).oninput = (e) => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        h.q = e.target.value;
        loadHist(true);
      }, 280);
    };
    await loadHist(true, token);
  }

  async function loadHist(reset, token = routeToken) {
    const h = state.hist;
    const list = $("#list");
    if (!list) return;
    if (reset) h.items = [];
    const p = new URLSearchParams({ limit: HIST_PAGE, offset: h.items.length });
    if (h.type !== "all") p.set("type", h.type);
    if (h.q.trim()) p.set("q", h.q.trim());
    if (h.cat) p.set("category_id", h.cat);
    let r;
    try {
      r = await api("GET", `/api/transactions?${p}`);
    } catch (ex) {
      toast(ex.message);
      return;
    }
    if (token !== routeToken || !$("#list")) return;
    h.items = reset ? r.items : h.items.concat(r.items);
    Object.assign(h, { total: r.total, income: r.income, expense: r.expense });
    renderHist();
  }

  function renderHist() {
    const h = state.hist;
    const list = $("#list");
    const filtered = h.q.trim() || h.cat;
    $("#sums").innerHTML = h.total
      ? `<span>${num(h.total)} transaksi</span>${h.type !== "expense" ? `<span class="in">Masuk ${rp(h.income)}</span>` : ""}${h.type !== "income" ? `<span class="out">Keluar ${rp(h.expense)}</span>` : ""}`
      : "";
    if (!h.items.length) {
      list.innerHTML = filtered
        ? `<div class="card empty"><b>Tidak ada yang cocok</b><p>Coba kata kunci lain atau hapus filter kategori.</p></div>`
        : `<div class="card empty"><b>Belum ada transaksi</b><p>Transaksi yang kamu catat akan muncul di sini.</p><button class="btn primary" id="e-add">Catat transaksi</button></div>`;
      const add = $("#e-add");
      if (add) add.onclick = () => openTxDialog();
      return;
    }
    const groups = [];
    for (const t of h.items) {
      const last = groups[groups.length - 1];
      if (last && last.date === t.date) last.items.push(t);
      else groups.push({ date: t.date, items: [t] });
    }
    list.innerHTML =
      groups
        .map((g) => {
          const net = g.items.reduce(
            (s, t) => s + (t.type === "income" ? t.amount : -t.amount),
            0,
          );
          return `<div class="day-h"><span>${esc(longDate(g.date))}</span><span>${net > 0 ? "+" : net < 0 ? "-" : ""}${rp(net).replace("-", "")}</span></div>
        <div class="group">${g.items.map(txRow).join("")}</div>`;
        })
        .join("") +
      (h.items.length < h.total
        ? `<p style="text-align:center;margin-top:16px"><button class="btn" id="more">Tampilkan lebih banyak</button></p>`
        : "");
    bindTxRows(list, h.items);
    const more = $("#more");
    if (more)
      more.onclick = () => {
        more.disabled = true;
        loadHist(false);
      };
  }

  /* ---------- catat / ubah transaksi (dialog) ---------- */

  async function openTxDialog(tx) {
    let cats;
    try {
      cats = await loadCats(true);
    } catch (ex) {
      toast(ex.message);
      return;
    }
    const editing = Boolean(tx);
    let type = tx ? tx.type : "expense";
    openDlg(`
      <form id="tf" class="form-grid" novalidate>
        <h2>${editing ? "Ubah transaksi" : "Catat transaksi"}</h2>
        <div class="seg type wide" role="group" aria-label="Jenis">
          <button type="button" data-t="expense" aria-pressed="${type === "expense"}">Pengeluaran</button>
          <button type="button" data-t="income" aria-pressed="${type === "income"}">Pemasukan</button>
        </div>
        <label class="field"><span>Jumlah</span>
          <div class="pre"><span>Rp</span><input class="amount-input" type="text" inputmode="numeric" name="amount" autocomplete="off" placeholder="0" value="${tx ? num(tx.amount) : ""}"></div></label>
        <div class="form-grid cols">
          <label class="field"><span>Kategori</span><select name="category_id"></select></label>
          <label class="field"><span>Tanggal</span><input type="date" name="date" value="${tx ? tx.date : todayStr()}" required></label>
        </div>
        <label class="field"><span>Catatan (boleh kosong)</span><input type="text" name="note" maxlength="200" value="${esc(tx ? tx.note : "")}" placeholder="Contoh: makan siang"></label>
        <p class="err" role="alert" id="terr"></p>
        <div class="dlg-actions">
          ${editing ? '<button class="btn danger spacer" type="button" id="del">Hapus</button>' : ""}
          <button class="btn" type="button" id="cancel">Batal</button>
          <button class="btn primary" type="submit">Simpan</button>
        </div>
      </form>`);

    const form = $("#tf", dlg);
    const sel = form.elements.category_id;
    const fillCats = (keep) => {
      sel.innerHTML =
        `<option value="">Tanpa kategori</option>` +
        cats
          .filter((c) => c.type === type)
          .map(
            (c) =>
              `<option value="${c.id}" ${String(c.id) === String(keep) ? "selected" : ""}>${esc(c.name)}</option>`,
          )
          .join("");
    };
    fillCats(tx && tx.type === type ? tx.category_id : "");
    $$("[data-t]", form).forEach((b) => {
      b.onclick = () => {
        type = b.dataset.t;
        $$("[data-t]", form).forEach((x) =>
          x.setAttribute("aria-pressed", String(x === b)),
        );
        fillCats("");
      };
    });
    const amt = form.elements.amount;
    amt.oninput = () => {
      const d = amt.value.replace(/\D/g, "").slice(0, 12);
      amt.value = d ? Number(d).toLocaleString("id-ID") : "";
    };
    if (!editing) amt.focus();
    $("#cancel", dlg).onclick = () => dlg.close();

    if (editing) {
      $("#del", dlg).onclick = async () => {
        const ok = await confirmBox({
          title: "Hapus transaksi ini?",
          text: `${rp(tx.amount)}${tx.note ? `, ${tx.note}` : ""} akan dihapus dan saldo ikut berubah.`,
          ok: "Hapus",
          danger: true,
        });
        if (!ok) return;
        try {
          await api("DELETE", `/api/transactions/${tx.id}`);
          toast("Transaksi dihapus");
          route();
        } catch (ex) {
          toast(ex.message);
        }
      };
    }

    form.onsubmit = async (e) => {
      e.preventDefault();
      const errEl = $("#terr", dlg);
      errEl.textContent = "";
      const amount = Number(amt.value.replace(/\D/g, ""));
      if (!amount) {
        errEl.textContent = "Isi jumlahnya dulu, misalnya 25.000.";
        amt.focus();
        return;
      }
      const body = {
        type,
        amount,
        category_id: sel.value || null,
        date: form.elements.date.value,
        note: form.elements.note.value,
      };
      const btn = $("button[type=submit]", form);
      btn.disabled = true;
      try {
        if (editing) await api("PUT", `/api/transactions/${tx.id}`, body);
        else await api("POST", "/api/transactions", body);
        dlg.close();
        toast(editing ? "Perubahan disimpan" : "Transaksi dicatat");
        route();
      } catch (ex) {
        errEl.textContent = ex.message;
        btn.disabled = false;
      }
    };
  }

  /* ---------- kategori (fitur 4) ---------- */

  async function viewKategori(view, token) {
    const cats = await loadCats(true);
    if (token !== routeToken) return;
    const block = (type, title) => `
      <section class="card">
        <div><h2>${title}</h2><p class="muted">Kategori bawaan tidak bisa diubah. Kategori buatanmu bisa diganti nama atau dihapus.</p></div>
        <div class="chips">
          ${cats
            .filter((c) => c.type === type)
            .map((c) =>
              c.is_default
                ? `<span class="chip fixed">${esc(c.name)}<small>bawaan</small></span>`
                : `<span class="chip">${esc(c.name)}${c.usage_count ? `<small>${c.usage_count}</small>` : ""}
                <button type="button" data-ren="${c.id}" aria-label="Ganti nama ${esc(c.name)}">${svg("edit")}</button>
                <button type="button" data-del="${c.id}" aria-label="Hapus ${esc(c.name)}">${svg("x")}</button></span>`,
            )
            .join("")}
        </div>
        <form class="add-row" data-type="${type}">
          <label class="sr" for="n-${type}">Nama kategori baru</label>
          <input type="text" id="n-${type}" maxlength="40" placeholder="Kategori baru" required>
          <button class="btn primary" type="submit">Tambah</button>
        </form>
      </section>`;
    view.innerHTML = `<div class="page-head"><h1>Kategori</h1></div>${block("expense", "Kategori pengeluaran")}${block("income", "Kategori pemasukan")}`;

    $$(".add-row", view).forEach((f) => {
      f.onsubmit = async (e) => {
        e.preventDefault();
        try {
          await api("POST", "/api/categories", {
            name: $("input", f).value,
            type: f.dataset.type,
          });
          toast("Kategori ditambahkan");
          route();
        } catch (ex) {
          toast(ex.message);
        }
      };
    });
    $$("[data-ren]", view).forEach((b) => {
      b.onclick = async () => {
        const c = cats.find((x) => x.id === Number(b.dataset.ren));
        const name = await promptBox({
          title: "Ganti nama kategori",
          label: "Nama kategori",
          value: c.name,
        });
        if (!name || name === c.name) return;
        try {
          await api("PUT", `/api/categories/${c.id}`, { name });
          toast("Nama kategori diganti");
          route();
        } catch (ex) {
          toast(ex.message);
        }
      };
    });
    $$("[data-del]", view).forEach((b) => {
      b.onclick = async () => {
        const c = cats.find((x) => x.id === Number(b.dataset.del));
        const ok = await confirmBox({
          title: `Hapus kategori "${c.name}"?`,
          text: c.usage_count
            ? `${c.usage_count} transaksi yang memakainya akan menjadi "Tanpa kategori".`
            : "Kategori ini belum dipakai transaksi mana pun.",
          ok: "Hapus",
          danger: true,
        });
        if (!ok) return;
        try {
          await api("DELETE", `/api/categories/${c.id}`);
          toast("Kategori dihapus");
          route();
        } catch (ex) {
          toast(ex.message);
        }
      };
    });
  }

  /* ---------- laporan & ekspor (fitur 6) ---------- */

  async function viewLaporan(view) {
    const r = state.report;
    const now = todayStr();
    view.innerHTML = `
      <div class="page-head"><h1>Laporan</h1></div>
      <form class="card form-grid" id="rf">
        <div class="field"><span>Jenis laporan</span>
          <div class="seg wide" role="group" aria-label="Jenis laporan">
            ${[
              ["day", "Harian"],
              ["month", "Bulanan"],
              ["year", "Tahunan"],
            ]
              .map(
                ([k, l]) =>
                  `<button type="button" data-p="${k}" aria-pressed="${k === r.period}">${l}</button>`,
              )
              .join("")}
          </div></div>
        <label class="field"><span id="plabel"></span><span id="pwrap"></span></label>
        <div class="field"><span>Format file</span>
          <div class="seg wide" role="group" aria-label="Format file">
            ${[
              ["pdf", "PDF"],
              ["csv", "CSV (Excel)"],
            ]
              .map(
                ([k, l]) =>
                  `<button type="button" data-f="${k}" aria-pressed="${k === r.format}">${l}</button>`,
              )
              .join("")}
          </div>
          <small id="fhint"></small></div>
        <label class="field" id="sepwrap"><span>Pemisah kolom CSV</span>
          <select name="sep"><option value="semicolon">Titik koma (cocok untuk Excel berbahasa Indonesia)</option><option value="comma">Koma (cocok untuk Google Sheets)</option></select></label>
        <p class="err" id="rerr" role="alert"></p>
        <button class="btn primary" type="submit" id="dl">Unduh laporan</button>
      </form>`;

    const wrap = $("#pwrap", view);
    const draw = () => {
      const label = { day: "Tanggal", month: "Bulan", year: "Tahun" }[r.period];
      $("#plabel", view).textContent = label;
      if (r.period === "day")
        wrap.innerHTML = `<input type="date" id="pv" value="${r.value && r.value.length === 10 ? r.value : now}" required>`;
      else if (r.period === "month")
        wrap.innerHTML = `<input type="month" id="pv" value="${r.value && r.value.length === 7 ? r.value : now.slice(0, 7)}" required>`;
      else
        wrap.innerHTML = `<input type="number" id="pv" min="2000" max="2100" step="1" value="${r.value && r.value.length === 4 ? r.value : now.slice(0, 4)}" required>`;
      $("#fhint", view).textContent =
        r.format === "pdf"
          ? "Rapi untuk dibaca dan dicetak: ringkasan, kategori, dan daftar transaksi."
          : "Satu baris per transaksi, bisa dibuka di Excel atau Google Sheets.";
      $("#sepwrap", view).hidden = r.format !== "csv";
      $$("[data-p]", view).forEach((b) =>
        b.setAttribute("aria-pressed", String(b.dataset.p === r.period)),
      );
      $$("[data-f]", view).forEach((b) =>
        b.setAttribute("aria-pressed", String(b.dataset.f === r.format)),
      );
    };
    draw();
    $$("[data-p]", view).forEach((b) => {
      b.onclick = () => {
        r.period = b.dataset.p;
        r.value = "";
        draw();
      };
    });
    $$("[data-f]", view).forEach((b) => {
      b.onclick = () => {
        r.format = b.dataset.f;
        draw();
      };
    });
    $("[name=sep]", view).value = r.sep;
    $("[name=sep]", view).onchange = (e) => {
      r.sep = e.target.value;
    };

    $("#rf", view).onsubmit = async (e) => {
      e.preventDefault();
      const errEl = $("#rerr", view);
      errEl.textContent = "";
      const v = $("#pv", view).value;
      if (!v) {
        errEl.textContent = "Pilih periodenya dulu.";
        return;
      }
      r.value = v;
      const date =
        r.period === "day"
          ? v
          : r.period === "month"
            ? `${v}-01`
            : `${String(v).padStart(4, "0")}-01-01`;
      const q = new URLSearchParams({
        period: r.period,
        date,
        format: r.format,
      });
      if (r.format === "csv") q.set("sep", r.sep);
      const btn = $("#dl", view);
      btn.disabled = true;
      btn.textContent = "Menyiapkan…";
      try {
        const res = await fetch(`/api/export?${q}`, {
          credentials: "same-origin",
        });
        if (!res.ok) {
          let msg = "Laporan belum bisa dibuat.";
          try {
            msg = (await res.json()).error || msg;
          } catch {
            /* abaikan */
          }
          throw new Error(msg);
        }
        const blob = await res.blob();
        const name =
          /filename="([^"]+)"/.exec(
            res.headers.get("Content-Disposition") || "",
          )?.[1] || `laporan.${r.format}`;
        const url = URL.createObjectURL(blob);
        const a = Object.assign(document.createElement("a"), {
          href: url,
          download: name,
        });
        document.body.append(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
        toast(`${name} sudah diunduh`);
      } catch (ex) {
        errEl.textContent = ex.message;
      }
      btn.disabled = false;
      btn.textContent = "Unduh laporan";
    };
  }

  /* ---------- profil dan tampilan ---------- */

  async function viewProfil(view, token) {
    if (token !== routeToken) return;
    const p = state.user;
    view.innerHTML = `
      <div class="page-head"><h1>Profil</h1></div>

      <form class="card form-grid" id="pf2">
        <h2>Data diri</h2>
        <label class="field"><span>Nama</span><input type="text" name="name" maxlength="60" value="${esc(p.name)}" required></label>
        <p class="muted">Email masuk: ${esc(p.email)}</p>
        <p class="err" role="alert" id="e1"></p>
        <div><button class="btn primary" type="submit">Simpan profil</button></div>
      </form>

      <section class="card form-grid" id="look">
        <h2>Tampilan</h2>
        <div class="themes" role="group" aria-label="Tema">
          ${Object.entries(THEMES)
            .map(
              ([k, t]) =>
                `<button type="button" class="theme-opt" data-theme-opt="${k}" aria-pressed="${k === currentTheme()}"><span class="sw" style="background:${t.sw}"></span>${t.label}</button>`,
            )
            .join("")}
        </div>
        ${
          glassSupported
            ? `<div class="field"><div class="range-row"><label for="clear">Transparansi</label><span id="clearv">${clearLevel()}%</span></div>
          <input type="range" id="clear" min="0" max="70" step="2" value="${clearLevel()}">
          <small>Geser ke kanan supaya kartu dan menu makin bening. Geser ke kiri supaya lebih padat dan mudah dibaca.</small></div>`
            : ""
        }
      </section>

      <form class="card form-grid" id="cf">
        <h2>Ganti kata sandi</h2>
        <div class="form-grid cols">
          <label class="field"><span>Kata sandi lama</span><input type="password" name="old_password" autocomplete="current-password" required></label>
          <label class="field"><span>Kata sandi baru</span><input type="password" name="new_password" autocomplete="new-password" minlength="8" required></label>
        </div>
        <p class="err" role="alert" id="e4"></p>
        <div><button class="btn" type="submit">Ganti kata sandi</button></div>
      </form>

      <div><button class="btn danger" id="logout" type="button">Keluar dari akun</button></div>`;

    const submit = (id, errId, fn) => {
      $(id, view).onsubmit = async (e) => {
        e.preventDefault();
        const errEl = $(errId, view);
        errEl.textContent = "";
        try {
          await fn(e.target);
        } catch (ex) {
          errEl.textContent = ex.message;
        }
      };
    };

    submit("#pf2", "#e1", async (f) => {
      const r = await api("PUT", "/api/me", { name: f.elements.name.value });
      state.user = { ...state.user, ...r.user };
      refreshMe();
      toast("Profil disimpan");
    });

    submit("#cf", "#e4", async (f) => {
      await api("POST", "/api/auth/change-password", {
        old_password: f.elements.old_password.value,
        new_password: f.elements.new_password.value,
      });
      f.reset();
      toast("Kata sandi diganti");
    });

    $$("[data-theme-opt]", view).forEach((b) => {
      b.onclick = () => setTheme(b.dataset.themeOpt);
    });
    const slider = $("#clear", view);
    if (slider) {
      slider.oninput = () => {
        $("#clearv", view).textContent = `${slider.value}%`;
        setClear(Number(slider.value));
      };
      slider.onchange = () => store.set("ct-clear", slider.value);
    }

    $("#logout", view).onclick = async () => {
      try {
        await api("POST", "/api/auth/logout", {});
      } catch {
        /* tetap keluar */
      }
      state.user = null;
      state.cats = [];
      state.recap = { period: "month", date: todayStr() };
      location.hash = "#/ringkasan";
      showAuth("login");
    };
  }

  /* ---------- mulai ---------- */

  $("#fab").onclick = () => openTxDialog();
  $("#themefab").onclick = toggleTheme;
  updateThemeButtons();

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () =>
      navigator.serviceWorker.register("/sw.js").catch(() => {}),
    );
  }

  (async () => {
    try {
      const st = await api("GET", "/api/auth/status");
      state.needsSetupCode = st.needsSetupCode;
      if (st.loggedIn) await startApp();
      else showAuth(st.hasUser ? "login" : "setup");
    } catch (ex) {
      $("#boot").innerHTML =
        `<div class="card empty"><b>Server tidak bisa dihubungi</b><p>${esc(ex.message)}</p><button class="btn primary" onclick="location.reload()">Muat ulang</button></div>`;
    }
  })();
})();
