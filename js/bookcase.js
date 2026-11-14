/* bookcase.js — Kitaplık projesinden alınan raflı kitaplık sistemi (masanın önündeki dolap). */
(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var NS = 'http://www.w3.org/2000/svg';

  var BINDINGS = ['#6b2a2a', '#2f4a3a', '#283a55', '#8a6a2c', '#3d4650', '#4d3247', '#7a3f24', '#545232', '#26474a'];
  var COLOR_VERSION = 2;

  var shownKey = '';
  var peekTimer = null;
  var ro = null;
  var resizeTimer = null;
  var inited = false;
  var shelfInput = null;

  function icon(name) {
    var s = document.createElementNS(NS, 'svg');
    s.setAttribute('class', 'ico');
    s.setAttribute('aria-hidden', 'true');
    var u = document.createElementNS(NS, 'use');
    u.setAttribute('href', '#i-' + name);
    s.appendChild(u);
    return s;
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function hash(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  function fold(s) {
    return String(s || '').toLocaleLowerCase('tr').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ı/g, 'i');
  }

  function progressOf(b) {
    if (!b.pages) return 0;
    return b.pages > 1 ? clamp(((b.page || 1) - 1) / (b.pages - 1), 0, 1) : 0;
  }

  // ---------- Kapaktan Sırt Rengi Çıkarma (Kitaplık algoritması) ----------
  function rgb2hsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, h = 0, s = 0;
    if (mx !== mn) {
      var d = mx - mn;
      s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
      if (mx === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if (mx === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
    }
    return [h, s, l];
  }

  function hsl2rgb(h, s, l) {
    var c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2, r = 0, g = 0, b = 0;
    if (h < 60) { r = c; g = x; }
    else if (h < 120) { r = x; g = c; }
    else if (h < 180) { g = c; b = x; }
    else if (h < 240) { g = x; b = c; }
    else if (h < 300) { r = x; b = c; }
    else { r = c; b = x; }
    return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
  }

  function sampleColor(canvas, seed) {
    var w = 48, h = Math.max(12, Math.round(48 * canvas.height / Math.max(1, canvas.width)));
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    var x = c.getContext('2d');
    x.drawImage(canvas, 0, 0, w, h);
    var d = x.getImageData(0, 0, w, h).data;
    var bins = {}, total = 0;
    for (var i = 0; i < d.length; i += 4) {
      var r = d[i], g = d[i + 1], b = d[i + 2];
      var mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      total++;
      if (mx < 46 || (mx - mn) / (mx || 1) < 0.3) continue;
      var k = (r >> 4) << 8 | (g >> 4) << 4 | (b >> 4);
      var e = bins[k] || (bins[k] = [0, 0, 0, 0]);
      e[0]++; e[1] += r; e[2] += g; e[3] += b;
    }
    var best = null;
    Object.keys(bins).forEach(function (k) { if (!best || bins[k][0] > best[0]) best = bins[k]; });
    if (best && best[0] >= total * 0.02) {
      var hsl = rgb2hsl(best[1] / best[0], best[2] / best[0], best[3] / best[0]);
      return hsl2rgb(hsl[0], clamp(hsl[1], 0.25, 0.55), clamp(hsl[2] * 0.6, 0.22, 0.38));
    }
    return Recolor.hexToRgb(BINDINGS[hash(String(seed)) % BINDINGS.length]);
  }

  function upgradeColors(allBooks) {
    var old = (allBooks || []).filter(function (b) { return !b.color || (b.colorVersion || 1) < COLOR_VERSION; });
    if (!old.length) return;
    var chain = Promise.resolve();
    old.forEach(function (b) {
      chain = chain.then(function () {
        return new Promise(function (resolve) {
          function done(col) {
            b.color = col;
            b.colorVersion = COLOR_VERSION;
            DB.updateBook(b.id, { color: col, colorVersion: COLOR_VERSION }).then(resolve, resolve);
          }
          if (!b.cover) { done(sampleColor(document.createElement('canvas'), b.id)); return; }
          var img = new Image(), url = URL.createObjectURL(b.cover);
          img.onload = function () {
            var cv = document.createElement('canvas');
            cv.width = img.naturalWidth; cv.height = img.naturalHeight;
            cv.getContext('2d').drawImage(img, 0, 0);
            URL.revokeObjectURL(url);
            done(sampleColor(cv, b.id));
          };
          img.onerror = function () {
            URL.revokeObjectURL(url);
            done(sampleColor(document.createElement('canvas'), b.id));
          };
          img.src = url;
        });
      });
    });
    chain.then(function () { invalidate(); render(); });
  }

  // ---------- Geometri & Raf Paketleme ----------
  function spineGeom(b) {
    var h = hash(b.id);
    var canLean = (h % 6 === 0);
    var deg = canLean ? (4 + ((h >> 3) % 8)) : 0;
    var dir = ((h >> 7) & 1) ? 1 : -1;
    return {
      w: Math.round(clamp(26 + ((b.pages || 1) - 60) * (38 / 740), 26, 64)),
      h: 175 + (h % 40),
      lean: 0,
      canLean: canLean,
      deg: deg,
      prefDir: dir
    };
  }

  function coverGeom(b) {
    var H = 172, a = b.aspect || 0.7;
    return { w: Math.round(clamp(H * a, 104, 152)), h: H };
  }

  function filteredShelfBooks() {
    if (!window.Desk || !Desk.getShelfBooks) return [];
    var all = Desk.getShelfBooks();
    var q = fold(($('#desk-search') && $('#desk-search').value) || '');
    var list = all.filter(function (b) {
      return !q || fold(b.title).indexOf(q) >= 0 || fold(b.author).indexOf(q) >= 0;
    });
    var sort = ($('#bc-sort') && $('#bc-sort').value) || App.settings.bcSort || 'recent';
    list.sort(function (a, b) {
      if (sort === 'title') return a.title.localeCompare(b.title, 'tr');
      if (sort === 'added') return (b.addedAt || 0) - (a.addedAt || 0);
      return (b.lastReadAt || b.addedAt || 0) - (a.lastReadAt || a.addedAt || 0);
    });
    return list;
  }

  function moreBtn(b) {
    var m = el('button', 'more');
    m.type = 'button';
    m.setAttribute('aria-label', 'Seçenekler: ' + b.title);
    m.appendChild(icon('more'));
    m.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      var r = m.getBoundingClientRect();
      Desk.showBookMenu(b, r.left, r.bottom + 4);
    });
    return m;
  }

  // Raftaki kitabı tutup doğrudan masanın üstüne indirebilme (+ tıklayınca açma)
  function wireShelfBook(wrap, b, noPeek) {
    wrap.addEventListener('contextmenu', function (e) {
      e.preventDefault();
      Desk.showBookMenu(b, e.clientX, e.clientY);
    });

    if (!noPeek && window.matchMedia && window.matchMedia('(hover: hover)').matches) {
      wrap.addEventListener('mouseenter', function () { schedulePeek(wrap, b); });
      wrap.addEventListener('mouseleave', hidePeek);
      wrap.addEventListener('focusin', function () { schedulePeek(wrap, b, true); });
      wrap.addEventListener('focusout', hidePeek);
    }

    var sx = 0, sy = 0, dragging = false, moved = false;
    var stage = $('#desk-stage');
    var link = wrap.querySelector('.open');

    wrap.addEventListener('pointerdown', function (e) {
      if (e.button !== 0 || (e.target && e.target.closest('button'))) return;
      sx = e.clientX; sy = e.clientY;
      dragging = true; moved = false;
    });

    function onMove(e) {
      if (!dragging) return;
      var dx = e.clientX - sx, dy = e.clientY - sy;
      if (!moved && Math.hypot(dx, dy) < 10) return;
      if (!moved) {
        moved = true;
        hidePeek();
        wrap.classList.add('is-shelf-dragging');
      }
      if (stage) {
        var r = stage.getBoundingClientRect();
        var overDesk = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
        stage.classList.toggle('is-drop-zone', overDesk);
      }
    }

    function onUp(e) {
      if (!dragging) return;
      dragging = false;
      wrap.classList.remove('is-shelf-dragging');
      if (stage) stage.classList.remove('is-drop-zone');
      if (!moved) return;

      wrap.dataset.justDragged = '1';
      setTimeout(function () { delete wrap.dataset.justDragged; }, 80);

      if (stage && Desk.placeBookFromShelf) {
        var r = stage.getBoundingClientRect();
        if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
          var maxXPct = r.width ? ((r.width - 128) / r.width) * 100 : 85;
          var maxYPct = r.height ? ((r.height - 205) / r.height) * 100 : 90;
          var xPct = clamp(((e.clientX - r.left - 55) / r.width) * 100, 0, Math.max(0, maxXPct));
          var yPct = clamp(((e.clientY - r.top - 75) / r.height) * 100, 0, Math.max(0, maxYPct));
          var keepBoth = e.shiftKey || e.ctrlKey || b.placement === 'both';
          Desk.placeBookFromShelf(b, Math.round(xPct * 100) / 100, Math.round(yPct * 100) / 100, keepBoth);
        }
      }
    }

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);

    if (link) {
      link.addEventListener('click', function (e) {
        if (wrap.dataset.justDragged) e.preventDefault();
      });
    }
  }

  function spineEl(b, g) {
    var wrap = el('div', 'book spine' + (b.placement === 'both' ? ' is-dual' : ''));
    wrap.dataset.id = b.id;
    var c = b.color || Recolor.hexToRgb(BINDINGS[hash(b.id) % BINDINGS.length]);
    var light = Recolor.lum(c) > 0.5;
    wrap.style.setProperty('--w', g.w + 'px');
    wrap.style.setProperty('--h', g.h + 'px');
    wrap.style.setProperty('--c', 'rgb(' + c.join(',') + ')');
    wrap.style.setProperty('--tc', light ? '#2a2118' : '#efe4cf');
    if (g.lean) {
      var rad = Math.abs(g.lean) * Math.PI / 180;
      var extra = Math.round(g.h * Math.sin(rad));
      wrap.classList.add('is-leaned');
      wrap.style.setProperty('--lean', g.lean + 'deg');
      if (g.lean > 0) {
        wrap.style.setProperty('--lean-origin', 'bottom right');
        wrap.style.marginRight = extra + 'px';
      } else {
        wrap.style.setProperty('--lean-origin', 'bottom left');
        wrap.style.marginLeft = extra + 'px';
      }
    }

    var a = el('a', 'open');
    a.href = '#/kitap/' + encodeURIComponent(b.id);
    a.draggable = false;
    a.setAttribute('aria-label', b.title + (b.author ? ', ' + b.author : '') + '. Aç');
    a.appendChild(el('span', 's-title', b.title));
    if (b.author) a.appendChild(el('span', 's-author', b.author));
    var p = el('span', 's-prog');
    if (progressOf(b) > 0.01 && (b.page || 1) > 1) {
      var i = el('i');
      i.style.width = (progressOf(b) * 100) + '%';
      p.appendChild(i);
    }
    a.appendChild(p);

    wrap.appendChild(a);
    wrap.appendChild(moreBtn(b));
    wireShelfBook(wrap, b, false);
    return wrap;
  }

  function coverEl(b, g) {
    var wrap = el('div', 'book cover' + (b.placement === 'both' ? ' is-dual' : ''));
    wrap.dataset.id = b.id;
    wrap.style.setProperty('--w', g.w + 'px');
    wrap.style.setProperty('--h', g.h + 'px');

    var a = el('a', 'open');
    a.href = '#/kitap/' + encodeURIComponent(b.id);
    a.draggable = false;
    a.setAttribute('aria-label', b.title + (b.author ? ', ' + b.author : '') + '. Aç');

    var url = Desk.getCoverURL(b);
    if (url) {
      var img = el('img', 'c-img');
      img.src = url; img.alt = ''; img.draggable = false;
      a.appendChild(img);
    } else {
      a.appendChild(el('span', 'c-img c-none', b.title));
    }

    var p = el('span', 'c-prog');
    if ((b.page || 1) > 1) {
      var i = el('i');
      i.style.width = (progressOf(b) * 100) + '%';
      p.appendChild(i);
    }
    a.appendChild(p);

    wrap.appendChild(a);
    wrap.appendChild(moreBtn(b));
    wireShelfBook(wrap, b, true);
    return wrap;
  }

  function capEl(b, g) {
    var a = el('a', 'cap');
    a.href = '#/kitap/' + encodeURIComponent(b.id);
    a.tabIndex = -1;
    a.setAttribute('aria-hidden', 'true');
    a.style.setProperty('--w', g.w + 'px');
    a.appendChild(el('span', 'cap-t', b.title));
    if (b.author) a.appendChild(el('span', 'cap-a', b.author));
    return a;
  }

  // ---------- Sırt Hover Önizleme (#peek) ----------
  function schedulePeek(node, b, now) {
    clearTimeout(peekTimer);
    peekTimer = setTimeout(function () { showPeek(node, b); }, now ? 0 : 140);
  }

  function showPeek(node, b) {
    var p = $('#peek');
    if (!p) return;
    p.textContent = '';
    var url = Desk.getCoverURL(b);
    if (url) {
      var img = el('img');
      img.src = url; img.alt = '';
      p.appendChild(img);
    }
    var meta = el('div', 'peek-meta');
    meta.appendChild(el('div', 'peek-title serif', b.title));
    if (b.author) meta.appendChild(el('div', 'peek-author', b.author));
    var pr = Math.round(progressOf(b) * 100);
    var placeLbl = b.placement === 'both' ? ' · Hem Masa Hem Kitaplık' : ' · Kitaplıkta';
    meta.appendChild(el('div', 'peek-sub', (b.pages || 1) + ' sayfa' + ((b.page || 1) > 1 ? ' · %' + pr : '') + placeLbl));
    p.appendChild(meta);
    p.hidden = false;

    var r = node.getBoundingClientRect(), pw = p.offsetWidth, ph = p.offsetHeight;
    var left = clamp(r.left + r.width / 2 - pw / 2, 8, window.innerWidth - pw - 8);
    var top = r.top - ph - 14;
    if (top < 8) top = r.bottom + 14;
    p.style.left = left + 'px';
    p.style.top = top + 'px';
    p.classList.add('on');
  }

  function hidePeek() {
    clearTimeout(peekTimer);
    var p = $('#peek');
    if (!p) return;
    p.classList.remove('on');
    p.hidden = true;
  }

  function syncToolbarUI() {
    var mode = App.settings.shelfMode || 'spines';
    var mat = App.settings.bookcaseMat || 'ahsap';
    var collapsed = !!App.settings.bookcaseCollapsed;

    $$('#bc-mode-seg [data-shelf]').forEach(function (b) {
      var on = b.dataset.shelf === mode;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
    });
    $$('#bc-mat-seg [data-mat]').forEach(function (b) {
      var on = b.dataset.mat === mat;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
    });

    var bc = $('#desk-bookcase');
    var body = $('#bc-body');
    var tg = $('#btn-bc-toggle');
    if (bc) bc.classList.toggle('is-collapsed', collapsed);
    if (body) body.hidden = collapsed;
    if (tg) {
      tg.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      tg.innerHTML = '<svg class="ico" aria-hidden="true"><use href="#i-' + (collapsed ? 'down' : 'up') + '"/></svg>';
    }
  }

  function invalidate() { shownKey = ''; }

  function render() {
    var host = $('#shelves');
    if (!host) return;
    syncToolbarUI();

    var totalShelf = window.Desk && Desk.getShelfBooks ? Desk.getShelfBooks().length : 0;
    var countEl = $('#bc-count');
    if (countEl) countEl.textContent = totalShelf ? totalShelf + ' Kitap' : 'Boş';

    var list = filteredShelfBooks();
    var emptyEl = $('#bc-empty-note');
    if (emptyEl) emptyEl.hidden = totalShelf > 0;

    if (App.settings.bookcaseCollapsed) return;

    var mode = App.settings.shelfMode || 'spines';
    var mat = App.settings.bookcaseMat || 'ahsap';
    var W = host.clientWidth;
    if (!W) return;

    var key = [mode, mat, W, list.map(function (b) {
      return b.id + ':' + b.title + ':' + (b.author || '') + ':' + (b.page || 1) + ':' + (b.placement || '') + ':' + (b.color || '');
    }).join('|')].join('#');
    if (key === shownKey) return;
    shownKey = key;
    hidePeek();

    host.textContent = '';
    host.className = 'shelves mode-' + mode + ' mat-' + mat;

    var pad = W < 600 ? 12 : 18;
    var gap = mode === 'spines' ? 3 : 28;
    var geoms = list.map(function (b) { return mode === 'spines' ? spineGeom(b) : coverGeom(b); });
    var rows = [], cur = [], used = 0, avail = W - pad * 2;

    list.forEach(function (b, i) {
      var g = geoms[i];
      var extra = (mode === 'spines' && g.canLean) ? Math.round(g.h * Math.sin(g.deg * Math.PI / 180)) : 0;
      var w = g.w + extra;
      if (cur.length && used + gap + w > avail) { rows.push(cur); cur = []; used = 0; }
      used += (cur.length ? gap : 0) + w;
      cur.push(i);
    });
    if (cur.length) rows.push(cur);

    // Masanın önünde en az 1 raf görünümü korunsun
    if (!rows.length) rows.push([]);

    if (mode === 'spines') {
      rows.forEach(function (idxs) {
        if (idxs.length <= 1) return;
        var leanedCount = 0;
        idxs.forEach(function (idx, pos) {
          var g = geoms[idx];
          if (!g.canLean || leanedCount >= 2) { g.lean = 0; return; }
          var prevLeanedRight = pos > 0 && geoms[idxs[pos - 1]].lean > 0;
          var dir = g.prefDir;
          if (pos === 0) dir = 1;
          else if (pos === idxs.length - 1) dir = -1;
          else if (prevLeanedRight) { g.lean = 0; return; }
          g.lean = g.deg * dir;
          leanedCount++;
        });
      });
    }

    rows.forEach(function (idxs) {
      var row = el('div', 'shelf');
      var items = el('div', 'items');
      var caps = mode === 'covers' ? el('div', 'caps') : null;
      idxs.forEach(function (i) {
        var b = list[i], g = geoms[i];
        items.appendChild(mode === 'spines' ? spineEl(b, g) : coverEl(b, g));
        if (caps) caps.appendChild(capEl(b, g));
      });
      row.appendChild(items);
      row.appendChild(el('div', 'plank'));
      if (caps && idxs.length) row.appendChild(caps);
      host.appendChild(row);
    });
  }

  function init() {
    if (inited) return;
    inited = true;

    var sortSel = $('#bc-sort');
    if (sortSel) {
      if (App.settings.bcSort) sortSel.value = App.settings.bcSort;
      sortSel.addEventListener('change', function () {
        App.set('bcSort', this.value);
        invalidate();
        render();
      });
    }

    $$('#bc-mode-seg [data-shelf]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        App.set('shelfMode', btn.dataset.shelf);
        invalidate();
        render();
      });
    });

    $$('#bc-mat-seg [data-mat]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        App.set('bookcaseMat', btn.dataset.mat);
        invalidate();
        render();
      });
    });

    var toggleBtn = $('#btn-bc-toggle');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', function () {
        App.set('bookcaseCollapsed', !App.settings.bookcaseCollapsed);
        invalidate();
        render();
      });
    }

    var addShelfBtn = $('#btn-shelf-add-pdf');
    if (addShelfBtn) {
      shelfInput = document.createElement('input');
      shelfInput.type = 'file';
      shelfInput.accept = 'application/pdf,.pdf';
      shelfInput.multiple = true;
      shelfInput.hidden = true;
      document.body.appendChild(shelfInput);

      addShelfBtn.addEventListener('click', function () { shelfInput.click(); });
      shelfInput.addEventListener('change', function () {
        if (this.files && this.files.length && window.Desk && Desk.addFiles) {
          Desk.addFiles(this.files, 'shelf');
        }
        this.value = '';
      });
    }

    var host = $('#shelves');
    if (host && window.ResizeObserver) {
      ro = new ResizeObserver(function () {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(function () { invalidate(); render(); }, 90);
      });
      ro.observe(host);
    }
  }

  window.Bookcase = {
    init: init,
    render: render,
    invalidate: invalidate,
    sampleColor: sampleColor,
    upgradeColors: upgradeColors,
    COLOR_VERSION: COLOR_VERSION
  };
})();
