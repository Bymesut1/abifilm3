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
  dbg.push('EM paketLen ' + t.length);
  [1, 2, 3, 6, 10].forEach(function (ci) {
    var chunk = t.substr(ci * 320, 320).replace(/\s+/g, ' ');
    if (chunk) dbg.push('EM K' + ci + ': ' + chunk);
  });
  dbg.push('EM Z: ' + t.slice(-160).replace(/\s+/g, ' '));
  var ss = html.lastIndexOf('<script');
  if (ss > -1) dbg.push('EM son: ' + html.substr(ss, 160).replace(/\s+/g, ' '));
}

// ---------------- Akış doğrulama (oynatma hatasını önlemek için) ----------------

function resolveRel(base, rel) {
  if (/^https?:\/\//i.test(rel)) return rel;
  if (rel.indexOf('//') === 0) return 'https:' + rel;
  if (rel.charAt(0) === '/') return originOf(base) + rel;
  return base.replace(/[?#].*$/, '').replace(/[^\/]*$/, '') + rel;
}

function probe(url, headers, range) {
  var h = {};
  Object.keys(headers || {}).forEach(function (k) { h[k] = headers[k]; });
  if (range) h['Range'] = 'bytes=0-1';
  return withTimeout(fetch(url, { headers: h }), 8000).then(function (res) {
    if (range) return { status: res.status, text: '' };
    return withTimeout(res.text(), 8000).then(
      function (t) { return { status: res.status, text: String(t || '') }; },
      function () { return { status: res.status, text: '' }; }
    );
  }).catch(function (e) { return { status: 0, text: (e && e.message) || 'hata' }; });
}

function firstUri(text) {
  var lines = String(text).split(/\r?\n/);
  for (var i = 0; i < lines.length; i++) {
    var l = lines[i].trim();
    if (l && l.charAt(0) !== '#') return l;
  }
  return '';
}

// Linki gerçekten çekip #EXTM3U mi diye bakar; farklı başlık kombinasyonlarını dener.
function verifyStream(r, label, origin) {
  if (r.type !== 'hls') return Promise.resolve(r);
  dbg.push('U ' + label + ' ' + r.url.slice(0, 110));
  var variants = [
    r.headers,
    { 'User-Agent': ANDROID_UA, 'Referer': origin + '/', 'Origin': origin },
    { 'User-Agent': ANDROID_UA, 'Referer': SITE_AYARLARI.PRIMARY_DOMAIN + '/', 'Origin': SITE_AYARLARI.PRIMARY_DOMAIN },
    { 'User-Agent': ANDROID_UA }
  ];
  function tryAt(i) {
    if (i >= variants.length) return Promise.resolve(r);
    return probe(r.url, variants[i]).then(function (p) {
      var head = p.text.slice(0, 40).replace(/\s+/g, ' ');
      dbg.push('V ' + label + ' h' + i + ' ' + p.status + ' ' + head);
      if (p.status === 200 && /^\s*#EXTM3U/.test(p.text)) {
        r.headers = variants[i];
        r.ok = true;
        // ikinci seviye: ilk alt liste / ilk parça erişilebiliyor mu
        var u1 = firstUri(p.text);
        if (!u1) return r;
        u1 = resolveRel(r.url, u1);
        return probe(u1, variants[i]).then(function (p2) {
          dbg.push('V2 ' + label + ' ' + p2.status + ' ' + p2.text.slice(0, 30).replace(/\s+/g, ' '));
          var u2 = /#EXTINF|#EXT-X-MAP/.test(p2.text) ? firstUri(p2.text) : '';
          if (!u2) return r;
          return probe(resolveRel(u1, u2), variants[i], true).then(function (p3) {
            dbg.push('V3 ' + label + ' parca ' + p3.status);
            return r;
          });
        });
      }
      return tryAt(i + 1);
    });
  }
  return tryAt(0);
}


// ---------------- Mini JS sandbox (şifreli embed betiklerini çalıştırıp URL yakalar) ----------------

function sbBtoa(str) {
  var out = '', i = 0, a, b, c;
  str = String(str);
  while (i < str.length) {
    a = str.charCodeAt(i++) & 255;
    b = i < str.length ? str.charCodeAt(i++) & 255 : NaN;
    c = i < str.length ? str.charCodeAt(i++) & 255 : NaN;
    out += B64.charAt(a >> 2) + B64.charAt(((a & 3) << 4) | ((isNaN(b) ? 0 : b) >> 4)) +
      (isNaN(b) ? '=' : B64.charAt(((b & 15) << 2) | ((isNaN(c) ? 0 : c) >> 6))) +
      (isNaN(c) ? '=' : B64.charAt(c & 63));
  }
  return out;
}
function sbAtob(s) { return bytesToStr(b64ToBytes(s)); }

function formEncode(o) {
  if (typeof o === 'string') return o;
  var parts = [];
  Object.keys(o || {}).forEach(function (k) {
    var v = o[k];
    if (v && typeof v === 'object') v = JSON.stringify(v);
    parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(v === undefined || v === null ? '' : v));
  });
  return parts.join('&');
}

var SB_RESERVED = /^(break|case|catch|class|const|continue|debugger|default|delete|do|else|enum|export|extends|false|finally|for|function|if|import|in|instanceof|let|new|null|return|super|switch|this|throw|true|try|typeof|var|void|while|with|yield|await|static|implements|interface|package|private|protected|public|arguments|eval|undefined|NaN|Infinity)$/;
function sbValidName(n) { return /^[A-Za-z_$][\w$]*$/.test(n) && !SB_RESERVED.test(n); }
function sbMissingName(e) {
  var msg = String((e && e.message) || e), m;
  if ((m = msg.match(/['"]?([A-Za-z_$][\w$]*)['"]? is not defined/))) return m[1];
  if ((m = msg.match(/Can't find variable: ([\w$]+)/))) return m[1];
  if ((m = msg.match(/Property '([\w$]+)' doesn't exist/))) return m[1];
  return '';
}
function sbDeclNames(code) {
  var names = {}, m, re = /\b(?:var|let|const)\s+([A-Za-z_$][\w$]*)/g;
  while ((m = re.exec(code)) !== null) names[m[1]] = 1;
  re = /\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g;
  while ((m = re.exec(code)) !== null) names[m[1]] = 1;
  re = /[;{}]\s*(?:var\s+)?([A-Za-z_$][\w$]*)\s*=(?!=)/g;
  while ((m = re.exec(code)) !== null) names[m[1]] = 1;
  return Object.keys(names).filter(sbValidName).slice(0, 400);
}

function sbNew(embedUrl, pageUrl) {
  var rec = [], trace = [], errs = [], reqs = [], queue = [], fired = 0, depth = 0;
  var G = {}, missing = [];
  var host = (String(embedUrl).match(/^https?:\/\/([^\/?#]+)/) || [])[1] || '';
  var NAMES = ['window', 'document', 'navigator', 'location', '$', 'jQuery', 'jwplayer', 'Hls', 'videojs', 'player',
    'localStorage', 'sessionStorage', 'screen', 'history', 'XMLHttpRequest', 'setTimeout', 'setInterval',
    'clearTimeout', 'clearInterval', 'self', 'top', 'parent', 'globalThis', 'Image', 'Audio', 'Element',
    'HTMLElement', 'Node', 'Event', 'CustomEvent', 'MutationObserver', 'FormData', 'Blob', 'Worker', 'WebSocket',
    'fetch', 'requestAnimationFrame', 'performance', 'console', 'chrome', 'opera'];

  function pv(v) {
    try {
      if (typeof v === 'string') return v.slice(0, 90);
      if (typeof v === 'function') return 'fn';
      return JSON.stringify(v).slice(0, 90);
    } catch (e) { return '?'; }
  }
  function add(v) {
    try {
      if (typeof v === 'string') rec.push(v);
      else if (v && typeof v === 'object') rec.push(JSON.stringify(v));
    } catch (e) {}
  }
  function fire(fn) { if (fired++ < 400) queue.push(fn); }
  function drain() {
    var n = 0;
    while (queue.length && n++ < 400) {
      var f = queue.shift();
      try { f(); } catch (e) { errs.push('cb:' + (e && e.message)); var mn = sbMissingName(e); if (mn) missing.push(mn); }
    }
  }
  function mk(name, init) {
    var store = init || {}, kids = {};
    function handleArgs(args) {
      if (trace.length < 60) trace.push(name + '(' + args.map(pv).join(',') + ')');
      for (var i = 0; i < args.length; i++) {
        if (typeof args[i] === 'function') fire(args[i]); else add(args[i]);
      }
    }
    return new Proxy(function () {}, {
      get: function (t, k) {
        if (typeof k === 'symbol') return k === Symbol.toPrimitive ? function () { return ''; } : undefined;
        if (k === 'toString' || k === 'toJSON') return function () { return ''; };
        if (k === 'valueOf') return function () { return 0; };
        if (k === 'then') return undefined;
        if (k === 'length') return 0;
        if (Object.prototype.hasOwnProperty.call(store, k)) return store[k];
        if (!kids[k]) kids[k] = mk(name + '.' + k);
        return kids[k];
      },
      set: function (t, k, v) {
        store[k] = v;
        if (typeof v === 'function') fire(v);
        else { if (trace.length < 60) trace.push(name + '.' + String(k) + '=' + pv(v)); add(v); }
        return true;
      },
      apply: function (t, th, args) { handleArgs(args); return mk(name + '()'); },
      construct: function (t, args) { handleArgs(args); return mk(name + '#'); }
    });
  }

  function rewrite(code) {
    return String(code).replace(/\beval\s*\(/g, '__ev(').replace(/(^|[^\w$.])Function\s*\(/g, '$1__Fn(');
  }
  var gkeys = [];
  function build(params, code, asExpr, doExport) {
    gkeys = Object.keys(G).filter(sbValidName);
    var all = NAMES.concat(['__ev', '__Fn', 'atob', 'btoa', '__G']).concat(gkeys).concat(params || []);
    var body = rewrite(code);
    if (asExpr) body = 'return (' + body + '\n);';
    else if (doExport) {
      var ep = sbDeclNames(code).map(function (n) {
        return 'try{if(typeof ' + n + '!=="undefined")__G["' + n + '"]=' + n + '}catch(_e){}';
      }).join(';');
      body = 'try{' + body + '\n}finally{' + ep + '}';
    }
    all.push(body);
    var fn = Function.apply(null, all);
    fn.__keys = gkeys;
    return fn;
  }
  var win, vals;
  function call(fn, extra) {
    var keys = fn.__keys || [];
    var args = vals.concat([sbEval, sbFn, sbAtob, sbBtoa, G]).concat(keys.map(function (k) { return G[k]; })).concat(extra || []);
    return fn.apply(win, args);
  }
  function execCode(code, tryExpr) {
    var mode = tryExpr ? 'expr' : 'stmt', fn;
    for (var attempt = 0; attempt < 30; attempt++) {
      try {
        if (mode === 'expr') { try { fn = build([], code, true, false); } catch (se) { mode = 'stmt'; } }
        if (mode === 'stmt') fn = build([], code, false, true);
        return call(fn);
      } catch (e) {
        var nm = sbMissingName(e);
        if (nm && sbValidName(nm) && NAMES.indexOf(nm) === -1 && !Object.prototype.hasOwnProperty.call(G, nm)) { G[nm] = mk(nm); continue; }
        throw e;
      }
    }
    return undefined;
  }
  function sbEval(code) {
    if (typeof code !== 'string') return code;
    rec.push(code);
    if (depth > 6) return undefined;
    depth++;
    try { return execCode(code, true); }
    catch (e) { errs.push('ev:' + (e && e.message)); return undefined; }
    finally { depth--; }
  }
  function sbFn() {
    var a = Array.prototype.slice.call(arguments), body = String(a.length ? a.pop() : ''), params = [];
    rec.push(body);
    a.forEach(function (x) { String(x).split(',').forEach(function (q) { q = q.trim(); if (q) params.push(q); }); });
    var fn = build(params, body, false, false);
    return function () { return call(fn, Array.prototype.slice.call(arguments)); };
  }

  function ajaxHandle(r) {
    var h = {};
    ['done', 'then', 'success'].forEach(function (n) { h[n] = function (f) { if (typeof f === 'function') r.cbs.push(f); return h; }; });
    ['fail', 'always', 'catch', 'error', 'complete'].forEach(function (n) { h[n] = function () { return h; }; });
    return h;
  }
  function addReq(opts) {
    var r = { opts: opts || {}, cbs: [] };
    reqs.push(r);
    if (trace.length < 60) trace.push('ajax ' + pv({ type: r.opts.type || r.opts.method, url: r.opts.url, data: r.opts.data }));
    return ajaxHandle(r);
  }
  var jqInit = {
    ajax: function (o, o2) { if (typeof o === 'string') { o2 = o2 || {}; o2.url = o; o = o2; } return addReq(o); },
    post: function (u, d, cb, t) { if (typeof d === 'function') { t = cb; cb = d; d = undefined; } return addReq({ type: 'POST', url: u, data: d, success: cb, dataType: t }); },
    get: function (u, d, cb, t) { if (typeof d === 'function') { t = cb; cb = d; d = undefined; } return addReq({ type: 'GET', url: u, data: d, success: cb, dataType: t }); },
    getJSON: function (u, d, cb) { if (typeof d === 'function') { cb = d; d = undefined; } return addReq({ type: 'GET', url: u, data: d, success: cb, dataType: 'json' }); },
    ajaxSetup: function () {}
  };

  var doc = mk('document', { referrer: pageUrl, cookie: '', URL: embedUrl, domain: host, readyState: 'complete' });
  var nav = mk('navigator', { userAgent: ANDROID_UA, platform: 'Linux armv8l', language: 'tr-TR', webdriver: false });
  var loc = mk('location', { href: embedUrl, hostname: host, host: host, origin: originOf(embedUrl), protocol: 'https:', pathname: '/' });
  win = mk('window', { atob: sbAtob, btoa: sbBtoa, eval: sbEval, Function: sbFn, document: doc, navigator: nav, location: loc });
  vals = NAMES.map(function (n) {
    if (n === 'window' || n === 'self' || n === 'top' || n === 'parent' || n === 'globalThis') return win;
    if (n === 'document') return doc;
    if (n === 'navigator') return nav;
    if (n === 'location') return loc;
    if (n === '$' || n === 'jQuery') return mk(n, jqInit);
    return mk(n);
  });

  return {
    rec: rec, trace: trace, errs: errs, reqs: reqs,
    run: function (code) {
      try { execCode(code, false); } catch (e) { errs.push('run:' + (e && e.message)); }
    },
    drain: drain,
    runAll: function (scripts) {
      var ok = [], attempt;
      function errFn(i, e) {
        errs.push('s' + i + ':' + String((e && e.message) || e).slice(0, 90));
        var nm = sbMissingName(e);
        if (nm) missing.push(nm);
      }
      scripts.forEach(function (sc, i) {
        var t = String(sc).replace(/(^|[^\w$.])Function\s*\(/g, '$1__Fn(')
          .replace(/(^|[;{}\s(])(?:let|const)\s+(?=[A-Za-z_$\[{])/g, '$1var ');
        try { Function(t); ok.push(t); } catch (se) { errs.push('syn' + i + ':' + (se && se.message)); }
      });
      var body = ok.map(function (t, i) { return 'try{\n' + t + '\n}catch(__e){__err(' + i + ',__e)}'; }).join('\n');
      for (attempt = 1; attempt <= 12; attempt++) {
        errs.length = 0; queue.length = 0; fired = 0; reqs.length = 0; trace.length = 0; missing.length = 0;
        var keys = Object.keys(G).filter(sbValidName), fn;
        try {
          fn = Function.apply(null, NAMES.concat(['__Fn', 'atob', 'btoa', '__err']).concat(keys).concat([body]));
        } catch (be) { errs.push('build:' + (be && be.message)); break; }
        try {
          fn.apply(win, vals.concat([sbFn, sbAtob, sbBtoa, errFn]).concat(keys.map(function (k) { return G[k]; })));
        } catch (re) { errFn(-1, re); }
        drain();
        var added = false;
        missing.forEach(function (nm) {
          if (sbValidName(nm) && NAMES.indexOf(nm) === -1 && !Object.prototype.hasOwnProperty.call(G, nm)) { G[nm] = mk(nm); added = true; }
        });
        if (!added) break;
      }
      return attempt;
    },
    feed: function (r, text) {
      rec.push(text);
      var o = r.opts || {}, data = text;
      if (/json/i.test(String(o.dataType || '')) || /^\s*[\[{]/.test(text)) { try { data = JSON.parse(text); } catch (e) { data = text; } }
      [o.success].concat(r.cbs).forEach(function (f) {
        if (typeof f !== 'function') return;
        try { f(data, 'success', {}); } catch (e) { errs.push('aj:' + (e && e.message)); }
      });
      drain();
    }
  };
}

function sbRequests(box, embedUrl, label) {
  var origin = originOf(embedUrl);
  return Promise.all(box.reqs.slice(0, 3).map(function (r) {
    var o = r.opts || {}, method = String(o.type || o.method || 'GET').toUpperCase();
    var url = resolveRel(embedUrl, String(o.url || ''));
    var headers = {
      'User-Agent': ANDROID_UA, 'Referer': embedUrl, 'Origin': origin,
      'X-Requested-With': 'XMLHttpRequest', 'Accept': '*/*'
    };
    var init = { method: method, headers: headers };
    if (o.data !== undefined && o.data !== null) {
      var enc = formEncode(o.data);
      if (method === 'GET') url += (url.indexOf('?') > -1 ? '&' : '?') + enc;
      else { init.body = enc; headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8'; }
    }
    return withTimeout(fetch(url, init), 9000).then(function (res) {
      return withTimeout(res.text(), 9000).then(function (t) { return { status: res.status, text: t || '' }; });
    }).catch(function (e) { return { status: 0, text: '' }; }).then(function (resp) {
      dbg.push('AJ ' + label + ' ' + method + ' ' + url.slice(-45) + ' ' + resp.status + '/' + resp.text.length + ' ' + resp.text.slice(0, 110).replace(/\s+/g, ' '));
      try { box.feed(r, resp.text); } catch (e) { dbg.push('AJ hata ' + (e && e.message)); }
    });
  }));
}

function sbDirectEvalOk() {
  try { return (function () { var q = 1; return eval('q+1') === 2; })(); } catch (e) { return false; }
}

function sbCollect(box, skip) {
  var urls = [], seen = {};
  box.rec.forEach(function (x) {
    var t = hexUnescape(String(x)).replace(/&amp;/g, '&');
    (t.match(/https?:\/\/[^\s"'<>\\)\]]+/g) || []).forEach(function (u) {
      u = u.replace(/[,;]+$/, '');
      if (seen[u] || u === skip || BAD_EXT.test(u)) return;
      if (/googleapis|gstatic|jquery|cdnjs|jsdelivr|jwplayer|jwpcdn|schema\.org|w3\.org|youtube|cloudflare|google/i.test(u)) return;
      seen[u] = true; urls.push(u);
    });
  });
  var good = urls.filter(function (u) { return /\.m3u8|master|\.mp4|\.txt(\?|$)|rapidrame|playmix|\/hls/i.test(u); });
  function rank(u) { return /\.m3u8/i.test(u) ? 0 : (/master/i.test(u) ? 1 : 2); }
  good.sort(function (a, b) { return rank(a) - rank(b); });
  return good;
}

function sandboxFind(html, embedUrl, pageUrl, skip, label) {
  var scripts = [], re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi, m;
  while ((m = re.exec(html)) !== null) {
    if (/\ssrc\s*=/.test(m[1]) || /ld\+json|application\/json/i.test(m[1])) continue;
    if (m[2].trim().length > 20) scripts.push(m[2]);
  }

  function pass(mode) {
    var box = sbNew(embedUrl, pageUrl), tag = (mode === 'uni' ? 'SB2 ' : 'SB '), info = '';
    if (mode === 'sep') { scripts.forEach(function (sc) { box.run(sc); }); box.drain(); }
    else info = ' deneme ' + box.runAll(scripts);
    return sbRequests(box, embedUrl, label + (mode === 'uni' ? 'U' : '')).then(function () {
      var good = sbCollect(box, skip);
      dbg.push(tag + label + ' betik ' + scripts.length + ' kayit ' + box.rec.length + ' istek ' + box.reqs.length +
        ' aday ' + good.length + info + (box.errs.length ? ' hata ' + box.errs.slice(0, 3).join('|').slice(0, 170) : ''));
      good.slice(0, 3).forEach(function (u) { dbg.push(tag + 'A ' + label + ' ' + u.slice(0, 130)); });
      if (!good.length) {
        var key = box.trace.filter(function (t) { return /setup|ajax|file|src|http|source|play/i.test(t); });
        (key.length ? key : box.trace).slice(0, 8).forEach(function (t) { dbg.push(tag + 'T ' + label + ' ' + t.slice(0, 130)); });
      }
      return good;
    });
  }

  return pass('sep').then(function (g) {
    if (g.length) return g;
    if (!sbDirectEvalOk()) { dbg.push('SB ' + label + ' direct eval yok'); return g; }
    return pass('uni');
  }).then(function (good) {
    return good.map(function (u) { return { url: u, type: /\.mp4(\?|$)/i.test(u) ? 'mp4' : 'hls', quality: 'Auto' }; });
  });
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
    if (r.found) return { r: r, ua: ANDROID_UA, html: html };
    return fetchEmbed(DESKTOP_UA).then(function (html2) {
      var r2 = html2 ? extractEmbed(html2, origin) : { found: null, texts: [] };
      if (r2.found) { dbg.push('EM ' + label + ' masaustu UA ile bulundu'); return { r: r2, ua: DESKTOP_UA, html: html2 }; }
      if (!html && !html2) dbg.push('EM ' + label + ' sayfa bos');
      return { r: html ? r : r2, ua: ANDROID_UA, html: html || html2 || '' };
    });
  }).then(function (o) {
    function viaSandbox(skip, allowUnverified) {
      if (!o.html) return Promise.resolve(null);
      var hdrs = { 'User-Agent': o.ua, 'Referer': origin + '/' };
      return sandboxFind(o.html, embedUrl, pageUrl, skip, label).catch(function (e) {
        dbg.push('SB hata ' + label + ' ' + (e && e.message));
        return [];
      }).then(function (cands) {
        function tryC(i) {
          if (i >= cands.length || i >= 4) {
            if (allowUnverified && cands.length) { cands[0].headers = hdrs; return Promise.resolve(cands[0]); }
            return Promise.resolve(null);
          }
          var c = cands[i]; c.headers = hdrs;
          return verifyStream(c, label + ' sb' + i, origin).then(function (v) {
            return (v.ok || v.type !== 'hls') ? v : tryC(i + 1);
          });
        }
        return tryC(0);
      });
    }

    if (!o.r.found) {
      return viaSandbox('', true).then(function (v) {
        if (v) return v;
        if (o.html) { try { embedDiag(label, o.html, o.r.texts); } catch (e) {} }
        stage = 'embed link çıkmadı (' + label + ')';
        return null;
      });
    }

    var found = o.r.found;
    found.headers = { 'User-Agent': o.ua, 'Referer': origin + '/' };
    try {
      var key = found.url.slice(0, 45);
      for (var ti = 0; ti < o.r.texts.length; ti++) {
        var tt = hexUnescape(o.r.texts[ti]), ix = tt.indexOf(key);
        if (ix > -1) { dbg.push('CTX ' + label + ' ' + tt.substr(Math.max(0, ix - 120), 330).replace(/\s+/g, ' ')); break; }
      }
    } catch (e) {}
    return verifyStream(found, label, origin).then(function (v) {
      if (v.ok || v.type !== 'hls') return v;
      return viaSandbox(v.url, false).then(function (s) { return s || v; });
    });
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
  var rows = [msg].concat(dbg.slice(0, 100));
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
          parts.forEach(function (p) { dbg.push('P ' + p.label + ' ' + p.url.slice(0, 150)); });
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
            return streams.concat(debugStream('tani: ' + streams.length + ' akis'));
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
