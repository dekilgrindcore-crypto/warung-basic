# Warung Basic — Cloudflare Worker

> Platform streaming ringan berbasis Cloudflare Workers. Routing, SEO, dan tampilan lengkap — tanpa server, tanpa database sendiri.

---

## Daftar Isi

- [Fitur](#fitur)
- [Arsitektur](#arsitektur)
- [Prasyarat](#prasyarat)
- [Instalasi](#instalasi)
- [Konfigurasi](#konfigurasi)
- [Struktur URL](#struktur-url)
- [API Dapur](#api-dapur)
- [Iklan](#iklan)
- [Deployment](#deployment)
- [Variabel Rahasia (Secrets)](#variabel-rahasia-secrets)
- [Cache](#cache)
- [SEO](#seo)
- [Scheduled Tasks](#scheduled-tasks)
- [Troubleshooting](#troubleshooting)

---

## Fitur

- **Tanpa Origin Server** — seluruh HTML di-render langsung di edge Cloudflare Workers
- **SEO Siap Pakai** — meta tags lengkap, Open Graph, Twitter Card, JSON-LD schema (WebSite, VideoObject, BreadcrumbList)
- **Routing Dinamis** — home, konten, kategori, tag, pencarian, album, dan halaman statis
- **In-Memory Cache** — cache ringan berbasis `Map` dengan TTL configurable, tanpa KV
- **Tema Kustom** — warna, font, dan accent bisa diubah lewat environment variable
- **Iklan Responsif** — slot iklan top/mid/bottom, berbeda kode untuk desktop dan mobile
- **Sitemap & RSS** — otomatis dari backend Dapur API
- **Robots.txt** — diambil dari API atau fallback default
- **Honeypot Path** — perlindungan crawler nakal dengan prefix kustom
- **CSP Nonce** — setiap halaman menggunakan nonce unik untuk inline style

---

## Arsitektur

```
Request
  └─► Cloudflare Worker (worker.js)
        ├─ Static assets → pass-through ke origin
        ├─ Special paths → robots.txt, sitemap, rss, manifest
        └─ Routing
             ├─ /               → handleHome
             ├─ /tonton/:id     → handleView
             ├─ /galeri/:id     → handleView (album)
             ├─ /kategori/:type → handleCategory
             ├─ /tag/:tag       → handleTag
             ├─ /cari           → handleSearch
             ├─ /dmca, /privasi, /syarat, /kontak, /tentang, /faq
             │                  → handleStaticPage
             └─ 404             → notFound

Worker ←→ Dapur API (backend eksternal)
            └─ /api/v1/media
            └─ /api/v1/trending
            └─ /api/v1/related/:id
            └─ /api/v1/search
            └─ /api/v1/categories
            └─ /api/v1/tags
            └─ /api/v1/sitemap
            └─ /api/v1/album/:id
            └─ /api/v1/robots
```

---

## Prasyarat

- [Node.js](https://nodejs.org/) v18+
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) v3+
- Akun Cloudflare (free tier cukup)
- Backend **Dapur API** yang sudah berjalan

```bash
npm install -g wrangler
wrangler login
```

---

## Instalasi

```bash
# Clone / salin file
cp worker.js my-warung/
cp wrangler.toml my-warung/
cd my-warung

# Jalankan lokal
wrangler dev
```

---

## Konfigurasi

Semua konfigurasi diatur lewat environment variable di `wrangler.toml`. Tidak ada file `.env` yang diperlukan.

### Identitas Warung

| Variable | Default | Keterangan |
|---|---|---|
| `WARUNG_NAME` | _(turunan dari domain)_ | Nama situs, tampil di header & title |
| `WARUNG_DOMAIN` | `''` | Domain tanpa `https://`, misal `streamku.com` |
| `WARUNG_BASE_URL` | _(turunan dari domain)_ | URL lengkap, misal `https://streamku.com` |
| `WARUNG_TAGLINE` | `Streaming gratis kualitas terbaik` | Tagline di footer |
| `WARUNG_TYPE` | `C` | Tipe warung; gunakan `A` untuk menonaktifkan menu Album |

### Koneksi ke Dapur API

| Variable | Default | Keterangan |
|---|---|---|
| `DAPUR_BASE_URL` | `''` | URL base backend API, misal `https://api.streamku.com` |
| `DAPUR_API_KEY` | `''` | API key, dikirim sebagai header `X-API-Key` — **simpan sebagai secret** |
| `DAPUR_CACHE_TTL` | `600` | TTL cache API dalam detik |
| `DAPUR_DEBUG` | `false` | Aktifkan log error detail di console |

### SEO

| Variable | Default | Keterangan |
|---|---|---|
| `SEO_DEFAULT_DESC` | _(lihat kode)_ | Meta description default |
| `SEO_KEYWORDS` | `streaming gratis, nonton online, video terbaru` | Meta keywords |
| `SEO_LANG` | `id` | Atribut `lang` pada tag `<html>` |
| `SEO_LOCALE` | `id_ID` | Locale untuk Open Graph |
| `SEO_OG_IMAGE_W` | `1200` | Lebar OG image |
| `SEO_OG_IMAGE_H` | `630` | Tinggi OG image |

### Path URL

| Variable | Default | Keterangan |
|---|---|---|
| `PATH_CONTENT` | `tonton` | Prefix URL konten video |
| `PATH_SEARCH` | `cari` | Prefix URL pencarian |
| `PATH_CATEGORY` | `kategori` | Prefix URL kategori |
| `PATH_TAG` | `tag` | Prefix URL tag |
| `PATH_ALBUM` | `galeri` | Prefix URL album |
| `PATH_DMCA` | `dmca` | Path halaman DMCA |
| `PATH_TERMS` | `syarat` | Path halaman syarat & ketentuan |
| `PATH_PRIVACY` | `privasi` | Path halaman kebijakan privasi |
| `PATH_FAQ` | `faq` | Path halaman FAQ |
| `PATH_CONTACT` | `kontak` | Path halaman kontak |
| `PATH_ABOUT` | `tentang` | Path halaman tentang kami |

### Pagination

| Variable | Default | Keterangan |
|---|---|---|
| `ITEMS_PER_PAGE` | `32` | Jumlah item per halaman |
| `RELATED_COUNT` | `12` | Jumlah konten terkait di halaman view |
| `TRENDING_COUNT` | `15` | Jumlah konten trending di halaman home |

### Tema

| Variable | Default | Keterangan |
|---|---|---|
| `THEME_ACCENT` | `#ff4d4d` | Warna aksen utama |
| `THEME_ACCENT2` | `#ff8080` | Warna aksen hover |
| `THEME_BG` | `#0f0f0f` | Warna background utama |
| `THEME_BG2` | `#1a1a1a` | Warna background sekunder (card, header) |
| `THEME_BG3` | `#252525` | Warna background tersier |
| `THEME_FG` | `#ffffff` | Warna teks utama |
| `THEME_FG_DIM` | `#b0b0b0` | Warna teks redup / metadata |
| `THEME_BORDER` | `#333333` | Warna garis border |
| `THEME_FONT` | `Inter` | Font body (Google Fonts atau sistem) |
| `THEME_FONT_DISPLAY` | `Poppins` | Font heading/display |

### Misc

| Variable | Default | Keterangan |
|---|---|---|
| `DEFAULT_THUMB` | `''` | URL thumbnail fallback bila item tidak punya gambar |
| `CONTACT_EMAIL` | `''` | Email kontak, tampil di halaman DMCA & Kontak |
| `HONEYPOT_PREFIX` | `admin-cp` | Path prefix yang mengembalikan 404 diam-diam |
| `SITEMAP_SALT` | `warung_basic_salt` | Salt unik untuk sitemap — **ubah ke nilai acak** |

---

## Struktur URL

| URL | Handler | Keterangan |
|---|---|---|
| `/` | Home | Daftar terbaru + trending |
| `/?page=2` | Home | Paginasi |
| `/tonton/:id/:slug` | View | Detail konten video |
| `/galeri/:id/:slug` | View | Detail album |
| `/kategori/:type` | Category | Filter berdasarkan tipe konten |
| `/kategori/:type/2` | Category | Kategori dengan paginasi |
| `/tag/:tag` | Tag | Filter berdasarkan tag |
| `/cari?q=keyword` | Search | Pencarian konten |
| `/sitemap.xml` | Sitemap | Index sitemap |
| `/sitemap-pages.xml` | Sitemap | Sitemap halaman |
| `/rss.xml` atau `/feed` | RSS | Feed RSS konten terbaru |
| `/robots.txt` | Robots | Aturan crawler |
| `/site.webmanifest` | Manifest | PWA manifest |
| `/dmca` `/privasi` `/syarat` `/kontak` `/tentang` `/faq` | Static | Halaman statis |

---

## API Dapur

Worker berkomunikasi dengan backend Dapur melalui `DapurClient`. Semua request dikirim ke:

```
{DAPUR_BASE_URL}/api/v1/{endpoint}
```

dengan header:

```
X-API-Key: {DAPUR_API_KEY}
Accept: application/json
User-Agent: WarungClient/1.0 ({domain})
Origin: https://{domain}
```

Timeout per request adalah **10 detik**. Respons yang sukses di-cache di memori sesuai `DAPUR_CACHE_TTL`.

### Endpoint yang Digunakan

| Endpoint | Digunakan untuk |
|---|---|
| `GET /media` | Daftar konten (home, kategori, tag) |
| `GET /media/:id` | Detail konten |
| `GET /trending` | Konten trending (home) |
| `GET /related/:id` | Konten terkait (halaman view) |
| `GET /search` | Pencarian |
| `GET /categories` | Daftar kategori |
| `GET /tags` | Daftar tag |
| `GET /album/:id` | Detail album |
| `GET /sitemap` | Data sitemap XML |
| `GET /robots` | Konten robots.txt |

---

## Iklan

Aktifkan iklan dengan mengeset `ADS_ENABLED = "true"`. Tersedia tiga posisi slot, masing-masing dengan kode terpisah untuk desktop dan mobile:

| Variable | Posisi |
|---|---|
| `ADS_CODE_TOP_D` / `ADS_CODE_TOP_M` | Di atas konten |
| `ADS_CODE_MID_D` / `ADS_CODE_MID_M` | Di tengah (antara trending & terbaru / setelah player) |
| `ADS_CODE_BTM_D` / `ADS_CODE_BTM_M` | Di bawah konten |

`ADS_LABEL` adalah teks label kecil di atas slot (misal: "Iklan" atau "Advertisement").

---

## Deployment

### Development (lokal)

```bash
wrangler dev
```

### Deploy ke Cloudflare

```bash
# Environment default
wrangler deploy

# Environment production (dengan route domain)
wrangler deploy --env production

# Environment staging
wrangler deploy --env staging
```

### Ganti Domain / Route

Edit bagian `[env.production]` di `wrangler.toml`:

```toml
[env.production]
route = { pattern = "streamku.com/*", zone_name = "streamku.com" }
```

---

## Variabel Rahasia (Secrets)

Variabel sensitif **jangan** diletakkan di `wrangler.toml`. Simpan dengan perintah:

```bash
wrangler secret put DAPUR_API_KEY
wrangler secret put DAPUR_BASE_URL   # jika URL dianggap sensitif
```

Untuk environment spesifik:

```bash
wrangler secret put DAPUR_API_KEY --env production
```

---

## Cache

Worker menggunakan in-memory cache (`Map`) dengan TTL, bukan Cloudflare KV. Ini berarti:

- Cache **tidak persisten** — reset setiap kali isolate di-restart
- Cache **per-isolate** — tidak dibagi antar instance Worker
- Maksimum **300 entri**; entri kadaluarsa dibersihkan otomatis saat limit tercapai

| Jenis Data | TTL Default |
|---|---|
| Response API Dapur | `DAPUR_CACHE_TTL` (600 detik) |
| Robots.txt | 24 jam |
| Sitemap XML | 1 jam |
| RSS Feed | 1 jam |

---

## SEO

Setiap halaman menghasilkan:

- `<title>` dan `<meta name="description">` yang relevan
- Canonical URL yang tepat
- Open Graph tags (title, description, image, locale)
- Twitter Card tags
- JSON-LD Schema.org:
  - **WebSite** + SearchAction (home)
  - **VideoObject** (halaman view)
  - **BreadcrumbList** (kategori, tag, view)
- `<meta name="robots" content="noindex">` khusus halaman pencarian

---

## Scheduled Tasks

Handler `scheduled` tersedia untuk tugas berkala (cron):

```toml
[triggers]
crons = ["0 * * * *"]
```

Tambahkan logika di fungsi `_scheduled` dalam `worker.js`:

```js
async function _scheduled(event, env, ctx) {
  // Contoh: ping indexing, prefetch cache, dll.
}
```

---

## Troubleshooting

**Worker mengembalikan "Layanan sementara tidak tersedia."**
→ Periksa `DAPUR_BASE_URL` dan `DAPUR_API_KEY`. Aktifkan `DAPUR_DEBUG = "true"` untuk melihat log error di Cloudflare dashboard.

**Halaman tidak tampil di domain custom**
→ Pastikan `route` di `wrangler.toml` sudah sesuai dan zona Cloudflare sudah aktif.

**Sitemap kosong**
→ Pastikan endpoint `/api/v1/sitemap` di Dapur API mengembalikan field `data.xml`.

**Tema tidak berubah**
→ Nilai `THEME_*` hanya dibaca saat worker start. Lakukan `wrangler deploy` ulang setelah mengubah variabel di `wrangler.toml`.

**Cache terlalu lama**
→ Turunkan nilai `DAPUR_CACHE_TTL` di `wrangler.toml`. Minimum yang disarankan: `60` detik.

---

## Lisensi

Dibuat oleh [dukunseo.com](https://dukunseo.com). Gunakan dan modifikasi sesuai kebutuhan.
