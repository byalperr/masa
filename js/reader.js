/* reader.js — PDF Okuyucu (Kitaplik motoru üzerine kurulu: sayfa çevirme, çift sayfa,
 * Space+tekerlek yakınlaştırma, piksel renklendirme, metin katmanı, arama, yer imleri, hızlı defter notu). */
(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var S = newState();
  function newState() {
    return {
      openToken: 0, book: null, pdf: null, n: 0, page: 1,
      token: 0, epoch: 0,
      sizes: {},
      cache: new Map(),
      cacheBytes: 0,
      inflight: new Map(),
      textCache: new Map(),
      bookmarks: [],
      saveTimer: null,
      search: { token: 0, q: '', nq: '', results: [], byPage: new Map(), cur: -1, scanning: false, noText: false, ptext: new Map(), totalChars: 0 }
    };
  }

  var stage, spreadEl, hideTimer = null, themePop = null, ro = null, resizeTimer = null, inited = false;

  function backToDeskHash() {
    var dId = (S.book && S.book.deskId) || (window.Desk && Desk.getActiveId());
    return dId ? '#/masa/' + encodeURIComponent(dId) : '#/';
  }

  function viewFor(page) {
    if (App.settings.viewMode !== 'spread') return [page];
    if (page <= 1) return [1];
    var start = page % 2 === 0 ? page : page - 1;
    return start + 1 <= S.n ? [start, start + 1] : [start];
  }
  function nextPage() {
    var v = viewFor(S.page), nxt = v[v.length - 1] + 1;
    return nxt <= S.n ? nxt : null;
  }
  function prevPage() {
    var v = viewFor(S.page);
    if (v[0] <= 1) return null;
    return viewFor(v[0] - 1)[0];
  }

  function baseInfo(p) {
    if (S.sizes[p]) return Promise.resolve(S.sizes[p]);
    var pdf = S.pdf;
    return pdf.getPage(p).then(function (pg) {
      var vp = pg.getViewport({ scale: 1 });
      return (S.sizes[p] = { w: vp.width, h: vp.height });
    });
  }

  var PAD_X = 20, PAD_Y = 20;
  function layoutFor(pages) {
    return Promise.all(pages.map(baseInfo)).then(function (infos) {
      var spread = App.settings.viewMode === 'spread';
      var availW = Math.max(120, stage.clientWidth - PAD_X * 2);
      var availH = Math.max(120, stage.clientHeight - PAD_Y * 2);
      var sumW = spread ? (infos.length === 2 ? infos[0].w + infos[1].w : infos[0].w * 2) : infos[0].w;
      var maxH = Math.max.apply(null, infos.map(function (i) { return i.h; }));
      var scaleW = availW / sumW;
      var scaleP = Math.min(scaleW, availH / maxH);
      var z = App.settings.zoom, scale;
      if (z === 'page') scale = scaleP;
      else if (z === 'custom') scale = scaleW * (App.settings.zoomFactor || 1);
      else scale = scaleW;
      return { infos: infos, scale: scale, scaleW: scaleW, scaleP: scaleP, spread: spread };
    });
  }

  function themeOpts() { var t = App.readerTheme(); return { bg: t.bg, fg: t.fg, key: t.key }; }

  function addCache(key, canvas) {
    var bytes = canvas.width * canvas.height * 4;
    if (S.cache.has(key)) { S.cacheBytes -= S.cache.get(key).bytes; S.cache.delete(key); }
    S.cache.set(key, { canvas: canvas, bytes: bytes });
    S.cacheBytes += bytes;
    var LIMIT = 220 * 1024 * 1024;
    while ((S.cacheBytes > LIMIT || S.cache.size > 9) && S.cache.size > 1) {
      var k = S.cache.keys().next().value;
      S.cacheBytes -= S.cache.get(k).bytes;
      S.cache.delete(k);
    }
  }
  function clearCache() {
    S.epoch++;
    S.inflight.forEach(function (r) { r.cancel(); });
    S.inflight.clear();
    S.cache.clear(); S.cacheBytes = 0;
  }
  function cancelUnwanted(wantedPages) {
    S.inflight.forEach(function (r, k) {
      if (wantedPages.indexOf(r.page) < 0) { r.cancel(); S.inflight.delete(k); }
    });
  }

  function renderCanvas(pageNum, cssW, cssH) {
    var th = themeOpts();
    var dprBase = window.devicePixelRatio || 1;
    var key = pageNum + '|' + Math.round(cssW) + 'x' + Math.round(cssH) + '|' + dprBase + '|' + th.key;
    var hit = S.cache.get(key);
    if (hit) { S.cache.delete(key); S.cache.set(key, hit); return Promise.resolve(hit.canvas); }
    var run = S.inflight.get(key);
    if (run) return run.promise;

    var epoch = S.epoch, pdf = S.pdf, task = null, cancelled = false;
    var rec = { page: pageNum, cancel: function () { cancelled = true; if (task) task.cancel(); } };
    rec.promise = pdf.getPage(pageNum).then(function (page) {
      if (cancelled) return null;
      var dpr = Math.min(dprBase, Math.sqrt(30e6 / (cssW * cssH)));
      var vp0 = page.getViewport({ scale: 1 });
      var vp = page.getViewport({ scale: (cssW * dpr) / vp0.width });
      var canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(vp.width));
      canvas.height = Math.max(1, Math.round(vp.height));
      var ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      task = page.render({ canvasContext: ctx, viewport: vp });
      return task.promise.then(function () {
        if (cancelled) return null;
        if (th.key !== 'kagit') Recolor.apply(canvas, th);
        if (epoch === S.epoch) addCache(key, canvas);
        return canvas;
      }, function (err) {
        if (err && err.name === 'RenderingCancelledException') return null;
        throw err;
      });
    });
    var done = function () { if (S.inflight.get(key) === rec) S.inflight.delete(key); };
    rec.promise.then(done, done);
    S.inflight.set(key, rec);
    return rec.promise;
  }

  function calcSpreadPadding(lay) {
    var stageW = (stage && stage.clientWidth) || 800;
    var stageH = (stage && stage.clientHeight) || 600;
    var bookW = 0, bookH = 0;
    if (lay && lay.infos && lay.infos.length) {
      var spread = lay.spread;
      var sumW = spread ? (lay.infos.length === 2 ? lay.infos[0].w + lay.infos[1].w : lay.infos[0].w * 2) : lay.infos[0].w;
      var maxH = Math.max.apply(null, lay.infos.map(function (i) { return i.h; }));
      bookW = Math.round(sumW * lay.scale);
      bookH = Math.round(maxH * lay.scale);
    } else {
      var targetEl = (spreadEl && spreadEl.firstElementChild) || spreadEl;
      if (targetEl) {
        bookW = targetEl.offsetWidth;
        bookH = targetEl.offsetHeight;
      }
    }
    bookW = Math.max(bookW, 100);
    bookH = Math.max(bookH, 100);
    var minX = Math.max(80, Math.round(bookW * 0.15));
    var minY = Math.max(80, Math.round(bookH * 0.15));
    var padX = Math.max(20, stageW - minX);
    var padY = Math.max(20, stageH - minY);
    return { padX: padX, padY: padY, bookW: bookW, bookH: bookH, stageW: stageW, stageH: stageH, minX: minX, minY: minY };
  }

  function getCenterScroll(p) {
    var scrollLeft = Math.round(p.padX - (p.stageW - p.bookW) / 2);
    var scrollTop;
    if (p.bookH <= p.stageH - 40) {
      scrollTop = Math.round(p.padY - (p.stageH - p.bookH) / 2);
    } else {
      scrollTop = Math.round(p.padY - 20);
    }
    return { left: scrollLeft, top: scrollTop };
  }

  var loadingTimer = null;
  function renderView(opts) {
    opts = opts || {};
    var token = ++S.token;
    var pages = viewFor(S.page);
    clearTimeout(loadingTimer);
    loadingTimer = setTimeout(function () { if (token === S.token) $('#r-loading').hidden = false; }, 350);
    var lay;
    return layoutFor(pages).then(function (l) {
      lay = l;
      if (token !== S.token) return null;
      var wanted = pages.slice();
      var nx = nextPage(), pv = prevPage();
      if (nx) wanted = wanted.concat(viewFor(nx)); if (pv) wanted = wanted.concat(viewFor(pv));
      cancelUnwanted(wanted);
      return Promise.all(pages.map(function (p, i) {
        var inf = l.infos[i];
        return renderCanvas(p, Math.round(inf.w * l.scale), Math.round(inf.h * l.scale));
      }));
    }).then(function (canvases) {
      if (token !== S.token || !canvases || canvases.some(function (c) { return !c; })) return;
      cancelSmoothScroll();
      if (typeof opts.beforeSwap === 'function') {
        if (opts.beforeSwap() === false) return;
      }
      var prevTargetEl = (spreadEl && spreadEl.firstElementChild) || spreadEl;
      var prevScreenX = prevTargetEl ? prevTargetEl.getBoundingClientRect().left : null;
      var prevScreenY = prevTargetEl ? prevTargetEl.getBoundingClientRect().top : null;

      var p = calcSpreadPadding(lay);
      spreadEl.style.padding = p.padY + 'px ' + p.padX + 'px';

      var frag = document.createDocumentFragment();
      var spread = lay.spread;
      var pageEls = [];
      var wrap = el('div', 'pages' + (spread ? ' is-spread' : '') + (spread && pages.length === 2 ? ' is-pair' : ''));
      if (spread && pages.length === 1 && pages[0] === 1) wrap.appendChild(placeholder(lay.infos[0], lay.scale));
      pages.forEach(function (pNum, i) {
        var inf = lay.infos[i];
        var pe = el('div', 'page');
        pe.style.width = Math.round(inf.w * lay.scale) + 'px';
        pe.style.height = Math.round(inf.h * lay.scale) + 'px';
        pe.dataset.page = pNum;
        pe.appendChild(canvases[i]);
        var tl = el('div', 'textLayer'); pe.appendChild(tl);
        if (hasBookmark(pNum)) pe.appendChild(el('span', 'ribbon'));
        wrap.appendChild(pe);
        pageEls.push({ p: pNum, pe: pe, tl: tl, scale: lay.scale });
      });
      if (spread && pages.length === 1 && pages[0] !== 1) wrap.appendChild(placeholder(lay.infos[0], lay.scale));
      frag.appendChild(wrap);
      spreadEl.textContent = '';
      spreadEl.appendChild(frag);
      if (opts.animate && !reduceMotion) { wrap.classList.add('enter'); }

      var maxScrollX = Math.max(0, p.bookW + 2 * p.padX - p.stageW);
      var maxScrollY = Math.max(0, p.bookH + 2 * p.padY - p.stageH);

      if (opts.center || prevScreenX == null || prevScreenY == null) {
        var centerPos = getCenterScroll(p);
        stage.scrollLeft = centerPos.left;
        stage.scrollTop = centerPos.top;
      } else if (opts.edge === 'top') {
        stage.scrollTop = p.padY - 20;
        if (prevScreenX != null) stage.scrollLeft = clamp(Math.round(p.padX - prevScreenX), 0, maxScrollX);
      } else if (opts.edge === 'bottom') {
        stage.scrollTop = Math.max(p.padY - 20, p.padY + p.bookH + 20 - p.stageH);
        if (prevScreenX != null) stage.scrollLeft = clamp(Math.round(p.padX - prevScreenX), 0, maxScrollX);
      } else if (opts.keepScroll && (wheelZooming || wheelCommitInFlight)) {
        /* zoom commit */
      } else {
        stage.scrollLeft = clamp(Math.round(p.padX - prevScreenX), 0, maxScrollX);
        stage.scrollTop = clamp(Math.round(p.padY - prevScreenY), 0, maxScrollY);
      }

      lay.cur = { scale: lay.scale };
      S.lastLayout = lay;
      updateZoomButtons(lay);
      if (typeof opts.afterSwap === 'function') opts.afterSwap();
      pageEls.forEach(function (x) { renderText(x, token); });
      scheduleIdlePrefetch(token);
    }).catch(function (err) {
      console.error(err);
      if (token === S.token) App.toast('Sayfa çizilemedi.', 'error');
    }).then(function () {
      clearTimeout(loadingTimer);
      if (token === S.token) $('#r-loading').hidden = true;
    });
  }

  function placeholder(inf, scale) {
    var d = el('div', 'page ghost');
    d.style.width = Math.round(inf.w * scale) + 'px';
    d.style.height = Math.round(inf.h * scale) + 'px';
    return d;
  }

  var prefetchTimer = null;
  function scheduleIdlePrefetch(token) {
    clearTimeout(prefetchTimer);
    prefetchTimer = setTimeout(function () {
      if (token !== S.token) return;
      var list = [];
      var nx = nextPage(), pv = prevPage();
      if (nx) list.push(viewFor(nx)); if (pv) list.push(viewFor(pv));
      var chain = Promise.resolve();
      list.forEach(function (pages) {
        chain = chain.then(function () {
          if (token !== S.token) return;
          return layoutFor(pages).then(function (l) {
            return pages.reduce(function (pr, p, i) {
              return pr.then(function () {
                if (token !== S.token) return;
                var inf = l.infos[i];
                return renderCanvas(p, Math.round(inf.w * l.scale), Math.round(inf.h * l.scale));
              });
            }, Promise.resolve());
          });
        });
      });
      chain.catch(function () {});
    }, 120);
  }

  function pageStringInfo(items) {
    var offs = new Array(items.length), parts = [], len = 0;
    for (var i = 0; i < items.length; i++) {
      offs[i] = len;
      var t = items[i].str || '';
      parts.push(t); len += t.length;
      if (items[i].hasEOL) { parts.push(' '); len += 1; }
    }
    return { s: parts.join(''), offs: offs };
  }

  function getContent(pageNum) {
    var c = S.textCache.get(pageNum);
    if (c) return Promise.resolve(c);
    var pdf = S.pdf;
    return pdf.getPage(pageNum).then(function (pg) {
      return pg.getTextContent();
    }).then(function (content) {
      var rec = { content: content, info: pageStringInfo(content.items) };
      S.textCache.set(pageNum, rec);
      if (S.textCache.size > 14) S.textCache.delete(S.textCache.keys().next().value);
      return rec;
    });
  }

  function renderText(x, token) {
    var pdf = S.pdf;
    Promise.all([pdf.getPage(x.p), getContent(x.p)]).then(function (res) {
      if (token !== S.token || !x.pe.isConnected) return;
      var vp = res[0].getViewport({ scale: x.scale });
      x.tl.style.setProperty('--scale-factor', vp.scale);
      var divs = [], strs = [];
      var tk = pdfjsLib.renderTextLayer({
        textContentSource: res[1].content, container: x.tl, viewport: vp,
        textDivs: divs, textContentItemsStr: strs
      });
      return tk.promise.then(function () {
        x.divs = divs; x.items = res[1].content.items; x.info = res[1].info;
        x.tl._x = x;
        applyHighlights(x, false);
        if (S.jumpScroll && S.jumpScroll === x.p) { S.jumpScroll = 0; scrollToCurrentHit(); }
      });
    }).catch(function (e) { if (!(e && e.name === 'AbortException')) console.warn('Metin katmanı', e); });
  }

  var normCache = {};
  function normFn(c) {
    var r = normCache[c];
    if (r === undefined) {
      r = c === 'ı' ? 'i' : c.normalize('NFKD').charAt(0);
      normCache[c] = r;
    }
    return r;
  }
  function norm(s) {
    var t = s.toLocaleLowerCase('tr');
    if (t.length !== s.length) {
      t = '';
      for (var i = 0; i < s.length; i++) {
        var c = s.charAt(i).toLocaleLowerCase('tr');
        t += c.length === 1 ? c : s.charAt(i).toLowerCase().charAt(0);
      }
    }
    return t.replace(/[\u00C0-\u024F\u1E00-\u1EFF\uFB00-\uFB06\u0300-\u036F]/g, function (c) {
      return normFn(c);
    });
  }

  function hlRanges(x) {
    var list = S.search.byPage.get(x.p);
    if (!list || !list.length) return null;
    var items = x.items, offs = x.info.offs, ranges = {};
    var cur = S.search.results[S.search.cur];
    list.forEach(function (r) {
      var a = r.idx, b = r.idx + r.len;
      for (var i = 0; i < items.length; i++) {
        var st = offs[i], en = st + (items[i].str || '').length;
        if (en <= a) continue;
        if (st >= b) break;
        (ranges[i] = ranges[i] || []).push([Math.max(a, st) - st, Math.min(b, en) - st, r === cur]);
      }
    });
    return ranges;
  }
  function applyHighlights(x, scroll) {
    if (!x.divs || !x.items || x.divs.length !== x.items.length) return;
    if (x.marked) {
      x.marked.forEach(function (i) { x.divs[i].textContent = x.items[i].str; });
      x.marked = null;
    }
    var ranges = hlRanges(x);
    if (!ranges) return;
    x.marked = [];
    Object.keys(ranges).forEach(function (k) {
      var i = +k, d = x.divs[i], str = x.items[i].str;
      var rs = ranges[k].sort(function (a, b) { return a[0] - b[0]; });
      d.textContent = '';
      var pos = 0;
      rs.forEach(function (r) {
        if (r[0] < pos) return;
        if (r[0] > pos) d.appendChild(document.createTextNode(str.slice(pos, r[0])));
        var m = el('mark', 'hl' + (r[2] ? ' cur' : ''), str.slice(r[0], r[1]));
        d.appendChild(m);
        pos = r[1];
      });
      if (pos < str.length) d.appendChild(document.createTextNode(str.slice(pos)));
      x.marked.push(i);
    });
    if (scroll) scrollToCurrentHit();
  }
  function rehighlightVisible(scroll) {
    $$('.textLayer', spreadEl).forEach(function (tl) { if (tl._x) applyHighlights(tl._x, scroll); });
  }
  function scrollToCurrentHit() {
    var m = spreadEl.querySelector('mark.cur');
    if (!m) return;
    var sr = stage.getBoundingClientRect(), r = m.getBoundingClientRect();
    if (r.top < sr.top + 40 || r.bottom > sr.bottom - 40 || r.left < sr.left || r.right > sr.right) {
      m.scrollIntoView({ block: 'center', inline: 'center', behavior: reduceMotion ? 'auto' : 'smooth' });
    }
  }

  function goTo(page, opts) {
    opts = opts || {};
    cancelSmoothScroll();
    if (wheelZooming || wheelCommitInFlight) cleanupWheelZoom();
    page = clamp(Math.round(page) || 1, 1, S.n);
    var first = viewFor(page)[0];
    var same = first === S.page && !opts.force;
    S.page = first;
    updateNavUI();
    queueSave();
    if (same) return;
    opts.animate = opts.animate !== false;
    renderView(opts);
  }
  function next(opts) { var p = nextPage(); if (p) goTo(p, opts); }
  function prev(opts) { var p = prevPage(); if (p) goTo(p, opts); }

  function scrollOrFlip(dir, frac) {
    var p = calcSpreadPadding(S.lastLayout);
    var minScrollY = p.padY - 20;
    var maxScrollY = p.padY + p.bookH + 20 - p.stageH;
    var isTall = p.bookH + 40 > p.stageH;
    if (isTall) {
      var cur = stage.scrollTop;
      if (dir > 0 && cur < maxScrollY - 4) {
        var stepDown = Math.min(stage.clientHeight * frac, maxScrollY - cur);
        stage.scrollBy({ top: stepDown, behavior: reduceMotion ? 'auto' : 'smooth' });
        return;
      }
      if (dir < 0 && cur > minScrollY + 4) {
        var stepUp = Math.min(stage.clientHeight * frac, cur - minScrollY);
        stage.scrollBy({ top: -stepUp, behavior: reduceMotion ? 'auto' : 'smooth' });
        return;
      }
      if (dir > 0) next({ edge: 'top' }); else prev({ edge: 'bottom' });
      return;
    }
    if (dir > 0) next(); else prev();
  }

  function updateNavUI() {
    var v = viewFor(S.page);
    var label = v.length === 2 ? v[0] + '–' + v[1] : String(v[0]);
    var inp = $('#r-pageinput');
    if (document.activeElement !== inp) inp.value = label;
    var lastPage = v[v.length - 1];
    var total = S.n || 1;
    var pct = S.n > 0 ? (lastPage / S.n) * 100 : 0;
    var prog = $('#r-progress');
    if (prog) {
      prog.setAttribute('aria-valuenow', lastPage);
      prog.setAttribute('aria-valuemin', 1);
      prog.setAttribute('aria-valuemax', total);
      var fill = $('#r-progress-fill');
      if (fill) fill.style.width = Math.min(100, Math.max(0, pct)) + '%';
    }
    $('#r-total').textContent = S.n;
    updateBookmarkUI();
    if (window.Notebook && Notebook.updateSidePanelContext) {
      Notebook.updateSidePanelContext(S.book, S.page);
    }
  }

  function queueSave() {
    if (window.Hafiza && S.book && S.pdf) Hafiza.page(S.book.id, S.page, S.n, S.book.deskId || '');
    clearTimeout(S.saveTimer);
    S.saveTimer = setTimeout(flush, 450);
  }
  function flush() {
    clearTimeout(S.saveTimer);
    S.saveTimer = null;
    if (!S.book || !S.pdf) return;
    var patch = { page: S.page, lastReadAt: Date.now() };
    S.book.page = S.page;
    S.book.lastReadAt = patch.lastReadAt;
    if (window.Desk) Desk.updateBookLocal(S.book.id, patch);
    DB.updateBook(S.book.id, patch).catch(function () {});
  }

  function effectiveFactor() {
    var l = S.lastLayout;
    if (!l) return 1;
    return l.scale / l.scaleW;
  }
  function zoomBy(mult) {
    if (wheelZooming || wheelCommitInFlight) cleanupWheelZoom();
    var f = clamp(effectiveFactor() * mult, 0.35, 4);
    App.set('zoom', 'custom'); App.set('zoomFactor', f);
    renderView({ keepScroll: true });
  }
  function setZoomMode(m) {
    if (wheelZooming || wheelCommitInFlight) cleanupWheelZoom();
    App.set('zoom', m);
    renderView({ center: true });
  }
  function updateZoomButtons() {
    var z = App.settings.zoom;
    $('#r-fitw').setAttribute('aria-pressed', z === 'width');
    $('#r-fitp').setAttribute('aria-pressed', z === 'page');
    $('#r-fitw').classList.toggle('on', z === 'width');
    $('#r-fitp').classList.toggle('on', z === 'page');
  }

  var wheelZooming = false, wheelCommitInFlight = false, wheelDebounce = null, wheelRafId = null;
  var wheelBaseFactor = 1, wheelTargetFactor = 1;
  var wheelTargetScale = 1, wheelCurrentScale = 1;
  var wheelCurrentTx = 0, wheelCurrentTy = 0;
  var wheelSpreadBaseLeft = 0, wheelSpreadBaseTop = 0;
  var wheelAnchorUx = 0, wheelAnchorUy = 0;
  var wheelAnchorLocalX = 0, wheelAnchorLocalY = 0;
  var wheelAnchorClientX = 0, wheelAnchorClientY = 0;
  var commitToken = 0;

  function cleanupWheelZoom() {
    cancelSmoothScroll();
    if (wheelDebounce) { clearTimeout(wheelDebounce); wheelDebounce = null; }
    if (wheelRafId) { cancelAnimationFrame(wheelRafId); wheelRafId = null; }
    commitToken++;
    if (wheelCommitInFlight) App.set('zoomFactor', effectiveFactor());
    wheelZooming = false;
    wheelCommitInFlight = false;
    if (spreadEl) {
      spreadEl.style.transform = '';
      spreadEl.style.transformOrigin = '';
      spreadEl.style.willChange = '';
    }
  }

  function stepWheelZoom() {
    wheelRafId = null;
    if (!wheelZooming) return;
    if (reduceMotion) {
      wheelCurrentScale = wheelTargetScale;
    } else {
      wheelCurrentScale += (wheelTargetScale - wheelCurrentScale) * 0.25;
      if (Math.abs(wheelTargetScale - wheelCurrentScale) < 0.001) wheelCurrentScale = wheelTargetScale;
    }
    wheelCurrentTx = (wheelAnchorClientX - wheelSpreadBaseLeft) - wheelCurrentScale * wheelAnchorUx;
    wheelCurrentTy = (wheelAnchorClientY - wheelSpreadBaseTop) - wheelCurrentScale * wheelAnchorUy;
    if (spreadEl) {
      spreadEl.style.transform = 'translate(' + wheelCurrentTx + 'px, ' + wheelCurrentTy + 'px) scale(' + wheelCurrentScale + ')';
    }
    if (Math.abs(wheelTargetScale - wheelCurrentScale) >= 0.001) {
      wheelRafId = requestAnimationFrame(stepWheelZoom);
    }
  }

  function commitWheelZoom() {
    if (!wheelZooming || wheelCommitInFlight) return;
    clearTimeout(wheelDebounce);
    wheelDebounce = null;
    if (wheelRafId) { cancelAnimationFrame(wheelRafId); wheelRafId = null; }

    wheelCurrentScale = wheelTargetScale;
    wheelCurrentTx = (wheelAnchorClientX - wheelSpreadBaseLeft) - wheelCurrentScale * wheelAnchorUx;
    wheelCurrentTy = (wheelAnchorClientY - wheelSpreadBaseTop) - wheelCurrentScale * wheelAnchorUy;
    if (spreadEl) {
      spreadEl.style.transform = 'translate(' + wheelCurrentTx + 'px, ' + wheelCurrentTy + 'px) scale(' + wheelCurrentScale + ')';
    }

    var targetFactor = wheelTargetFactor;
    var baseFactor = wheelBaseFactor;
    var ratio = targetFactor / baseFactor;

    if (Math.abs(ratio - 1) < 0.001) { cleanupWheelZoom(); return; }

    var myToken = ++commitToken;
    wheelCommitInFlight = true;

    var savedAnchorLocalX = wheelAnchorLocalX;
    var savedAnchorLocalY = wheelAnchorLocalY;
    var savedAnchorClientX = wheelAnchorClientX;
    var savedAnchorClientY = wheelAnchorClientY;
    var savedRatio = ratio;

    App.set('zoom', 'custom');
    App.set('zoomFactor', targetFactor);

    renderView({
      keepScroll: true,
      beforeSwap: function () { if (myToken !== commitToken) return false; },
      afterSwap: function () {
        if (myToken !== commitToken) return;
        if (spreadEl) {
          spreadEl.style.transform = '';
          spreadEl.style.transformOrigin = '';
          spreadEl.style.willChange = '';
        }
        var targetEl = (spreadEl && spreadEl.firstElementChild) || spreadEl;
        if (targetEl) {
          var tRectAfter = targetEl.getBoundingClientRect();
          var curX = tRectAfter.left + savedAnchorLocalX * savedRatio;
          var curY = tRectAfter.top + savedAnchorLocalY * savedRatio;
          stage.scrollLeft += Math.round(curX - savedAnchorClientX);
          stage.scrollTop += Math.round(curY - savedAnchorClientY);
        }
        wheelZooming = false;
        wheelCommitInFlight = false;
      }
    }).catch(function () {
      if (myToken === commitToken) cleanupWheelZoom();
    });
  }

  var smoothScrollRafId = null, smoothScrollTargetX = null, smoothScrollTargetY = null;
  function cancelSmoothScroll() {
    if (smoothScrollRafId) { cancelAnimationFrame(smoothScrollRafId); smoothScrollRafId = null; }
    smoothScrollTargetX = null;
    smoothScrollTargetY = null;
  }

  function stepSmoothScroll() {
    smoothScrollRafId = null;
    if (smoothScrollTargetX == null || smoothScrollTargetY == null) return;
    var curX = stage.scrollLeft, curY = stage.scrollTop;
    var diffX = smoothScrollTargetX - curX, diffY = smoothScrollTargetY - curY;
    var newX = Math.abs(diffX) < 0.5 ? smoothScrollTargetX : curX + diffX * 0.25;
    var newY = Math.abs(diffY) < 0.5 ? smoothScrollTargetY : curY + diffY * 0.25;
    stage.scrollLeft = Math.round(newX);
    stage.scrollTop = Math.round(newY);
    if (Math.abs(smoothScrollTargetX - stage.scrollLeft) >= 1 || Math.abs(smoothScrollTargetY - stage.scrollTop) >= 1) {
      smoothScrollRafId = requestAnimationFrame(stepSmoothScroll);
    } else {
      stage.scrollLeft = smoothScrollTargetX;
      stage.scrollTop = smoothScrollTargetY;
      smoothScrollTargetX = null;
      smoothScrollTargetY = null;
    }
  }

  function handleNormalWheel(e) {
    var p = calcSpreadPadding(S.lastLayout);
    var center = getCenterScroll(p);
    var limitMinY = p.bookH + 40 <= p.stageH ? center.top : p.padY - 20;
    var limitMaxY = p.bookH + 40 <= p.stageH ? center.top : p.padY + p.bookH + 20 - p.stageH;
    var limitMinX = p.bookW + 40 <= p.stageW ? center.left : p.padX - 20;
    var limitMaxX = p.bookW + 40 <= p.stageW ? center.left : p.padX + p.bookW + 20 - p.stageW;

    var dx = e.deltaX || 0, dy = e.deltaY || 0;
    if (e.deltaMode === 1) { dx *= 33; dy *= 33; }
    else if (e.deltaMode === 2) { dx *= 600; dy *= 600; }

    var curX = smoothScrollTargetX != null ? smoothScrollTargetX : stage.scrollLeft;
    var curY = smoothScrollTargetY != null ? smoothScrollTargetY : stage.scrollTop;
    var nextX = curX, nextY = curY;

    if (Math.abs(dy) > 0.1) nextY = dy > 0 ? Math.min(curY + dy, Math.max(curY, limitMaxY)) : Math.max(curY + dy, Math.min(curY, limitMinY));
    if (Math.abs(dx) > 0.1) nextX = dx > 0 ? Math.min(curX + dx, Math.max(curX, limitMaxX)) : Math.max(curX + dx, Math.min(curX, limitMinX));

    if (nextX === stage.scrollLeft && nextY === stage.scrollTop && nextX === curX && nextY === curY) {
      e.preventDefault();
      return;
    }
    smoothScrollTargetX = nextX;
    smoothScrollTargetY = nextY;
    if (reduceMotion) {
      stage.scrollLeft = nextX;
      stage.scrollTop = nextY;
      cancelSmoothScroll();
    } else if (!smoothScrollRafId) {
      smoothScrollRafId = requestAnimationFrame(stepSmoothScroll);
    }
    e.preventDefault();
  }

  function onWheel(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (!S.pdf) return;
    if (!stage.contains(e.target) && !e.target.closest('.edge')) return;
    if (!pan.on) { handleNormalWheel(e); return; }

    cancelSmoothScroll();
    var dy = e.deltaY;
    if (e.deltaMode === 1) dy *= 33;
    else if (e.deltaMode === 2) dy *= 600;
    if (Math.abs(dy) < 0.1) return;
    dy = clamp(dy, -500, 500);
    e.preventDefault();
    pan.moved = true;

    var targetEl = (spreadEl && spreadEl.firstElementChild) || spreadEl;
    if (!targetEl || !spreadEl) return;
    if (wheelCommitInFlight) { commitToken++; wheelCommitInFlight = false; }

    if (!wheelZooming) {
      wheelZooming = true;
      wheelBaseFactor = effectiveFactor();
      wheelTargetFactor = wheelBaseFactor;
      wheelCurrentScale = 1;
      wheelTargetScale = 1;
      wheelCurrentTx = 0;
      wheelCurrentTy = 0;
      var sRect = spreadEl.getBoundingClientRect();
      wheelSpreadBaseLeft = sRect.left;
      wheelSpreadBaseTop = sRect.top;
      spreadEl.style.transformOrigin = '0 0';
      spreadEl.style.willChange = 'transform';
    }

    var tRect = targetEl.getBoundingClientRect();
    wheelAnchorClientX = e.clientX;
    wheelAnchorClientY = e.clientY;
    wheelAnchorLocalX = (e.clientX - tRect.left) / wheelCurrentScale;
    wheelAnchorLocalY = (e.clientY - tRect.top) / wheelCurrentScale;
    wheelAnchorUx = (e.clientX - wheelSpreadBaseLeft - wheelCurrentTx) / wheelCurrentScale;
    wheelAnchorUy = (e.clientY - wheelSpreadBaseTop - wheelCurrentTy) / wheelCurrentScale;

    var mult = Math.exp(-dy * 0.0015);
    wheelTargetFactor = clamp(wheelTargetFactor * mult, 0.35, 4);
    wheelTargetScale = wheelTargetFactor / wheelBaseFactor;

    if (reduceMotion) {
      wheelCurrentScale = wheelTargetScale;
      wheelCurrentTx = (wheelAnchorClientX - wheelSpreadBaseLeft) - wheelCurrentScale * wheelAnchorUx;
      wheelCurrentTy = (wheelAnchorClientY - wheelSpreadBaseTop) - wheelCurrentScale * wheelAnchorUy;
      spreadEl.style.transform = 'translate(' + wheelCurrentTx + 'px, ' + wheelCurrentTy + 'px) scale(' + wheelCurrentScale + ')';
    } else if (!wheelRafId) {
      wheelRafId = requestAnimationFrame(stepWheelZoom);
    }
    clearTimeout(wheelDebounce);
    wheelDebounce = setTimeout(commitWheelZoom, 300);
  }

  function setMode(m) {
    if (App.settings.viewMode === m) return;
    App.set('viewMode', m);
    syncModeButtons();
    S.page = viewFor(S.page)[0];
    updateNavUI();
    renderView({ center: true });
  }
  function syncModeButtons() {
    var m = App.settings.viewMode;
    $('#r-single').classList.toggle('on', m !== 'spread');
    $('#r-spread').classList.toggle('on', m === 'spread');
    $('#r-single').setAttribute('aria-pressed', m !== 'spread');
    $('#r-spread').setAttribute('aria-pressed', m === 'spread');
  }

  function buildThemeList() {
    var box = $('#theme-list'); box.textContent = '';
    ['kagit', 'sepya', 'gece', 'amber', 'ozel'].forEach(function (k) {
      var t = App.READER_THEMES[k];
      var b = el('button', 'theme-opt'); b.type = 'button'; b.dataset.theme = k;
      b.setAttribute('role', 'radio');
      var sw = el('span', 'sw', 'Aa'); sw.dataset.k = k;
      b.appendChild(sw); b.appendChild(el('span', 'nm', t.name));
      b.addEventListener('click', function () { chooseTheme(k); });
      box.appendChild(b);
    });
    syncThemeUI();
  }
  function syncThemeUI() {
    var cur = App.settings.theme;
    $$('.theme-opt').forEach(function (b) {
      var k = b.dataset.theme, on = k === cur;
      b.setAttribute('aria-checked', on); b.classList.toggle('on', on);
      var sw = b.querySelector('.sw');
      var bg = k === 'ozel' ? App.settings.customBg : App.READER_THEMES[k].bg;
      var fg = k === 'ozel' ? App.settings.customFg : App.READER_THEMES[k].fg;
      sw.style.background = bg; sw.style.color = fg;
    });
    $('#custom-colors').hidden = cur !== 'ozel';
    $('#c-bg').value = App.settings.customBg; $('#c-fg').value = App.settings.customFg;
    $('#r-bright').value = App.settings.bright;
    spreadEl.style.filter = App.settings.bright < 100 ? 'brightness(' + (App.settings.bright / 100) + ')' : '';
    syncReaderBgUI();
  }
  function syncReaderBgUI() {
    var cur = App.settings.readerBg || 'none';
    $$('#pop-theme [data-rbg]').forEach(function (b) {
      var on = b.dataset.rbg === cur;
      b.setAttribute('aria-checked', on ? 'true' : 'false');
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.classList.toggle('on', on);
    });
  }
  function chooseTheme(k) { App.set('theme', k); applyThemeChange(); }
  function applyThemeChange() {
    App.applyReaderPalette();
    syncThemeUI();
    clearCache();
    renderView({ keepScroll: true });
  }

  function hasBookmark(p) { return S.bookmarks.some(function (b) { return b.page === p; }); }
  function viewHasBookmark() { return viewFor(S.page).some(hasBookmark); }
  function updateBookmarkUI() {
    var on = viewHasBookmark();
    var b = $('#r-bm');
    b.classList.toggle('on', on); b.setAttribute('aria-pressed', on);
    b.setAttribute('aria-label', on ? 'Yer imini kaldır (B)' : 'Bu sayfaya yer imi koy (B)');
    $$('.page', spreadEl).forEach(function (pe) {
      var p = +pe.dataset.page; if (!p) return;
      var r = pe.querySelector('.ribbon');
      if (hasBookmark(p) && !r) pe.appendChild(el('span', 'ribbon'));
      else if (!hasBookmark(p) && r) r.remove();
    });
  }
  function toggleBookmark() {
    if (!S.book) return;
    var pages = viewFor(S.page);
    var existing = S.bookmarks.filter(function (b) { return pages.indexOf(b.page) >= 0; });
    if (existing.length) {
      existing.forEach(function (b) { DB.deleteBookmark(b.id); });
      S.bookmarks = S.bookmarks.filter(function (b) { return existing.indexOf(b) < 0; });
      renderBookmarks(); updateBookmarkUI();
      App.toast('Yer imi kaldırıldı.', '', 1800);
      return;
    }
    var bm = { id: DB.uid(), bookId: S.book.id, page: S.page, note: '', createdAt: Date.now() };
    S.bookmarks.push(bm);
    DB.putBookmark(bm);
    renderBookmarks(); updateBookmarkUI();
    App.toast('Yer imi eklendi · sayfa ' + bm.page, '', 1800);
  }
  function renderBookmarks() {
    var box = $('#bm-list'); box.textContent = '';
    var list = S.bookmarks.slice().sort(function (a, b) { return a.page - b.page; });
    if (!list.length) {
      box.appendChild(el('p', 'side-empty', 'Henüz yer imi yok. Bir sayfada B tuşuna bas.'));
      return;
    }
    var fmt = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' });
    list.forEach(function (bm) {
      var row = el('div', 'bm-row');
      var go = el('button', 'bm-go'); go.type = 'button';
      go.appendChild(el('span', 'bm-pg', String(bm.page)));
      row.appendChild(go);
      var mid = el('div', 'bm-mid');
      var inp = el('input', 'bm-note'); inp.type = 'text'; inp.maxLength = 200;
      inp.placeholder = 'Not ekle'; inp.value = bm.note || '';
      inp.addEventListener('change', function () { bm.note = inp.value.trim(); DB.putBookmark(bm); });
      inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') inp.blur(); });
      mid.appendChild(inp);
      mid.appendChild(el('span', 'bm-date', fmt.format(new Date(bm.createdAt))));
      row.appendChild(mid);
      var del = el('button', 'btn icon small'); del.type = 'button';
      del.innerHTML = '<svg class="ico" aria-hidden="true"><use href="#i-trash"/></svg>';
      del.addEventListener('click', function () {
        DB.deleteBookmark(bm.id);
        S.bookmarks = S.bookmarks.filter(function (b) { return b !== bm; });
        renderBookmarks(); updateBookmarkUI();
      });
      row.appendChild(del);
      go.addEventListener('click', function () { goTo(bm.page); });
      box.appendChild(row);
    });
  }

  function resolveDest(dest) {
    var pdf = S.pdf;
    var p = typeof dest === 'string' ? pdf.getDestination(dest) : Promise.resolve(dest);
    return p.then(function (d) {
      if (!d || !d.length) return null;
      var ref = d[0];
      if (ref && typeof ref === 'object') return pdf.getPageIndex(ref).then(function (i) { return i + 1; });
      if (Number.isInteger(ref)) return ref + 1;
      return null;
    }).catch(function () { return null; });
  }
  function buildOutline(items, depth) {
    var ul = el('ul', 'toc-ul');
    items.forEach(function (it) {
      var li = el('li');
      var row = el('div', 'toc-row');
      var kids = it.items && it.items.length;
      var tg = el('button', 'toc-tg'); tg.type = 'button';
      if (kids) {
        tg.innerHTML = '<svg class="ico" aria-hidden="true"><use href="#i-chev"/></svg>';
        tg.setAttribute('aria-expanded', depth < 1);
      } else { tg.disabled = true; tg.tabIndex = -1; tg.className += ' none'; }
      row.appendChild(tg);
      var a = el('button', 'toc-link', it.title || '—'); a.type = 'button';
      a.addEventListener('click', function () {
        resolveDest(it.dest).then(function (pg) { if (pg) goTo(pg); else App.toast('Bu başlığın hedefi bulunamadı.'); });
      });
      row.appendChild(a);
      li.appendChild(row);
      if (kids) {
        var sub = buildOutline(it.items, depth + 1);
        sub.hidden = depth >= 1;
        li.classList.toggle('open', depth < 1);
        tg.addEventListener('click', function () {
          sub.hidden = !sub.hidden; li.classList.toggle('open', !sub.hidden);
          tg.setAttribute('aria-expanded', !sub.hidden);
        });
        li.appendChild(sub);
      }
      ul.appendChild(li);
    });
    return ul;
  }
  function loadOutline(token) {
    var box = $('#toc-list'); box.textContent = '';
    S.pdf.getOutline().then(function (o) {
      if (token !== S.openToken) return;
      if (!o || !o.length) { box.appendChild(el('p', 'side-empty', 'Bu kitapta içindekiler tablosu yok.')); S.hasToc = false; return; }
      S.hasToc = true;
      box.appendChild(buildOutline(o, 0));
    }).catch(function () { box.appendChild(el('p', 'side-empty', 'İçindekiler okunamadı.')); });
  }

  var searchDebounce = null;
  function onQueryInput() {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(function () { runSearch($('#q').value); }, 260);
  }
  function resetSearchResults() {
    var s = S.search;
    s.results = []; s.byPage = new Map(); s.cur = -1;
    $('#q-results').textContent = '';
    rehighlightVisible(false);
  }
  function getPageSearchText(p) {
    var s = S.search;
    var c = s.ptext.get(p);
    if (c) return Promise.resolve(c);
    return S.pdf.getPage(p).then(function (pg) { return pg.getTextContent(); }).then(function (content) {
      var info = pageStringInfo(content.items);
      var rec = { s: info.s, n: norm(info.s) };
      s.ptext.set(p, rec);
      s.totalChars += rec.s.replace(/\s/g, '').length;
      return rec;
    });
  }
  function setStatus(msg) { $('#q-status').textContent = msg; }

  function runSearch(q) {
    var s = S.search, tok = ++s.token;
    q = q.replace(/\s+/g, ' ').trim();
    s.q = q; s.nq = q ? norm(q) : '';
    resetSearchResults();
    s.noText = false;
    if (!s.nq) { s.scanning = false; setStatus(''); return; }
    s.scanning = true;
    setStatus('Aranıyor…');
    var MAXRES = 2000, MAXLI = 400;
    var listEl = $('#q-results');
    var p = 1, sinceYield = 0;

    function step() {
      if (tok !== s.token) return;
      if (p > S.n) { finish(); return; }
      var cur = p++;
      getPageSearchText(cur).then(function (rec) {
        if (tok !== s.token) return;
        var from = 0, idx, added = 0;
        while (s.results.length < MAXRES && (idx = rec.n.indexOf(s.nq, from)) >= 0) {
          var r = { page: cur, idx: idx, len: s.nq.length };
          s.results.push(r); added++;
          var arr = s.byPage.get(cur); if (!arr) s.byPage.set(cur, arr = []);
          arr.push(r);
          if (listEl.children.length < MAXLI) listEl.appendChild(resultItem(r, rec, s.results.length - 1));
          from = idx + Math.max(1, s.nq.length);
        }
        if (added && viewFor(S.page).indexOf(cur) >= 0) rehighlightVisible(false);
        sinceYield++;
        if (added || sinceYield >= 8 || cur === S.n) {
          sinceYield = 0;
          setStatus(s.results.length + ' sonuç · ' + cur + '/' + S.n + ' sayfa tarandı');
          setTimeout(step, 0);
        } else step();
      }).catch(function () { setTimeout(step, 0); });
    }
    function finish() {
      s.scanning = false;
      if (!s.results.length) {
        setStatus(s.totalChars < 5 ? 'Bu kitapta aranabilir metin yok.' : 'Sonuç bulunamadı.');
        s.noText = s.totalChars < 5;
      } else {
        setStatus(s.results.length + ' sonuç' + (s.results.length >= MAXRES ? ' (ilk ' + MAXRES + ')' : ''));
      }
    }
    step();
  }
  function resultItem(r, rec, i) {
    var li = el('li');
    var b = el('button', 'q-item'); b.type = 'button'; b.dataset.i = i;
    b.appendChild(el('span', 'q-pg', 's. ' + r.page));
    var a = Math.max(0, r.idx - 36), e = Math.min(rec.s.length, r.idx + r.len + 56);
    var sn = el('span', 'q-snip');
    sn.appendChild(document.createTextNode((a > 0 ? '…' : '') + rec.s.slice(a, r.idx).replace(/\s+/g, ' ')));
    sn.appendChild(el('mark', null, rec.s.slice(r.idx, r.idx + r.len)));
    sn.appendChild(document.createTextNode(rec.s.slice(r.idx + r.len, e).replace(/\s+/g, ' ') + (e < rec.s.length ? '…' : '')));
    b.appendChild(sn);
    b.addEventListener('click', function () { selectResult(i); });
    li.appendChild(b);
    return li;
  }
  function selectResult(i) {
    var s = S.search;
    if (i < 0 || i >= s.results.length) return;
    s.cur = i;
    var r = s.results[i];
    $$('.q-item.on').forEach(function (n) { n.classList.remove('on'); });
    var btn = $('#q-results .q-item[data-i="' + i + '"]');
    if (btn) { btn.classList.add('on'); btn.scrollIntoView({ block: 'nearest' }); }
    var visible = viewFor(S.page).indexOf(r.page) >= 0;
    if (visible) rehighlightVisible(true);
    else { S.jumpScroll = r.page; goTo(r.page); }
  }
  function stepResult(d) {
    var s = S.search;
    if (!s.results.length) return;
    var i = s.cur < 0 ? (d > 0 ? 0 : s.results.length - 1) : (s.cur + d + s.results.length) % s.results.length;
    selectResult(i);
  }

  function openPanel(tab) {
    if (window.Notebook && Notebook.closeSidePanel) Notebook.closeSidePanel();
    if (window.AI && AI.isOpen()) AI.close();
    var side = $('#r-side');
    side.hidden = false;
    $('#view-reader').classList.add('side-open');
    $('#r-panel').setAttribute('aria-pressed', 'true');
    if (tab) showTab(tab);
    showBars();
  }
  function closePanel() {
    $('#r-side').hidden = true;
    $('#view-reader').classList.remove('side-open');
    $('#r-panel').setAttribute('aria-pressed', 'false');
  }
  function showTab(tab) {
    $$('#r-side .tabs [data-tab]').forEach(function (b) {
      var on = b.dataset.tab === tab;
      b.setAttribute('aria-selected', on); b.classList.toggle('on', on);
    });
    $$('#r-side .tabpane').forEach(function (p) { p.hidden = p.dataset.pane !== tab; });
    S.tab = tab;
  }
  function panelOpen() { return !$('#r-side').hidden; }

  function showBars() {
    var v = $('#view-reader');
    v.classList.remove('idle');
    clearTimeout(hideTimer);
    hideTimer = setTimeout(maybeHide, 2400);
  }
  function maybeHide() {
    var v = $('#view-reader');
    if (v.hidden) return;
    var qn = $('#r-quick-note');
    var aiEl = $('#r-ai');
    if (v.querySelector('.bar:hover') || !$('#pop-theme').hidden || (qn && !qn.hidden) || (aiEl && !aiEl.hidden)) {
      hideTimer = setTimeout(maybeHide, 1200);
      return;
    }
    var ae = document.activeElement;
    if (ae && ae.id === 'r-pageinput') { hideTimer = setTimeout(maybeHide, 1200); return; }
    v.classList.add('idle');
  }

  function open(id) {
    if (S.book && S.book.id === id && S.pdf) { showBars(); return Promise.resolve(); }
    close();
    var my = ++S.openToken;
    $('#r-loading').hidden = false;
    $('#r-title').textContent = ''; $('#r-author').textContent = '';
    spreadEl.textContent = '';
    var book;
    return DB.getBook(id).then(function (b) {
      if (!b) throw new Error('Kitap bulunamadı');
      book = b;
      return DB.getFile(id);
    }).then(function (blob) {
      if (my !== S.openToken) return null;
      if (!blob) throw new Error('Dosya bulunamadı');
      return window.openPdfBlob(blob);
    }).then(function (pdf) {
      if (!pdf) return;
      if (my !== S.openToken) { pdf.destroy(); return; }
      S.book = book; S.pdf = pdf; S.n = pdf.numPages;
      document.title = book.title + ' — Masa';
      $('#r-title').textContent = book.title;
      $('#r-author').textContent = book.author || '';
      var prog = $('#r-progress');
      if (prog) { prog.setAttribute('aria-valuemin', 1); prog.setAttribute('aria-valuemax', S.n); }
      syncModeButtons(); syncThemeUI(); buildThemeList(); App.applyReaderBg();
      $('#q').value = '';
      resetSearchResults(); setStatus('');
      S.search.q = ''; S.search.nq = '';
      showTab('toc');
      if (window.AI) AI.onBookChanged({ id: book.id, deskId: book.deskId || '', title: book.title, author: book.author || '', page: book.page || 1 });
      if (window.Hafiza) Hafiza.event('book-opened', { bookId: book.id, title: book.title || '', page: book.page || 1, pages: S.n }, book.deskId || '');
      loadOutline(my);
      return DB.listBookmarks(book.id).then(function (list) {
        if (my !== S.openToken) return;
        S.bookmarks = list;
        renderBookmarks();
        S.page = viewFor(clamp(book.page || 1, 1, S.n))[0];
        S.book.lastReadAt = Date.now();
        updateNavUI();
        queueSave();
        showBars();
        return renderView({ center: true });
      });
    }).catch(function (err) {
      if (my !== S.openToken) return;
      $('#r-loading').hidden = true;
      throw err;
    });
  }

  function close() {
    if (S.book) flush();
    cancelSmoothScroll();
    cleanupWheelZoom();
    clearTimeout(S.saveTimer);
    clearTimeout(prefetchTimer);
    S.search.token++;
    clearCache();
    var pdf = S.pdf;
    var ot = S.openToken + 1;
    S = newState();
    S.openToken = ot;
    if (spreadEl) { spreadEl.textContent = ''; spreadEl.style.padding = ''; }
    if (pdf) { try { pdf.destroy(); } catch (e) {} }
    document.title = 'Masa';
    if (inited) {
      closePanel();
      if (window.Notebook && Notebook.closeSidePanel) Notebook.closeSidePanel();
      if (window.AI) AI.onBookChanged(null);
      $('#r-loading').hidden = true;
    }
  }

  function onKey(e) {
    if (App.route !== 'reader' || !S.pdf) return;
    if (e.ctrlKey && !e.altKey && (e.key === 'f' || e.key === 'F')) {
      e.preventDefault();
      openPanel('search');
      var q = $('#q'); q.focus(); q.select();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (document.querySelector('dialog[open]')) return;
    var t = e.target, tag = t.tagName;
    if (tag === 'INPUT' && t.type === 'range') return;
    if (t.closest && t.closest('.popover')) {
      if (e.key === 'Escape') {
        if (!$('#pop-theme').hidden) themePop.close();
        else if (window.Ambience && Ambience.isOpen()) Ambience.close();
      }
      return;
    }
    var typing = tag === 'TEXTAREA' || tag === 'SELECT' ||
      (tag === 'INPUT' && ['range', 'color', 'checkbox', 'button'].indexOf(t.type) < 0);
    if (typing) {
      if (e.key === 'Escape') {
        t.blur();
        if (t.closest && t.closest('#r-quick-note') && window.Notebook) Notebook.closeSidePanel();
        else if (t.closest && t.closest('#r-ai') && window.AI) AI.close();
        else if (panelOpen() && S.tab === 'search') closePanel();
        stage.focus({ preventScroll: true });
        e.preventDefault();
      }
      return;
    }
    showBars();
    var k = e.key;
    switch (k) {
      case 'ArrowRight': next(); break;
      case 'ArrowLeft': prev(); break;
      case 'ArrowDown': scrollOrFlip(1, 0.18); break;
      case 'ArrowUp': scrollOrFlip(-1, 0.18); break;
      case 'PageDown': scrollOrFlip(1, 0.9); break;
      case 'PageUp': scrollOrFlip(-1, 0.9); break;
      case ' ':
        if (tag === 'BUTTON') return;
        if (!e.repeat && !pan.on) startPan(e.shiftKey);
        break;
      case 'Home': goTo(1); break;
      case 'End': goTo(S.n); break;
      case 'b': case 'B': toggleBookmark(); break;
      case '+': case '=': zoomBy(1.15); break;
      case '-': case '_': zoomBy(1 / 1.15); break;
      case '0': setZoomMode('width'); break;
      case 'Escape':
        if (window.AI && AI.dismissBubble && AI.dismissBubble()) { /* balon kapandı */ }
        else if (window.AI && AI.isOpen()) { AI.close(); }
        else if (window.Notebook && Notebook.isSidePanelOpen && Notebook.isSidePanelOpen()) { Notebook.closeSidePanel(); }
        else if (!$('#pop-theme').hidden) { themePop.close(); }
        else if (window.Ambience && Ambience.isOpen()) { Ambience.close(); }
        else if (panelOpen()) closePanel();
        else location.hash = backToDeskHash();
        break;
      default: return;
    }
    e.preventDefault();
  }

  var pan = { on: false, t: 0, moved: false, down: false, shift: false, id: null, x: 0, y: 0, sl: 0, st: 0 };
  function startPan(shift) {
    cancelSmoothScroll();
    pan.on = true; pan.t = Date.now(); pan.moved = false; pan.shift = !!shift;
    $('#view-reader').classList.add('pan');
  }
  function endPan(cancel) {
    if (!pan.on) return;
    var quick = Date.now() - pan.t < 200 && !pan.moved && !cancel;
    pan.on = false; pan.down = false; pan.moved = false;
    if (wheelZooming) commitWheelZoom();
    var v = $('#view-reader'); v.classList.remove('pan', 'panning');
    if (pan.id !== null) { try { stage.releasePointerCapture(pan.id); } catch (e) {} pan.id = null; }
    if (quick && S.pdf) scrollOrFlip(pan.shift ? -1 : 1, 0.9);
  }
  function initPan() {
    var view = $('#view-reader');
    view.addEventListener('pointerdown', function (e) {
      cancelSmoothScroll();
      if (wheelZooming) commitWheelZoom();
      if (!pan.on || e.button !== 0) return;
      if (!stage.contains(e.target) && !e.target.closest('.edge')) return;
      e.preventDefault(); e.stopPropagation();
      pan.down = true; pan.id = e.pointerId; pan.x = e.clientX; pan.y = e.clientY;
      pan.sl = stage.scrollLeft; pan.st = stage.scrollTop;
      try { stage.setPointerCapture(e.pointerId); } catch (err) {}
      view.classList.add('panning');
    }, true);
    view.addEventListener('pointermove', function (e) {
      if (!pan.on || !pan.down) return;
      var dx = e.clientX - pan.x, dy = e.clientY - pan.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) pan.moved = true;
      stage.scrollLeft = pan.sl - dx; stage.scrollTop = pan.st - dy;
      e.preventDefault();
    }, true);
    function up() {
      if (!pan.down) return;
      pan.down = false; view.classList.remove('panning');
      if (pan.id !== null) { try { stage.releasePointerCapture(pan.id); } catch (err) {} pan.id = null; }
    }
    view.addEventListener('pointerup', up, true);
    view.addEventListener('pointercancel', up, true);
    view.addEventListener('click', function (e) { if (pan.on) { e.stopPropagation(); e.preventDefault(); } }, true);
    view.addEventListener('selectstart', function (e) { if (pan.on) e.preventDefault(); }, true);
    document.addEventListener('keyup', function (e) {
      if (e.key === ' ' && pan.on) { e.preventDefault(); endPan(false); }
    });
    window.addEventListener('blur', function () { endPan(true); });
    view.addEventListener('wheel', onWheel, { passive: false });
  }

  function init() {
    if (inited) return;
    inited = true;
    stage = $('#r-stage'); spreadEl = $('#r-spread-el');

    $('#r-back').addEventListener('click', function () { location.hash = backToDeskHash(); });
    $('#r-single').addEventListener('click', function () { setMode('single'); });
    $('#r-spread').addEventListener('click', function () { setMode('spread'); });
    $('#r-zin').addEventListener('click', function () { zoomBy(1.15); });
    $('#r-zout').addEventListener('click', function () { zoomBy(1 / 1.15); });
    $('#r-fitw').addEventListener('click', function () { setZoomMode('width'); });
    $('#r-fitp').addEventListener('click', function () { setZoomMode('page'); });
    $('#r-bm').addEventListener('click', toggleBookmark);
    $('#r-search').addEventListener('click', function () {
      openPanel('search'); var q = $('#q'); q.focus(); q.select();
    });
    $('#r-panel').addEventListener('click', function () {
      if (panelOpen()) closePanel(); else openPanel(S.tab || 'toc');
    });
    $('#r-quick-note-btn').addEventListener('click', function () {
      if (panelOpen()) closePanel();
      if (window.AI && AI.isOpen()) AI.close();
      if (window.Notebook && Notebook.toggleSidePanel) {
        Notebook.toggleSidePanel(S.book, S.page);
        if (Notebook.isSidePanelOpen && Notebook.isSidePanelOpen()) {
          setTimeout(function () { capturePdfSelection(false); }, 40);
        }
      }
    });
    $('#side-close').addEventListener('click', closePanel);
    $$('#r-side .tabs [data-tab]').forEach(function (b) {
      b.addEventListener('click', function () { showTab(b.dataset.tab); if (b.dataset.tab === 'search') $('#q').focus(); });
    });
    $$('#view-reader .bar .btn').forEach(function (b) {
      b.addEventListener('click', function (e) { if (e.detail > 0 && b.id !== 'r-panel') b.blur(); });
    });

    themePop = App.popover($('#r-theme'), $('#pop-theme'));
    syncReaderBgUI();
    $$('#pop-theme [data-rbg]').forEach(function (b) {
      b.addEventListener('click', function () {
        App.set('readerBg', b.dataset.rbg);
        syncReaderBgUI();
        App.applyReaderBg();
      });
    });

    var cDeb = null;
    function customChanged() {
      App.set('customBg', $('#c-bg').value); App.set('customFg', $('#c-fg').value);
      clearTimeout(cDeb);
      cDeb = setTimeout(applyThemeChange, 140);
    }
    $('#c-bg').addEventListener('input', customChanged);
    $('#c-fg').addEventListener('input', customChanged);
    $('#r-bright').addEventListener('input', function () {
      App.set('bright', +this.value);
      spreadEl.style.filter = App.settings.bright < 100 ? 'brightness(' + (App.settings.bright / 100) + ')' : '';
    });

    var pi = $('#r-pageinput');
    pi.addEventListener('focus', function () { pi.select(); });
    pi.addEventListener('blur', function () { updateNavUI(); });
    $('#r-jump').addEventListener('submit', function (e) {
      e.preventDefault();
      var n = parseInt(pi.value, 10);
      if (n) goTo(clamp(n, 1, S.n));
      pi.blur(); stage.focus({ preventScroll: true });
    });

    $('#edge-prev').addEventListener('click', function () { prev(); });
    $('#edge-next').addEventListener('click', function () { next(); });

    $('#q').addEventListener('input', onQueryInput);
    $('#search-form').addEventListener('submit', function (e) {
      e.preventDefault();
      clearTimeout(searchDebounce);
      var q = $('#q').value.replace(/\s+/g, ' ').trim();
      if (q !== S.search.q) { runSearch(q); return; }
      stepResult(e.submitter && e.submitter.id === 'q-prev' ? -1 : 1);
    });
    $('#q-next').addEventListener('click', function () { stepResult(1); });
    $('#q-prev').addEventListener('click', function () { stepResult(-1); });
    $('#q').addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); stepResult(-1); }
    });

    document.addEventListener('keydown', onKey);
    initPan();

    // Yan defter açıkken PDF üzerinden seçilen yazıyı anlık olarak deftere aktar
    var selectingFromStage = false;
    var isStagePointerDown = false;
    var selChangeTimer = null;
    var lastPdfSelectionText = '';

    function selNodeEl(node) {
      if (!node) return null;
      return node.nodeType === 3 ? node.parentElement : node;
    }
    function isUiPanelEl(el) {
      return !!(el && el.closest && el.closest('#r-quick-note, #r-side, #r-ai, .bar'));
    }
    function readStageSelectionText() {
      var sel = window.getSelection ? window.getSelection() : null;
      if (!sel || sel.isCollapsed) return '';
      var text = String(sel).trim();
      if (!text) return '';
      var aEl = selNodeEl(sel.anchorNode);
      var fEl = selNodeEl(sel.focusNode);
      if (isUiPanelEl(aEl) || isUiPanelEl(fEl)) return '';
      var inStage = (aEl && stage.contains(aEl)) || (fEl && stage.contains(fEl));
      if (!inStage) {
        try {
          var range = sel.rangeCount ? sel.getRangeAt(0) : null;
          var cEl = selNodeEl(range && range.commonAncestorContainer);
          if (!cEl || !stage.contains(cEl)) return '';
        } catch (err) {
          return '';
        }
      }
      return text;
    }
    function capturePdfSelection(forceManual) {
      if (!S.pdf || App.route !== 'reader' || pan.on) return false;
      if (!window.Notebook || !Notebook.isSidePanelOpen || !Notebook.isSidePanelOpen()) return false;
      var text = readStageSelectionText();
      if (!text && forceManual && lastPdfSelectionText) text = lastPdfSelectionText;
      if (!text) return false;
      lastPdfSelectionText = text;
      return !!Notebook.appendSelectionToSidePanel(text, S.book, S.page, !!forceManual);
    }
    function onStagePointerDown(e) {
      if (e.button === 0 && !pan.on) {
        selectingFromStage = true;
        isStagePointerDown = true;
      }
    }
    function onDocPointerRelease() {
      if (!selectingFromStage && !isStagePointerDown) return;
      selectingFromStage = false;
      isStagePointerDown = false;
      setTimeout(function () { capturePdfSelection(false); }, 35);
    }
    stage.addEventListener('mousedown', onStagePointerDown);
    stage.addEventListener('pointerdown', onStagePointerDown);
    document.addEventListener('mouseup', onDocPointerRelease);
    document.addEventListener('pointerup', onDocPointerRelease);
    stage.addEventListener('dblclick', function () {
      setTimeout(function () { capturePdfSelection(false); }, 45);
    });
    stage.addEventListener('keyup', function (e) {
      if (e.shiftKey || ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A'))) {
        setTimeout(function () { capturePdfSelection(false); }, 35);
      }
    });
    document.addEventListener('selectionchange', function () {
      if (!S.pdf || App.route !== 'reader' || pan.on) return;
      var txt = readStageSelectionText();
      if (txt) lastPdfSelectionText = txt;
      if (isStagePointerDown) return;
      clearTimeout(selChangeTimer);
      selChangeTimer = setTimeout(function () { capturePdfSelection(false); }, 260);
    });
    stageSelApi = {
      get: readStageSelectionText,
      last: function () { return lastPdfSelectionText; }
    };
    var captureBtn = $('#rqn-capture-sel');
    if (captureBtn) {
      captureBtn.addEventListener('mousedown', function (e) { e.preventDefault(); });
      captureBtn.addEventListener('click', function () { capturePdfSelection(true); });
    }

    var view = $('#view-reader');
    view.addEventListener('mousemove', showBars);
    view.addEventListener('touchstart', showBars, { passive: true });
    view.addEventListener('focusin', showBars);

    var tx = 0, ty = 0, tt = 0;
    stage.addEventListener('touchstart', function (e) {
      if (e.touches.length !== 1) return;
      tx = e.touches[0].clientX; ty = e.touches[0].clientY; tt = Date.now();
    }, { passive: true });
    stage.addEventListener('touchend', function (e) {
      var t = e.changedTouches[0]; if (!t || !tt) return;
      var dx = t.clientX - tx, dy = t.clientY - ty;
      var p = calcSpreadPadding(S.lastLayout);
      if (Date.now() - tt < 600 && Math.abs(dx) > 70 && Math.abs(dy) < 50 && p.bookW + 40 <= stage.clientWidth) {
        if (dx < 0) next(); else prev();
      }
      tt = 0;
    }, { passive: true });

    ro = new ResizeObserver(function () {
      if (!S.pdf) return;
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () {
        if (!S.pdf) return;
        if (wheelZooming || wheelCommitInFlight) cleanupWheelZoom();
        renderView({ keepScroll: true });
      }, 160);
    });
    ro.observe(stage);

    syncModeButtons();
  }

  // Yapay zekanın kitabı tanıması için ipuçları: üstveri, içindekiler başlıkları, ilk 3 sayfanın metni
  function getIdentityClues() {
    var pdf = S.pdf;
    var out = { metaTitle: '', metaAuthor: '', outline: [], firstPagesText: '' };
    if (!pdf) return Promise.resolve(out);
    var pMeta = pdf.getMetadata().then(function (m) {
      var i = (m && m.info) || {};
      out.metaTitle = String(i.Title || '').replace(/\s+/g, ' ').trim().slice(0, 300);
      out.metaAuthor = String(i.Author || '').replace(/\s+/g, ' ').trim().slice(0, 300);
    }).catch(function () {});
    var pOut = pdf.getOutline().then(function (o) {
      out.outline = (o || []).map(function (it) { return String((it && it.title) || '').replace(/\s+/g, ' ').trim(); })
        .filter(Boolean).slice(0, 40);
    }).catch(function () {});
    var parts = [];
    var pText = Promise.resolve();
    for (var p = 1; p <= Math.min(3, pdf.numPages); p++) {
      (function (pn) {
        pText = pText.then(function () { return pdf.getPage(pn); }).then(function (pg) { return pg.getTextContent(); }).then(function (c) {
          parts.push(c.items.map(function (it) { return it.str; }).join(' ').replace(/\s+/g, ' ').trim());
        });
      })(p);
    }
    pText = pText.then(function () { out.firstPagesText = parts.join('\n\n').slice(0, 3000); }).catch(function () {});
    return Promise.all([pMeta, pOut, pText]).then(function () { return out; });
  }

  var stageSelApi = null;

  window.Reader = {
    getStageSelection: function () { return stageSelApi ? stageSelApi.get() : ''; },
    getLastSelection: function () { return stageSelApi ? stageSelApi.last() : ''; },
    closeSidePanel: function () { if ($('#r-side')) closePanel(); },
    init: init,
    open: open,
    close: close,
    flush: flush,
    currentBook: function () { return S.book ? { id: S.book.id, deskId: S.book.deskId || '', title: S.book.title, author: S.book.author || '', page: S.page } : null; },
    getIdentityClues: getIdentityClues
  };
})();
