/* Dipasang di <head> supaya tema yang dipilih langsung dipakai sebelum halaman tampil (tidak berkedip). */
(function () {
  var root = document.documentElement;
  var theme = 'light';
  var clear = 38;
  try {
    theme = localStorage.getItem('ct-theme') || 'light';
    var c = parseInt(localStorage.getItem('ct-clear'), 10);
    if (c >= 0 && c <= 70) clear = c;
  } catch (e) { /* penyimpanan browser tidak tersedia */ }
  if (theme !== 'light' && theme !== 'dark' && theme !== 'green') theme = 'light';
  root.dataset.theme = theme;
  root.style.setProperty('--glass', (1 - clear / 100).toFixed(2));
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = { light: '#e3eeff', dark: '#0b1220', green: '#0a0f0d' }[theme];
})();
