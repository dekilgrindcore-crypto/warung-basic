'use strict';

/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║           WARUNG BASIC — Stripped Worker                               ║
 * ║  Routing + API + SEO standar. Tanpa fitur keren.                       ║
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
  PATH_ALBUM:    'galeri',
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
const _cache = new Map(); // key → { value, expiresAt }

function cacheGet(key) {
  const entry = _cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { _cache.delete(key); return null; }
  return entry.value;
}
function cacheSet(key, value, ttlMs = 300_000) {
  // Bersihkan entries lama kalau cache membengkak
  if (_cache.size >= 300) {
    const now = Date.now();
    for (const [k, v] of _cache) {
      if (now > v.expiresAt) _cache.delete(k);
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

// ── Config helper ────────────────────────────────────────────────────────────
function getConfig(env) {
  const cfg = { ..._DEFAULT_CONFIG };
  for (const key of Object.keys(_DEFAULT_CONFIG)) {
    if (env[key] !== undefined) cfg[key] = env[key];
  }
  // Derive domain & name kalau tidak diset
  if (!cfg.WARUNG_NAME && cfg.WARUNG_DOMAIN)
    cfg.WARUNG_NAME = ucfirst(cfg.WARUNG_DOMAIN.split('.')[0]);
  if (!cfg.WARUNG_BASE_URL && cfg.WARUNG_DOMAIN)
    cfg.WARUNG_BASE_URL = 'https://'+cfg.WARUNG_DOMAIN;
  cfg.DAPUR_DEBUG = String(cfg.DAPUR_DEBUG) === 'true';
  cfg.DAPUR_CACHE_TTL = parseInt(cfg.DAPUR_CACHE_TTL, 10) || 600;
  cfg.ITEMS_PER_PAGE  = parseInt(cfg.ITEMS_PER_PAGE, 10)  || 32;
  cfg.RELATED_COUNT   = parseInt(cfg.RELATED_COUNT, 10)   || 12;
  cfg.TRENDING_COUNT  = parseInt(cfg.TRENDING_COUNT, 10)  || 15;
  cfg._env = env;
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

    // Cek memory cache
    const cached = cacheGet(cacheKey);
    if (cached) return cached;

    try {
      const ctrl  = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 10000);
      let resp;
      try {
        resp = await fetch(url, {
          headers: {
            'X-API-Key':    this.apiKey,
            'Accept':       'application/json',
            'User-Agent':   `WarungClient/1.0 (${this.domain})`,
            'Origin':       `https://${this.domain}`,
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

  // Shorthand helpers
  getHome(params)            { return this.fetch('/media', { sort:'newest', ...params }); }
  getMediaList(params)       { return this.fetch('/media', params); }
  getMedia(id)               { return this.fetch(`/media/${id}`); }
  getTrending(limit=15)      { return this.fetch('/trending', { per_page: limit }); }
  getRelated(id, limit=12)   { return this.fetch(`/related/${id}`, { per_page: limit }); }
  searchMedia(q, params)     { return this.fetch('/search', { q, ...params }); }
  getCategories()            { return this.fetch('/categories'); }
  getTags(params)            { return this.fetch('/tags', params); }
  getSitemap(params)         { return this.fetch('/sitemap', params); }
  getAlbum(id)               { return this.fetch(`/album/${id}`); }
  getRobots()                { return this.fetch('/robots'); }

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
      <a href="${h(searchHref)}">Cari</a>
    </div>
  </nav>
</header>
<style nonce="">
.site-header{background:var(--bg2);border-bottom:1px solid var(--border);position:sticky;top:0;z-index:100}
.nav{display:flex;align-items:center;gap:24px;height:56px}
.nav-logo{font-family:var(--font-d);font-weight:700;font-size:1.2rem;color:var(--fg)}
.nav-links{display:flex;gap:16px;margin-left:auto}
.nav-links a{color:var(--fg-dim);font-size:.95rem;transition:color .2s}
.nav-links a:hover{color:var(--accent)}
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

/**
 * renderAdSlot(position, cfg, isMobile)
 * position: 'top' | 'mid' | 'bottom'
 * Mengembalikan string HTML slot iklan, atau '' jika ADS_ENABLED = false / kode kosong.
 */
function renderAdSlot(position, cfg, isMobile) {
  if (String(cfg.ADS_ENABLED) !== 'true') return '';
  const codeMap = {
    top:    isMobile ? cfg.ADS_CODE_TOP_M    : cfg.ADS_CODE_TOP_D,
    mid:    isMobile ? cfg.ADS_CODE_MID_M    : cfg.ADS_CODE_MID_D,
    bottom: isMobile ? cfg.ADS_CODE_BTM_M    : cfg.ADS_CODE_BTM_D,
  };
  const code = codeMap[position] || '';
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

  return `<article class="card">
  <a href="${url}" class="card-thumb-wrap">
    ${thumb ? `<img src="${thumb}" alt="${title}" loading="lazy" decoding="async" width="320" height="180" class="card-thumb">` : '<div class="card-thumb-placeholder"></div>'}
    ${dur}${isNew}
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

  const pageUrl = (p) => {
    const u = new URL(baseUrl, 'https://dummy.x');
    u.searchParams.set('page', p);
    return u.pathname + u.search;
  };

  let html = `<nav class="pagination" aria-label="Navigasi halaman"><div class="page-links">`;
  if (prev) html += `<a class="page-btn" href="${h(pageUrl(prev))}" rel="prev">← Sebelumnya</a>`;
  html += `<span class="page-cur">Hal. ${cur} / ${total}</span>`;
  if (next) html += `<a class="page-btn" href="${h(pageUrl(next))}" rel="next">Berikutnya →</a>`;
  html += `</div></nav>`;
  return html;
}

// ── Response builder ─────────────────────────────────────────────────────────
function htmlResponse(html, status=200, extraHeaders={}) {
  return new Response(html, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=UTF-8',
      'Cache-Control': 'public, max-age=600, s-maxage=3600, stale-while-revalidate=300',
      'X-Content-Type-Options': 'nosniff',
      ...extraHeaders,
    },
  });
}

function notFound(cfg) {
  const nonce = generateNonce();
  const head  = renderHead({ title:`404 — ${cfg.WARUNG_NAME}`, desc:'Halaman tidak ditemukan.', canonical:'https://'+cfg.WARUNG_DOMAIN+'/404', cfg, nonce });
  return htmlResponse(head + renderNav(cfg) + `<main class="container" style="padding:80px 0;text-align:center"><h1 style="font-size:4rem;color:var(--accent)">404</h1><p style="color:var(--fg-dim);margin-top:12px">Halaman tidak ditemukan.</p><a href="${h(homeUrl(cfg))}" style="display:inline-block;margin-top:24px;padding:10px 24px;background:var(--accent);color:#fff;border-radius:6px">Kembali ke Beranda</a></main>` + renderFooter(cfg) + '</body></html>', 404);
}

// ── JSON-LD schema helpers ───────────────────────────────────────────────────
function websiteSchema(cfg) {
  return {
    '@context': 'https://schema.org',
    '@type':    'WebSite',
    name:  cfg.WARUNG_NAME,
    url:   'https://'+cfg.WARUNG_DOMAIN,
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
      '@type':                'InteractionCounter',
      interactionType:        'https://schema.org/WatchAction',
      userInteractionCount:   item.views,
    } : undefined,
  };
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
    title:     page > 1 ? `${cfg.WARUNG_NAME} — Halaman ${page}` : cfg.WARUNG_NAME,
    desc:      cfg.SEO_DEFAULT_DESC,
    keywords:  cfg.SEO_KEYWORDS,
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
</main>` + renderFooter(cfg) + renderCommonStyles() + '</body></html>';

  return htmlResponse(html);
}

async function handleView(request, cfg, client, url, id) {
  const nonce  = generateNonce();
  const mobile = isMobileRequest(request);
  const [mediaRes, relatedRes] = await Promise.all([
    client.getMedia(id),
    client.getRelated(id, cfg.RELATED_COUNT),
  ]);

  const item    = mediaRes?.data;
  const related = relatedRes?.data || [];

  if (!item) return notFound(cfg);

  const canonical = makeCanonical(itemUrl(item, cfg), cfg);
  const schema    = [
    breadcrumbSchema([
      { name: cfg.WARUNG_NAME, url: 'https://'+cfg.WARUNG_DOMAIN },
      { name: item.title, url: canonical },
    ]),
    videoSchema(item, canonical, cfg),
  ].filter(Boolean);

  const thumb = safeThumb(item, cfg);
  const tags  = Array.isArray(item.tags) ? item.tags : [];
  const tagHtml = tags.length
    ? `<div class="tag-list">${tags.map(t=>`<a href="${h(tagUrl(t,cfg))}" class="tag-pill">${h(t)}</a>`).join('')}</div>`
    : '';

  const embedHtml = item.embed_url
    ? `<div class="player-wrap"><iframe src="${h(safeUrl(item.embed_url))}" frameborder="0" allowfullscreen loading="lazy" title="${h(item.title)}"></iframe></div>`
    : (thumb ? `<div class="player-wrap"><img src="${h(thumb)}" alt="${h(item.title)}" class="hero-img"></div>` : '');

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
        ${item.views ? `<span>${formatViews(item.views)} penonton</span>` : ''}
        ${item.duration ? `<span>${formatDuration(item.duration)}</span>` : ''}
        ${item.created_at ? `<span>${formatDate(item.created_at)}</span>` : ''}
      </div>
      ${tagHtml}
      ${item.description ? `<div class="view-desc">${nl2br(h(item.description))}</div>` : ''}
    </div>
  </article>
  ${renderAdSlot('mid', cfg, mobile)}
  ${relatedSection}
  ${renderAdSlot('bottom', cfg, mobile)}
</main>` + renderFooter(cfg) + renderCommonStyles() + `
<style>
.player-wrap{width:100%;aspect-ratio:16/9;background:#000;border-radius:8px;overflow:hidden;margin-bottom:20px}
.player-wrap iframe,.hero-img{width:100%;height:100%;object-fit:cover}
.view-article{max-width:900px;margin:0 auto;padding:24px 0}
.view-title{font-size:1.4rem;font-weight:700;line-height:1.3;margin-bottom:12px}
.view-meta{display:flex;gap:12px;color:var(--fg-dim);font-size:.85rem;flex-wrap:wrap;margin-bottom:12px}
.view-desc{color:var(--fg-dim);font-size:.95rem;line-height:1.7;margin-top:16px}
.tag-list{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px}
.tag-pill{background:var(--bg3);color:var(--fg-dim);padding:4px 12px;border-radius:99px;font-size:.8rem;border:1px solid var(--border)}
.tag-pill:hover{color:var(--accent);border-color:var(--accent)}
</style>
</body></html>`;

  return htmlResponse(html);
}

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
    ${meta.total ? `<p class="meta-count" style="color:var(--fg-dim);font-size:.85rem;margin-bottom:16px">${numberFormat(meta.total)} konten</p>` : ''}
    ${renderGrid(items, cfg)}
    ${renderPagination(meta, page, url.pathname)}
  </section>
  ${renderAdSlot('bottom', cfg, mobile)}
</main>` + renderFooter(cfg) + renderCommonStyles() + '</body></html>';

  return htmlResponse(html);
}

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
    <h1 class="section-title">Tag: ${h(tag)}</h1>
    ${renderGrid(items, cfg)}
    ${renderPagination(meta, page, url.pathname)}
  </section>
  ${renderAdSlot('bottom', cfg, mobile)}
</main>` + renderFooter(cfg) + renderCommonStyles() + '</body></html>';

  return htmlResponse(html);
}

async function handleSearch(request, cfg, client, url) {
  const nonce  = generateNonce();
  const mobile = isMobileRequest(request);
  const q    = (url.searchParams.get('q') || '').trim();
  const page = parseInt(url.searchParams.get('page'), 10) || 1;
  const type = url.searchParams.get('type') || '';

  const res   = q ? await client.searchMedia(q, { per_page: cfg.ITEMS_PER_PAGE, page, ...(type?{type}:{}) }) : null;
  const items = res?.data || [];
  const meta  = res?.meta || {};
  const canonical = makeCanonical(url.pathname + (q ? '?q='+encodeURIComponent(q) : ''), cfg);

  const head = renderHead({
    title:    q ? `Hasil "${h(q)}" — ${cfg.WARUNG_NAME}` : `Cari — ${cfg.WARUNG_NAME}`,
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
    ? (items.length ? renderGrid(items, cfg) + renderPagination(meta, page, url.pathname+'?q='+encodeURIComponent(q))
                    : `<p class="empty-msg">Tidak ada hasil untuk "<strong>${h(q)}</strong>".</p>`)
    : '';

  const html = head + renderNav(cfg) + `
<main class="container main-content">
  ${renderAdSlot('top', cfg, mobile)}
  <section class="section">
    <h1 class="section-title">Cari Konten</h1>
    ${searchBox}
    ${q ? `<p style="color:var(--fg-dim);font-size:.85rem;margin-bottom:16px">${meta.total ? numberFormat(meta.total)+' hasil untuk "'+h(q)+'"' : 'Mencari...'}</p>` : ''}
    ${resultsHtml}
  </section>
  ${renderAdSlot('bottom', cfg, mobile)}
</main>` + renderFooter(cfg) + renderCommonStyles() + `
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

async function handleStaticPage(request, cfg, page, url) {
  const nonce = generateNonce();
  const pages = {
    [cfg.PATH_DMCA]:    { title:'DMCA', content:'Untuk permintaan takedown, hubungi kami di '+h(cfg.CONTACT_EMAIL||'kontak@'+cfg.WARUNG_DOMAIN) },
    [cfg.PATH_PRIVACY]: { title:'Kebijakan Privasi', content:'Kami menghormati privasi pengguna. Data tidak dibagikan ke pihak ketiga.' },
    [cfg.PATH_TERMS]:   { title:'Syarat & Ketentuan', content:'Dengan menggunakan situs ini, Anda menyetujui syarat layanan kami.' },
    [cfg.PATH_CONTACT]: { title:'Kontak', content:'Email: '+h(cfg.CONTACT_EMAIL||'kontak@'+cfg.WARUNG_DOMAIN) },
    [cfg.PATH_ABOUT]:   { title:'Tentang Kami', content:`${h(cfg.WARUNG_NAME)} adalah platform streaming gratis terbaik.` },
    [cfg.PATH_FAQ]:     { title:'FAQ', content:'Pertanyaan umum seputar layanan kami.' },
  };

  const info = pages[page];
  if (!info) return null;

  const canonical = makeCanonical('/'+page, cfg);
  const head = renderHead({
    title:    `${info.title} — ${cfg.WARUNG_NAME}`,
    desc:     info.content.replace(/<[^>]+>/g,'').slice(0,160),
    canonical,
    nonce,
    cfg,
  });

  const html = head + renderNav(cfg) + `
<main class="container main-content">
  <article style="max-width:800px;margin:0 auto;padding:40px 0">
    <h1 style="margin-bottom:24px">${h(info.title)}</h1>
    <div style="color:var(--fg-dim);line-height:1.8">${info.content}</div>
    <p style="margin-top:32px"><a href="${h(homeUrl(cfg))}">← Kembali ke Beranda</a></p>
  </article>
</main>` + renderFooter(cfg) + renderCommonStyles() + '</body></html>';

  return htmlResponse(html);
}

// ── XML helpers ──────────────────────────────────────────────────────────────
async function handleRobots(cfg, client) {
  const cached = cacheGet('robots:'+cfg.WARUNG_DOMAIN);
  if (cached) return new Response(cached, { headers:{'Content-Type':'text/plain;charset=UTF-8','Cache-Control':'public,max-age=86400'} });

  let body;
  try {
    const res = await client.getRobots();
    body = res?.data?.content || '';
  } catch { body = ''; }

  if (!body) {
    body = `User-agent: *\nAllow: /\nDisallow: /${cfg.HONEYPOT_PREFIX}/\nDisallow: /search\nSitemap: https://${cfg.WARUNG_DOMAIN}/sitemap.xml\n`;
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
</sitemapindex>`;
  }

  cacheSet(cacheKey, xml, 3_600_000);
  return new Response(xml, { headers:{'Content-Type':'application/xml;charset=UTF-8','Cache-Control':'public,max-age=3600'} });
}

async function handleRss(cfg, client) {
  const cacheKey = `rss:${cfg.WARUNG_DOMAIN}`;
  const cached   = cacheGet(cacheKey);
  if (cached) return new Response(cached, { headers:{'Content-Type':'application/rss+xml;charset=UTF-8','Cache-Control':'public,max-age=3600'} });

  const res   = await client.getMediaList({ per_page: 20, sort: 'newest' });
  const items = res?.data || [];

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

// ── Shared CSS styles ────────────────────────────────────────────────────────
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
/* Mobile default: banner pendek 320×50 / 320×100 */
@media(max-width:767px){
  .ad-slot__body{min-height:50px;max-width:100%}
  .ad-slot--mid .ad-slot__body{min-height:100px}
}
/* Desktop: leaderboard 728×90 / medium rectangle */
@media(min-width:768px){
  .ad-slot__body{min-height:90px;max-width:970px}
  .ad-slot--mid .ad-slot__body{min-height:250px;max-width:728px}
  .ad-slot--bottom .ad-slot__body{min-height:90px;max-width:970px}
}
</style>`;
}

// ── Main fetch handler ───────────────────────────────────────────────────────
async function _fetch(request, env, ctx) {
  const cfg    = getConfig(env);
  const client = new DapurClient(cfg);
  const url    = new URL(request.url);
  const path   = url.pathname.replace(/\/+$/, '') || '/';
  const parts  = path.split('/').filter(Boolean);
  const first  = parts[0] || '';

  // ── Static assets — pass through ke origin ──────────────────────────────
  if (_STATIC_EXT_RX.test(path)) {
    return fetch(request);
  }

  // ── Handled special paths ────────────────────────────────────────────────
  const filename = parts[parts.length-1] || '';
  if (_HANDLED_PATHS.has(filename) || _HANDLED_PATHS.has(first)) {
    if (filename === 'robots.txt') return handleRobots(cfg, client);
    if (filename.startsWith('sitemap') && filename.endsWith('.xml')) return handleSitemap(cfg, client, filename);
    if (filename === 'rss.xml' || filename === 'feed.xml' || filename === 'feed') return handleRss(cfg, client);
    if (filename === 'site.webmanifest') {
      const manifest = JSON.stringify({ name: cfg.WARUNG_NAME, short_name: cfg.WARUNG_NAME, start_url:'/', display:'standalone', background_color: cfg.THEME_BG, theme_color: cfg.THEME_ACCENT });
      return new Response(manifest, { headers:{'Content-Type':'application/manifest+json','Cache-Control':'public,max-age=86400'} });
    }
  }

  // ── Routing ──────────────────────────────────────────────────────────────
  try {

    // Home
    if (!first || first === '') {
      return handleHome(request, cfg, client, url);
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

    // Tag: /tag/{tag}[/{page}]
    if (first === cfg.PATH_TAG) {
      const tag  = decodeURIComponent(parts[1] || '');
      const page = parseInt(parts[2], 10) || 1;
      if (tag) return handleTag(request, cfg, client, url, tag, page);
    }

    // Content view: /tonton/{id}[/{slug}]
    if (first === cfg.PATH_CONTENT || first === cfg.PATH_ALBUM) {
      const id = parts[1];
      if (id) return handleView(request, cfg, client, url, id);
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
