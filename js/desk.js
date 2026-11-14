/* desk.js — Masalar yönetimi, masa üstü PDF kapakları, tema/arka plan/yüzey özelleştirme. */
(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var desks = [];
  var activeDeskId = null;
  var books = [];
  var coverURLs = {};
  var customBgs = [];
  var customBgThumbURLs = {};
  var ctxBook = null;
  var editingDeskId = null;
  var inited = false;
  var topBookZ = 10;

  function isOnDesk(b) {
    var p = (b && b.placement) || 'desk';
    return p === 'desk' || p === 'both';
  }

  function isOnShelf(b) {
    var p = (b && b.placement) || 'desk';
    return p === 'shelf' || p === 'both';
  }

  function progressOf(b) {
    if (!b || !b.pages) return 0;
    return clamp((b.page || 1) / b.pages, 0, 1);
  }

  function bringToFront(el) {
    if (!el) return;
    el.style.zIndex = ++topBookZ;
  }

  function clampStagePos(el, targetLeftPx, targetTopPx) {
    var stage = $('#desk-stage');
    if (!stage || !el) return { x: 0, y: 0 };
    var r = stage.getBoundingClientRect();
    if (!r.width || !r.height) return { x: 0, y: 0 };
    var maxPxX = Math.max(0, r.width - el.offsetWidth);
    var maxPxY = Math.max(0, r.height - el.offsetHeight);
    var pxX = clamp(targetLeftPx, 0, maxPxX);
    var pxY = clamp(targetTopPx, 0, maxPxY);
    var maxPctX = r.width ? Math.floor((maxPxX / r.width) * 10000) / 100 : 0;
    var maxPctY = r.height ? Math.floor((maxPxY / r.height) * 10000) / 100 : 0;
    return {
      x: clamp(Math.round((pxX / r.width) * 10000) / 100, 0, maxPctX),
      y: clamp(Math.round((pxY / r.height) * 10000) / 100, 0, maxPctY)
    };
  }

  function makeFreeDraggable(opts) {
    var el = opts && opts.el;
    if (!el) return;
    var dragging = false, moved = false;
    var startX = 0, startY = 0, grabX = 0, grabY = 0;
    var lastX = 0, lastY = 0, scrollRaf = 0;
    var threshold = opts.threshold != null ? opts.threshold : 10;

    function applyAt(clientX, clientY) {
      var stage = $('#desk-stage');
      if (!stage) return;
      var r = stage.getBoundingClientRect();
      if (!r.width || !r.height) return;
      var pos = clampStagePos(el, clientX - r.left - grabX, clientY - r.top - grabY);
      el.style.left = pos.x + '%';
      el.style.top = pos.y + '%';
      if (opts.setPos) opts.setPos(pos.x, pos.y);
      if (opts.onDragMove) opts.onDragMove(clientX, clientY, pos);
    }

    function tickAutoScroll() {
      if (!dragging || !moved) { scrollRaf = 0; return; }
      var dyScroll = 0;
      if (lastY < 64) dyScroll = -14;
      else if (lastY > window.innerHeight - 64) dyScroll = 14;
      if (dyScroll) {
        window.scrollBy(0, dyScroll);
        applyAt(lastX, lastY);
      }
      scrollRaf = requestAnimationFrame(tickAutoScroll);
    }

    function onMove(e) {
      if (!dragging) return;
      lastX = e.clientX;
      lastY = e.clientY;
      if (!moved) {
        if (Math.hypot(e.clientX - startX, e.clientY - startY) < threshold) return;
        moved = true;
        bringToFront(el);
        el.classList.add('is-dragging');
        if (!scrollRaf) scrollRaf = requestAnimationFrame(tickAutoScroll);
      }
      applyAt(e.clientX, e.clientY);
    }

    function cleanup() {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      if (scrollRaf) { cancelAnimationFrame(scrollRaf); scrollRaf = 0; }
    }

    function onUp(e) {
      if (!dragging) return;
      dragging = false;
      cleanup();
      el.classList.remove('is-dragging');
      if (moved) {
        el.dataset.justDragged = '1';
        setTimeout(function () { delete el.dataset.justDragged; }, 120);
      }
      if (opts.onDragEnd) opts.onDragEnd(e, moved);
    }

    el.addEventListener('dragstart', function (e) { e.preventDefault(); });

    el.addEventListener('pointerdown', function (e) {
      if (window.innerWidth <= 1020) return;
      if (e.button !== 0) return;
      if (opts.ignoreSelector && e.target && e.target.closest(opts.ignoreSelector)) return;
      if (opts.canDrag && !opts.canDrag(e)) return;
      var er = el.getBoundingClientRect();
      dragging = true;
      moved = false;
      startX = e.clientX;
      startY = e.clientY;
      lastX = e.clientX;
      lastY = e.clientY;
      grabX = e.clientX - er.left;
      grabY = e.clientY - er.top;
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    });
  }

  function pickFreeDeskSlot(deskId) {
    var existing = books.filter(function (b) { return b.deskId === deskId && isOnDesk(b) && b.deskX != null; });
    var cols = [10, 23, 36, 49];
    var rows = [8.8, 16.2, 23.8, 31.5, 39.5, 47.5, 55.5, 63.5, 71.5, 79.5, 87.5];
    for (var pass = 0; pass < 4; pass++) {
      for (var r = 0; r < rows.length; r++) {
        for (var c = 0; c < cols.length; c++) {
          var sx = cols[c] + pass * 2.5;
          var sy = rows[r] + pass * 1.5;
          var clash = existing.some(function (b) {
            return Math.abs(b.deskX - sx) < 9 && Math.abs(b.deskY - sy) < 6;
          });
          if (!clash) return { x: Math.min(86, sx), y: Math.min(92, sy) };
        }
      }
    }
    var n = existing.length;
    return {
      x: Math.round((10 + ((n * 7) % 52)) * 10) / 10,
      y: Math.round((5 + ((n * 6) % 78)) * 10) / 10
    };
  }

  // ---------- PDF.js Range Transport (Kitaplik'tan) ----------
  var RangeCls = null;
  function rangeTransport(blob, initial) {
    if (!RangeCls) {
      RangeCls = class extends pdfjsLib.PDFDataRangeTransport {
        constructor(b, init) { super(b.size, init); this.blob = b; }
        requestDataRange(begin, end) {
          var self = this;
          this.blob.slice(begin, end).arrayBuffer().then(function (buf) {
            self.onDataRange(begin, new Uint8Array(buf));
          });
        }
      };
    }
    return new RangeCls(blob, initial);
  }

  function openPdf(blob) {
    var first = blob.slice(0, 65536).arrayBuffer().then(function (buf) {
      var t = rangeTransport(blob, new Uint8Array(buf));
      return pdfjsLib.getDocument({ range: t, length: blob.size, disableAutoFetch: true, disableStream: true }).promise;
    });
    return first.catch(function (err) {
      if (err && err.name === 'PasswordException') throw err;
      return blob.arrayBuffer().then(function (ab) {
        return pdfjsLib.getDocument({ data: new Uint8Array(ab) }).promise;
      });
    });
  }
  window.openPdfBlob = openPdf;

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function fold(s) {
    return String(s || '').toLocaleLowerCase('tr').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ı/g, 'i');
  }
  function sensibleTitle(t) {
    if (!t) return null;
    t = String(t).replace(/\s+/g, ' ').trim();
    if (t.length < 3 || t.length > 160) return null;
    if (/^\d+$/.test(t)) return null;
    if (/^(untitled|adsız|microsoft word|document\d*|title)\b/i.test(t)) return null;
    if (/\.(docx?|indd|tex|pdf|pages|odt|qxd)$/i.test(t)) return null;
    return t;
  }

  function coverURL(b) {
    if (!b.cover) return null;
    if (!coverURLs[b.id]) coverURLs[b.id] = URL.createObjectURL(b.cover);
    return coverURLs[b.id];
  }

  function addOnePdf(file, deskId, placement) {
    var doc;
    return openPdf(file).then(function (d) {
      doc = d;
      return Promise.all([doc.getMetadata().catch(function () { return {}; }), doc.getPage(1)]);
    }).then(function (res) {
      var info = (res[0] && res[0].info) || {};
      var page = res[1];
      var vp0 = page.getViewport({ scale: 1 });
      var scale = clamp(340 / vp0.width, 0.2, 4);
      var vp = page.getViewport({ scale: scale });
      var canvas = document.createElement('canvas');
      canvas.width = Math.round(vp.width);
      canvas.height = Math.round(vp.height);
      var ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      return page.render({ canvasContext: ctx, viewport: vp }).promise.then(function () {
        var newId = DB.uid();
        var color = (window.Bookcase && Bookcase.sampleColor)
          ? Bookcase.sampleColor(canvas, newId)
          : [90, 56, 42];
        var place = placement || 'desk';
        var slot = (place === 'desk' || place === 'both') ? pickFreeDeskSlot(deskId) : null;
        return new Promise(function (resolve) { canvas.toBlob(resolve, 'image/jpeg', 0.85); }).then(function (blob) {
          var title = sensibleTitle(info.Title) || App.cleanName(file.name);
          var author = info.Author ? String(info.Author).replace(/\s+/g, ' ').trim().slice(0, 80) : '';
          var rec = {
            id: newId,
            deskId: deskId,
            placement: place,
            deskX: slot ? slot.x : null,
            deskY: slot ? slot.y : null,
            colorVersion: (window.Bookcase && Bookcase.COLOR_VERSION) || 2,
            color: color,
            title: title,
            author: author,
            pages: doc.numPages,
            addedAt: Date.now(),
            lastReadAt: 0,
            page: 1,
            cover: blob,
            aspect: canvas.width / canvas.height,
            size: file.size,
            fileName: file.name
          };
          return DB.addBook(rec, file).then(function () { return rec; });
        });
      });
    }).then(function (rec) {
      try { doc.destroy(); } catch (e) {}
      return rec;
    }, function (err) {
      try { doc && doc.destroy(); } catch (e) {}
      throw err;
    });
  }

  function addFiles(fileList, targetPlacement) {
    var files = Array.prototype.slice.call(fileList || []).filter(function (f) {
      return /\.pdf$/i.test(f.name) || f.type === 'application/pdf';
    });
    if (!files.length) {
      App.toast('Yalnızca PDF dosyaları eklenebilir.', 'error');
      return Promise.resolve();
    }
    var place = targetPlacement || 'desk';
    var targetDesk = activeDeskId;
    var pt = App.progressToast(place === 'shelf' ? 'PDF kitaplığa yerleştiriliyor…' : 'PDF masaya yerleştiriliyor…');
    var ok = 0, dup = 0, fail = [];
    var chain = Promise.resolve();

    files.forEach(function (f, i) {
      chain = chain.then(function () {
        if (books.some(function (b) { return b.deskId === targetDesk && b.fileName === f.name && b.size === f.size; })) {
          dup++;
          return;
        }
        pt.update('PDF ekleniyor (' + (i + 1) + '/' + files.length + '): ' + f.name);
        return addOnePdf(f, targetDesk, place).then(function (rec) {
          books.push(rec);
          ok++;
        }, function (err) {
          console.error(f.name, err);
          fail.push(f.name);
        });
      });
    });

    return chain.then(function () {
      pt.close();
      var msg = [];
      if (ok) msg.push(ok + (place === 'shelf' ? ' PDF kitaplığa eklendi' : ' PDF masaya eklendi'));
      if (dup) msg.push(dup + ' dosya bu masada zaten var');
      if (fail.length) msg.push(fail.length + ' dosya açılamadı');
      App.toast(msg.join(' · ') || 'Dosya eklenmedi', fail.length ? 'error' : '', 4500);
      renderBooks();
      if (window.Bookcase) { Bookcase.invalidate(); Bookcase.render(); }
      renderDesksList();
    });
  }

  // ---------- Masalar ----------
  function getActive() {
    for (var i = 0; i < desks.length; i++) {
      if (desks[i].id === activeDeskId) return desks[i];
    }
    return desks[0] || null;
  }

  function saveCurrentDesk() {
    var d = getActive();
    if (!d) return Promise.resolve();
    d.updatedAt = Date.now();
    return DB.putDesk(d);
  }

  function createStarterDesk() {
    var d = {
      id: DB.uid(),
      name: 'Ana Çalışma Masam',
      surface: 'ceviz',
      theme: 'ceviz',
      bg: '01',
      deskScaleV2: true,
      accessories: Accessories.defaultList(),
      musicBox: { x: 72, y: 1.2 },
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    desks.push(d);
    return DB.putDesk(d).then(function () { return d; });
  }

  function applyMusicBoxPos(desk) {
    var box = $('#desk-music-box');
    if (!box || !desk) return;
    if (!desk.musicBox || desk.musicBox.x == null || desk.musicBox.y == null) {
      desk.musicBox = { x: 72, y: 1.2 };
    }
    box.style.left = desk.musicBox.x + '%';
    box.style.top = desk.musicBox.y + '%';
  }

  function selectDesk(id, pushHash) {
    var d = desks.find(function (x) { return x.id === id; });
    if (!d) d = desks[0];
    if (!d) return;
    activeDeskId = d.id;
    App.set('activeDeskId', d.id);
    if (pushHash) {
      location.hash = '#/masa/' + encodeURIComponent(d.id);
    }
    applyDeskAppearance(d);
    applyMusicBoxPos(d);
    renderBooks();
    if (window.Bookcase) { Bookcase.invalidate(); Bookcase.render(); }
    renderDesksList();
    Accessories.renderOnDesk(d);
    Accessories.renderSettingsList(d);
    if (window.Notebook && Notebook.onDeskChange) Notebook.onDeskChange(d.id);
  }

  function applyDeskAppearance(desk) {
    if (!desk) return;
    App.applyTheme(desk.theme || 'ceviz');
    App.applyDeskSurface(desk.surface || 'ceviz');
    App.applyDeskBg(desk.bg || 'none');

    var nameEl = $('#desk-active-name');
    if (nameEl) nameEl.textContent = desk.name;

    var themeSel = $('#set-desk-theme');
    if (themeSel) themeSel.value = desk.theme || 'ceviz';

    $$('#set-desk-surface [data-surface]').forEach(function (b) {
      var on = b.dataset.surface === (desk.surface || 'ceviz');
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
    });

    syncBgPickerUI(desk.bg || 'none');
  }

  // ---------- Özel Arka Plan Fotoğrafları ----------
  function makeThumbBlob(img) {
    var maxW = 240;
    var scale = Math.min(1, maxW / img.naturalWidth);
    var cw = Math.max(1, Math.round(img.naturalWidth * scale));
    var ch = Math.max(1, Math.round(img.naturalHeight * scale));
    var cv = document.createElement('canvas');
    cv.width = cw;
    cv.height = ch;
    cv.getContext('2d').drawImage(img, 0, 0, cw, ch);
    return new Promise(function (resolve) {
      cv.toBlob(resolve, 'image/jpeg', 0.78);
    });
  }

  function addCustomBackground(file) {
    if (!file || (file.type && file.type.indexOf('image/') !== 0 && !/\.(jpe?g|png|webp|avif)$/i.test(file.name))) {
      App.toast('Lütfen bir resim dosyası seç.', 'error');
      return;
    }
    var url = URL.createObjectURL(file);
    var img = new Image();
    img.onload = function () {
      makeThumbBlob(img).then(function (thumbBlob) {
        URL.revokeObjectURL(url);
        var rec = {
          id: DB.uid(),
          name: file.name.replace(/\.[^.]+$/, ''),
          fullBlob: file,
          thumbBlob: thumbBlob,
          createdAt: Date.now()
        };
        return DB.putBackground(rec).then(function () {
          customBgs.push(rec);
          renderCustomBgThumbs();
          var d = getActive();
          if (d) {
            d.bg = 'custom:' + rec.id;
            saveCurrentDesk();
            applyDeskAppearance(d);
          }
          App.toast('Arka plan fotoğrafı eklendi.');
        });
      });
    };
    img.onerror = function () {
      URL.revokeObjectURL(url);
      App.toast('Resim okunamadı.', 'error');
    };
    img.src = url;
  }

  function renderCustomBgThumbs() {
    var host = $('#custom-bg-grid');
    if (!host) return;
    host.textContent = '';
    var d = getActive();
    var curBg = (d && d.bg) || 'none';

    customBgs.forEach(function (bg) {
      var code = 'custom:' + bg.id;
      if (!customBgThumbURLs[bg.id] && bg.thumbBlob) {
        customBgThumbURLs[bg.id] = URL.createObjectURL(bg.thumbBlob);
      }
      var wrap = document.createElement('div');
      wrap.className = 'bg-custom-wrap';

      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'bg-thumb' + (curBg === code ? ' on' : '');
      btn.dataset.bg = code;
      btn.title = bg.name;
      if (customBgThumbURLs[bg.id]) {
        btn.style.backgroundImage = "url('" + customBgThumbURLs[bg.id] + "')";
      }
      btn.addEventListener('click', function () {
        var desk = getActive();
        if (!desk) return;
        desk.bg = code;
        saveCurrentDesk();
        applyDeskAppearance(desk);
      });

      var del = document.createElement('button');
      del.type = 'button';
      del.className = 'bg-custom-del';
      del.title = 'Fotoğrafı sil';
      del.textContent = '×';
      del.addEventListener('click', function (e) {
        e.stopPropagation();
        customBgs = customBgs.filter(function (x) { return x.id !== bg.id; });
        if (customBgThumbURLs[bg.id]) { URL.revokeObjectURL(customBgThumbURLs[bg.id]); delete customBgThumbURLs[bg.id]; }
        DB.deleteBackground(bg.id).catch(function () {});
        var desk = getActive();
        if (desk && desk.bg === code) {
          desk.bg = 'none';
          saveCurrentDesk();
          applyDeskAppearance(desk);
        }
        renderCustomBgThumbs();
      });

      wrap.appendChild(btn);
      wrap.appendChild(del);
      host.appendChild(wrap);
    });
  }

  function syncBgPickerUI(bgVal) {
    $$('#pop-desk-theme [data-bg]').forEach(function (b) {
      var on = b.dataset.bg === bgVal;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
    });
  }

  // ---------- Masa Üstündeki Serbest Konumlu PDF Kapakları ----------
  function deskBooks() {
    var q = fold(($('#desk-search') && $('#desk-search').value) || '');
    return books.filter(function (b) {
      if (b.deskId !== activeDeskId || !isOnDesk(b)) return false;
      if (!q) return true;
      return fold(b.title).indexOf(q) >= 0 || fold(b.author).indexOf(q) >= 0;
    }).sort(function (a, b) {
      return (a.addedAt || 0) - (b.addedAt || 0);
    });
  }

  function setBookPlacement(book, newPlacement, coords) {
    if (!book) return;
    book.placement = newPlacement;
    var patch = { placement: newPlacement };
    if (newPlacement === 'desk' || newPlacement === 'both') {
      if (coords && coords.x != null && coords.y != null) {
        book.deskX = coords.x;
        book.deskY = coords.y;
      } else if (book.deskX == null || book.deskY == null) {
        var slot = pickFreeDeskSlot(book.deskId);
        book.deskX = slot.x;
        book.deskY = slot.y;
      }
      patch.deskX = book.deskX;
      patch.deskY = book.deskY;
    }
    DB.updateBook(book.id, patch).catch(function () {});
    renderBooks();
    if (window.Bookcase) { Bookcase.invalidate(); Bookcase.render(); }
  }

  function makeDeskBookDraggable(card, book) {
    var bc = $('#desk-bookcase');
    var link = card.querySelector('.desk-book-link');

    makeFreeDraggable({
      el: card,
      ignoreSelector: 'button',
      threshold: 10,
      setPos: function (nx, ny) {
        book.deskX = nx;
        book.deskY = ny;
      },
      onDragMove: function (cx, cy) {
        if (!bc) return;
        var bcr = bc.getBoundingClientRect();
        var overBc = cx >= bcr.left && cx <= bcr.right && cy >= bcr.top && cy <= bcr.bottom;
        bc.classList.toggle('is-drop-zone', overBc);
        card.classList.toggle('is-over-shelf', overBc);
      },
      onDragEnd: function (e, moved) {
        card.classList.remove('is-over-shelf');
        if (bc) bc.classList.remove('is-drop-zone');
        if (!moved) return;
        if (bc && e) {
          var bcr = bc.getBoundingClientRect();
          if (e.clientX >= bcr.left && e.clientX <= bcr.right && e.clientY >= bcr.top && e.clientY <= bcr.bottom) {
            var nextPlace = (e.shiftKey || e.ctrlKey) ? 'both' : 'shelf';
            setBookPlacement(book, nextPlace);
            App.toast(nextPlace === 'both' ? 'Kitap hem masada hem kitaplıkta tutuldu.' : 'Kitap kitaplığa kaldırıldı.');
            return;
          }
        }
        DB.updateBook(book.id, { deskX: book.deskX, deskY: book.deskY }).catch(function () {});
      }
    });

    if (link) {
      link.addEventListener('click', function (e) {
        if (card.dataset.justDragged) {
          e.preventDefault();
          return;
        }
        e.preventDefault();
        location.hash = '#/kitap/' + encodeURIComponent(book.id);
      });
    }
  }

  function renderBooks() {
    var grid = $('#desk-books-grid');
    var empty = $('#desk-books-empty');
    var countEl = $('#desk-books-count');
    if (!grid) return;

    var allDeskBooks = books.filter(function (b) { return b.deskId === activeDeskId && isOnDesk(b); });
    var list = deskBooks();
    if (countEl) countEl.textContent = allDeskBooks.length ? allDeskBooks.length + ' PDF' : 'Boş';

    grid.textContent = '';
    if (empty) {
      empty.hidden = list.length > 0;
      empty.querySelector('.desk-empty-title').textContent = allDeskBooks.length
        ? 'Aramana uyan PDF yok.'
        : 'Masanın üstünde henüz PDF yok.';
    }

    list.forEach(function (b) {
      if (b.deskX == null || b.deskY == null) {
        var slot = pickFreeDeskSlot(b.deskId);
        b.deskX = slot.x;
        b.deskY = slot.y;
        DB.updateBook(b.id, { deskX: b.deskX, deskY: b.deskY, placement: b.placement || 'desk' }).catch(function () {});
      }

      var card = document.createElement('div');
      card.className = 'desk-book' + (b.placement === 'both' ? ' is-dual' : '');
      card.dataset.id = b.id;
      card.style.left = b.deskX + '%';
      card.style.top = b.deskY + '%';

      var link = document.createElement('a');
      link.className = 'desk-book-link';
      link.draggable = false;
      link.href = '#/kitap/' + encodeURIComponent(b.id);
      link.title = b.title + (b.author ? ' — ' + b.author : '') + ' (' + (b.pages || '?') + ' sayfa)';

      var coverBox = document.createElement('div');
      coverBox.className = 'desk-book-cover';
      var url = coverURL(b);
      if (url) {
        var img = document.createElement('img');
        img.src = url;
        img.alt = '';
        img.draggable = false;
        coverBox.appendChild(img);
      } else {
        var fb = document.createElement('div');
        fb.className = 'desk-book-fallback';
        fb.textContent = b.title;
        coverBox.appendChild(fb);
      }

      var badge = document.createElement('span');
      badge.className = 'desk-book-pages';
      badge.textContent = (b.page > 1 ? b.page + '/' : '') + (b.pages || 1) + ' s.';
      coverBox.appendChild(badge);

      if (b.placement === 'both') {
        var dual = document.createElement('span');
        dual.className = 'desk-book-dual';
        dual.textContent = 'Raf + Masa';
        coverBox.appendChild(dual);
      }

      var prog = document.createElement('span');
      prog.className = 'desk-book-prog';
      var fill = document.createElement('i');
      fill.style.width = ((b.page || 1) > 1 ? Math.round(progressOf(b) * 100) : 0) + '%';
      prog.appendChild(fill);
      coverBox.appendChild(prog);

      var info = document.createElement('div');
      info.className = 'desk-book-info';
      var tt = document.createElement('div');
      tt.className = 'desk-book-title';
      tt.textContent = b.title;
      info.appendChild(tt);
      if (b.author) {
        var au = document.createElement('div');
        au.className = 'desk-book-author';
        au.textContent = b.author;
        info.appendChild(au);
      }

      link.appendChild(coverBox);
      link.appendChild(info);

      var more = document.createElement('button');
      more.type = 'button';
      more.className = 'desk-book-more';
      more.setAttribute('aria-label', 'PDF seçenekleri: ' + b.title);
      more.innerHTML = '<svg class="ico" aria-hidden="true"><use href="#i-more"/></svg>';
      more.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        var r = more.getBoundingClientRect();
        showBookMenu(b, r.left, r.bottom + 4);
      });

      card.addEventListener('contextmenu', function (e) {
        e.preventDefault();
        showBookMenu(b, e.clientX, e.clientY);
      });

      card.appendChild(link);
      card.appendChild(more);
      makeDeskBookDraggable(card, b);
      grid.appendChild(card);
    });
  }

  // ---------- PDF Bağlam Menüsü (Konum / Düzenle / Taşı / Sil) ----------
  function showBookMenu(book, x, y) {
    ctxBook = book;
    var m = $('#ctx-book');
    if (!m) return;
    var p = (book && book.placement) || 'desk';
    var btnBoth = m.querySelector('[data-act="place-both"]');
    var btnShelf = m.querySelector('[data-act="place-shelf"]');
    var btnDesk = m.querySelector('[data-act="place-desk"]');

    if (btnBoth) {
      btnBoth.hidden = (p === 'both');
      btnBoth.querySelector('.ctx-lbl').textContent = p === 'shelf'
        ? 'Masaya da Koy (Her İkisinde Tut)'
        : 'Kitaplığa da Koy (Her İkisinde Tut)';
    }
    if (btnShelf) {
      btnShelf.hidden = (p === 'shelf');
      btnShelf.querySelector('.ctx-lbl').textContent = p === 'both'
        ? 'Masadan Kaldır (Yalnız Kitaplıkta)'
        : 'Kitaplığa Kaldır (Yalnız Kitaplık)';
    }
    if (btnDesk) {
      btnDesk.hidden = (p === 'desk');
      btnDesk.querySelector('.ctx-lbl').textContent = p === 'both'
        ? 'Kitaplıktan Kaldır (Yalnız Masada)'
        : 'Masaya Çıkar (Yalnız Masa)';
    }

    m.hidden = false;
    var mw = m.offsetWidth || 220;
    var mh = m.offsetHeight || 180;
    m.style.left = Math.min(x, window.innerWidth - mw - 8) + 'px';
    m.style.top = Math.min(y, window.innerHeight - mh - 8) + 'px';
  }
  function hideBookMenu() {
    var m = $('#ctx-book');
    if (m) m.hidden = true;
  }

  function renderDesksList() {
    var listEl = $('#desk-switcher-list');
    var modalList = $('#desks-manage-list');
    [listEl, modalList].forEach(function (host) {
      if (!host) return;
      host.textContent = '';
      desks.forEach(function (d) {
        var bCount = books.filter(function (b) { return b.deskId === d.id; }).length;
        var row = document.createElement('div');
        row.className = 'desk-list-row' + (d.id === activeDeskId ? ' is-active' : '');

        var pick = document.createElement('button');
        pick.type = 'button';
        pick.className = 'desk-list-pick';
        pick.addEventListener('click', function () {
          selectDesk(d.id, true);
          var pop = $('#pop-desks');
          if (pop) pop.hidden = true;
          var dlg = $('#dlg-desks');
          if (dlg && dlg.open) dlg.close();
        });

        var sw = document.createElement('span');
        sw.className = 'desk-surface-dot surf-' + (d.surface || 'ceviz');

        var meta = document.createElement('span');
        meta.className = 'desk-list-meta';
        var nm = document.createElement('span');
        nm.className = 'desk-list-name';
        nm.textContent = d.name;
        var sub = document.createElement('span');
        sub.className = 'desk-list-sub';
        sub.textContent = bCount + ' PDF';
        meta.appendChild(nm);
        meta.appendChild(sub);

        pick.appendChild(sw);
        pick.appendChild(meta);
        row.appendChild(pick);

        var editBtn = document.createElement('button');
        editBtn.type = 'button';
        editBtn.className = 'btn icon small';
        editBtn.title = 'Masayı düzenle';
        editBtn.innerHTML = '<svg class="ico" aria-hidden="true"><use href="#i-edit"/></svg>';
        editBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          openDeskDialog(d);
        });
        row.appendChild(editBtn);

        host.appendChild(row);
      });
    });
  }

  function openDeskDialog(desk) {
    var dlg = $('#dlg-desk-edit');
    if (!dlg) return;
    editingDeskId = desk ? desk.id : null;
    $('#desk-dlg-title').textContent = desk ? 'Masayı düzenle' : 'Yeni masa oluştur';
    $('#desk-dlg-name').value = desk ? desk.name : '';
    $('#desk-dlg-surface').value = desk ? (desk.surface || 'ceviz') : 'ceviz';
    $('#desk-dlg-theme').value = desk ? (desk.theme || 'ceviz') : 'ceviz';
    var delBtn = $('#desk-dlg-delete');
    if (delBtn) delBtn.hidden = !desk || desks.length <= 1;
    dlg.showModal();
    setTimeout(function () { $('#desk-dlg-name').focus(); }, 30);
  }

  function refresh() {
    return DB.listBooks().then(function (list) {
      books = list || [];
      renderBooks();
      if (window.Bookcase) { Bookcase.invalidate(); Bookcase.render(); }
      renderDesksList();
      if (window.Notebook) Notebook.renderDeskWidget();
    });
  }

  function initMusicBoxDrag() {
    var box = $('#desk-music-box');
    if (!box) return;
    makeFreeDraggable({
      el: box,
      ignoreSelector: 'button, input, a, select, .mbox-prog',
      threshold: 6,
      canDrag: function () { return !!getActive(); },
      setPos: function (nx, ny) {
        var d = getActive();
        if (d) d.musicBox = { x: nx, y: ny };
      },
      onDragEnd: function (e, moved) {
        if (moved) saveCurrentDesk();
      }
    });
  }

  function init() {
    if (inited) return Promise.resolve();
    inited = true;

    // Popover'lar
    App.popover($('#btn-desk-switcher'), $('#pop-desks'));
    App.popover($('#btn-desk-theme'), $('#pop-desk-theme'));
    App.popover($('#btn-desk-acc'), $('#pop-desk-acc'));

    // PDF ekleme
    var pdfInput = $('#pdf-file-input');
    $('#btn-add-pdf').addEventListener('click', function () { pdfInput.click(); });
    $('#empty-add-pdf').addEventListener('click', function () { pdfInput.click(); });
    pdfInput.addEventListener('change', function () {
      if (this.files.length) addFiles(this.files);
      this.value = '';
    });

    var searchInp = $('#desk-search');
    if (searchInp) searchInp.addEventListener('input', function () {
      renderBooks();
      if (window.Bookcase) { Bookcase.invalidate(); Bookcase.render(); }
    });

    initMusicBoxDrag();

    // Masa oluşturma düğmeleri
    $('#btn-new-desk-pop').addEventListener('click', function () {
      $('#pop-desks').hidden = true;
      openDeskDialog(null);
    });
    $('#btn-manage-desks').addEventListener('click', function () {
      $('#pop-desks').hidden = true;
      renderDesksList();
      $('#dlg-desks').showModal();
    });
    $('#btn-new-desk-modal').addEventListener('click', function () {
      $('#dlg-desks').close();
      openDeskDialog(null);
    });

    // Masa düzenleme / oluşturma formu
    $('#form-desk-edit').addEventListener('submit', function (e) {
      e.preventDefault();
      var name = $('#desk-dlg-name').value.trim();
      if (!name) return;
      var surface = $('#desk-dlg-surface').value;
      var theme = $('#desk-dlg-theme').value;

      if (editingDeskId) {
        var d = desks.find(function (x) { return x.id === editingDeskId; });
        if (d) {
          d.name = name;
          d.surface = surface;
          d.theme = theme;
          d.updatedAt = Date.now();
          DB.putDesk(d).catch(function () {});
          if (d.id === activeDeskId) applyDeskAppearance(d);
        }
      } else {
        var nd = {
          id: DB.uid(),
          name: name,
          surface: surface,
          theme: theme,
          bg: '01',
          deskScaleV2: true,
          accessories: Accessories.defaultList(),
          musicBox: { x: 72, y: 1.2 },
          createdAt: Date.now(),
          updatedAt: Date.now()
        };
        desks.push(nd);
        DB.putDesk(nd).catch(function () {});
        selectDesk(nd.id, true);
      }
      $('#dlg-desk-edit').close();
      renderDesksList();
    });

    $('#desk-dlg-delete').addEventListener('click', function () {
      if (!editingDeskId || desks.length <= 1) return;
      var delId = editingDeskId;
      var victimBooks = books.filter(function (b) { return b.deskId === delId; });
      victimBooks.forEach(function (b) { DB.deleteBook(b.id).catch(function () {}); });
      books = books.filter(function (b) { return b.deskId !== delId; });
      desks = desks.filter(function (d) { return d.id !== delId; });
      DB.deleteDesk(delId).catch(function () {});
      if (window.Notebook && Notebook.deleteDeskData) Notebook.deleteDeskData(delId);
      $('#dlg-desk-edit').close();
      if (activeDeskId === delId) selectDesk(desks[0].id, true);
      else renderDesksList();
      App.toast('Masa silindi.');
    });

    // Tema, yüzey, arka plan seçicileri
    $('#set-desk-theme').addEventListener('change', function () {
      var d = getActive();
      if (!d) return;
      d.theme = this.value;
      saveCurrentDesk();
      applyDeskAppearance(d);
    });

    $$('#set-desk-surface [data-surface]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var d = getActive();
        if (!d) return;
        d.surface = btn.dataset.surface;
        saveCurrentDesk();
        applyDeskAppearance(d);
      });
    });

    $$('#pop-desk-theme [data-bg]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var d = getActive();
        if (!d) return;
        d.bg = btn.dataset.bg;
        saveCurrentDesk();
        applyDeskAppearance(d);
      });
    });

    var customBgInput = $('#custom-bg-input');
    $('#btn-add-custom-bg').addEventListener('click', function () { customBgInput.click(); });
    customBgInput.addEventListener('change', function () {
      if (this.files && this.files[0]) addCustomBackground(this.files[0]);
      this.value = '';
    });

    // Kitap bağlam menüsü
    document.addEventListener('click', hideBookMenu);
    $('#ctx-book').addEventListener('click', function (e) {
      var btn = e.target.closest('[data-act]');
      if (!btn || !ctxBook) return;
      var act = btn.dataset.act;
      if (act === 'place-both') {
        setBookPlacement(ctxBook, 'both');
        App.toast('Kitap hem masada hem kitaplıkta.');
      } else if (act === 'place-shelf') {
        setBookPlacement(ctxBook, 'shelf');
        App.toast('Kitap kitaplığa kaldırıldı.');
      } else if (act === 'place-desk') {
        setBookPlacement(ctxBook, 'desk');
        App.toast('Kitap masaya çıkarıldı.');
      } else if (act === 'edit') {
        $('#e-book-title').value = ctxBook.title || '';
        $('#e-book-author').value = ctxBook.author || '';
        $('#dlg-book-edit').showModal();
      } else if (act === 'move') {
        var sel = $('#move-book-desk');
        sel.textContent = '';
        desks.forEach(function (d) {
          var opt = document.createElement('option');
          opt.value = d.id;
          opt.textContent = d.name;
          if (d.id === ctxBook.deskId) opt.selected = true;
          sel.appendChild(opt);
        });
        $('#move-book-name').textContent = ctxBook.title;
        $('#dlg-book-move').showModal();
      } else if (act === 'delete') {
        $('#del-book-text').textContent = '"' + ctxBook.title + '" bu masadan kalıcı olarak silinecek.';
        $('#dlg-book-del').showModal();
      }
    });

    $('#form-book-edit').addEventListener('submit', function (e) {
      e.preventDefault();
      if (!ctxBook) return;
      ctxBook.title = $('#e-book-title').value.trim() || ctxBook.title;
      ctxBook.author = $('#e-book-author').value.trim();
      DB.updateBook(ctxBook.id, { title: ctxBook.title, author: ctxBook.author }).catch(function () {});
      $('#dlg-book-edit').close();
      renderBooks();
      if (window.Bookcase) { Bookcase.invalidate(); Bookcase.render(); }
    });

    $('#form-book-move').addEventListener('submit', function (e) {
      e.preventDefault();
      if (!ctxBook) return;
      var targetId = $('#move-book-desk').value;
      ctxBook.deskId = targetId;
      DB.updateBook(ctxBook.id, { deskId: targetId }).catch(function () {});
      $('#dlg-book-move').close();
      renderBooks();
      if (window.Bookcase) { Bookcase.invalidate(); Bookcase.render(); }
      renderDesksList();
      App.toast('PDF seçilen masaya taşındı.');
    });

    $('#form-book-del').addEventListener('submit', function (e) {
      e.preventDefault();
      if (!ctxBook) return;
      var id = ctxBook.id;
      if (coverURLs[id]) { URL.revokeObjectURL(coverURLs[id]); delete coverURLs[id]; }
      books = books.filter(function (b) { return b.id !== id; });
      DB.deleteBook(id).catch(function () {});
      $('#dlg-book-del').close();
      renderBooks();
      if (window.Bookcase) { Bookcase.invalidate(); Bookcase.render(); }
      renderDesksList();
      App.toast('PDF silindi.');
    });

    // Verileri yükle
    return Promise.all([DB.listDesks(), DB.listBooks(), DB.listBackgrounds()]).then(function (res) {
      desks = res[0] || [];
      books = res[1] || [];
      customBgs = res[2] || [];
      renderCustomBgThumbs();

      if (!desks.length) {
        return createStarterDesk();
      }
    }).then(function () {
      var wanted = App.settings.activeDeskId;
      var found = desks.find(function (d) { return d.id === wanted; });
      activeDeskId = found ? found.id : desks[0].id;
      selectDesk(activeDeskId, false);
      if (window.Bookcase && Bookcase.upgradeColors) Bookcase.upgradeColors(books);
    });
  }

  window.Desk = {
    init: init,
    refresh: refresh,
    addFiles: addFiles,
    selectDesk: selectDesk,
    getActive: getActive,
    getActiveId: function () { return activeDeskId; },
    saveCurrentDesk: saveCurrentDesk,
    applyMusicBoxPos: applyMusicBoxPos,
    bringToFront: bringToFront,
    clampStagePos: clampStagePos,
    makeFreeDraggable: makeFreeDraggable,
    getCoverURL: coverURL,
    getShelfBooks: function () {
      return books.filter(function (b) { return b.deskId === activeDeskId && isOnShelf(b); });
    },
    showBookMenu: showBookMenu,
    placeBookFromShelf: function (book, xPct, yPct, keepBoth) {
      var nextPlace = keepBoth ? 'both' : 'desk';
      setBookPlacement(book, nextPlace, { x: xPct, y: yPct });
      App.toast(nextPlace === 'both' ? 'Kitap hem masada hem kitaplıkta.' : 'Kitap masaya çıkarıldı.');
    },
    hasDesk: function (id) { return desks.some(function (d) { return d.id === id; }); },
    updateBookLocal: function (id, patch) {
      var b = books.find(function (x) { return x.id === id; });
      if (b) Object.assign(b, patch);
    }
  };
})();
