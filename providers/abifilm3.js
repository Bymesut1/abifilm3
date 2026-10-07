// ============================================================
//  abifilm3 — Nuvio scraper (filmmakinesi.to) — film + dizi
// ============================================================

var SITE_AYARLARI = {
  PRIMARY_DOMAIN: 'https://filmmakinesi.to',
  EKLENTI_ADI: 'abifilm3',
  // true iken akış bulunamazsa nedenini yazan "DEBUG" satırları çıkar. Her şey çalışınca false yap.
  DEBUG_MODU: true
};

var TMDB_KEY = '000316508321ce461cf81e7c6815eec7';
var PROVIDER_ID = 'abifilm3';
var ANDROID_UA = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Mobile Safari/537.36';

var PAGE_HEADERS = {
  'User-Agent': ANDROID_UA,
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'tr-TR,tr;q=0.9',
  'Referer': SITE_AYARLARI.PRIMARY_DOMAIN + '/'
};

var stage = '';
function log(m) { try { console.log('[abifilm3] ' + m); } catch (e) {} }

// ---------------- Yardımcılar (Promise tabanlı) ----------------

function withTimeout(promise, ms) {
  return new Promise(function (resolve, reject) {
    var t = setTimeout(function () { reject(new Error('timeout')); }, ms);
    promise.then(function (v) { clearTimeout(t); resolve(v); },
                 function (e) { clearTimeout(t); reject(e); });
  });
}

var dbg = [];
var DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function getText(url, headers, label) {
  function once(h) {
    return withTimeout(fetch(url, { headers: h }), 9000).then(function (res) {
      return withTimeout(res.text(), 9000).then(
        function (t) { return { status: res.status, ok: res.ok, text: t || '' }; },
        function () { return { status: res.status, ok: false, text: '' }; }
      );
    }).catch(function (e) { return { status: 0, ok: false, text: '', err: (e && e.message) || 'hata' }; });
  }
  var h = headers || PAGE_HEADERS;
  return once(h).then(function (r) {
    if (!r.ok && (r.status === 0 || r.status === 403 || r.status === 429 || r.status === 503) && /^https?:\/\/(?:[a-z0-9-]+\.)*filmmakinesi\.to/i.test(url)) {
      var h2 = {};
      Object.keys(h).forEach(function (k) { h2[k] = h[k]; });
      h2['User-Agent'] = DESKTOP_UA;
      return once(h2).then(function (r2) { return r2.ok ? r2 : r; });
    }
    return r;
  }).then(function (r) {
    if (label) dbg.push(label + ' ' + (r.status || r.err || '?') + '/' + r.text.length);
    return r.ok ? r.text : '';
  });
}

function decodeHtml(s) {
  return String(s || '').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

var TR_MAP = { 'ç': 'c', 'ğ': 'g', 'ı': 'i', 'ö': 'o', 'ş': 's', 'ü': 'u', 'â': 'a', 'î': 'i', 'û': 'u' };
function asciiLower(s) {
  return String(s || '').replace(/İ/g, 'i').replace(/I/g, 'i').toLowerCase()
    .replace(/[çğıöşüâîû]/g, function (c) { return TR_MAP[c]; });
}
function norm(s) { return asciiLower(s).replace(/[^a-z0-9]/g, ''); }
function slugify(s) { return asciiLower(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); }

function originOf(u) { return (String(u).match(/^https?:\/\/[^\/]+/) || [''])[0]; }

// base64 (kendi uygulamamız, atob'a bağımlı değil)
var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function b64ToBytes(s) {
  s = String(s || '').replace(/-/g, '+').replace(/_/g, '/').replace(/[^A-Za-z0-9+\/]/g, '');
  var out = [], buf = 0, bits = 0;
  for (var i = 0; i < s.length; i++) {
    buf = (buf << 6) | B64.indexOf(s.charAt(i));
    bits += 6;
    if (bits >= 8) { bits -= 8; out.push((buf >> bits) & 255); buf = buf & ((1 << bits) - 1); }
  }
  return out;
}
function bytesToStr(b) {
  var s = '';
  for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return s;
}
function rot13(s) {
  return String(s || '').replace(/[a-zA-Z]/g, function (c) {
    var base = c <= 'Z' ? 65 : 97;
    return String.fromCharCode((c.charCodeAt(0) - base + 13) % 26 + base);
  });
}
function hexUnescape(s) {
  return String(s || '')
    .replace(/\\x([0-9a-fA-F]{2})/g, function (m, h) { return String.fromCharCode(parseInt(h, 16)); })
    .replace(/\\u([0-9a-fA-F]{4})/g, function (m, h) { return String.fromCharCode(parseInt(h, 16)); })
    .replace(/\\\//g, '/');
}

// Sitenin scx token'ı: rot13 -> base64 -> URL
function decodeToken(t) {
  var u = bytesToStr(b64ToBytes(rot13(t)));
  return /^https?:\/\//.test(u) ? u : '';
}

// RapidVid av('...') çözücü: ters çevir -> b64 -> "K9L" anahtarıyla kaydır -> b64
function decodeSecret(input) {
  var rev = String(input).split('').reverse().join('');
  var bytes = b64ToBytes(rev);
  var key = 'K9L', out = [];
  for (var i = 0; i < bytes.length; i++) {
    var off = (key.charCodeAt(i % key.length) % 5) + 1;
    out.push((bytes[i] - off) & 255);
  }
  var inner = bytesToStr(out);
  if (/https?:\/\//.test(inner)) return inner;
  return bytesToStr(b64ToBytes(inner));
}

// eval(function(p,a,c,k,e,d)...) açıcı
function unpackPacked(src) {
  var m = String(src || '').match(/eval\(function\(p,a,c,k,e,d\)\{[\s\S]*?\}\('([\s\S]*?)',(\d+),(\d+),'([\s\S]*?)'\.split\('\|'\)/);
  if (!m) return '';
  var p = m[1].replace(/\\'/g, "'").replace(/\\\\/g, '\\');
  var a = parseInt(m[2], 10), c = parseInt(m[3], 10), k = m[4].split('|');
  function enc(n) {
    return (n < a ? '' : enc(Math.floor(n / a))) +
           ((n = n % a) > 35 ? String.fromCharCode(n + 29) : n.toString(36));
  }
  var d = {};
  while (c--) d[enc(c)] = k[c] || enc(c);
  return p.replace(/\b\w+\b/g, function (w) { return d[w] !== undefined ? d[w] : w; });
}

function unpackAll(text) {
  var list = [String(text || '')], cur = list[0];
  for (var i = 0; i < 3; i++) {
    var u = unpackPacked(cur);
    if (!u) break;
    list.push(u);
    cur = u;
  }
  return list;
}

var BAD_EXT = /\.(vtt|srt|jpg|jpeg|png|webp|gif|css|js|ico|svg)(\?|$)/i;
var CDN_HOST = /^https?:\/\/[^\/]*(?:\.shop|pictabox\.[a-z]+|rapidrame\.[a-z]+|cdnimages?\d*\.[a-z]+|cdnimgs?\d*\.[a-z]+|static\d+\.[a-z]+)(?:[\/:?]|$)/i;

function findStreamUrl(text) {
  text = hexUnescape(text).replace(/&amp;/g, '&');
  var urls = text.match(/https?:\/\/[^\s"'<>\\]+/g) || [];
  var i, u;
  for (i = 0; i < urls.length; i++) {
    u = urls[i];
    if (/\.m3u8/i.test(u) && !BAD_EXT.test(u)) {
      var best = u;
      for (var j = 0; j < urls.length; j++) {
        if (/\.m3u8/i.test(urls[j]) && /master/i.test(urls[j])) { best = urls[j]; break; }
      }
      return { url: best, type: 'hls', quality: 'Auto' };
    }
  }
  for (i = 0; i < urls.length; i++) {
    u = urls[i];
    if (CDN_HOST.test(u) && !BAD_EXT.test(u)) return { url: u, type: 'hls', quality: 'Auto' };
  }
  var f = text.match(/file\s*["']?\s*:\s*["']([^"']+\.mp4[^"']*)["']/);
  if (f) return { url: f[1], type: 'mp4', quality: 'Auto' };
  return null;
}


// ---------------- Eşleştirme ----------------

function nameMatches(siteName, wantList) {
  var a = norm(siteName);
  if (!a) return false;
  var aa = a.replace(/^the/, '');
  for (var i = 0; i < wantList.length; i++) {
    var w = wantList[i], ww = w.replace(/^the/, '');
    if (a === w || aa === ww) return true;
    if (aa.indexOf(ww) === 0 && /^\d{1,2}$/.test(aa.slice(ww.length))) return true;
    if (ww.indexOf(aa) === 0 && /^\d{1,2}$/.test(ww.slice(aa.length))) return true;
    if (w.length >= 7 && a.indexOf(w) > -1) return true;
  }
  return false;
}

// Arama sonucu kartları: <a class="item" href="/film/..." data-title="..."> ... <div class="info"><span>2002</span>
function parseCards(html) {
  var cards = [], re = /<a class="item" href="(\/(?:film|dizi)\/[^"]+)"([^>]*)>([\s\S]*?)<\/a>/g, m;
  while ((m = re.exec(String(html || ''))) !== null) {
    var title = (m[2].match(/data-title="([^"]*)"/) || [])[1] || '';
    var yr = (m[3].match(/<div class="info">\s*<span>(\d{4})/) || [])[1] || '';
    cards.push({
      path: m[1],
      kind: m[1].indexOf('/dizi/') === 0 ? 'tv' : 'movie',
      title: decodeHtml(title).trim(),
      year: parseInt(yr, 10) || 0
    });
  }
  return cards;
}

function findContentPage(kind, title, origTitle, year, imdbId) {
  var y = parseInt(year, 10);
  var want = [norm(title), norm(origTitle)].filter(function (n) { return n && n.length >= 2; });
  var queries = [imdbId, origTitle, title].filter(function (q, i, a) { return q && a.indexOf(q) === i; });

  return Promise.all(queries.map(function (q, qi) {
    return getText(SITE_AYARLARI.PRIMARY_DOMAIN + '/arama/?s=' + encodeURIComponent(q), null, 'S' + (qi + 1));
  })).then(function (results) {
    var all = [], byImdb = [], seen = {};
    results.forEach(function (html, qi) {
      parseCards(html).forEach(function (c) {
        if (c.kind !== kind) return;
        if (qi === 0 && imdbId) byImdb.push(c);
        if (!seen[c.path]) { seen[c.path] = true; all.push(c); }
      });
    });
    dbg.push('kart ' + all.length + (imdbId ? ' imdb:' + byImdb.length : ''));

    function yearOk(c) { return c.year && y && Math.abs(c.year - y) <= 1; }
    function titleOk(c) { return nameMatches(c.title, want); }

    var order = [], used = {};
    function add(c) { if (c && !used[c.path]) { used[c.path] = true; order.push(c); } }
    byImdb.forEach(add);
    all.filter(function (c) { return yearOk(c) && titleOk(c); }).forEach(add);
    all.filter(titleOk).forEach(add);
    all.filter(yearOk).forEach(add);

    var cands = order.slice(0, 4);
    if (!cands.length) return null;

    return Promise.all(cands.map(function (c) {
      return getText(SITE_AYARLARI.PRIMARY_DOMAIN + c.path, null, null);
    })).then(function (pages) {
      cands.forEach(function (c, i) {
        dbg.push('C' + (i + 1) + ' ' + c.year + ' ' + c.title + (pages[i] ? '' : ' (bos)'));
      });
      var i;
      // 1) sayfada IMDb kimliği geçiyorsa kesin doğru
      if (imdbId) {
        for (i = 0; i < cands.length; i++) {
          if (pages[i] && pages[i].indexOf(imdbId) > -1) return { path: cands[i].path, html: pages[i] };
        }
      }
      // 2) yıl + başlık
      for (i = 0; i < cands.length; i++) {
        if (pages[i] && yearOk(cands[i]) && titleOk(cands[i])) return { path: cands[i].path, html: pages[i] };
      }
      // 3) IMDb aramasının ilk sonucu
      if (byImdb.length) {
        for (i = 0; i < cands.length; i++) {
          if (cands[i].path === byImdb[0].path && pages[i]) return { path: cands[i].path, html: pages[i] };
        }
      }
      return null;
    });
  });
}

// ---------------- Kaynakları çıkarma ----------------

function extractParts(html) {
  var list = [], seen = {}, m;
  var re = /<a[^>]*data-video_url="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  while ((m = re.exec(html)) !== null) {
    var u = decodeHtml(m[1]).trim();
    var label = decodeHtml(m[2].replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
    if (/youtube\.com|youtu\.be/.test(u) || /fragman/i.test(label)) continue;
    if (!/^https?:\/\//.test(u) || seen[u]) continue;
    seen[u] = true;
    list.push({ url: u, label: label || 'Kaynak' });
  }
  if (!list.length) {
    var re2 = /<iframe[^>]*data-src="(https?:\/\/[^"]+)"/g;
    while ((m = re2.exec(html)) !== null) {
      var u2 = decodeHtml(m[1]);
      if (/youtube|youtu\.be/.test(u2) || seen[u2]) continue;
      seen[u2] = true;
      list.push({ url: u2, label: 'Kaynak' });
    }
  }
  return list;
}

// ---------------- Çözücüler ----------------

// ---- RapidVid yedek çözücü: anahtar/format değişse de dener ----
function revStr(s) { return String(s).split('').reverse().join(''); }
function hasHttp(x) { return /https?:\/\/[A-Za-z0-9]/.test(x); }

function tryDecodeString(str) {
  var variants = [str, revStr(str), rot13(str), revStr(rot13(str))];
  for (var vi = 0; vi < variants.length; vi++) {
    var bytes = b64ToBytes(variants[vi]);
    if (bytes.length < 12) continue;
    var plain = bytesToStr(bytes);
    if (hasHttp(plain)) return plain;
    var inner0 = bytesToStr(b64ToBytes(plain));
    if (hasHttp(inner0)) return inner0;
    for (var a = 0; a <= 5; a++) for (var b = 0; b <= 5; b++) for (var c = 0; c <= 5; c++) {
      if (!a && !b && !c) continue;
      var off = [a, b, c], out = [];
      for (var i = 0; i < bytes.length; i++) out.push((bytes[i] - off[i % 3]) & 255);
      var s2 = bytesToStr(out);
      if (hasHttp(s2)) return s2;
      if (/^[A-Za-z0-9+\/=_\-]+$/.test(s2)) {
        var s3 = bytesToStr(b64ToBytes(s2));
        if (hasHttp(s3)) return s3;
      }
    }
  }
  return '';
}

function bruteFindStream(texts) {
  var cands = [];
  texts.forEach(function (t) {
    var re = /["']([A-Za-z0-9+\/=_\-]{30,6000})["']/g, m;
    while ((m = re.exec(t)) !== null) {
      if (cands.indexOf(m[1]) === -1) cands.push(m[1]);
    }
  });
  cands.sort(function (x, y) { return y.length - x.length; });
  cands = cands.slice(0, 8);
  dbg.push('RV aday ' + cands.length);
  for (var i = 0; i < cands.length; i++) {
    var d = tryDecodeString(cands[i]);
    if (d) {
      var f = findStreamUrl(d);
      if (f) return f;
      var u = (d.match(/https?:\/\/[^\s"'<>\\]+/) || [])[0];
      if (u && !BAD_EXT.test(u)) return { url: u, type: /\.mp4/i.test(u) ? 'mp4' : 'hls', quality: 'Auto' };
    }
  }
  return null;
}

function rvDiag(html, texts) {
  var t = texts[texts.length - 1];
  var i = t.search(/av\s*\(/);
  dbg.push('RV len=' + html.length + ' paket=' + (texts.length - 1) + ' av=' + (i > -1) +
    ' file=' + /file/.test(t) + ' m3u8=' + /m3u8/.test(t) + ' atob=' + /atob/.test(t));
  if (i > -1) dbg.push('RV av: ' + t.substr(Math.max(0, i - 30), 140));
  var si = html.search(/<script/i);
  dbg.push('RV bas: ' + html.substr(0, 90).replace(/\s+/g, ' '));
  var ss = html.lastIndexOf('<script');
  if (ss > -1) dbg.push('RV son: ' + html.substr(ss, 160).replace(/\s+/g, ' '));
}


function extractEmbed(html, origin) {
  var texts = unpackAll(html), found = null, m;

  // Düz <video><source src="..."> / <video src="...">
  var sm = html.match(/<(?:source|video)[^>]*\ssrc=["'](https?:\/\/[^"']+)["']/i);
  if (sm && !BAD_EXT.test(sm[1])) {
    return { found: { url: decodeHtml(sm[1]), type: /\.mp4(\?|$)/i.test(sm[1]) ? 'mp4' : 'hls', quality: 'Auto' }, texts: texts };
  }

  for (var i = 0; i < texts.length && !found; i++) {
    var t = texts[i];

    // JSON-LD contentUrl
    var cu = t.match(/"contentUrl"\s*:\s*"([^"]+)"/);
    if (cu) {
      var cv = hexUnescape(cu[1]);
      if (/^https?:\/\//.test(cv) && !BAD_EXT.test(cv)) found = { url: cv, type: /\.mp4(\?|$)/i.test(cv) ? 'mp4' : 'hls', quality: 'Auto' };
    }
    if (found) break;

    var av = t.match(/av\(\s*['"]([^'"]+)['"]\s*\)/);
    if (av) {
      try {
        var d = decodeSecret(av[1]);
        found = findStreamUrl(d) || (/^https?:\/\/\S+$/.test(d) ? { url: d, type: 'hls', quality: 'Auto' } : null);
      } catch (e) {}
    }
    if (found) break;

    var re = /"?file"?\s*:\s*"([^"]+)"/g;
    while ((m = re.exec(t)) !== null) {
      var v = hexUnescape(m[1]);
      if (/^https?:\/\//.test(v) && !BAD_EXT.test(v)) {
        found = { url: v, type: /\.mp4/i.test(v) ? 'mp4' : 'hls', quality: 'Auto' };
        break;
      }
    }
    if (found) break;

    found = findStreamUrl(t);
    if (found) break;

    // Göreli m3u8 yolu ("/stream/.../master.m3u8")
    var rel = hexUnescape(t).match(/["'](\/[^"'\s]+\.m3u8[^"'\s]*)["']/);
    if (rel) found = { url: origin + rel[1], type: 'hls', quality: 'Auto' };
  }
  if (!found) { try { found = bruteFindStream(texts); } catch (e) { dbg.push('EM brute hata ' + e.message); } }
  return { found: found, texts: texts };
}

function embedDiag(label, html, texts) {
  var t = texts[texts.length - 1];
  var scripts = (html.match(/<script/gi) || []).length;
  dbg.push('EM ' + label + ' len=' + html.length + ' script=' + scripts + ' paket=' + (texts.length - 1) +
    ' eval=' + /eval\(/.test(html) + ' atob=' + /atob\(/.test(html) + ' file=' + /file/.test(t) +
    ' m3u8=' + /m3u8/.test(t) + ' av=' + /av\s*\(/.test(t));
  var srcs = [], re = /<script[^>]*\ssrc=["']([^"']+)["']/g, m;
  while ((m = re.exec(html)) !== null && srcs.length < 3) srcs.push(m[1].slice(-40));
  if (srcs.length) dbg.push('EM js: ' + srcs.join(' , '));
  var i = t.search(/av\s*\(|atob\(|m3u8|"file"/);
  if (i > -1) dbg.push('EM ipucu: ' + t.substr(Math.max(0, i - 40), 160).replace(/\s+/g, ' '));
  var ss = html.lastIndexOf('<script');
  if (ss > -1) dbg.push('EM son: ' + html.substr(ss, 160).replace(/\s+/g, ' '));
}

function resolveEmbed(embedUrl, pageUrl, label) {
  var origin = originOf(embedUrl);
  function fetchEmbed(ua) {
    return getText(embedUrl, {
      'User-Agent': ua,
      'Accept': 'text/html,*/*;q=0.8',
      'Accept-Language': 'tr-TR,tr;q=0.9',
      'Referer': pageUrl
    });
  }
  return fetchEmbed(ANDROID_UA).then(function (html) {
    var r = html ? extractEmbed(html, origin) : { found: null, texts: [] };
    if (r.found) return { r: r, ua: ANDROID_UA };
    return fetchEmbed(DESKTOP_UA).then(function (html2) {
      var r2 = html2 ? extractEmbed(html2, origin) : { found: null, texts: [] };
      if (r2.found) { dbg.push('EM ' + label + ' masaustu UA ile bulundu'); return { r: r2, ua: DESKTOP_UA }; }
      if (!html && !html2) { dbg.push('EM ' + label + ' sayfa bos'); }
      else { try { embedDiag(label, html || html2, (html ? r : r2).texts); } catch (e) {} }
      stage = 'embed link çıkmadı (' + label + ')';
      return null;
    });
  }).then(function (o) {
    if (!o) return null;
    var found = o.r.found;
    found.headers = { 'User-Agent': o.ua, 'Referer': origin + '/' };
    return found;
  });
}

// ============================================================
//  NUVIO GİRİŞ NOKTASI
// ============================================================

function makeStream(label, r) {
  return {
    name: SITE_AYARLARI.EKLENTI_ADI,
    title: label,
    url: r.url,
    quality: r.quality || 'Auto',
    type: r.type,
    headers: r.headers || { 'User-Agent': ANDROID_UA },
    provider: PROVIDER_ID
  };
}

function debugStream(msg) {
  if (!SITE_AYARLARI.DEBUG_MODU) return [];
  var rows = [msg].concat(dbg.slice(0, 40));
  return rows.map(function (r) {
    return { name: 'DEBUG ' + r, title: 'DEBUG ' + r, url: 'https://debug.invalid/', quality: 'Auto', provider: PROVIDER_ID };
  });
}

function getStreams(tmdbId, mediaType, season, episode) {
  var isTv = (mediaType === 'tv' || mediaType === 'series');
  if (!isTv && mediaType !== 'movie') return Promise.resolve([]);
  stage = 'tmdb';
  dbg = [];

  var url = isTv
    ? 'https://api.themoviedb.org/3/tv/' + tmdbId + '?language=tr-TR&append_to_response=external_ids&api_key=' + TMDB_KEY
    : 'https://api.themoviedb.org/3/movie/' + tmdbId + '?language=tr-TR&api_key=' + TMDB_KEY;

  return withTimeout(fetch(url), 9000)
    .then(function (res) { return res.json(); })
    .then(function (info) {
      var title = isTv ? info.name : info.title;
      var origTitle = isTv ? info.original_name : info.original_title;
      var year = ((isTv ? info.first_air_date : info.release_date) || '').slice(0, 4);
      var imdbId = isTv ? ((info.external_ids || {}).imdb_id || '') : (info.imdb_id || '');
      if (!title || !year) return debugStream('TMDB bilgisi eksik');
      stage = 'arama: ' + title + ' (' + year + ')';

      return findContentPage(isTv ? 'tv' : 'movie', title, origTitle, year, imdbId).then(function (found) {
        if (!found) return debugStream('sayfa yok: ' + title + ' ' + year);
        log('sayfa: ' + found.path);

        var pagePromise;
        if (isTv) {
          var s = parseInt(season, 10) || 1, e = parseInt(episode, 10) || 1;
          var base = found.path.replace(/\/?$/, '/');
          var epPath = base + 'sezon-' + s + '/bolum-' + e + '/';
          pagePromise = getText(SITE_AYARLARI.PRIMARY_DOMAIN + epPath, null, 'EP').then(function (html) {
            return { url: SITE_AYARLARI.PRIMARY_DOMAIN + epPath, html: html };
          });
        } else {
          pagePromise = Promise.resolve({ url: SITE_AYARLARI.PRIMARY_DOMAIN + found.path, html: found.html });
        }

        return pagePromise.then(function (pg) {
          if (!pg.html) return debugStream('bolum sayfasi bos: ' + pg.url);
          var parts = extractParts(pg.html);
          dbg.push('kaynak ' + parts.length);
          if (!parts.length) return debugStream('kaynak yok');

          return Promise.all(parts.map(function (p) {
            return resolveEmbed(p.url, pg.url, p.label).catch(function (er) { dbg.push('EM hata ' + (er && er.message)); return null; });
          })).then(function (resolved) {
            var streams = [], seen = {};
            for (var i = 0; i < parts.length; i++) {
              var r = resolved[i];
              if (!r || seen[r.url]) continue;
              seen[r.url] = true;
              streams.push(makeStream(parts[i].label, r));
            }
            if (!streams.length) return debugStream('cozulemedi: ' + stage);
            return streams;
          });
        });
      });
    })
    .catch(function (e) { return debugStream('hata ' + (e && e.message) + ' ' + stage); });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getStreams: getStreams, _t: { parseCards: parseCards, extractParts: extractParts, extractEmbed: extractEmbed, findStreamUrl: findStreamUrl } };
} else {
  global.getStreams = getStreams;
}
