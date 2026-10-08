# Catatuang

Pencatat keuangan pribadi. Web app yang bisa dipasang di HP (PWA), tanpa library tambahan.

## Menjalankan

Butuh Node.js 22.5 atau lebih baru.

    npm start

Buka http://localhost:3000, buat akun, lalu mulai mencatat. Data tersimpan di folder `data/`.

Konfigurasi server dapat diatur melalui environment variables.

Jika lupa kata sandi, kode reset akan tercetak di log server setelah email dimasukkan.

## Tes

    npm test
