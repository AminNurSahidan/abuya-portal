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
4. Buat tabel + akun admin pertama:
   ```bash
   python -m app.cli create-admin --email admin@abuyagroup.com --name "Admin Operasional"
   ```
5. Jalankan server:
   ```bash
   uvicorn app.main:app --reload
   ```
6. Buka http://localhost:8000 lalu login. Dokumentasi API: http://localhost:8000/api/docs

## Endpoint

| Method | Path | Akses | Fungsi |
|---|---|---|---|
| POST | /api/auth/login | publik | Login, dapat token |
| GET | /api/auth/me | login | Data user yang sedang login |
| PATCH | /api/auth/me | login | Ubah nama sendiri |
| POST | /api/auth/change-password | login | Ganti kata sandi sendiri |
| POST | /api/auth/logout | login | Catat logout |
| POST | /api/auth/logout-all | login | Keluar dari semua perangkat |
| GET | /api/users | admin | Daftar user (filter q, role, active, page, size) |
| POST | /api/users | admin | Tambah user |
| GET | /api/users/{id} | admin | Detail user |
| PATCH | /api/users/{id} | admin | Ubah nama, role, status aktif, cabang |
| POST | /api/users/{id}/reset-password | admin | Reset kata sandi user |
| POST | /api/users/{id}/unlock | admin | Buka kunci akun |
| GET/POST/PATCH | /api/brands | admin (GET: login) | Master brand |
| GET/POST/PATCH | /api/branches | admin (GET: login) | Master cabang |
| GET | /api/dashboard/summary | login | Data beranda |

Role: `admin`, `am`, `amka`, `approver`, `gudang`, `staff`.

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
4. Di `/var/www/abuya-portal/backend`: buat venv, install requirements, isi `.env` (kosongkan `FRONTEND_DIR`, karena frontend dilayani Nginx), lalu jalankan `create-admin`.
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
