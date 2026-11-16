# Abuya Portal API

Backend user & auth untuk Abuya Portal (FastAPI + PostgreSQL).

## Struktur folder

```
abuya-portal/
├── backend/
│   ├── app/
│   ├── deploy/
│   ├── requirements.txt
│   └── .env.example
└── frontend/
    ├── login.html
    ├── dashboard.html
    ├── css/
    └── js/
```

## Jalankan di komputer (lokal)

1. Install PostgreSQL, lalu buat database:
   ```sql
   CREATE USER abuya WITH PASSWORD 'password_kamu';
   CREATE DATABASE abuya_portal OWNER abuya;
   ```
2. Siapkan backend:
   ```bash
   cd backend
   python -m venv venv
   source venv/bin/activate        # Windows: venv\Scripts\activate
   pip install -r requirements.txt
   cp .env.example .env            # Windows: copy .env.example .env
   ```
3. Edit `.env`: isi `DATABASE_URL` dan `JWT_SECRET`. Buat secret acak dengan:
   ```bash
   python -c "import secrets; print(secrets.token_urlsafe(48))"
   ```
4. Buat tabel + akun Master pertama:
   ```bash
   python -m app.cli create-master --username master
   ```
5. (Opsional) Isi data contoh: 8 cabang, produk, PIC, 5 user demo (password `password123`), dan PR/PO:
   ```bash
   python -m app.cli seed-demo
   ```
6. Jalankan server:
   ```bash
   python -m uvicorn app.main:app --reload
   ```
7. Buka http://localhost:8000 lalu login. Dokumentasi API: http://localhost:8000/api/docs

Perintah lain:
- `python -m app.cli reset-db` menghapus SEMUA tabel dan data, lalu membuat ulang (dipakai kalau struktur tabel berubah).
- `python -m app.cli init-db` membuat tabel yang belum ada tanpa menghapus data.

## Role (sama dengan MASAR)

| Role | Akses |
|---|---|
| SM | Buat PR untuk cabang yang di-mapping |
| AM | Edit item, Approve/Tolak PR Pending di cabang yang di-mapping |
| AMKA | Buat PR (bisa langsung Approve), edit & Approve PR di cabang yang di-mapping |
| PIC | Lihat PR/PO brand-nya |
| Master | Semua brand, semua cabang, Master Data |

Aturan: PR Pending otomatis Expired di hari Required Date. Approve PR otomatis menerbitkan PO. Kebuli Abuya hanya bisa shipping Direct. Nomor dokumen `PR-YYYYMMDD-001` / `PO-YYYYMMDD-001`, reset tiap hari.

## Endpoint utama

| Method | Path | Fungsi |
|---|---|---|
| POST | /api/auth/login | Login pakai username |
| GET | /api/auth/me | User yang sedang login |
| GET | /api/dashboard/summary | Data dashboard |
| GET | /api/purchase-requests | Daftar PR (status, branch_id, shipping, q, date_from, date_to, sort, dir) |
| GET | /api/purchase-requests/summary | Jumlah PR per status & per cabang |
| GET | /api/purchase-requests/form-options | Cabang, produk, PIC untuk form PR |
| POST | /api/purchase-requests | Buat PR (`approve_now` untuk AMKA/Master) |
| GET | /api/purchase-requests/{id} | Detail PR |
| POST/PATCH/DELETE | /api/purchase-requests/{id}/items | Tambah/ubah/hapus item PR Pending |
| POST | /api/purchase-requests/{id}/approve | Approve + terbitkan PO |
| POST | /api/purchase-requests/{id}/reject | Tolak PR |
| GET | /api/purchase-orders | Daftar PO |
| GET | /api/purchase-orders/summary | Jumlah PO per shipping & per cabang |
| GET | /api/purchase-orders/export | Data export Excel |
| GET | /api/purchase-orders/{id} | Detail PO |
| GET/POST/PATCH | /api/branches, /api/products, /api/pics | Master data (tulis: Master saja) |
| GET/POST/PATCH | /api/users | Kelola user (Master) |
| PUT | /api/users/{id}/branches | Mapping cabang user (Master) |

## Deploy ke VPS Hostinger (Ubuntu)

1. Install paket:
   ```bash
   sudo apt update
   sudo apt install -y python3-venv python3-pip postgresql nginx certbot python3-certbot-nginx
   ```
2. Buat user sistem dan upload project ke `/var/www/abuya-portal`:
   ```bash
   sudo adduser --system --group abuya
   sudo mkdir -p /var/www/abuya-portal
   ```
3. Buat database (langkah lokal no. 1) lewat `sudo -u postgres psql`.
4. Di `/var/www/abuya-portal/backend`: buat venv, install requirements, isi `.env` (kosongkan `FRONTEND_DIR`, karena frontend dilayani Nginx), lalu jalankan `create-master`.
5. Pasang service:
   ```bash
   sudo chown -R abuya:abuya /var/www/abuya-portal
   sudo cp deploy/abuya-api.service /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable --now abuya-api
   ```
6. Pasang Nginx (ganti `server_name` dengan domain kamu):
   ```bash
   sudo cp deploy/nginx-abuya-portal.conf /etc/nginx/sites-available/abuya-portal
   sudo ln -s /etc/nginx/sites-available/abuya-portal /etc/nginx/sites-enabled/
   sudo nginx -t && sudo systemctl reload nginx
   ```
7. Arahkan DNS domain ke IP VPS, lalu aktifkan HTTPS:
   ```bash
   sudo certbot --nginx -d portal.abuyagroup.com
   ```
8. Cek log kalau ada masalah: `sudo journalctl -u abuya-api -f`