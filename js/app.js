/* app.js — Masa uygulaması ana yöneticisi: yönlendirme, tema/arka plan, sürükle-bırak. */
(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var READER_THEMES = {
    kagit: { name: 'Kâğıt', bg: '#ffffff', fg: '#1b1a18', accent: '#8a5a20' },
    sepya: { name: 'Sepya', bg: '#f4ecd8', fg: '#43331f', accent: '#8a5a20' },
    gece: { name: 'Gece', bg: '#000000', fg: '#d9d9d9', accent: '#c9a15a' },
    amber: { name: 'Gece-Amber', bg: '#000000', fg: '#d9ab62', accent: '#d9a04a' },
    ozel: { name: 'Özel', bg: '#1d2420', fg: '#cfd8cc', accent: '#c9a15a' }
  };

  var APP_THEMES = {
    ceviz: { name: 'Ceviz Çalışma', bg: '#191410', fg: '#efe6d6', accent: '#d49a4a' },
    gece: { name: 'Gece Lambası', bg: '#0d0e12', fg: '#e2e4ea', accent: '#d6a24c' },
    sepya: { name: 'Sıcak Sepya', bg: '#ebe0c8', fg: '#3b2d1b', accent: '#8c5a1e' },
    orman: { name: 'Orman Yeşili', bg: '#101c17', fg: '#e2ece6', accent: '#7ab88f' },
    siyah: { name: 'Saf Siyah', bg: '#050506', fg: '#dcdcdc', accent: '#e0a448' },
    kagit: { name: 'Aydınlık Kâğıt', bg: '#f4efe5', fg: '#25211b', accent: '#8a5a20' }
  };

  var DEFAULTS = {
    activeDeskId: '',
    theme: 'sepya',
    readerBg: 'lib',
    customBg: '#1d2420',
    customFg: '#cfd8cc',
    bright: 100,
    viewMode: 'single',
    zoom: 'width',
    zoomFactor: 1,
    musicVol: 75,
    musicRepeat: false,
    musicShuffle: false,
    activeTrackId: '',
    shelfMode: 'spines',
    bookcaseMat: 'ahsap',
    bookcaseCollapsed: false,
    bcSort: 'recent',
    ambience: {
      master: 80,
      dalga: { on: false, vol: 60 },
      kafe: { on: false, vol: 50 },
      yagmur: { on: false, vol: 70 },
      somine: { on: false, vol: 60 },
      karanlik: { on: false, vol: 40 },
      firtina: { on: false, vol: 60 },
      succession: { on: false, vol: 50 }
    }
  };

  var bgObjectURLs = {};

  var App = {
    settings: Object.assign({}, DEFAULTS),
    READER_THEMES: READER_THEMES,
    APP_THEMES: APP_THEMES,
    route: 'desk'
  };
  window.App = App;

  App.set = function (key, val) {
    App.settings[key] = val;
    DB.setSetting(key, val).catch(function () {});
  };

  App.readerTheme = function () {
    var s = App.settings;
    var t = READER_THEMES[s.theme] || READER_THEMES.sepya;
    if (s.theme === 'ozel') {
      return { bg: s.customBg, fg: s.customFg, accent: t.accent, key: 'ozel:' + s.customBg + s.customFg };
    }
    return { bg: t.bg, fg: t.fg, accent: t.accent, key: s.theme };
  };

  function setRootPalette(p, pageTheme) {
    var root = document.documentElement;
    var dark = Recolor.lum(Recolor.hexToRgb(p.bg)) < 0.5;
    root.style.setProperty('--bg', p.bg);
    root.style.setProperty('--fg', p.fg);
    root.style.setProperty('--accent', p.accent);
    if (pageTheme) {
      root.style.setProperty('--page-bg', pageTheme.bg);
      root.style.setProperty('--page-fg', pageTheme.fg);
    }
    root.classList.toggle('is-dark', dark);
  }

  App.applyTheme = function (themeKey) {
    var p = APP_THEMES[themeKey] || APP_THEMES.ceviz;
    setRootPalette(p, App.readerTheme());
  };

  App.applyReaderPalette = function () {
    var rt = App.readerTheme();
    var p = { bg: Recolor.mixHex(rt.bg, rt.fg, 0.08), fg: rt.fg, accent: rt.accent };
    setRootPalette(p, rt);
  };

  App.applyDeskSurface = function (surf) {
    var el = $('#desk-stage');
    if (!el) return;
    el.classList.remove('surf-ceviz', 'surf-mese', 'surf-siyah', 'surf-mermer', 'surf-sumen');
    el.classList.add('surf-' + (surf || 'ceviz'));
  };

  function resolveBgUrl(code) {
    if (!code || code === 'none') return Promise.resolve(null);
    if (code.indexOf('custom:') === 0) {
      var id = code.slice(7);
      if (bgObjectURLs[id]) return Promise.resolve(bgObjectURLs[id]);
      return DB.getBackground(id).then(function (rec) {
        if (!rec || !rec.fullBlob) return null;
        bgObjectURLs[id] = URL.createObjectURL(rec.fullBlob);
        return bgObjectURLs[id];
      }).catch(function () { return null; });
    }
    var absUrl = new URL('img/bg/bg-' + code + '.jpg', document.baseURI).href;
    return Promise.resolve(absUrl);
  }

  function applyBgToElement(el, varName, code) {
    if (!el) return;
    if (!code || code === 'none') {
      el.classList.remove('has-bg');
      el.style.removeProperty(varName);
      return;
    }
    el.dataset.bgPending = code;
    resolveBgUrl(code).then(function (url) {
      if (el.dataset.bgPending !== code) return;
      if (!url) {
        el.classList.remove('has-bg');
        el.style.removeProperty(varName);
        return;
      }
      var img = new Image();
      img.onload = function () {
        if (el.dataset.bgPending === code) {
          el.classList.add('has-bg');
          el.style.setProperty(varName, "url('" + url + "')");
        }
      };
      img.onerror = function () {
        if (el.dataset.bgPending === code) {
          el.classList.remove('has-bg');
          el.style.removeProperty(varName);
        }
      };
      img.src = url;
    });
  }

  App.applyDeskBg = function (bgCode) {
    applyBgToElement($('#view-desk'), '--desk-bg-url', bgCode);
    applyBgToElement($('#view-notebook'), '--desk-bg-url', bgCode);
    if ((App.settings.readerBg || 'lib') === 'lib') App.applyReaderBg();
  };

  App.applyReaderBg = function () {
    var rBg = App.settings.readerBg || 'none';
    var desk = window.Desk && Desk.getActive();
    var bgCode = rBg === 'lib' ? ((desk && desk.bg) || 'none') : rBg;
    applyBgToElement($('#view-reader'), '--reader-bg-url', bgCode);
  };

  App.toast = function (msg, kind, ms) {
    var el = document.createElement('div');
    el.className = 'toast' + (kind ? ' ' + kind : '');
    el.textContent = msg;
    $('#toasts').appendChild(el);
    var t = setTimeout(close, ms || 3400);
    function close() {
      clearTimeout(t);
      el.classList.add('out');
      setTimeout(function () { el.remove(); }, 220);
    }
    el.addEventListener('click', close);
    return { update: function (m) { el.textContent = m; }, close: close };
  };

  App.progressToast = function (msg) {
    var el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    $('#toasts').appendChild(el);
    return {
      update: function (m) { el.textContent = m; },
      close: function () { el.classList.add('out'); setTimeout(function () { el.remove(); }, 220); }
    };
  };

  App.popover = function (btn, pop) {
    function open() {
      // Açık başka popover'ları kapat
      $$('.popover').forEach(function (p) {
        if (p !== pop && !p.hidden) {
          p.hidden = true;
        }
      });
      pop.hidden = false;
      btn.setAttribute('aria-expanded', 'true');
    }
    function close() {
      pop.hidden = true;
      btn.setAttribute('aria-expanded', 'false');
    }
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      pop.hidden ? open() : close();
    });
    document.addEventListener('click', function (e) {
      if (!pop.hidden && !pop.contains(e.target) && !btn.contains(e.target)) close();
    });
    pop.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.stopPropagation(); close(); btn.focus(); }
    });
    return { open: open, close: close, isOpen: function () { return !pop.hidden; } };
  };

  App.cleanName = function (fileName) {
    return String(fileName || '').replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim() || fileName;
  };

  // ---------- Yönlendirme ----------
  var lastRoute = null;
  function route() {
    var h = location.hash || '';
    var mBook = h.match(/^#\/kitap\/(.+)$/);
    var mDesk = h.match(/^#\/masa\/(.+)$/);

    if (lastRoute === 'notebook' && !/^#\/defter/.test(h) && window.Notebook) {
      Notebook.flush();
    }

    if (mBook) {
      var bookId = decodeURIComponent(mBook[1]);
      lastRoute = 'reader';
      App.route = 'reader';
      $('#view-desk').hidden = true;
      $('#view-notebook').hidden = true;
      $('#view-reader').hidden = false;
      App.applyReaderPalette();
      Reader.open(bookId).catch(function (err) {
        console.error(err);
        App.toast('PDF açılamadı.', 'error');
        var dId = Desk.getActiveId();
        location.hash = dId ? '#/masa/' + encodeURIComponent(dId) : '#/';
      });
    } else if (/^#\/defter/.test(h)) {
      lastRoute = 'notebook';
      App.route = 'notebook';
      Reader.close();
      $('#view-reader').hidden = true;
      $('#view-desk').hidden = true;
      $('#view-notebook').hidden = false;
      var d = Desk.getActive();
      if (d) {
        App.applyTheme(d.theme || 'ceviz');
        App.applyDeskBg(d.bg || 'none');
      }
      Notebook.render();
      document.title = 'Defter — Masa';
    } else {
      var wasReader = lastRoute === 'reader';
      lastRoute = 'desk';
      App.route = 'desk';
      Reader.close();
      $('#view-reader').hidden = true;
      $('#view-notebook').hidden = true;
      $('#view-desk').hidden = false;
      if (mDesk) {
        var reqDeskId = decodeURIComponent(mDesk[1]);
        if (Desk.hasDesk(reqDeskId) && Desk.getActiveId() !== reqDeskId) {
          Desk.selectDesk(reqDeskId, false);
        }
      }
      var activeDesk = Desk.getActive();
      if (activeDesk) {
        App.applyTheme(activeDesk.theme || 'ceviz');
        App.applyDeskSurface(activeDesk.surface || 'ceviz');
        App.applyDeskBg(activeDesk.bg || 'none');
      }
      if (wasReader) Desk.refresh();
      else if (window.Notebook) Notebook.renderDeskWidget();
      document.title = (activeDesk ? activeDesk.name + ' — ' : '') + 'Masa';
    }
  }

  // ---------- Sürükle-bırak (PDF -> Masa, Ses -> Müzik Kutusu) ----------
  function initDrop() {
    var drop = $('#drop'), depth = 0;
    function hasFiles(e) {
      var t = e.dataTransfer && e.dataTransfer.types;
      return t && Array.prototype.indexOf.call(t, 'Files') >= 0;
    }
    window.addEventListener('dragenter', function (e) {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth++;
      drop.hidden = false;
    });
    window.addEventListener('dragover', function (e) {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    });
    window.addEventListener('dragleave', function (e) {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) drop.hidden = true;
    });
    window.addEventListener('drop', function (e) {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      drop.hidden = true;
      var files = Array.prototype.slice.call((e.dataTransfer && e.dataTransfer.files) || []);
      if (!files.length) return;
      var pdfs = files.filter(function (f) { return /\.pdf$/i.test(f.name) || f.type === 'application/pdf'; });
      var audios = files.filter(function (f) { return Music.isAudioFile(f); });
      var overShelf = e.target && e.target.closest && e.target.closest('#desk-bookcase');
      if (pdfs.length) Desk.addFiles(pdfs, overShelf ? 'shelf' : 'desk');
      if (audios.length) Music.addFiles(audios);
      if (!pdfs.length && !audios.length) {
        App.toast('PDF veya ses dosyası (.mp3, .ogg, .wav, .flac, .m4a) bırakabilirsin.', 'error');
      }
    });
  }

  function init() {
    document.addEventListener('click', function (e) {
      var c = e.target.closest && e.target.closest('[data-close]');
      if (c) {
        var d = c.closest('dialog');
        if (d) d.close();
      }
    });

    // Üst navigasyon sekmeleri
    $('#nav-to-notebook').addEventListener('click', function () {
      location.hash = '#/defter';
    });
    $('#nav-to-music').addEventListener('click', function () {
      Music.openLibrary();
    });

    initDrop();
    Accessories.init();
    if (window.Bookcase) Bookcase.init();
    Reader.init();
    if (window.AI) AI.init();
    if (window.Ambience) Ambience.init();

    Promise.all([Desk.init(), Notebook.init(), Music.init()]).then(function () {
      window.addEventListener('hashchange', route);
      route();
    });
  }

  var keys = Object.keys(DEFAULTS);
  Promise.all(keys.map(function (k) { return DB.getSetting(k, DEFAULTS[k]); }))
    .catch(function () { return keys.map(function (k) { return DEFAULTS[k]; }); })
    .then(function (vals) {
      keys.forEach(function (k, i) { App.settings[k] = vals[i]; });
      try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) {}
      init();
    });

  window.addEventListener('pagehide', function () {
    if (window.Reader) Reader.flush();
    if (window.Notebook) Notebook.flush();
  });
})();
