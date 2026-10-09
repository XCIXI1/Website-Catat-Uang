# Website Catat Keuangan

Aplikasi berbasis web yang dirancang untuk membantu pengguna mencatat dan mengelola keuangan harian dengan mudah dan praktis.

---

## Tampilan Aplikasi (Screenshot)
![Preview Tampilan Aplikasi](./Foto%20Website%20catat%20Keuangan/Screenshot%202026-10-09%20073313.png)

---

## Tech Stack

- **Frontend:** HTML5, CSS3, JavaScript (ES6+) murni, tanpa framework
- **Framework / Library:** tidak ada (tanpa React, Tailwind, atau Bootstrap)
- **Backend:** Node.js 22.5 atau lebih baru, memakai modul bawaan `node:http`
- **Database:** SQLite lewat modul bawaan `node:sqlite`
- **Laporan:** PDF dan CSV dibuat langsung oleh server
- **PWA:** Service Worker dan Web App Manifest, jadi bisa dipasang di HP
- **Package Manager:** npm (hanya untuk menjalankan skrip, tidak ada dependensi)
- **Testing:** `node:test` bawaan Node.js
- **Deployment:** Docker di layanan hosting yang mendukung server dan penyimpanan tetap

---

## Langkah-langkah Instalasi & Memulai Proyek

Berikut adalah panduan lengkap untuk memasang dan menjalankan proyek ini di komputer lokal kamu.

### Persyaratan (Prerequisites)
Sebelum memulai, pastikan kamu telah menginstall modul berikut di komputer kamu:
- **Node.js (termasuk npm):** [Download Node.js LTS](https://nodejs.org/)
- **Git:** [Download Git](https://git-scm.com/)

---

### Panduan untuk Pengguna Windows

1. **Buka Terminal / Command Prompt:**
   Tekan `Win + R`, ketik `cmd` atau `powershell`, lalu tekan **Enter** (atau buka **Git Bash**).

2. **Cek Instalasi Node.js & npm:**
   ```cmd
   node -v
   npm -v
   ```
3. **Clone Repository ini**
   
   **DOS**
   ```cmd
   git clone https://github.com/XCIXI1/Website-Catat-Keuangan.git
   ```
4. **Masuk ke Direktori Proyek:**

   **DOS**
   ```cmd
   cd Website-Catat-Keuangan
   ```
5. **Install Dependensi/Package:**

   **DOS**
   ```cmd
   npm install
   ```
6. **Jalankan Aplikasi:**

   **DOS**
   ```cmd
   npm start
   ```
   (jika tidak bisa, gunakan)
   ```cmd
   npm.cmd start
   ```
8. **Akses Aplikasi:**

   Buka browser dan buka alamat http://localhost:3000, buat akun, lalu mulai mencatat.    Seluruh data transaksi akan tersimpan secara lokal di folder data/.
---
### Panduan untuk Pengguna Linux / macOS
1. **Buka Terminal:**
   
   Tekan Ctrl + Alt + T (Linux) atau Cmd + Space lalu ketik Terminal (macOS).
2. **Cek Versi Node.js:**

   **Bash**
   ```cmd
   node -v

   ( Pastikan versi node.js minimal v22.5.0 )
   ```
3. **Clone Repository:**

    **Bash**
   ```cmd
   git clone [https://github.com/XCIXI1/Website-Catat-Keuangan.git](https://github.com/XCIXI1/Website-Catat-Keuangan.git)
   ```
4. **Masuk ke Direktori Proyek:**

   **Bash**
   ```cmd
   cd Website-Catat-Keuangan
   ```
5. **Install Dependensi**

    **Bash**
   ```cmd
   npm install
   ```
6. **Jalankan Aplikasi**

    **Bash**
   ```cmd
   npm start
   ```
7. **Akses Aplikasi**

   Buka browser dan buka alamat http://localhost:3000.
---
### Menjalankan Pengujian ( Testing )

Untuk menjalankan unit test bawaan menggunakan Node.js Native Test Runner, jalankan perintah berikut di terminal:

 **Bash**
```cmd
node --test test/api.test.js
```
