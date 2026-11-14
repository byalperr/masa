/* hafiza.js — Masa hafızasının "kancaları": masa oturumunu izler, olayları köprüye (Bridge API v2) bildirir.
 * Oturum = bir masa etkin masa olduğu sürece. Masadan ayrılınca (başka masaya geçme, sayfayı kapatma/yenileme)
 * biter; okuyucu ve defter aynı masanın aynı oturumudur. Olaylar yapay zeka çağrısı yapmaz; yalnız köprüye yazılır.
 * Hepsi "ateşle ve unut": ağ hataları sessizce yutulur, arayüz hiçbir zaman beklemez. Yapay zeka panelinin kapalı
 * olması olayları etkilemez. */
(function () {
  'use strict';

  var BASE = 'http://127.0.0.1:8765';
  var PAGE_WAIT_MS = 8000;
  var NOTE_WAIT_MS = 20000;
  var QUOTE_DEDUPE_MS = 30000;
  var OFF_COOLDOWN_MS = 20000;

  var started = false;
  var sessionDesk = '';          // oturumu süren masa ('' = yok)
  var offUntil = 0;              // köprü kapalıysa bu zamana kadar olay göndermeyi dene(me)
  var pagePend = {};             // bookId -> { timer, deskId, data }
  var pageSent = {};             // bookId -> en son gönderilen sayfa
  var notePend = {};             // noteId -> { timer, deskId, data }
  var noteSent = {};             // noteId -> en son gönderilen (başlık + özet)
  var quoteSeen = {};            // metin -> son gönderim zamanı

  function activeDeskId() {
    return window.Desk && Desk.getActiveId ? (Desk.getActiveId() || '') : '';
  }
  function deskName(id) {
    return window.Desk && Desk.getDeskName ? (Desk.getDeskName(id) || '') : '';
  }

  // POST /memory/event (text/plain: basit istek, CORS ön kontrolü yok). Söz verir: true = köprü kabul etti.
  function post(type, data, deskId, force) {
    deskId = deskId || sessionDesk || activeDeskId();
    if (!deskId) return null;
    if (!force && Date.now() < offUntil) return null;
    var body;
    try {
      body = JSON.stringify({ deskId: deskId, deskName: deskName(deskId), type: type, data: data || {} });
    } catch (e) { return null; }
    var p;
    try {
      p = fetch(BASE + '/memory/event', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: body,
        keepalive: true
      });
    } catch (e) { return null; }
    return p.then(function (res) {
      offUntil = 0;
      return res.text().then(function (txt) {
        try { var d = JSON.parse(txt); return !(d && d.ok === false); } catch (e) { return res.ok; }
      }, function () { return res.ok; });
    }, function () {
      offUntil = Date.now() + OFF_COOLDOWN_MS;
      return false;
    });
  }

  function event(type, data, deskId) {
    if (!started) return;
    post(type, data, deskId);
  }

  /* ---------- Bekleyen (geciktirilmiş) olaylar ---------- */
  function sendPage(bookId) {
    var p = pagePend[bookId];
    if (!p) return null;
    clearTimeout(p.timer);
    delete pagePend[bookId];
    if (pageSent[bookId] === p.data.page) return null;
    pageSent[bookId] = p.data.page;
    return post('page', p.data, p.deskId);
  }
  function sendNote(noteId) {
    var p = notePend[noteId];
    if (!p) return null;
    clearTimeout(p.timer);
    delete notePend[noteId];
    var sig = p.data.noteTitle + '\u0000' + p.data.excerpt;
    if (noteSent[noteId] === sig) return null;
    noteSent[noteId] = sig;
    return post('note-saved', p.data, p.deskId);
  }
  // Bekleyen sayfa/not olaylarını hemen gönderir; gönderim sözlerini döndürür
  function flush() {
    var out = [];
    Object.keys(pagePend).forEach(function (k) { var r = sendPage(k); if (r) out.push(r); });
    Object.keys(notePend).forEach(function (k) { var r = sendNote(k); if (r) out.push(r); });
    return out;
  }

  /* ---------- Olay yardımcıları ---------- */
  // Okuyucuda sayfa değişti (≈8 sn içinde en son sayfa gönderilir)
  function page(bookId, pg, pages, deskId) {
    if (!started || !bookId || !pg) return;
    var data = { bookId: bookId, page: pg, pages: pages || 0 };
    var p = pagePend[bookId];
    if (p) { p.data = data; return; }
    if (pageSent[bookId] === pg) return;
    pagePend[bookId] = {
      deskId: deskId || sessionDesk,
      data: data,
      timer: setTimeout(function () { sendPage(bookId); }, PAGE_WAIT_MS)
    };
  }

  // PDF'ten yakalanan alıntı; aynı metin 30 sn içinde bir kez gönderilir
  function quote(bookId, topicId, text, pg, deskId) {
    if (!started) return;
    text = String(text || '').trim();
    if (!text) return;
    var now = Date.now();
    Object.keys(quoteSeen).forEach(function (k) { if (now - quoteSeen[k] > QUOTE_DEDUPE_MS) delete quoteSeen[k]; });
    if (quoteSeen[text] && now - quoteSeen[text] < QUOTE_DEDUPE_MS) return;
    quoteSeen[text] = now;
    post('quote', { bookId: bookId || null, topicId: topicId || null, text: text.slice(0, 4000), page: pg || null }, deskId);
  }

  // Defter notu kaydedildi (≈20 sn içinde, not başına en son hâli gönderilir)
  function noteSaved(topicId, topicTitle, noteId, noteTitle, content, deskId) {
    if (!started || !noteId) return;
    var ex = String(content || '').slice(0, 1500);
    if (!ex.trim()) return;
    var data = {
      topicId: topicId || null,
      topicTitle: topicTitle || '',
      noteId: noteId,
      noteTitle: noteTitle || '',
      excerpt: ex
    };
    var p = notePend[noteId];
    if (p) { p.data = data; return; }
    if (noteSent[noteId] === data.noteTitle + '\u0000' + ex) return;
    notePend[noteId] = {
      deskId: deskId || sessionDesk,
      data: data,
      timer: setTimeout(function () { sendNote(noteId); }, NOTE_WAIT_MS)
    };
  }

  /* ---------- Oturum ---------- */
  function startSession(id) {
    sessionDesk = id;
    try { if (window.AI && AI.dropMemCache) AI.dropMemCache(id); } catch (e) {}
    post('session-start', {}, id);
  }

  // unloading=true: sayfa kapanıyor, hiçbir şey beklenemez
  function endSession(unloading) {
    var id = sessionDesk;
    if (!id) return;
    sessionDesk = '';
    var waits = flush();
    var sc = null;
    try { if (window.AI && AI.sessionChats) sc = AI.sessionChats(id); } catch (e) { sc = null; }
    function send() {
      var p = post('session-end', { chats: sc ? sc.chats : [] }, id, true);
      if (sc && p) p.then(function (ok) { if (!ok) sc.rollback(); });
      else if (sc && !p) sc.rollback();
    }
    if (unloading || !waits.length) send();
    else Promise.all(waits).then(send, send);
  }

  // Etkin masa değiştiyse eski oturumu bitirir, yenisini başlatır (route ve Desk.selectDesk çağırır)
  function sync() {
    if (!started) return;
    var id = activeDeskId();
    if (id === sessionDesk) return;
    if (sessionDesk) endSession(false);
    if (id) startSession(id);
  }

  // Masa silindi: oturumu bitirme, köprü zaten masanın klasörünü siler
  function forgetDesk(id) {
    if (!id) return;
    if (sessionDesk === id) sessionDesk = '';
    Object.keys(pagePend).forEach(function (k) { if (pagePend[k].deskId === id) { clearTimeout(pagePend[k].timer); delete pagePend[k]; } });
    Object.keys(notePend).forEach(function (k) { if (notePend[k].deskId === id) { clearTimeout(notePend[k].timer); delete notePend[k]; } });
  }

  function start() {
    if (started) return;
    started = true;
    window.addEventListener('pagehide', function () { endSession(true); });
    // Sayfa geri-ileri önbelleğinden dönerse yeni oturum başlar
    window.addEventListener('pageshow', function (e) { if (e.persisted) sync(); });
    sync();
  }

  window.Hafiza = {
    start: start,
    sync: sync,
    event: event,
    page: page,
    quote: quote,
    noteSaved: noteSaved,
    flush: flush,
    forgetDesk: forgetDesk,
    sessionDesk: function () { return sessionDesk; }
  };
})();
