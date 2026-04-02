'use strict';

/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║           WARUNG BASIC — Full Worker                                   ║
 * ║  Routing + API + SEO + Album Gallery + Articles + Tags + Tracking      ║
 * ║  Author : dukunseo.com                                                 ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * LICENSE
 * ───────────────────────────────────────────────────────────────────────────
 * Copyright © 2026–present dukunseo.com. All rights reserved.
 *
 * Kode ini dilisensikan eksklusif untuk pengguna resmi dukunseo.com.
 * Penggunaan, distribusi, modifikasi, atau sublisensing tanpa izin tertulis
 * dari dukunseo.com dilarang keras.
 *
 * Lisensi ini TIDAK mengizinkan:
 *   • Redistribusi ulang (baik gratis maupun komersial)
 *   • Penghapusan atribusi atau klaim kepemilikan oleh pihak lain
 *   • Penggunaan nama / merek dukunseo.com untuk tujuan promosi pihak ketiga
 *
 * Untuk pertanyaan lisensi, kunjungi: https://dukunseo.com
 * ───────────────────────────────────────────────────────────────────────────
 *
 * CHANGELOG — Bug Fixes & Optimasi
 * ───────────────────────────────────────────────────────────────────────────
 * [PUTARAN 1]
 * BUG 1  handleAlbumView: double fetch album + preloadedItem tidak pernah
 *        terpakai. Sekarang fetch album & related paralel via Promise.all,
 *        preloadedItem dipakai sebagai fallback metadata jika album gagal.
 *
 * BUG 2  handleAlbumView: record-view album tidak pakai ctx.waitUntil
 *        sehingga berisiko dibunuh CF sebelum selesai. ctx sekarang
 *        diteruskan dari _fetch → handleView → handleAlbumView.
 *
 * BUG 3  cacheSet eviction: jika 300 entry semua masih fresh, tidak ada
 *        yang dihapus tapi entry baru tetap di-set → cache membengkak.
 *        Sekarang ada FIFO fallback: hapus entry terlama jika tidak ada
 *        yang expired.
 *
 * BUG 4  renderPagination: URL constructor dengan base 'https://dummy.x'
 *        tidak konsisten jika baseUrl mengandung query string. Diganti
 *        manipulasi string + URLSearchParams yang lebih predictable.
 *
 * BUG 5  handleProxyLike & handleProxyWatch tidak ada timeout — bisa hang
 *        sampai batas CF (~30 dtk) jika Dapur lambat. Sekarang ada
 *        AbortController + timeout 8 detik pada kedua proxy handler.
 *
 * BUG 6  handleRss tidak ada outer try/catch — error tak terduga dari
 *        client.getMediaList bisa crash handler. Sekarang ditangani
 *        gracefully dengan fallback items kosong.
 *
 * OPT 1  getConfig: re-build object setiap request meski env tidak berubah.
 *        Sekarang di-memoize per env via WeakMap — ~0 overhead per request
 *        setelah request pertama.
 *
 * OPT 2  renderCommonStyles(): dipanggil tiap render padahal hasilnya static.
 *        Sekarang di-cache sebagai konstanta _COMMON_STYLES saat module load.
 *
 * OPT 3  parseTags(): logika parse tags duplikat di 3 handler (handleView,
 *        handleAlbumView, handleArticleDetail). Dipindah ke helper terpusat.
 *
 * [PUTARAN 2]
 * SEC 1  handleSearch: double-escape — h(q) dipanggil sebelum masuk
 *        renderHead yang juga memanggil h() → &amp;lt; di output.
 *        Difix: lepas h() di call site, biarkan renderHead yang handle.
 *
 * SEC 2  Proxy pid tidak divalidasi format — path seperti '../../etc' bisa
 *        lolos ke URL Dapur. Sekarang hanya integer 1–10 digit (/^\d{1,10}$/)
 *        yang diterima di router sebelum masuk handler.
 *
 * SEC 3  Search query q tidak dibatasi panjang — payload 10.000+ karakter
 *        bisa membebani Dapur dan menghasilkan HTML raksasa. Di-slice ke
 *        200 karakter sebelum diproses.
 *
 * SEC 4  htmlResponse minim security headers — X-Frame-Options, Referrer-
 *        Policy, dan Permissions-Policy ditambahkan sebagai baseline defense.
 *
 * SEC 5  renderTrackingJs: <script> inline tanpa nonce attribute sehingga
 *        tidak bisa divalidasi browser via CSP. Fungsi sekarang menerima
 *        parameter nonce dan semua call site diupdate.
 *
 * SEC 6  article.content_html diinjeksi langsung tanpa guard tipe/ukuran.
 *        Sekarang ada validasi typeof string + batas 512KB; komentar
 *        eksplisit bahwa sanitasi HARUS dilakukan di sisi Dapur/CMS.
 *
 * SEC 7  renderAdSlot: ad code dari env diinjeksi mentah tanpa validasi.
 *        Sekarang ada guard typeof string + batas 32KB untuk cegah env
 *        value rusak/raksasa merusak HTML output.
 *
 * SEC 8  decodeURIComponent pada tag & article slug tanpa try-catch —
 *        URIError dari URL malformed bubble ke outer catch dan return 500.
 *        Sekarang masing-masing di-wrap try-catch dan return 404 yang tepat.
 *
 * PERF 9 Klarifikasi komentar handleAlbumView: fetch /album/{id} memang
 *        SELALU diperlukan karena photos hanya ada di endpoint ini, bukan
 *        di /media/{id}. Tidak ada redundansi — komentar sebelumnya misleading.
 * ───────────────────────────────────────────────────────────────────────────
 */

// ── Regex & konstanta dasar ──────────────────────────────────────────────────
const _STATIC_EXT_RX = /\.(?:css|js|mjs|map|ico|png|jpg|jpeg|gif|svg|webp|avif|woff|woff2|ttf|eot|otf|mp4|webm|ogg|mp3|wav|json|txt|xml|pdf|zip|gz|br)$/i;
const _HANDLED_PATHS = new Set([
  'sitemap.xml','sitemap-index.xml','sitemap-pages.xml','sitemap-video.xml','sitemap-image.xml',
  'rss.xml','feed.xml','feed','robots.txt','site.webmanifest','apple-touch-icon.png',
]);
const _MOBILE_UA_RX = /Mobile|Android|iPhone|iPad/i;

// ── Default config ────────────────────────────────────────────────────────────
const _DEFAULT_CONFIG = {
  WARUNG_NAME:    '',
  WARUNG_DOMAIN:  '',
  WARUNG_BASE_URL:'',
  WARUNG_TAGLINE: 'Streaming gratis kualitas terbaik',
  WARUNG_TYPE:    'C',

  DAPUR_BASE_URL:  '',
  DAPUR_CACHE_TTL: 600,
  DAPUR_DEBUG:     false,

  SEO_DEFAULT_DESC: 'Nonton konten terbaru gratis streaming HD. Koleksi terlengkap update tiap hari.',
  SEO_KEYWORDS:     'streaming gratis, nonton online, video terbaru',
  SEO_LANG:         'id',
  SEO_LOCALE:       'id_ID',
  SEO_OG_IMAGE_W:   1200,
  SEO_OG_IMAGE_H:   630,

  PATH_CONTENT:  'tonton',
  PATH_SEARCH:   'cari',
  PATH_CATEGORY: 'kategori',
  PATH_TAG:      'tag',
  PATH_TAGS:     'tags',      // ← baru: halaman daftar semua tag
  PATH_ALBUM:    'galeri',
  PATH_ARTICLE:  'artikel',   // ← baru: halaman artikel / blog
  PATH_DMCA:     'dmca',
  PATH_TERMS:    'syarat',
  PATH_PRIVACY:  'privasi',
  PATH_FAQ:      'faq',
  PATH_CONTACT:  'kontak',
  PATH_ABOUT:    'tentang',

  ITEMS_PER_PAGE:  32,
  RELATED_COUNT:   12,
  TRENDING_COUNT:  15,

  THEME_ACCENT:      '#ff4d4d',
  THEME_ACCENT2:     '#ff8080',
  THEME_BG:          '#0f0f0f',
  THEME_BG2:         '#1a1a1a',
  THEME_BG3:         '#252525',
  THEME_FG:          '#ffffff',
  THEME_FG_DIM:      '#b0b0b0',
  THEME_BORDER:      '#333333',
  THEME_FONT:        'Inter',
  THEME_FONT_DISPLAY:'Poppins',

  ADS_ENABLED:        false,
  ADS_ADSENSE_CLIENT: '',
  ADS_LABEL:          '',
  ADS_CODE_TOP_D:     '',
  ADS_CODE_TOP_M:     '',
  ADS_CODE_MID_D:     '',
  ADS_CODE_MID_M:     '',
  ADS_CODE_BTM_D:     '',
  ADS_CODE_BTM_M:     '',

  DEFAULT_THUMB:      '',
  CONTACT_EMAIL:      '',
  HONEYPOT_PREFIX:    'admin-cp',
  SITEMAP_SALT:       'warung_basic_salt',
};

// ── In-memory cache sederhana (Map + TTL) ────────────────────────────────────
const _cache = new Map();

function cacheGet(key) {
  const entry = _cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { _cache.delete(key); return null; }
  return entry.value;
}
function cacheSet(key, value, ttlMs = 300_000) {
  if (_cache.size >= 300) {
    const now = Date.now();
    let deleted = 0;
    for (const [k, v] of _cache) {
      if (now > v.expiresAt) { _cache.delete(k); deleted++; }
    }
    // FIX BUG 3: jika tidak ada yang expired, paksa hapus entry terlama (FIFO)
    // agar Map tidak tumbuh tak terbatas saat semua entry masih fresh.
    if (deleted === 0) {
      const firstKey = _cache.keys().next().value;
      if (firstKey !== undefined) _cache.delete(firstKey);
    }
  }
  _cache.set(key, { value, expiresAt: Date.now() + ttlMs });
}

// ── Error logger minimalis ───────────────────────────────────────────────────
function logError(ctx, err) {
  console.error(`[${ctx}]`, err?.message || err);
}

// ── Utility functions ────────────────────────────────────────────────────────
const _hMap = { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;' };
const _hRx  = /[&<>"']/g;
function h(str) { return str == null ? '' : String(str).replace(_hRx, c => _hMap[c]); }

function jsStr(value) {
  return JSON.stringify(value)
    .replace(/</g,'\\u003c').replace(/>/g,'\\u003e')
    .replace(/&/g,'\\u0026').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
}

function safeUrl(url, fallback = '') {
  if (!url) return fallback;
  try {
    const u = new URL(String(url));
    return (u.protocol === 'https:' || u.protocol === 'http:') ? url : fallback;
  } catch { return fallback; }
}

function makeSlug(text) {
  return (text||'').toLowerCase().replace(/[^a-z0-9\s-]/g,'').replace(/\s+/g,'-').replace(/^-+|-+$/g,'');
}
function truncate(str, len) {
  const s = (str||'').replace(/<[^>]+>/g,'');
  return s.length <= len ? s : s.slice(0, len).replace(/\s+\S*$/,'') + '…';
}
function formatDuration(seconds) {
  if (!seconds || seconds <= 0) return '';
  seconds = Math.floor(seconds);
  const s = seconds%60, m = Math.floor(seconds/60)%60, hh = Math.floor(seconds/3600);
  return hh > 0
    ? `${String(hh).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
    : `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}
function isoDuration(s) {
  if (!s || s <= 0) return '';
  const d=parseInt(s,10), hh=Math.floor(d/3600), mm=Math.floor((d%3600)/60), ss=d%60;
  return 'PT'+(hh?hh+'H':'')+(mm?mm+'M':'')+(ss||(!hh&&!mm)?ss+'S':'');
}
function formatViews(v) {
  if (!v) return '0';
  if (v >= 1_000_000) return (v/1_000_000).toFixed(1)+'M';
  if (v >= 1_000) return (v/1_000).toFixed(1)+'K';
  return String(v);
}
function formatDate(d) {
  if (!d) return '';
  const dt = new Date(d);
  return isNaN(dt) ? '' : dt.toLocaleDateString('id-ID', { day:'2-digit', month:'short', year:'numeric' });
}
function isoDate(d) { try { return new Date(d).toISOString(); } catch { return ''; } }
function numberFormat(n) { return new Intl.NumberFormat('id-ID').format(n||0); }
function ucfirst(str) { return str ? str.charAt(0).toUpperCase()+str.slice(1) : ''; }
function stripTags(str) { return (str||'').replace(/<[^>]+>/g,''); }
function nl2br(str) { return (str||'').replace(/\n/g,'<br>'); }
function generateNonce() { return crypto.randomUUID().replace(/-/g,''); }

function _absUrl(url, domain) {
  if (!url) return '';
  const s = String(url).trim();
  if (s.startsWith('https://') || s.startsWith('http://')) return s;
  if (s.startsWith('//')) return 'https:'+s;
  return domain && s.startsWith('/') ? 'https://'+domain+s : '';
}

// OPT 3: helper terpusat untuk parse tags — menghilangkan duplikasi di 3+ handler
function parseTags(tags) {
  if (Array.isArray(tags)) return tags.filter(Boolean);
  if (typeof tags === 'string') return tags.split(',').map(t => t.trim()).filter(Boolean);
  return [];
}

// ── Config helper ────────────────────────────────────────────────────────────
// OPT 4: memoize config per env object (sama selama lifetime isolate CF Workers)
const _cfgCache = new WeakMap();
function getConfig(env) {
  if (_cfgCache.has(env)) return _cfgCache.get(env);
  const cfg = { ..._DEFAULT_CONFIG };
  for (const key of Object.keys(_DEFAULT_CONFIG)) {
    if (env[key] !== undefined) cfg[key] = env[key];
  }
  if (!cfg.WARUNG_NAME && cfg.WARUNG_DOMAIN)
    cfg.WARUNG_NAME = ucfirst(cfg.WARUNG_DOMAIN.split('.')[0]);
  if (!cfg.WARUNG_BASE_URL && cfg.WARUNG_DOMAIN)
    cfg.WARUNG_BASE_URL = 'https://'+cfg.WARUNG_DOMAIN;
  cfg.DAPUR_DEBUG     = String(cfg.DAPUR_DEBUG) === 'true';
  cfg.DAPUR_CACHE_TTL = parseInt(cfg.DAPUR_CACHE_TTL, 10) || 600;
  cfg.ITEMS_PER_PAGE  = parseInt(cfg.ITEMS_PER_PAGE, 10)  || 32;
  cfg.RELATED_COUNT   = parseInt(cfg.RELATED_COUNT, 10)   || 12;
  cfg.TRENDING_COUNT  = parseInt(cfg.TRENDING_COUNT, 10)  || 15;
  cfg._env = env;
  _cfgCache.set(env, cfg);
  return cfg;
}

// ── URL helpers ──────────────────────────────────────────────────────────────
function urlHelper(path, cfg) { return (cfg.WARUNG_BASE_PATH||'')+'/'+path.replace(/^\/+/,''); }
function absUrl(path, cfg)    { return 'https://'+cfg.WARUNG_DOMAIN+urlHelper(path, cfg); }
function contentUrl(id, title, cfg) {
  const slug = makeSlug(title||'');
  return urlHelper(cfg.PATH_CONTENT+'/'+id+(slug?'/'+slug:''), cfg);
}
function albumUrl(id, title, cfg) {
  const slug = makeSlug(title||'');
  return urlHelper(cfg.PATH_ALBUM+'/'+id+(slug?'/'+slug:''), cfg);
}
function categoryUrl(type, page=1, cfg) {
  return urlHelper(cfg.PATH_CATEGORY+'/'+encodeURIComponent(type)+(page>1?'/'+page:''), cfg);
}
function tagUrl(tag, cfg) {
  return urlHelper(cfg.PATH_TAG+'/'+encodeURIComponent((tag||'').toLowerCase().trim()), cfg);
}
function searchUrl(q, cfg) {
  return urlHelper(cfg.PATH_SEARCH, cfg)+(q?'?q='+encodeURIComponent(q):'');
}
function articleUrl(article, cfg) {
  const slug = article.slug || makeSlug(article.title||'');
  return urlHelper(cfg.PATH_ARTICLE+'/'+(slug||article.id), cfg);
}
function itemUrl(item, cfg) {
  return item.type === 'album' ? albumUrl(item.id, item.title, cfg) : contentUrl(item.id, item.title, cfg);
}
function homeUrl(cfg) { return cfg.WARUNG_BASE_PATH||'/'; }
function safeThumb(item, cfg) { return item?.thumbnail || cfg.DEFAULT_THUMB || ''; }

// ── Dapur API client ─────────────────────────────────────────────────────────
class DapurClient {
  constructor(cfg) {
    this.baseUrl = (cfg.DAPUR_BASE_URL||'').replace(/\/$/, '');
    this.apiKey  = cfg.DAPUR_API_KEY || '';
    this.domain  = cfg.WARUNG_DOMAIN || '';
    this.ttl     = (cfg.DAPUR_CACHE_TTL || 600) * 1000;
    this.debug   = cfg.DAPUR_DEBUG;
  }

  async fetch(path, params = {}) {
    const qs = new URLSearchParams(params).toString();
    const url = `${this.baseUrl}/api/v1${path}${qs?'?'+qs:''}`;
    const cacheKey = `api:${this.domain}:${path}:${qs}`;

    const cached = cacheGet(cacheKey);
    if (cached) return cached;

    try {
      const ctrl  = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 10000);
      let resp;
      try {
        resp = await fetch(url, {
          headers: {
            'X-API-Key':  this.apiKey,
            'Accept':     'application/json',
            'User-Agent': `WarungClient/1.0 (${this.domain})`,
            'Origin':     `https://${this.domain}`,
          },
          signal: ctrl.signal,
        });
      } finally { clearTimeout(timer); }

      if (!resp.ok) {
        if (this.debug) console.error('[DapurClient] Error', resp.status, path);
        return this._err('Layanan sementara tidak tersedia.');
      }

      const data = await resp.json();
      if (data?.status !== 'error') cacheSet(cacheKey, data, this.ttl);
      return data;
    } catch (err) {
      logError('DapurClient.fetch', err);
      return this._err('Layanan sementara tidak tersedia.');
    }
  }

  // ── Media
  getHome(params)          { return this.fetch('/media', { sort:'newest', ...params }); }
  getMediaList(params)     { return this.fetch('/media', params); }
  getMedia(id)             { return this.fetch(`/media/${id}`); }
  getTrending(limit=15)    { return this.fetch('/trending', { per_page: limit }); }
  getMostViewed(limit=15)  { return this.fetch('/most-viewed', { per_page: limit }); }
  getMostLiked(limit=15)   { return this.fetch('/most-liked', { per_page: limit }); }
  getRelated(id, limit=12) { return this.fetch(`/related/${id}`, { per_page: limit }); }
  searchMedia(q, params)   { return this.fetch('/search', { q, ...params }); }

  // ── Taxonomy
  getCategories()          { return this.fetch('/categories'); }
  getTags(params)          { return this.fetch('/tags', params); }
  getTagMedia(tag, params) { return this.fetch(`/tags-media/${encodeURIComponent(tag)}`, params); }

  // ── Album (tipe B & C)
  getAlbum(id)             { return this.fetch(`/album/${id}`); }

  // ── Articles
  getArticles(params)      { return this.fetch('/articles', params); }
  getArticle(slug)         { return this.fetch(`/article/${encodeURIComponent(slug)}`); }

  // ── Infra
  getSitemap(params)       { return this.fetch('/sitemap', params); }
  getRobots()              { return this.fetch('/robots'); }
  getConfig()              { return this.fetch('/config'); }

  _err(msg) { return { status:'error', message:msg, data:[], meta:{} }; }
}

// ── SEO / meta helpers ───────────────────────────────────────────────────────
function makeCanonical(path, cfg) {
  const clean = path.replace(/\/+$/, '') || '/';
  return 'https://'+cfg.WARUNG_DOMAIN+clean;
}

function renderHead({ title, desc, keywords, canonical, ogImage, ogType='website', schema=[], nonce, cfg, extraMeta='' }) {
  const metaTitle    = h(title || cfg.WARUNG_NAME);
  const metaDesc     = h(truncate(desc || cfg.SEO_DEFAULT_DESC, 160));
  const metaKeywords = h(keywords || cfg.SEO_KEYWORDS);
  const ogImg        = h(ogImage || cfg.SEO_OG_IMAGE || '');

  const schemaHtml = schema.map(s =>
    `<script type="application/ld+json" nonce="${nonce}">${JSON.stringify(s)}</script>`
  ).join('\n');

  return `<!DOCTYPE html>
<html lang="${cfg.SEO_LANG}" prefix="og: https://ogp.me/ns#">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${metaTitle}</title>
<meta name="description" content="${metaDesc}">
<meta name="keywords" content="${metaKeywords}">
<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1">
<link rel="canonical" href="${h(canonical)}">
<meta property="og:type" content="${ogType}">
<meta property="og:title" content="${metaTitle}">
<meta property="og:description" content="${metaDesc}">
<meta property="og:url" content="${h(canonical)}">
<meta property="og:site_name" content="${h(cfg.WARUNG_NAME)}">
<meta property="og:locale" content="${cfg.SEO_LOCALE||'id_ID'}">
${ogImg ? `<meta property="og:image" content="${ogImg}">
<meta property="og:image:width" content="${cfg.SEO_OG_IMAGE_W||1200}">
<meta property="og:image:height" content="${cfg.SEO_OG_IMAGE_H||630}">` : ''}
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${metaTitle}">
<meta name="twitter:description" content="${metaDesc}">
${ogImg ? `<meta name="twitter:image" content="${ogImg}">` : ''}
${extraMeta}
${schemaHtml}
${renderThemeCss(cfg, nonce)}
</head>`;
}

function renderThemeCss(cfg, nonce) {
  return `<style nonce="${nonce}">
:root {
  --accent:   ${h(cfg.THEME_ACCENT||'#ff4d4d')};
  --accent2:  ${h(cfg.THEME_ACCENT2||'#ff8080')};
  --bg:       ${h(cfg.THEME_BG||'#0f0f0f')};
  --bg2:      ${h(cfg.THEME_BG2||'#1a1a1a')};
  --bg3:      ${h(cfg.THEME_BG3||'#252525')};
  --fg:       ${h(cfg.THEME_FG||'#ffffff')};
  --fg-dim:   ${h(cfg.THEME_FG_DIM||'#b0b0b0')};
  --border:   ${h(cfg.THEME_BORDER||'#333333')};
  --font:     '${h(cfg.THEME_FONT||'Inter')}', sans-serif;
  --font-d:   '${h(cfg.THEME_FONT_DISPLAY||'Poppins')}', sans-serif;
}
*,*::before,*::after { box-sizing:border-box; margin:0; padding:0; }
body { background:var(--bg); color:var(--fg); font-family:var(--font); line-height:1.6; min-height:100vh; }
a { color:var(--accent); text-decoration:none; }
a:hover { color:var(--accent2); }
img { max-width:100%; height:auto; display:block; }
.container { max-width:1280px; margin:0 auto; padding:0 16px; }
</style>`;
}

function renderNav(cfg, currentPath='') {
  const home = homeUrl(cfg);
  const searchHref = searchUrl('', cfg);
  return `<header class="site-header">
  <nav class="nav container">
    <a class="nav-logo" href="${h(home)}">${h(cfg.WARUNG_NAME)}</a>
    <div class="nav-links">
      <a href="${h(categoryUrl('video',1,cfg))}">Video</a>
      ${cfg.WARUNG_TYPE !== 'A' ? `<a href="${h(categoryUrl('album',1,cfg))}">Album</a>` : ''}
      <a href="${h(urlHelper(cfg.PATH_ARTICLE, cfg))}">Artikel</a>
      <a href="${h(searchHref)}">Cari</a>
    </div>
  </nav>
</header>
<style>
.site-header{background:var(--bg2);border-bottom:1px solid var(--border);position:sticky;top:0;z-index:100}
.nav{display:flex;align-items:center;gap:24px;height:56px}
.nav-logo{font-family:var(--font-d);font-weight:700;font-size:1.2rem;color:var(--fg)}
.nav-links{display:flex;gap:16px;margin-left:auto}
.nav-links a{color:var(--fg-dim);font-size:.95rem;transition:color .2s}
.nav-links a:hover{color:var(--accent)}
@media(max-width:480px){.nav-links a:not(:last-child){display:none}}
</style>`;
}

function renderFooter(cfg) {
  const year = new Date().getFullYear();
  return `<footer class="site-footer">
  <div class="container footer-inner">
    <p class="footer-name">${h(cfg.WARUNG_NAME)}</p>
    <p class="footer-tagline">${h(cfg.WARUNG_TAGLINE)}</p>
    <div class="footer-links">
      <a href="${h(urlHelper(cfg.PATH_DMCA, cfg))}">DMCA</a>
      <a href="${h(urlHelper(cfg.PATH_PRIVACY, cfg))}">Privasi</a>
      <a href="${h(urlHelper(cfg.PATH_TERMS, cfg))}">Syarat</a>
      <a href="${h(urlHelper(cfg.PATH_CONTACT, cfg))}">Kontak</a>
      <a href="${h(urlHelper(cfg.PATH_ARTICLE, cfg))}">Artikel</a>
      <a href="${h(urlHelper(cfg.PATH_TAGS, cfg))}">Tag</a>
    </div>
    <p class="footer-copy">© ${year} ${h(cfg.WARUNG_NAME)} • All Rights Reserved</p>
  </div>
</footer>
<style>
.site-footer{background:var(--bg2);border-top:1px solid var(--border);padding:40px 0;margin-top:60px;text-align:center}
.footer-inner{display:flex;flex-direction:column;align-items:center;gap:12px}
.footer-name{font-weight:700;font-size:1.1rem}
.footer-tagline{color:var(--fg-dim);font-size:.9rem}
.footer-links{display:flex;gap:16px;flex-wrap:wrap;justify-content:center}
.footer-links a{color:var(--fg-dim);font-size:.85rem}
.footer-links a:hover{color:var(--accent)}
.footer-copy{color:var(--fg-dim);font-size:.8rem}
</style>`;
}

// ── Ad helpers ───────────────────────────────────────────────────────────────
function isMobileRequest(request) {
  return _MOBILE_UA_RX.test(request.headers.get('User-Agent') || '');
}

function renderAdSlot(position, cfg, isMobile) {
  if (String(cfg.ADS_ENABLED) !== 'true') return '';
  const codeMap = {
    top:    isMobile ? cfg.ADS_CODE_TOP_M : cfg.ADS_CODE_TOP_D,
    mid:    isMobile ? cfg.ADS_CODE_MID_M : cfg.ADS_CODE_MID_D,
    bottom: isMobile ? cfg.ADS_CODE_BTM_M : cfg.ADS_CODE_BTM_D,
  };
  // FIX SECURITY 7: ad code dari env — pastikan string dan batasi ukuran 32KB
  // agar env value rusak/raksasa tidak merusak HTML output.
  const rawCode = codeMap[position];
  const code = (typeof rawCode === 'string' && rawCode.length <= 32_768) ? rawCode : '';
  if (!code) return '';
  const label = cfg.ADS_LABEL
    ? `<p class="ad-label">${h(cfg.ADS_LABEL)}</p>`
    : '';
  return `<div class="ad-slot ad-slot--${position}" aria-label="Iklan" role="complementary">
  <div class="ad-slot__inner">${label}<div class="ad-slot__body">${code}</div></div>
</div>`;
}

// ── Card renderer ────────────────────────────────────────────────────────────
function renderCard(item, cfg) {
  const url   = h(itemUrl(item, cfg));
  const thumb = h(safeThumb(item, cfg));
  const title = h(item.title || '');
  const dur   = item.duration ? `<span class="card-dur">${h(formatDuration(item.duration))}</span>` : '';
  const views = item.views    ? `<span class="card-views">${h(formatViews(item.views))} x</span>` : '';
  const date  = item.created_at ? `<span class="card-date">${h(formatDate(item.created_at))}</span>` : '';
  const isNew = item.is_new ? `<span class="card-badge">NEW</span>` : '';
  const isAlbum = item.type === 'album' ? `<span class="card-badge card-badge--album">📷</span>` : '';

  return `<article class="card">
  <a href="${url}" class="card-thumb-wrap">
    ${thumb
      ? `<img src="${thumb}" alt="${title}" loading="lazy" decoding="async" width="320" height="180" class="card-thumb">`
      : '<div class="card-thumb-placeholder"></div>'}
    ${dur}${isNew}${isAlbum}
  </a>
  <div class="card-info">
    <a href="${url}" class="card-title" title="${title}">${title}</a>
    <div class="card-meta">${views}${date}</div>
  </div>
</article>`;
}

function renderGrid(items, cfg) {
  if (!items?.length) return '<p class="empty-msg">Tidak ada konten tersedia.</p>';
  return `<div class="card-grid">${items.map(i => renderCard(i, cfg)).join('')}</div>`;
}

function renderPagination(meta, currentPage, baseUrl) {
  if (!meta?.total_pages || meta.total_pages <= 1) return '';
  const total = meta.total_pages;
  const cur   = parseInt(currentPage, 10) || 1;
  const prev  = cur > 1 ? cur-1 : null;
  const next  = cur < total ? cur+1 : null;

  // FIX BUG 4: hindari URL constructor dengan base dummy.x — tidak konsisten
  // di semua edge runtime jika baseUrl mengandung query string.
  // Gunakan manipulasi string langsung yang predictable.
  const pageUrl = (p) => {
    const [pathPart, qsPart] = baseUrl.split('?');
    const params = new URLSearchParams(qsPart || '');
    params.set('page', p);
    return pathPart + '?' + params.toString();
  };

  let html = `<nav class="pagination" aria-label="Navigasi halaman"><div class="page-links">`;
  if (prev) html += `<a class="page-btn" href="${h(pageUrl(prev))}" rel="prev">← Sebelumnya</a>`;
  html += `<span class="page-cur">Hal. ${cur} / ${total}</span>`;
  if (next) html += `<a class="page-btn" href="${h(pageUrl(next))}" rel="next">Berikutnya →</a>`;
  html += `</div></nav>`;
  return html;
}

// ── Response builder ─────────────────────────────────────────────────────────
// FIX SECURITY 4: tambah security headers — X-Frame-Options, Referrer-Policy.
// Nonce di <style> dan <script> sudah dipakai, tapi CSP header tidak dikirim
// sehingga nonce tidak memberikan proteksi nyata. Untuk menambah CSP penuh
// perlu nonce diteruskan ke sini; sementara ini tambah header baseline dulu.
function htmlResponse(html, status=200, extraHeaders={}) {
  return new Response(html, {
    status,
    headers: {
      'Content-Type':            'text/html; charset=UTF-8',
      'Cache-Control':           'public, max-age=600, s-maxage=3600, stale-while-revalidate=300',
      'X-Content-Type-Options':  'nosniff',
      'X-Frame-Options':         'SAMEORIGIN',
      'Referrer-Policy':         'strict-origin-when-cross-origin',
      'Permissions-Policy':      'camera=(), microphone=(), geolocation=()',
      ...extraHeaders,
    },
  });
}

function notFound(cfg) {
  const nonce = generateNonce();
  const head  = renderHead({
    title:    `404 — ${cfg.WARUNG_NAME}`,
    desc:     'Halaman tidak ditemukan.',
    canonical:'https://'+cfg.WARUNG_DOMAIN+'/404',
    cfg, nonce,
  });
  return htmlResponse(
    head + renderNav(cfg) +
    `<main class="container" style="padding:80px 0;text-align:center">
      <h1 style="font-size:4rem;color:var(--accent)">404</h1>
      <p style="color:var(--fg-dim);margin-top:12px">Halaman tidak ditemukan.</p>
      <a href="${h(homeUrl(cfg))}" style="display:inline-block;margin-top:24px;padding:10px 24px;background:var(--accent);color:#fff;border-radius:6px">
        Kembali ke Beranda
      </a>
    </main>` +
    renderFooter(cfg) + _COMMON_STYLES + '</body></html>',
    404
  );
}

// ── JSON-LD schema helpers ───────────────────────────────────────────────────
function websiteSchema(cfg) {
  return {
    '@context': 'https://schema.org',
    '@type':    'WebSite',
    name:       cfg.WARUNG_NAME,
    url:        'https://'+cfg.WARUNG_DOMAIN,
    description: cfg.SEO_DEFAULT_DESC,
    potentialAction: {
      '@type':       'SearchAction',
      target:        { '@type':'EntryPoint', urlTemplate: 'https://'+cfg.WARUNG_DOMAIN+'/'+cfg.PATH_SEARCH+'?q={search_term_string}' },
      'query-input': 'required name=search_term_string',
    },
  };
}

function breadcrumbSchema(items) {
  return {
    '@context': 'https://schema.org',
    '@type':    'BreadcrumbList',
    itemListElement: items.map((item, i) => ({
      '@type':   'ListItem',
      position:  i+1,
      name:      item.name,
      item:      item.url,
    })),
  };
}

function videoSchema(item, canonical, cfg) {
  if (!item || item.type === 'album') return null;
  return {
    '@context':   'https://schema.org',
    '@type':      'VideoObject',
    name:         item.title,
    description:  truncate(item.description || item.title, 200),
    thumbnailUrl: _absUrl(item.thumbnail, cfg.WARUNG_DOMAIN),
    uploadDate:   isoDate(item.created_at),
    duration:     isoDuration(item.duration),
    url:          canonical,
    embedUrl:     safeUrl(item.embed_url || ''),
    interactionStatistic: item.views ? {
      '@type':              'InteractionCounter',
      interactionType:      'https://schema.org/WatchAction',
      userInteractionCount: item.views,
    } : undefined,
  };
}

function imageGallerySchema(item, photos, canonical, cfg) {
  return {
    '@context': 'https://schema.org',
    '@type':    'ImageGallery',
    name:       item.title,
    description: truncate(item.description || item.title, 200),
    url:        canonical,
    datePublished: isoDate(item.created_at),
    image:      photos.map(p => {
      const src = typeof p === 'string' ? p : (p?.url || p?.src || '');
      return _absUrl(src, cfg.WARUNG_DOMAIN);
    }).filter(Boolean),
  };
}

function articleSchema(article, canonical, cfg) {
  return {
    '@context':    'https://schema.org',
    '@type':       'Article',
    headline:      article.title,
    description:   truncate(stripTags(article.content || article.excerpt || ''), 200),
    url:           canonical,
    datePublished: isoDate(article.created_at || article.published_at),
    dateModified:  isoDate(article.updated_at || article.created_at),
    author: {
      '@type': 'Organization',
      name:    cfg.WARUNG_NAME,
      url:     'https://'+cfg.WARUNG_DOMAIN,
    },
    publisher: {
      '@type': 'Organization',
      name:    cfg.WARUNG_NAME,
      url:     'https://'+cfg.WARUNG_DOMAIN,
    },
    ...(article.thumbnail ? { image: _absUrl(article.thumbnail, cfg.WARUNG_DOMAIN) } : {}),
  };
}

// ── Shared CSS styles ────────────────────────────────────────────────────────
// OPT 2: string static — cache sekali saat module load, tidak re-generate tiap request
function renderCommonStyles() {
  return `<style>
.main-content{padding:24px 0 40px}
.section{margin-bottom:40px}
.section-title{font-family:var(--font-d);font-size:1.2rem;font-weight:700;margin-bottom:16px;display:flex;align-items:center;gap:8px}
.card-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}
@media(min-width:480px){.card-grid{grid-template-columns:repeat(3,1fr)}}
@media(min-width:768px){.card-grid{grid-template-columns:repeat(4,1fr)}}
@media(min-width:1024px){.card-grid{grid-template-columns:repeat(5,1fr)}}
.card{background:var(--bg2);border-radius:8px;overflow:hidden;transition:transform .15s}
.card:hover{transform:translateY(-2px)}
.card-thumb-wrap{display:block;position:relative;aspect-ratio:16/9;background:var(--bg3)}
.card-thumb{width:100%;height:100%;object-fit:cover}
.card-thumb-placeholder{width:100%;height:100%;background:var(--bg3)}
.card-dur{position:absolute;bottom:6px;right:6px;background:rgba(0,0,0,.75);color:#fff;font-size:.7rem;padding:2px 6px;border-radius:3px}
.card-badge{position:absolute;top:6px;left:6px;background:var(--accent);color:#fff;font-size:.65rem;font-weight:700;padding:2px 6px;border-radius:3px}
.card-badge--album{background:#7c3aed}
.card-info{padding:8px 10px 10px}
.card-title{display:block;font-size:.82rem;font-weight:600;line-height:1.4;color:var(--fg);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:4px}
.card-title:hover{color:var(--accent)}
.card-meta{display:flex;gap:8px;color:var(--fg-dim);font-size:.72rem;flex-wrap:wrap}
.pagination{display:flex;justify-content:center;margin-top:32px}
.page-links{display:flex;align-items:center;gap:12px}
.page-btn{background:var(--bg2);border:1px solid var(--border);color:var(--fg);padding:8px 16px;border-radius:6px;font-size:.9rem;transition:border-color .2s}
.page-btn:hover{border-color:var(--accent);color:var(--accent)}
.page-cur{color:var(--fg-dim);font-size:.9rem}
.empty-msg{text-align:center;color:var(--fg-dim);padding:60px 0;font-size:1rem}
.meta-count{color:var(--fg-dim);font-size:.85rem;margin-bottom:16px}
/* ── Ad Slots ─────────────────────────────────────────── */
.ad-slot{width:100%;overflow:hidden;clear:both}
.ad-slot--top{margin:0 0 24px}
.ad-slot--mid{margin:32px 0}
.ad-slot--bottom{margin:40px 0 0}
.ad-slot__inner{display:flex;flex-direction:column;align-items:center;gap:6px}
.ad-label{font-size:.6rem;text-transform:uppercase;letter-spacing:.1em;color:var(--fg-dim);opacity:.55;margin:0;line-height:1}
.ad-slot__body{width:100%;display:flex;justify-content:center;align-items:center;min-height:50px;background:var(--bg2);border:1px solid var(--border);border-radius:8px;overflow:hidden;padding:4px}
@media(max-width:767px){
  .ad-slot__body{min-height:50px;max-width:100%}
  .ad-slot--mid .ad-slot__body{min-height:100px}
}
@media(min-width:768px){
  .ad-slot__body{min-height:90px;max-width:970px}
  .ad-slot--mid .ad-slot__body{min-height:250px;max-width:728px}
  .ad-slot--bottom .ad-slot__body{min-height:90px;max-width:970px}
}
</style>`;
}
const _COMMON_STYLES = renderCommonStyles();

// ── Client-side tracking JS ──────────────────────────────────────────────────
/**
 * Semua request browser diarahkan ke proxy Worker (/w/like/{id}, /w/watch/{id})
 * sehingga DAPUR_API_KEY TIDAK pernah terekspos ke browser.
 *
 * Proxy handler: handleProxyLike / handleProxyWatch (lihat _fetch router).
 *
 *  - POST /w/like/{id}   → Worker proxy → Dapur record-like
 *  - POST /w/watch/{id}  → Worker proxy → Dapur record-watch-time  (video only)
 *  - record-view         → dikirim dari sisi Worker, tidak butuh JS browser
 */
// FIX SECURITY 5: tambah nonce agar script bisa divalidasi browser via CSP
function renderTrackingJs(mediaId, isVideo, nonce) {
  const safeId = parseInt(mediaId, 10) || 0;
  if (!safeId) return '';
  const nonceAttr = nonce ? ` nonce="${nonce}"` : '';

  // Semua endpoint relatif — tidak ada domain/key yang terekspos
  return `<script${nonceAttr}>
(function(){
  var MID = ${safeId};

  // ── Like button ──────────────────────────────────────────────────────────
  var likeBtn = document.getElementById('like-btn');
  if (likeBtn) {
    likeBtn.addEventListener('click', function() {
      if (likeBtn.dataset.liked) return;
      likeBtn.dataset.liked = '1';
      likeBtn.disabled = true;
      fetch('/w/like/'+MID, { method:'POST' })
        .then(function(r){ return r.ok ? r.json() : Promise.reject(r.status); })
        .then(function(d){
          var cnt = document.getElementById('like-count');
          if (cnt && d.likes != null) cnt.textContent = d.likes;
          likeBtn.classList.add('liked');
          likeBtn.title = 'Sudah disukai';
        })
        .catch(function(){
          likeBtn.disabled = false;
          delete likeBtn.dataset.liked;
        });
    });
  }

  ${isVideo ? `
  // ── Watch time (video only) ──────────────────────────────────────────────
  var watchStart = Date.now();
  var watchSent  = 0;
  var INTERVAL   = 30000; // 30 detik

  function sendWatchTime(seconds) {
    if (seconds < 5) return;
    // Gunakan Blob agar Content-Type: application/json dikirim dengan benar
    var payload = new Blob([JSON.stringify({ seconds: seconds })], { type: 'application/json' });
    if (navigator.sendBeacon) {
      navigator.sendBeacon('/w/watch/'+MID, payload);
    } else {
      fetch('/w/watch/'+MID, { method:'POST', body: payload, keepalive:true }).catch(function(){});
    }
  }

  var watchTimer = setInterval(function(){
    var elapsed = Math.floor((Date.now() - watchStart) / 1000);
    var delta   = elapsed - watchSent;
    if (delta > 0) { sendWatchTime(delta); watchSent = elapsed; }
  }, INTERVAL);

  window.addEventListener('pagehide', function(){
    clearInterval(watchTimer);
    var elapsed = Math.floor((Date.now() - watchStart) / 1000);
    var delta   = elapsed - watchSent;
    if (delta > 0) sendWatchTime(delta);
  });
  ` : ''}
})();
</script>`;
}

// ── Proxy handlers: /w/like/{id} dan /w/watch/{id} ──────────────────────────
// Browser POST ke sini → Worker teruskan ke Dapur dengan API key (tidak terekspos).
async function handleProxyLike(cfg, id) {
  if (!id || !cfg.DAPUR_BASE_URL) {
    return new Response(JSON.stringify({ error: 'Bad request' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }
  try {
    // FIX BUG 6: tambahkan timeout agar tidak hang jika Dapur lambat
    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    let resp;
    try {
      resp = await fetch(`${cfg.DAPUR_BASE_URL}/api/v1/record-like/${id}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key':    cfg.DAPUR_API_KEY || '',
          'Origin':       `https://${cfg.WARUNG_DOMAIN}`,
        },
        signal: ctrl.signal,
      });
    } finally { clearTimeout(timer); }
    const data = await resp.json();
    return new Response(JSON.stringify(data), {
      status: resp.ok ? 200 : resp.status,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    logError('handleProxyLike', err);
    return new Response(JSON.stringify({ error: 'Upstream error' }), { status: 502, headers: { 'Content-Type': 'application/json' } });
  }
}

async function handleProxyWatch(cfg, id, request) {
  if (!id || !cfg.DAPUR_BASE_URL) {
    return new Response(JSON.stringify({ error: 'Bad request' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }
  try {
    // Baca body dari browser — harus JSON { seconds: N }
    let body = '{}';
    try { body = await request.text(); } catch { /* keep default */ }

    // FIX BUG 6: timeout pada proxy watch juga
    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    let resp;
    try {
      resp = await fetch(`${cfg.DAPUR_BASE_URL}/api/v1/record-watch-time/${id}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key':    cfg.DAPUR_API_KEY || '',
          'Origin':       `https://${cfg.WARUNG_DOMAIN}`,
        },
        body,
        signal: ctrl.signal,
      });
    } finally { clearTimeout(timer); }
    return new Response(null, { status: resp.ok ? 204 : resp.status, headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    logError('handleProxyWatch', err);
    return new Response(null, { status: 502 });
  }
}

// ── Fire-and-forget: record-view dari Worker (tidak blok response) ───────────
async function recordViewServer(mediaId, cfg) {
  if (!mediaId || !cfg.DAPUR_BASE_URL) return;
  try {
    await fetch(`${cfg.DAPUR_BASE_URL}/api/v1/record-view/${mediaId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key':    cfg.DAPUR_API_KEY || '',
        'Origin':       `https://${cfg.WARUNG_DOMAIN}`,
      },
    });
  } catch { /* silent */ }
}

// ── Page handlers ────────────────────────────────────────────────────────────

async function handleHome(request, cfg, client, url) {
  const page   = parseInt(url.searchParams.get('page'),10) || 1;
  const nonce  = generateNonce();
  const mobile = isMobileRequest(request);

  const [latestRes, trendingRes] = await Promise.all([
    client.getMediaList({ per_page: cfg.ITEMS_PER_PAGE, page, sort: 'newest' }),
    page === 1 ? client.getTrending(cfg.TRENDING_COUNT) : Promise.resolve(null),
  ]);

  const items    = latestRes?.data || [];
  const trending = trendingRes?.data || [];
  const meta     = latestRes?.meta  || {};

  const canonical = makeCanonical(url.pathname + (page > 1 ? '?page='+page : ''), cfg);
  const schema    = [websiteSchema(cfg)];

  const trendingSection = trending.length ? `
<section class="section">
  <h2 class="section-title">🔥 Trending</h2>
  ${renderGrid(trending, cfg)}
</section>` : '';

  const head = renderHead({
    title:    page > 1 ? `${cfg.WARUNG_NAME} — Halaman ${page}` : cfg.WARUNG_NAME,
    desc:     cfg.SEO_DEFAULT_DESC,
    keywords: cfg.SEO_KEYWORDS,
    canonical,
    schema,
    nonce,
    cfg,
  });

  const pagination = renderPagination(meta, page, url.pathname);

  const html = head + renderNav(cfg) + `
<main class="container main-content">
  ${renderAdSlot('top', cfg, mobile)}
  ${trendingSection}
  ${trendingSection ? renderAdSlot('mid', cfg, mobile) : ''}
  <section class="section">
    <h2 class="section-title">Konten Terbaru</h2>
    ${renderGrid(items, cfg)}
    ${pagination}
  </section>
  ${renderAdSlot('bottom', cfg, mobile)}
</main>` + renderFooter(cfg) + _COMMON_STYLES + '</body></html>';

  return htmlResponse(html);
}

// ── Video / Content view ──────────────────────────────────────────────────────
async function handleView(request, cfg, client, url, id, ctx) {
  const nonce  = generateNonce();
  const mobile = isMobileRequest(request);
  const [mediaRes, relatedRes] = await Promise.all([
    client.getMedia(id),
    client.getRelated(id, cfg.RELATED_COUNT),
  ]);

  const item    = mediaRes?.data;
  const related = relatedRes?.data || [];   // sudah di-fetch, di-pass ke album agar tidak double

  if (!item) return notFound(cfg);

  // Jika konten adalah album — delegate ke handler galeri, pass related agar tidak double-fetch
  if (item.type === 'album') {
    return handleAlbumView(request, cfg, client, url, id, item, related, ctx);
  }

  const canonical = makeCanonical(itemUrl(item, cfg), cfg);
  const schema    = [
    breadcrumbSchema([
      { name: cfg.WARUNG_NAME, url: 'https://'+cfg.WARUNG_DOMAIN },
      { name: item.title,      url: canonical },
    ]),
    videoSchema(item, canonical, cfg),
  ].filter(Boolean);

  const thumb = safeThumb(item, cfg);
  const tags  = parseTags(item.tags);
  const tagHtml = tags.length
    ? `<div class="tag-list">${tags.map(t=>`<a href="${h(tagUrl(t,cfg))}" class="tag-pill">${h(t)}</a>`).join('')}</div>`
    : '';

  const embedHtml = item.embed_url
    ? `<div class="player-wrap"><iframe src="${h(safeUrl(item.embed_url))}" frameborder="0" allowfullscreen loading="lazy" title="${h(item.title)}"></iframe></div>`
    : (thumb ? `<div class="player-wrap"><img src="${h(thumb)}" alt="${h(item.title)}" class="hero-img" loading="eager"></div>` : '');

  const head = renderHead({
    title:    item.title,
    desc:     item.description || item.title,
    keywords: tags.join(', ') || cfg.SEO_KEYWORDS,
    canonical,
    ogImage:  thumb,
    ogType:   'video.other',
    schema,
    nonce,
    cfg,
  });

  const relatedSection = related.length
    ? `<section class="section"><h2 class="section-title">Konten Terkait</h2>${renderGrid(related, cfg)}</section>`
    : '';

  const html = head + renderNav(cfg) + `
<main class="container main-content">
  ${renderAdSlot('top', cfg, mobile)}
  <article class="view-article">
    ${embedHtml}
    <div class="view-info">
      <h1 class="view-title">${h(item.title)}</h1>
      <div class="view-meta">
        ${item.views   ? `<span>👁 <span id="view-count">${formatViews(item.views)}</span></span>` : ''}
        ${item.likes   ? `<span>❤️ <span id="like-count">${numberFormat(item.likes)}</span></span>` : ''}
        ${item.duration ? `<span>⏱ ${formatDuration(item.duration)}</span>` : ''}
        ${item.created_at ? `<span>📅 ${formatDate(item.created_at)}</span>` : ''}
      </div>
      <div class="view-actions">
        <button id="like-btn" class="like-btn" title="Suka konten ini" aria-label="Suka">
          ❤️ Suka
        </button>
      </div>
      ${tagHtml}
      ${item.description ? `<div class="view-desc">${nl2br(h(item.description))}</div>` : ''}
    </div>
  </article>
  ${renderAdSlot('mid', cfg, mobile)}
  ${relatedSection}
  ${renderAdSlot('bottom', cfg, mobile)}
</main>` + renderFooter(cfg) + _COMMON_STYLES + `
<style>
.player-wrap{width:100%;aspect-ratio:16/9;background:#000;border-radius:8px;overflow:hidden;margin-bottom:20px}
.player-wrap iframe,.hero-img{width:100%;height:100%;object-fit:cover}
.view-article{max-width:900px;margin:0 auto;padding:24px 0}
.view-title{font-size:1.4rem;font-weight:700;line-height:1.3;margin-bottom:12px}
.view-meta{display:flex;gap:12px;color:var(--fg-dim);font-size:.85rem;flex-wrap:wrap;margin-bottom:12px}
.view-actions{margin-bottom:16px}
.like-btn{background:var(--bg3);border:1px solid var(--border);color:var(--fg);padding:8px 20px;border-radius:99px;font-size:.9rem;cursor:pointer;transition:all .2s}
.like-btn:hover,.like-btn.liked{background:var(--accent);border-color:var(--accent);color:#fff}
.view-desc{color:var(--fg-dim);font-size:.95rem;line-height:1.7;margin-top:16px}
.tag-list{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px}
.tag-pill{background:var(--bg3);color:var(--fg-dim);padding:4px 12px;border-radius:99px;font-size:.8rem;border:1px solid var(--border)}
.tag-pill:hover{color:var(--accent);border-color:var(--accent)}
</style>` +
renderTrackingJs(item.id, true, nonce) +
`</body></html>`;

  // Fire-and-forget view record dari server
  // ctx di-pass langsung dari _fetch sehingga waitUntil tersedia
  if (ctx?.waitUntil) {
    ctx.waitUntil(recordViewServer(item.id, cfg));
  } else {
    recordViewServer(item.id, cfg).catch(()=>{});
  }

  return htmlResponse(html);
}

// ── Album / Gallery view ──────────────────────────────────────────────────────
// preloadedItem   : item media sudah di-fetch handleView — skip re-fetch basic info
// preloadedRelated: related sudah di-fetch handleView — skip fetch kedua
// ctx             : FIX BUG 2 — diteruskan dari _fetch agar waitUntil tersedia
async function handleAlbumView(request, cfg, client, url, id, preloadedItem, preloadedRelated, ctx) {
  const nonce  = generateNonce();
  const mobile = isMobileRequest(request);

  // FIX PERF 9 (klarifikasi): /album/{id} SELALU di-fetch karena endpoint ini
  // adalah satu-satunya sumber `photos`. /media/{id} (preloadedItem) tidak
  // mengandung array foto — jadi fetch ini tidak redundan.
  // preloadedRelated dari handleView di-reuse untuk hemat 1 API call.
  // preloadedItem hanya dipakai sebagai fallback metadata jika album endpoint gagal.
  const [albumRes, related] = await Promise.all([
    client.getAlbum(id),
    preloadedRelated !== undefined
      ? Promise.resolve(preloadedRelated)
      : client.getRelated(id, cfg.RELATED_COUNT).then(r => r?.data ?? []),
  ]);

  const album  = albumRes?.data;
  // FIX BUG 1: gunakan preloadedItem jika album fetch tidak mengembalikan data lengkap
  const item   = (album && (album.title || album.id)) ? album : (preloadedItem || album);
  const photos = album?.photos || albumRes?.photos || [];

  if (!item) return notFound(cfg);

  const canonical = makeCanonical(albumUrl(item.id, item.title, cfg), cfg);
  const thumb = safeThumb(item, cfg) || (photos[0]?.url || photos[0] || '');
  const tags  = parseTags(item.tags);

  const schema = [
    breadcrumbSchema([
      { name: cfg.WARUNG_NAME, url: 'https://'+cfg.WARUNG_DOMAIN },
      { name: 'Galeri',        url: 'https://'+cfg.WARUNG_DOMAIN+'/'+cfg.PATH_ALBUM },
      { name: item.title,      url: canonical },
    ]),
    imageGallerySchema(item, photos, canonical, cfg),
  ].filter(Boolean);

  const tagHtml = tags.length
    ? `<div class="tag-list">${tags.map(t=>`<a href="${h(tagUrl(t,cfg))}" class="tag-pill">${h(t)}</a>`).join('')}</div>`
    : '';

  // Gallery HTML — lightbox sederhana
  const galleryHtml = photos.length
    ? `<div class="photo-grid">
        ${photos.map((p, i) => {
          const src = _absUrl(p.url || p.src || (typeof p === 'string' ? p : ''), cfg.WARUNG_DOMAIN);
          const alt = h(p.caption || p.alt || `${item.title} — foto ${i+1}`);
          return src
            ? `<a class="photo-item" href="${h(src)}" data-index="${i}" data-lightbox="album">
                <img src="${h(src)}" alt="${alt}" loading="lazy" decoding="async" width="400" height="300">
               </a>`
            : '';
        }).join('')}
      </div>`
    : `<p class="empty-msg">Foto belum tersedia.</p>`;

  const head = renderHead({
    title:    `${item.title} — Galeri Foto`,
    desc:     item.description || `Lihat ${photos.length} foto dalam album ${item.title}.`,
    keywords: tags.join(', ') || cfg.SEO_KEYWORDS,
    canonical,
    ogImage:  thumb,
    ogType:   'article',
    schema,
    nonce,
    cfg,
  });

  const relatedSection = related.length
    ? `<section class="section"><h2 class="section-title">Konten Terkait</h2>${renderGrid(related, cfg)}</section>`
    : '';

  const html = head + renderNav(cfg) + `
<main class="container main-content">
  ${renderAdSlot('top', cfg, mobile)}
  <article class="album-article">
    ${thumb ? `<div class="album-hero"><img src="${h(thumb)}" alt="${h(item.title)}" class="album-cover" loading="eager"></div>` : ''}
    <div class="album-info">
      <span class="album-badge">📷 Album</span>
      <h1 class="view-title">${h(item.title)}</h1>
      <div class="view-meta">
        ${photos.length ? `<span>🖼 ${photos.length} foto</span>` : ''}
        ${item.views ? `<span>👁 ${formatViews(item.views)} dilihat</span>` : ''}
        ${item.created_at ? `<span>📅 ${formatDate(item.created_at)}</span>` : ''}
      </div>
      <div class="view-actions">
        <button id="like-btn" class="like-btn" title="Suka album ini" aria-label="Suka">
          ❤️ <span id="like-count">${numberFormat(item.likes||0)}</span> Suka
        </button>
      </div>
      ${tagHtml}
      ${item.description ? `<div class="view-desc">${nl2br(h(item.description))}</div>` : ''}
    </div>
    <div class="album-gallery-wrap">
      <h2 class="section-title" style="margin-bottom:16px">📸 Semua Foto</h2>
      ${galleryHtml}
    </div>
  </article>
  ${renderAdSlot('mid', cfg, mobile)}
  ${relatedSection}
  ${renderAdSlot('bottom', cfg, mobile)}
</main>` + renderFooter(cfg) + _COMMON_STYLES + `
<style>
.album-article{max-width:1100px;margin:0 auto;padding:24px 0}
.album-hero{margin-bottom:20px;border-radius:10px;overflow:hidden;max-height:400px}
.album-cover{width:100%;height:100%;object-fit:cover;border-radius:10px}
.album-info{margin-bottom:28px}
.album-badge{background:#7c3aed;color:#fff;font-size:.75rem;font-weight:700;padding:3px 10px;border-radius:4px;margin-bottom:10px;display:inline-block}
.view-title{font-size:1.4rem;font-weight:700;line-height:1.3;margin-bottom:12px}
.view-meta{display:flex;gap:12px;color:var(--fg-dim);font-size:.85rem;flex-wrap:wrap;margin-bottom:12px}
.view-actions{margin-bottom:16px}
.like-btn{background:var(--bg3);border:1px solid var(--border);color:var(--fg);padding:8px 20px;border-radius:99px;font-size:.9rem;cursor:pointer;transition:all .2s}
.like-btn:hover,.like-btn.liked{background:var(--accent);border-color:var(--accent);color:#fff}
.view-desc{color:var(--fg-dim);font-size:.95rem;line-height:1.7;margin-top:16px}
.tag-list{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px}
.tag-pill{background:var(--bg3);color:var(--fg-dim);padding:4px 12px;border-radius:99px;font-size:.8rem;border:1px solid var(--border)}
.tag-pill:hover{color:var(--accent);border-color:var(--accent)}
/* Photo grid */
.photo-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:8px}
@media(min-width:480px){.photo-grid{grid-template-columns:repeat(3,1fr)}}
@media(min-width:768px){.photo-grid{grid-template-columns:repeat(4,1fr)}}
@media(min-width:1024px){.photo-grid{grid-template-columns:repeat(5,1fr)}}
.photo-item{display:block;border-radius:6px;overflow:hidden;aspect-ratio:4/3;background:var(--bg3);cursor:zoom-in;transition:opacity .2s}
.photo-item:hover{opacity:.85}
.photo-item img{width:100%;height:100%;object-fit:cover}
/* Simple lightbox */
.lb-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.92);z-index:9999;align-items:center;justify-content:center;flex-direction:column}
.lb-overlay.active{display:flex}
.lb-img{max-width:92vw;max-height:85vh;object-fit:contain;border-radius:6px}
.lb-close{position:absolute;top:16px;right:20px;color:#fff;font-size:2rem;cursor:pointer;background:none;border:none;line-height:1}
.lb-nav{display:flex;gap:24px;margin-top:16px}
.lb-btn{background:var(--bg2);border:1px solid var(--border);color:#fff;padding:8px 20px;border-radius:6px;cursor:pointer;font-size:1rem}
.lb-btn:hover{border-color:var(--accent);color:var(--accent)}
.lb-counter{color:var(--fg-dim);font-size:.85rem;margin-top:8px}
</style>
<div class="lb-overlay" id="lb-overlay" role="dialog" aria-modal="true">
  <button class="lb-close" id="lb-close" aria-label="Tutup">&times;</button>
  <img class="lb-img" id="lb-img" src="" alt="">
  <div class="lb-nav">
    <button class="lb-btn" id="lb-prev">← Sebelumnya</button>
    <button class="lb-btn" id="lb-next">Berikutnya →</button>
  </div>
  <p class="lb-counter" id="lb-counter"></p>
</div>
<script>
(function(){
  var photos = ${jsStr(photos.map(p => ({
    src: _absUrl(p.url || p.src || (typeof p === 'string' ? p : ''), cfg.WARUNG_DOMAIN),
    alt: p.caption || p.alt || '',
  })))};
  var cur = 0;
  var overlay = document.getElementById('lb-overlay');
  var img     = document.getElementById('lb-img');
  var counter = document.getElementById('lb-counter');

  function show(i) {
    if (!photos.length) return;
    cur = (i + photos.length) % photos.length;
    img.src = photos[cur].src || '';
    img.alt = photos[cur].alt || '';
    counter.textContent = (cur+1) + ' / ' + photos.length;
    overlay.classList.add('active');
    document.body.style.overflow = 'hidden';
  }
  function close() {
    overlay.classList.remove('active');
    document.body.style.overflow = '';
  }

  document.querySelectorAll('[data-lightbox="album"]').forEach(function(a) {
    a.addEventListener('click', function(e) {
      e.preventDefault();
      show(parseInt(a.dataset.index, 10) || 0);
    });
  });

  document.getElementById('lb-close').addEventListener('click', close);
  document.getElementById('lb-prev').addEventListener('click', function(){ show(cur-1); });
  document.getElementById('lb-next').addEventListener('click', function(){ show(cur+1); });
  overlay.addEventListener('click', function(e){ if (e.target === overlay) close(); });
  document.addEventListener('keydown', function(e){
    if (!overlay.classList.contains('active')) return;
    if (e.key === 'Escape') close();
    if (e.key === 'ArrowLeft')  show(cur-1);
    if (e.key === 'ArrowRight') show(cur+1);
  });
})();
</script>` +
renderTrackingJs(item.id, false, nonce) +
`</body></html>`;

  // FIX BUG 2: gunakan ctx.waitUntil agar record-view tidak dibunuh sebelum selesai
  if (ctx?.waitUntil) {
    ctx.waitUntil(recordViewServer(item.id, cfg));
  } else {
    recordViewServer(item.id, cfg).catch(()=>{});
  }
  return htmlResponse(html);
}

// ── Category ─────────────────────────────────────────────────────────────────
async function handleCategory(request, cfg, client, url, type, page) {
  const nonce  = generateNonce();
  const mobile = isMobileRequest(request);
  const res = await client.getMediaList({ type, per_page: cfg.ITEMS_PER_PAGE, page, sort: 'newest' });
  const items   = res?.data || [];
  const meta    = res?.meta || {};
  const typeLabel = type ? ucfirst(type) : 'Semua';
  const canonical = makeCanonical(url.pathname + (page > 1 ? '?page='+page : ''), cfg);

  const head = renderHead({
    title:    `${typeLabel} — ${cfg.WARUNG_NAME}${page>1?' Halaman '+page:''}`,
    desc:     `Koleksi ${typeLabel.toLowerCase()} terbaru di ${cfg.WARUNG_NAME}. Streaming gratis tanpa registrasi.`,
    keywords: `${typeLabel.toLowerCase()}, ${cfg.SEO_KEYWORDS}`,
    canonical,
    schema:   [breadcrumbSchema([{name:cfg.WARUNG_NAME,url:'https://'+cfg.WARUNG_DOMAIN},{name:typeLabel,url:canonical}])],
    nonce,
    cfg,
  });

  const html = head + renderNav(cfg) + `
<main class="container main-content">
  ${renderAdSlot('top', cfg, mobile)}
  <section class="section">
    <h1 class="section-title">${h(typeLabel)}</h1>
    ${meta.total ? `<p class="meta-count">${numberFormat(meta.total)} konten</p>` : ''}
    ${renderGrid(items, cfg)}
    ${renderPagination(meta, page, url.pathname)}
  </section>
  ${renderAdSlot('bottom', cfg, mobile)}
</main>` + renderFooter(cfg) + _COMMON_STYLES + '</body></html>';

  return htmlResponse(html);
}

// ── Tag (satu tag, list konten) ───────────────────────────────────────────────
async function handleTag(request, cfg, client, url, tag, page) {
  const nonce  = generateNonce();
  const mobile = isMobileRequest(request);
  const res = await client.getMediaList({ tag, per_page: cfg.ITEMS_PER_PAGE, page });
  const items   = res?.data || [];
  const meta    = res?.meta || {};
  const canonical = makeCanonical(url.pathname + (page > 1 ? '?page='+page : ''), cfg);

  const head = renderHead({
    title:    `${ucfirst(tag)} — ${cfg.WARUNG_NAME}`,
    desc:     `Konten ${tag} terbaru di ${cfg.WARUNG_NAME}. Temukan koleksi lengkap gratis.`,
    keywords: `${tag}, ${cfg.SEO_KEYWORDS}`,
    canonical,
    schema:   [breadcrumbSchema([{name:cfg.WARUNG_NAME,url:'https://'+cfg.WARUNG_DOMAIN},{name:ucfirst(tag),url:canonical}])],
    nonce,
    cfg,
  });

  const html = head + renderNav(cfg) + `
<main class="container main-content">
  ${renderAdSlot('top', cfg, mobile)}
  <section class="section">
    <h1 class="section-title">🏷 Tag: ${h(tag)}</h1>
    ${meta.total ? `<p class="meta-count">${numberFormat(meta.total)} konten</p>` : ''}
    ${renderGrid(items, cfg)}
    ${renderPagination(meta, page, url.pathname)}
  </section>
  ${renderAdSlot('bottom', cfg, mobile)}
</main>` + renderFooter(cfg) + _COMMON_STYLES + '</body></html>';

  return htmlResponse(html);
}

// ── Tags listing (semua tag) ──────────────────────────────────────────────────
async function handleTagsList(request, cfg, client, url) {
  const nonce  = generateNonce();
  const res    = await client.getTags({ limit: 200 });
  const tags   = Array.isArray(res?.data) ? res.data : [];
  const canonical = makeCanonical('/'+cfg.PATH_TAGS, cfg);

  const head = renderHead({
    title:    `Semua Tag — ${cfg.WARUNG_NAME}`,
    desc:     `Jelajahi semua tag konten di ${cfg.WARUNG_NAME}.`,
    keywords: cfg.SEO_KEYWORDS,
    canonical,
    schema:   [breadcrumbSchema([{name:cfg.WARUNG_NAME,url:'https://'+cfg.WARUNG_DOMAIN},{name:'Tags',url:canonical}])],
    nonce,
    cfg,
  });

  const tagsHtml = tags.length
    ? `<div class="tags-cloud">
        ${tags.map(t => {
          const name  = typeof t === 'string' ? t : (t.name || t.tag || '');
          const count = typeof t === 'object' ? (t.count || t.total || '') : '';
          if (!name) return '';
          return `<a href="${h(tagUrl(name,cfg))}" class="tag-cloud-item">
            ${h(name)}${count ? `<span class="tag-cloud-count">${count}</span>` : ''}
          </a>`;
        }).join('')}
      </div>`
    : '<p class="empty-msg">Belum ada tag tersedia.</p>';

  const html = head + renderNav(cfg) + `
<main class="container main-content">
  <section class="section">
    <h1 class="section-title">🏷 Semua Tag</h1>
    ${tags.length ? `<p class="meta-count">${tags.length} tag tersedia</p>` : ''}
    ${tagsHtml}
  </section>
</main>` + renderFooter(cfg) + _COMMON_STYLES + `
<style>
.tags-cloud{display:flex;flex-wrap:wrap;gap:10px;padding:8px 0}
.tag-cloud-item{display:inline-flex;align-items:center;gap:6px;background:var(--bg2);border:1px solid var(--border);color:var(--fg-dim);padding:6px 14px;border-radius:99px;font-size:.85rem;transition:all .2s}
.tag-cloud-item:hover{border-color:var(--accent);color:var(--accent);background:var(--bg3)}
.tag-cloud-count{background:var(--bg3);color:var(--fg-dim);font-size:.72rem;padding:1px 7px;border-radius:99px;line-height:1.4}
</style>
</body></html>`;

  return htmlResponse(html);
}

// ── Search ────────────────────────────────────────────────────────────────────
async function handleSearch(request, cfg, client, url) {
  const nonce  = generateNonce();
  const mobile = isMobileRequest(request);
  // FIX SECURITY 3: batasi panjang query — cegah payload besar ke Dapur & HTML bloat
  const q    = (url.searchParams.get('q') || '').trim().slice(0, 200);
  const page = parseInt(url.searchParams.get('page'), 10) || 1;
  const type = url.searchParams.get('type') || '';

  const res   = q ? await client.searchMedia(q, { per_page: cfg.ITEMS_PER_PAGE, page, ...(type?{type}:{}) }) : null;
  const items = res?.data || [];
  const meta  = res?.meta || {};
  const canonical = makeCanonical(url.pathname + (q ? '?q='+encodeURIComponent(q) : ''), cfg);

  const head = renderHead({
    title:    q ? `Hasil "${q}" — ${cfg.WARUNG_NAME}` : `Cari — ${cfg.WARUNG_NAME}`,
    desc:     q ? `Hasil pencarian untuk "${q}" di ${cfg.WARUNG_NAME}.` : `Cari konten di ${cfg.WARUNG_NAME}.`,
    canonical,
    nonce,
    extraMeta: `<meta name="robots" content="noindex, follow">`,
    cfg,
  });

  const searchBox = `
<form class="search-form" method="get" action="${h(urlHelper(cfg.PATH_SEARCH, cfg))}">
  <input class="search-input" type="search" name="q" value="${h(q)}" placeholder="Cari konten..." autocomplete="off" autofocus>
  <button class="search-btn" type="submit">Cari</button>
</form>`;

  const resultsHtml = q
    ? (items.length
        ? renderGrid(items, cfg) + renderPagination(meta, page, url.pathname+'?q='+encodeURIComponent(q))
        : `<p class="empty-msg">Tidak ada hasil untuk "<strong>${h(q)}</strong>".</p>`)
    : '';

  const html = head + renderNav(cfg) + `
<main class="container main-content">
  ${renderAdSlot('top', cfg, mobile)}
  <section class="section">
    <h1 class="section-title">🔍 Cari Konten</h1>
    ${searchBox}
    ${q ? `<p class="meta-count">${meta.total ? numberFormat(meta.total)+' hasil untuk "'+h(q)+'"' : 'Tidak ditemukan'}</p>` : ''}
    ${resultsHtml}
  </section>
  ${renderAdSlot('bottom', cfg, mobile)}
</main>` + renderFooter(cfg) + _COMMON_STYLES + `
<style>
.search-form{display:flex;gap:8px;margin-bottom:24px}
.search-input{flex:1;background:var(--bg2);border:1px solid var(--border);border-radius:6px;padding:10px 16px;color:var(--fg);font-size:1rem;outline:none}
.search-input:focus{border-color:var(--accent)}
.search-btn{background:var(--accent);color:#fff;border:none;border-radius:6px;padding:10px 20px;font-size:1rem;cursor:pointer}
.search-btn:hover{background:var(--accent2)}
</style>
</body></html>`;

  return htmlResponse(html, 200, { 'Cache-Control': 'no-store' });
}

// ── Article list ──────────────────────────────────────────────────────────────
async function handleArticleList(request, cfg, client, url) {
  const nonce  = generateNonce();
  const mobile = isMobileRequest(request);
  const page   = parseInt(url.searchParams.get('page'), 10) || 1;

  const res     = await client.getArticles({ per_page: 20, page });
  const articles = Array.isArray(res?.data) ? res.data : [];
  const meta     = res?.meta || {};
  const canonical = makeCanonical('/'+cfg.PATH_ARTICLE + (page>1?'?page='+page:''), cfg);

  const head = renderHead({
    title:    `Artikel — ${cfg.WARUNG_NAME}${page>1?' Halaman '+page:''}`,
    desc:     `Baca artikel terbaru dari ${cfg.WARUNG_NAME}. Tips, informasi, dan konten menarik setiap hari.`,
    keywords: `artikel, blog, ${cfg.SEO_KEYWORDS}`,
    canonical,
    schema:   [
      breadcrumbSchema([{name:cfg.WARUNG_NAME,url:'https://'+cfg.WARUNG_DOMAIN},{name:'Artikel',url:canonical}]),
      websiteSchema(cfg),
    ],
    nonce,
    cfg,
  });

  const articlesHtml = articles.length
    ? `<div class="article-list">
        ${articles.map(a => {
          const aUrl  = h(articleUrl(a, cfg));
          const thumb = h(_absUrl(a.thumbnail || '', cfg.WARUNG_DOMAIN));
          return `<article class="article-card">
            ${thumb ? `<a href="${aUrl}" class="article-thumb-wrap"><img src="${thumb}" alt="${h(a.title||'')}" loading="lazy" width="320" height="180" class="article-thumb"></a>` : ''}
            <div class="article-card-body">
              <a href="${aUrl}" class="article-card-title">${h(a.title||'')}</a>
              ${a.created_at ? `<p class="article-card-date">📅 ${formatDate(a.created_at)}</p>` : ''}
              ${a.excerpt || a.description ? `<p class="article-card-excerpt">${h(truncate(stripTags(a.excerpt||a.description||''), 120))}</p>` : ''}
              <a href="${aUrl}" class="article-card-more">Baca selengkapnya →</a>
            </div>
          </article>`;
        }).join('')}
      </div>
      ${renderPagination(meta, page, '/'+cfg.PATH_ARTICLE)}`
    : '<p class="empty-msg">Belum ada artikel tersedia.</p>';

  const html = head + renderNav(cfg) + `
<main class="container main-content">
  ${renderAdSlot('top', cfg, mobile)}
  <section class="section">
    <h1 class="section-title">📰 Artikel</h1>
    ${articlesHtml}
  </section>
  ${renderAdSlot('bottom', cfg, mobile)}
</main>` + renderFooter(cfg) + _COMMON_STYLES + `
<style>
.article-list{display:flex;flex-direction:column;gap:24px}
.article-card{display:flex;gap:16px;background:var(--bg2);border:1px solid var(--border);border-radius:10px;overflow:hidden;transition:border-color .2s}
.article-card:hover{border-color:var(--accent)}
.article-thumb-wrap{flex:0 0 180px}
.article-thumb{width:180px;height:120px;object-fit:cover}
.article-card-body{display:flex;flex-direction:column;gap:6px;padding:16px 16px 16px 0;flex:1}
.article-card-title{font-size:1.05rem;font-weight:700;color:var(--fg);line-height:1.4}
.article-card-title:hover{color:var(--accent)}
.article-card-date{color:var(--fg-dim);font-size:.8rem}
.article-card-excerpt{color:var(--fg-dim);font-size:.88rem;line-height:1.55}
.article-card-more{color:var(--accent);font-size:.85rem;margin-top:auto}
@media(max-width:480px){
  .article-card{flex-direction:column}
  .article-thumb-wrap{flex:unset}
  .article-thumb{width:100%;height:180px}
  .article-card-body{padding:12px}
}
</style>
</body></html>`;

  return htmlResponse(html);
}

// ── Article detail ────────────────────────────────────────────────────────────
async function handleArticleDetail(request, cfg, client, url, slug) {
  const nonce  = generateNonce();
  const mobile = isMobileRequest(request);

  const res     = await client.getArticle(slug);
  const article = res?.data;

  if (!article) return notFound(cfg);

  const canonical = makeCanonical(articleUrl(article, cfg), cfg);
  const thumb     = _absUrl(article.thumbnail || '', cfg.WARUNG_DOMAIN);
  const tags      = parseTags(article.tags);

  const schema = [
    breadcrumbSchema([
      { name: cfg.WARUNG_NAME, url: 'https://'+cfg.WARUNG_DOMAIN },
      { name: 'Artikel',       url: 'https://'+cfg.WARUNG_DOMAIN+'/'+cfg.PATH_ARTICLE },
      { name: article.title,   url: canonical },
    ]),
    articleSchema(article, canonical, cfg),
  ];

  const head = renderHead({
    title:    article.title,
    desc:     article.excerpt || truncate(stripTags(article.content||''), 160),
    keywords: tags.join(', ') || cfg.SEO_KEYWORDS,
    canonical,
    ogImage:  thumb,
    ogType:   'article',
    schema,
    nonce,
    cfg,
    extraMeta: article.created_at
      ? `<meta property="article:published_time" content="${isoDate(article.created_at)}">
         <meta property="article:modified_time"  content="${isoDate(article.updated_at || article.created_at)}">`
      : '',
  });

  const tagHtml = tags.length
    ? `<div class="tag-list">${tags.map(t=>`<a href="${h(tagUrl(t,cfg))}" class="tag-pill">${h(t)}</a>`).join('')}</div>`
    : '';

  // FIX SECURITY 6: content_html dari server diinjeksi langsung — ini disengaja
  // karena CMS Dapur yang bertanggung jawab sanitasi (strip script, event handler, dll).
  // Guard minimal: pastikan tipe string dan batasi ukuran 500KB agar tidak OOM.
  // Jika Dapur belum sanitasi, content_html TIDAK boleh diaktifkan.
  const rawContentHtml = article.content_html;
  const contentHtml = (typeof rawContentHtml === 'string' && rawContentHtml.length <= 512_000)
    ? rawContentHtml
    : nl2br(h(article.content || article.body || ''));

  const html = head + renderNav(cfg) + `
<main class="container main-content">
  ${renderAdSlot('top', cfg, mobile)}
  <article class="article-detail" itemscope itemtype="https://schema.org/Article">
    ${thumb ? `<div class="article-hero"><img src="${h(thumb)}" alt="${h(article.title)}" itemprop="image" loading="eager" class="article-hero-img"></div>` : ''}
    <div class="article-body">
      <h1 class="article-headline" itemprop="headline">${h(article.title)}</h1>
      <div class="article-meta">
        ${article.created_at ? `<span>📅 <time itemprop="datePublished" datetime="${isoDate(article.created_at)}">${formatDate(article.created_at)}</time></span>` : ''}
        ${article.updated_at ? `<span>🔄 Diperbarui ${formatDate(article.updated_at)}</span>` : ''}
        <span itemprop="publisher" itemscope itemtype="https://schema.org/Organization"><span itemprop="name" style="display:none">${h(cfg.WARUNG_NAME)}</span></span>
      </div>
      ${tagHtml}
      <div class="article-content" itemprop="articleBody">
        ${contentHtml}
      </div>
      <div class="article-share">
        <p style="color:var(--fg-dim);font-size:.85rem;margin-bottom:8px">Bagikan artikel ini:</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <a href="https://twitter.com/intent/tweet?url=${encodeURIComponent(canonical)}&text=${encodeURIComponent(article.title)}" target="_blank" rel="noopener noreferrer" class="share-btn share-tw">Twitter</a>
          <a href="https://wa.me/?text=${encodeURIComponent(article.title+' '+canonical)}" target="_blank" rel="noopener noreferrer" class="share-btn share-wa">WhatsApp</a>
          <a href="https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(canonical)}" target="_blank" rel="noopener noreferrer" class="share-btn share-fb">Facebook</a>
        </div>
      </div>
      <p style="margin-top:32px"><a href="${h(urlHelper(cfg.PATH_ARTICLE, cfg))}" style="color:var(--fg-dim);font-size:.9rem">← Semua Artikel</a></p>
    </div>
  </article>
  ${renderAdSlot('bottom', cfg, mobile)}
</main>` + renderFooter(cfg) + _COMMON_STYLES + `
<style>
.article-detail{max-width:800px;margin:0 auto;padding:24px 0}
.article-hero{margin-bottom:24px;border-radius:10px;overflow:hidden}
.article-hero-img{width:100%;max-height:420px;object-fit:cover;border-radius:10px}
.article-headline{font-size:1.6rem;font-weight:700;line-height:1.3;margin-bottom:14px}
.article-meta{display:flex;gap:14px;color:var(--fg-dim);font-size:.82rem;flex-wrap:wrap;margin-bottom:14px}
.article-content{color:var(--fg-dim);font-size:.97rem;line-height:1.8;margin-top:20px}
.article-content h2,.article-content h3{color:var(--fg);margin:24px 0 10px;font-family:var(--font-d)}
.article-content p{margin-bottom:14px}
.article-content img{border-radius:6px;margin:12px 0}
.article-content a{color:var(--accent)}
.article-content ul,.article-content ol{padding-left:20px;margin-bottom:14px}
.article-share{margin-top:40px;padding-top:24px;border-top:1px solid var(--border)}
.share-btn{padding:7px 16px;border-radius:6px;font-size:.85rem;color:#fff;font-weight:600}
.share-tw{background:#1da1f2}
.share-wa{background:#25d366}
.share-fb{background:#1877f2}
.tag-list{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px}
.tag-pill{background:var(--bg3);color:var(--fg-dim);padding:4px 12px;border-radius:99px;font-size:.8rem;border:1px solid var(--border)}
.tag-pill:hover{color:var(--accent);border-color:var(--accent)}
</style>
</body></html>`;

  return htmlResponse(html);
}

// ── Static pages ──────────────────────────────────────────────────────────────
async function handleStaticPage(request, cfg, page, url) {
  const nonce = generateNonce();
  const pages = {
    [cfg.PATH_DMCA]:    { title:'DMCA', content:'Untuk permintaan takedown konten yang melanggar hak cipta, hubungi kami di <a href="mailto:'+h(cfg.CONTACT_EMAIL||'kontak@'+cfg.WARUNG_DOMAIN)+'">'+h(cfg.CONTACT_EMAIL||'kontak@'+cfg.WARUNG_DOMAIN)+'</a>. Kami akan merespons dalam 1×24 jam.' },
    [cfg.PATH_PRIVACY]: { title:'Kebijakan Privasi', content:'Kami menghormati privasi pengguna. Data yang dikumpulkan hanya digunakan untuk meningkatkan layanan dan tidak dibagikan ke pihak ketiga tanpa persetujuan Anda. Cookie digunakan untuk pengalaman pengguna yang lebih baik.' },
    [cfg.PATH_TERMS]:   { title:'Syarat & Ketentuan', content:'Dengan menggunakan situs ini, Anda menyetujui syarat layanan kami. Konten yang tersedia hanya untuk keperluan hiburan. Dilarang mendistribusikan ulang konten tanpa izin.' },
    [cfg.PATH_CONTACT]: { title:'Kontak', content:`Punya pertanyaan atau kerja sama? Hubungi kami:<br><br><strong>Email:</strong> <a href="mailto:${h(cfg.CONTACT_EMAIL||'kontak@'+cfg.WARUNG_DOMAIN)}">${h(cfg.CONTACT_EMAIL||'kontak@'+cfg.WARUNG_DOMAIN)}</a>` },
    [cfg.PATH_ABOUT]:   { title:'Tentang Kami', content:`<strong>${h(cfg.WARUNG_NAME)}</strong> adalah platform streaming gratis terbaik di Indonesia. Kami menyajikan konten berkualitas tinggi yang dapat dinikmati kapan saja dan di mana saja. Misi kami: hiburan terbaik, gratis untuk semua.` },
    [cfg.PATH_FAQ]:     { title:'FAQ', content:`<strong>Apakah situs ini gratis?</strong><br>Ya, sepenuhnya gratis tanpa registrasi.<br><br><strong>Bagaimana cara melaporkan konten?</strong><br>Kirim email ke <a href="mailto:${h(cfg.CONTACT_EMAIL||'kontak@'+cfg.WARUNG_DOMAIN)}">${h(cfg.CONTACT_EMAIL||'kontak@'+cfg.WARUNG_DOMAIN)}</a>.<br><br><strong>Apakah ada aplikasi mobile?</strong><br>Saat ini belum, namun situs kami sudah mobile-friendly.` },
  };

  const info = pages[page];
  if (!info) return null;

  const canonical = makeCanonical('/'+page, cfg);
  const head = renderHead({
    title:    `${info.title} — ${cfg.WARUNG_NAME}`,
    desc:     stripTags(info.content).slice(0,160),
    canonical,
    nonce,
    cfg,
  });

  const html = head + renderNav(cfg) + `
<main class="container main-content">
  <article style="max-width:800px;margin:0 auto;padding:40px 0">
    <h1 style="margin-bottom:24px;font-size:1.6rem">${h(info.title)}</h1>
    <div style="color:var(--fg-dim);line-height:1.8;font-size:.97rem">${info.content}</div>
    <p style="margin-top:32px"><a href="${h(homeUrl(cfg))}" style="color:var(--fg-dim);font-size:.9rem">← Kembali ke Beranda</a></p>
  </article>
</main>` + renderFooter(cfg) + _COMMON_STYLES + '</body></html>';

  return htmlResponse(html);
}

// ── XML helpers ───────────────────────────────────────────────────────────────
async function handleRobots(cfg, client) {
  const cached = cacheGet('robots:'+cfg.WARUNG_DOMAIN);
  if (cached) return new Response(cached, { headers:{'Content-Type':'text/plain;charset=UTF-8','Cache-Control':'public,max-age=86400'} });

  let body;
  try {
    const res = await client.getRobots();
    body = res?.data?.content || '';
  } catch { body = ''; }

  if (!body) {
    body = [
      'User-agent: *',
      'Allow: /',
      `Disallow: /${cfg.HONEYPOT_PREFIX}/`,
      `Disallow: /${cfg.PATH_SEARCH}`,
      `Sitemap: https://${cfg.WARUNG_DOMAIN}/sitemap.xml`,
      '',
    ].join('\n');
  }

  cacheSet('robots:'+cfg.WARUNG_DOMAIN, body, 86_400_000);
  return new Response(body, { headers:{'Content-Type':'text/plain;charset=UTF-8','Cache-Control':'public,max-age=86400'} });
}

async function handleSitemap(cfg, client, sitemapFile) {
  const cacheKey = `sitemap:${cfg.WARUNG_DOMAIN}:${sitemapFile}`;
  const cached   = cacheGet(cacheKey);
  if (cached) return new Response(cached, { headers:{'Content-Type':'application/xml;charset=UTF-8','Cache-Control':'public,max-age=3600'} });

  let xml;
  try {
    const endpoint = sitemapFile === 'sitemap.xml' ? '/sitemap' : `/sitemap/${sitemapFile.replace('.xml','')}`;
    const res = await client.fetch(endpoint);
    xml = res?.data?.xml || '';
  } catch { xml = ''; }

  if (!xml) {
    xml = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>https://${cfg.WARUNG_DOMAIN}/sitemap-pages.xml</loc></sitemap>
  <sitemap><loc>https://${cfg.WARUNG_DOMAIN}/sitemap-video.xml</loc></sitemap>
</sitemapindex>`;
  }

  cacheSet(cacheKey, xml, 3_600_000);
  return new Response(xml, { headers:{'Content-Type':'application/xml;charset=UTF-8','Cache-Control':'public,max-age=3600'} });
}

async function handleRss(cfg, client) {
  const cacheKey = `rss:${cfg.WARUNG_DOMAIN}`;
  const cached   = cacheGet(cacheKey);
  if (cached) return new Response(cached, { headers:{'Content-Type':'application/rss+xml;charset=UTF-8','Cache-Control':'public,max-age=3600'} });

  // OPT 6: tambah try/catch outer — DapurClient.fetch sudah catch internal,
  // tapi error tak terduga (misal TypeError) bisa masih lolos ke sini.
  let items = [];
  try {
    const res = await client.getMediaList({ per_page: 20, sort: 'newest' });
    items = res?.data || [];
  } catch (err) {
    logError('handleRss.getMediaList', err);
  }

  const rssItems = items.map(item => {
    const link  = absUrl(itemUrl(item, cfg), cfg);
    const thumb = safeThumb(item, cfg);
    return `<item>
  <title><![CDATA[${item.title||''}]]></title>
  <link>${h(link)}</link>
  <guid isPermaLink="true">${h(link)}</guid>
  <pubDate>${new Date(item.created_at||Date.now()).toUTCString()}</pubDate>
  <description><![CDATA[${truncate(item.description||item.title,200)}]]></description>
  ${thumb?`<enclosure url="${h(thumb)}" type="image/jpeg"/>`:''}
</item>`;
  }).join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
  <title><![CDATA[${cfg.WARUNG_NAME}]]></title>
  <link>https://${cfg.WARUNG_DOMAIN}</link>
  <description><![CDATA[${cfg.SEO_DEFAULT_DESC}]]></description>
  <language>${cfg.SEO_LANG}</language>
  <atom:link href="https://${cfg.WARUNG_DOMAIN}/rss.xml" rel="self" type="application/rss+xml"/>
  ${rssItems}
</channel>
</rss>`;

  cacheSet(cacheKey, xml, 3_600_000);
  return new Response(xml, { headers:{'Content-Type':'application/rss+xml;charset=UTF-8','Cache-Control':'public,max-age=3600'} });
}

// ── Main fetch handler ───────────────────────────────────────────────────────
async function _fetch(request, env, ctx) {
  const cfg    = getConfig(env);
  const client = new DapurClient(cfg);
  const url    = new URL(request.url);
  const path   = url.pathname.replace(/\/+$/, '') || '/';
  const parts  = path.split('/').filter(Boolean);
  const first  = parts[0] || '';

  // ── Static assets — pass through ke origin ─────────────────────────────
  if (_STATIC_EXT_RX.test(path)) {
    return fetch(request);
  }

  // ── Handled special paths ───────────────────────────────────────────────
  const filename = parts[parts.length-1] || '';
  if (_HANDLED_PATHS.has(filename) || _HANDLED_PATHS.has(first)) {
    if (filename === 'robots.txt')
      return handleRobots(cfg, client);
    if (filename.startsWith('sitemap') && filename.endsWith('.xml'))
      return handleSitemap(cfg, client, filename);
    if (filename === 'rss.xml' || filename === 'feed.xml' || filename === 'feed')
      return handleRss(cfg, client);
    if (filename === 'site.webmanifest') {
      const manifest = JSON.stringify({
        name:             cfg.WARUNG_NAME,
        short_name:       cfg.WARUNG_NAME,
        start_url:        '/',
        display:          'standalone',
        background_color: cfg.THEME_BG,
        theme_color:      cfg.THEME_ACCENT,
      });
      return new Response(manifest, { headers:{'Content-Type':'application/manifest+json','Cache-Control':'public,max-age=86400'} });
    }
  }

  // ── Routing ─────────────────────────────────────────────────────────────
  try {

    // Home
    if (!first || first === '') {
      return handleHome(request, cfg, client, url);
    }

    // ── Proxy routes (browser → Worker → Dapur, API key tidak terekspos) ──────
    if (first === 'w' && request.method === 'POST') {
      const action = parts[1]; // 'like' atau 'watch'
      const rawPid = parts[2];
      // FIX SECURITY 2: validasi pid harus integer positif — cegah path injection
      const pid = rawPid && /^\d{1,10}$/.test(rawPid) ? rawPid : null;
      if (action === 'like'  && pid) return handleProxyLike(cfg, pid);
      if (action === 'watch' && pid) return handleProxyWatch(cfg, pid, request);
      return new Response('Bad proxy request', { status: 400 });
    }

    // Static pages
    const staticPages = [cfg.PATH_DMCA, cfg.PATH_PRIVACY, cfg.PATH_TERMS, cfg.PATH_CONTACT, cfg.PATH_ABOUT, cfg.PATH_FAQ];
    if (staticPages.includes(first) && parts.length === 1) {
      const res = await handleStaticPage(request, cfg, first, url);
      if (res) return res;
    }

    // Search
    if (first === cfg.PATH_SEARCH) {
      return handleSearch(request, cfg, client, url);
    }

    // Category: /kategori/{type}[/{page}]
    if (first === cfg.PATH_CATEGORY) {
      const type = parts[1] || '';
      const page = parseInt(parts[2], 10) || 1;
      return handleCategory(request, cfg, client, url, type, page);
    }

    // Tag single: /tag/{tag}[/{page}]
    if (first === cfg.PATH_TAG) {
      let tag = '';
      // FIX SECURITY 8: URIError dari %xx invalid → 400 bukan 500
      try { tag = decodeURIComponent(parts[1] || ''); } catch { return notFound(cfg); }
      const page = parseInt(parts[2], 10) || 1;
      if (tag) return handleTag(request, cfg, client, url, tag, page);
    }

    // Tags listing: /tags
    if (first === cfg.PATH_TAGS && parts.length === 1) {
      return handleTagsList(request, cfg, client, url);
    }

    // Content view (video): /tonton/{id}[/{slug}]
    if (first === cfg.PATH_CONTENT) {
      const id = parts[1];
      if (id) return handleView(request, cfg, client, url, id, ctx);
    }

    // Album view: /galeri/{id}[/{slug}]
    if (first === cfg.PATH_ALBUM) {
      const id = parts[1];
      if (id) return handleView(request, cfg, client, url, id, ctx);
      // /galeri tanpa id → kategori album
      return handleCategory(request, cfg, client, url, 'album', parseInt(parts[2],10)||1);
    }

    // Articles list: /artikel
    if (first === cfg.PATH_ARTICLE && parts.length === 1) {
      return handleArticleList(request, cfg, client, url);
    }

    // Article detail: /artikel/{slug}
    if (first === cfg.PATH_ARTICLE && parts[1]) {
      let slug = '';
      // FIX SECURITY 8: URIError dari slug malformed → 404 bukan 500
      try { slug = decodeURIComponent(parts[1]); } catch { return notFound(cfg); }
      return handleArticleDetail(request, cfg, client, url, slug);
    }

    // Honeypot path — return 404 silently
    if (first === cfg.HONEYPOT_PREFIX) {
      return notFound(cfg);
    }

    return notFound(cfg);

  } catch (err) {
    logError('_fetch', err);
    return new Response('Internal Server Error', { status:500 });
  }
}

// ── Scheduled handler ────────────────────────────────────────────────────────
async function _scheduled(event, env, ctx) {
  // Tambahkan tugas berkala di sini jika diperlukan.
  // Contoh: sinkronisasi cache, ping indexing, dll.
}

export default {
  fetch:     _fetch,
  scheduled: _scheduled,
};
