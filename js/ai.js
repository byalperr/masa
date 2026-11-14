/* ai.js — Yapay Zekaya Sor paneli.
 * Yerel AI köprüsüne (http://127.0.0.1:8765) bağlanır; PDF başına sohbeti IndexedDB'de (aichats) saklar,
 * PDF'te seçilen yazının altında "Yapay zekaya sor" balonu gösterir.
 * Yapay zeka çıktısı güvenilmezdir: markdown DOM düğümleriyle (textContent) kurulur, ham HTML asla yorumlanmaz. */
(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function icon(id) {
    var ns = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('class', 'ico');
    svg.setAttribute('aria-hidden', 'true');
    var use = document.createElementNS(ns, 'use');
    use.setAttribute('href', '#' + id);
    svg.appendChild(use);
    return svg;
  }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  var BASE = 'http://127.0.0.1:8765';
  var DEFAULT_MODEL = 'gemini-3.8-flash-medium';
  var FALLBACK_MODELS = [
    { id: 'gemini-3.8-flash-medium', name: 'Gemini 3.8 Flash (Medium)' },
    { id: 'gemini-3.8-flash-low', name: 'Gemini 3.8 Flash (Low)' },
    { id: 'gemini-4-argon-medium', name: 'Gemini 4 Argon (Medium)' },
    { id: 'claude-sonnet-5-5-medium', name: 'Claude Sonnet 5.5 (Medium)' }
  ];
  var DEFAULT_QUESTION = 'Bu alıntıyı açıkla.';
  var MAX_QUOTES = 8;
  var ASK_TIMEOUT_MS = 6 * 60 * 1000;

  var inited = false;
  var bridge = 'unknown';          // unknown | checking | ok | off
  var models = FALLBACK_MODELS.slice();
  var model = DEFAULT_MODEL;
  var curBook = null;              // { id, title, author, page }
  var rec = null;                  // geçerli kitabın kaydı: { bookId, activeId, chats: [...] }
  var chat = null;                 // geçerli kitapta açık olan sohbet
  var recs = {};                   // bookId -> kayıt (önbellek; bekleyen istekler için de gerekli)
  var pending = {};                // chatId -> { ctrl, start, msgId, userAborted }
  var listMode = false;            // panelde "Sohbetler" listesi mi gösteriliyor
  var quotes = [];                 // gönderilmemiş alıntılar (geçerli kitap)
  var loadToken = 0;
  var hintTimer = null;
  var bubbleEl = null;
  var bubbleText = '';

  /* ---------- Markdown (güvenli, DOM tabanlı) ---------- */
  function inline(parent, text, depth) {
    depth = depth || 0;
    var re = /`([^`\n]+)`|\*\*([^\n]+?)\*\*|\*([^*\s][^*\n]*?)\*|(!?)\[([^\]\n]*)\]\(([^)\s]*)(?:\s+"[^"]*")?\)/;
    var rest = String(text);
    while (rest) {
      var m = depth > 3 ? null : re.exec(rest);
      if (!m) { parent.appendChild(document.createTextNode(rest)); break; }
      if (m.index > 0) parent.appendChild(document.createTextNode(rest.slice(0, m.index)));
      if (m[1] != null) {
        parent.appendChild(el('code', null, m[1]));
      } else if (m[2] != null) {
        var b = el('strong'); inline(b, m[2], depth + 1); parent.appendChild(b);
      } else if (m[3] != null) {
        var i = el('em'); inline(i, m[3], depth + 1); parent.appendChild(i);
      } else {
        // Bağlantı/görsel: tıklanabilir değil, düz metin olarak göster
        var label = m[5], url = m[6];
        var out;
        if (m[4]) out = label || url;
        else out = (!label || label === url) ? url : label + ' (' + url + ')';
        parent.appendChild(document.createTextNode(out));
      }
      rest = rest.slice(m.index + m[0].length);
    }
  }

  var RE_FENCE = /^\s*```/;
  var RE_HEAD = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
  var RE_HR = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
  var RE_QUOTE = /^\s{0,3}>/;
  var RE_LI = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;

  function isBlockStart(line) {
    return RE_FENCE.test(line) || RE_HEAD.test(line) || RE_HR.test(line) || RE_QUOTE.test(line) || RE_LI.test(line);
  }

  function renderBlocks(container, text, depth) {
    var lines = String(text).replace(/\r\n?/g, '\n').split('\n');
    var i = 0, m;
    while (i < lines.length) {
      var line = lines[i];
      if (RE_FENCE.test(line)) {
        var code = [];
        i++;
        while (i < lines.length && !RE_FENCE.test(lines[i])) { code.push(lines[i]); i++; }
        i++; // kapanış çiti
        var pre = el('pre'); pre.appendChild(el('code', null, code.join('\n')));
        container.appendChild(pre);
        continue;
      }
      if (!line.trim()) { i++; continue; }
      if ((m = RE_HEAD.exec(line))) {
        var h = el('div', 'ai-h ai-h' + Math.min(m[1].length, 3));
        inline(h, m[2]);
        container.appendChild(h);
        i++; continue;
      }
      if (RE_HR.test(line)) { container.appendChild(el('hr')); i++; continue; }
      if (RE_QUOTE.test(line)) {
        var q = [];
        while (i < lines.length && RE_QUOTE.test(lines[i])) { q.push(lines[i].replace(/^\s{0,3}>\s?/, '')); i++; }
        var bq = el('blockquote');
        if (depth < 3) renderBlocks(bq, q.join('\n'), depth + 1);
        else bq.textContent = q.join('\n');
        container.appendChild(bq);
        continue;
      }
      if ((m = RE_LI.exec(line))) {
        var ordered = /\d/.test(m[2]);
        var list = el(ordered ? 'ol' : 'ul');
        if (ordered) { var n = parseInt(m[2], 10); if (n > 1) list.start = n; }
        var baseIndent = m[1].length;
        var last = null;
        while (i < lines.length) {
          var l = lines[i], im = RE_LI.exec(l);
          if (im) {
            var li = el('li');
            inline(li, im[3]);
            var lvl = Math.min(Math.floor(Math.max(0, im[1].length - baseIndent) / 2), 3);
            if (lvl) li.style.marginLeft = (lvl * 1.2) + 'em';
            list.appendChild(li);
            last = { li: li, text: im[3] };
            i++;
          } else if (last && l.trim() && /^\s{2,}/.test(l) && !isBlockStart(l)) {
            last.li.appendChild(document.createElement('br'));
            inline(last.li, l.trim());
            i++;
          } else break;
        }
        container.appendChild(list);
        continue;
      }
      var para = [];
      while (i < lines.length && lines[i].trim() && (para.length === 0 || !isBlockStart(lines[i]))) { para.push(lines[i]); i++; }
      var p = el('p');
      para.forEach(function (pl, idx) {
        if (idx) p.appendChild(document.createElement('br'));
        inline(p, pl.trim());
      });
      container.appendChild(p);
    }
  }

  function renderMarkdown(text) {
    var box = el('div', 'ai-bot-body');
    renderBlocks(box, text || '', 0);
    return box;
  }

  /* ---------- Köprü ---------- */
  function request(path, opts, timeoutMs) {
    var ctrl = opts.ctrl || new AbortController();
    var timer = timeoutMs ? setTimeout(function () { try { ctrl.abort(); } catch (e) {} }, timeoutMs) : null;
    var init = { method: opts.method || 'GET', signal: ctrl.signal };
    if (opts.body) { init.headers = { 'Content-Type': 'application/json' }; init.body = JSON.stringify(opts.body); }
    return fetch(BASE + path, init).then(function (res) {
      return res.text().then(function (txt) {
        if (timer) clearTimeout(timer);
        var data = null;
        try { data = JSON.parse(txt); } catch (e) {}
        return { status: res.status, data: data };
      });
    }, function (err) {
      if (timer) clearTimeout(timer);
      throw err;
    });
  }

  function checkBridge() {
    bridge = 'checking';
    renderStatus();
    return request('/health', {}, 4000).then(function (r) {
      if (r.data && r.data.ok) {
        bridge = 'ok';
        renderStatus();
        return loadModels();
      }
      bridge = 'off';
      renderStatus();
    }, function () {
      bridge = 'off';
      renderStatus();
    });
  }

  function loadModels() {
    return request('/models', {}, 6000).then(function (r) {
      var list = r.data && r.data.models;
      if (Array.isArray(list)) {
        list = list.filter(function (x) { return x && typeof x.id === 'string'; });
        if (list.length) models = list.map(function (x) { return { id: x.id, name: x.name || x.id }; });
      }
    }, function () { /* yedek liste kalır */ }).then(fillModels);
  }

  function fillModels() {
    var sel = $('#ai-model');
    if (!sel) return;
    sel.textContent = '';
    var has = models.some(function (m) { return m.id === model; });
    var all = has ? models : models.concat([{ id: model, name: model }]);
    all.forEach(function (m) {
      var o = el('option', null, m.name);
      o.value = m.id;
      sel.appendChild(o);
    });
    sel.value = model;
  }

  function modelName(id) {
    for (var i = 0; i < models.length; i++) if (models[i].id === id) return models[i].name;
    return id || '';
  }

  /* ---------- Sohbet verisi ---------- */
  // Bir PDF'in birden çok sohbeti olur; hiçbiri silinmez. Kayıt aichats deposunda bookId anahtarıyla tutulur.
  function newChatObj() {
    var now = Date.now();
    return { id: DB.uid(), conversationId: null, messages: [], createdAt: now, updatedAt: now };
  }
  function normalizeRec(bookId, r) {
    if (r && Array.isArray(r.chats)) {
      r.chats = r.chats.filter(function (c) { return c && c.id; });
      r.chats.forEach(function (c) { if (!Array.isArray(c.messages)) c.messages = []; });
    } else if (r && Array.isArray(r.messages)) {
      // Eski biçim (tek sohbet) → çoklu sohbete taşı
      var old = newChatObj();
      old.conversationId = r.conversationId || null;
      old.messages = r.messages;
      old.createdAt = (r.messages[0] && r.messages[0].at) || r.updatedAt || old.createdAt;
      old.updatedAt = r.updatedAt || old.updatedAt;
      r = { bookId: bookId, chats: [old], activeId: old.id };
    } else {
      r = { bookId: bookId, chats: [], activeId: null };
    }
    var act = findChat(r, r.activeId);
    if (!act) {
      act = r.chats.length ? r.chats[r.chats.length - 1] : newChatObj();
      if (r.chats.indexOf(act) < 0) r.chats.push(act);
      r.activeId = act.id;
    }
    return r;
  }
  function findChat(r, id) {
    if (!r || !id) return null;
    for (var i = 0; i < r.chats.length; i++) if (r.chats[i].id === id) return r.chats[i];
    return null;
  }
  function saveRec(bookId) {
    var r = recs[bookId];
    if (!r) return Promise.resolve();
    // Boş sohbetler (aktif olan hariç) kaydedilmez
    var out = {
      bookId: bookId,
      activeId: r.activeId,
      chats: r.chats.filter(function (c) { return c.messages.length || c.id === r.activeId; }),
      updatedAt: Date.now()
    };
    return DB.putAiChat(out).catch(function () {});
  }
  function touch(c) { c.updatedAt = Date.now(); }
  function curPending() { return chat ? pending[chat.id] || null : null; }
  function chatTitle(c) {
    var first = null;
    for (var i = 0; i < c.messages.length; i++) if (c.messages[i].role === 'user') { first = c.messages[i]; break; }
    if (!first) return 'Yeni sohbet';
    var t = first.text && first.text !== DEFAULT_QUESTION ? first.text : ((first.quotes && first.quotes[0]) || first.text || '');
    t = String(t).replace(/\s+/g, ' ').trim();
    return t.length > 70 ? t.slice(0, 70) + '…' : (t || 'Sohbet');
  }

  /* ---------- Gönderme ---------- */
  function trunc(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n) : s; }

  function send(retryId) {
    var book = curBook;
    if (!book || !chat || pending[chat.id]) return;
    listMode = false;
    var c = chat;
    var input = $('#ai-input');
    var m = null;
    if (retryId) {
      for (var k = 0; k < c.messages.length; k++) if (c.messages[k].id === retryId) m = c.messages[k];
      if (!m || m.role !== 'user') return;
      delete m.error;
      m.model = model;
    } else {
      var question = input.value.trim();
      if (!question && !quotes.length) return;
      if (!question) question = DEFAULT_QUESTION;
      m = { id: DB.uid(), role: 'user', quotes: quotes.slice(), text: question, model: model, at: Date.now() };
      c.messages.push(m);
      quotes = [];
      input.value = '';
      autosize();
    }
    var idx = c.messages.indexOf(m);
    var history = c.messages.slice(0, idx).filter(function (x) { return !x.error; }).slice(-10).map(function (x) {
      var t = x.text;
      if (x.role === 'user' && x.quotes && x.quotes.length) {
        t = x.quotes.map(function (q) { return '“' + q + '”'; }).join('\n') + '\n' + t;
      }
      return { role: x.role, text: trunc(t, 1500) };
    });
    var cb = window.Reader && Reader.currentBook ? Reader.currentBook() : null;
    var page = cb && cb.id === book.id ? cb.page : book.page;
    var payload = {
      model: model,
      conversationId: c.conversationId || null,
      book: { title: book.title || '', author: book.author || '', page: page || 1 },
      quotes: m.quotes || [],
      question: m.text,
      history: history
    };
    var ctrl = new AbortController();
    var mine = { ctrl: ctrl, start: Date.now(), msgId: m.id, userAborted: false };
    pending[c.id] = mine;
    touch(c);
    saveRec(book.id);
    render();

    request('/ask', { method: 'POST', body: payload, ctrl: ctrl }, ASK_TIMEOUT_MS).then(function (r) {
      var d = r.data;
      if (d && d.ok && typeof d.response === 'string') {
        finish(book.id, c, mine, m, null, d);
      } else {
        finish(book.id, c, mine, m, (d && d.error) || ('Köprüden beklenmeyen yanıt geldi (' + r.status + ').'), null);
      }
    }, function (err) {
      var msg;
      if (err && err.name === 'AbortError') {
        msg = mine.userAborted ? 'İstek durduruldu.' : 'İstek zaman aşımına uğradı.';
      } else {
        bridge = 'off';
        msg = 'AI köprüsüne ulaşılamadı. Köprünün açık olduğundan emin ol.';
      }
      finish(book.id, c, mine, m, msg, null);
    });
  }

  // bookId ve sohbet send anında yakalanır: yanıt, kullanıcı başka PDF'e ya da sohbete geçse bile
  // asıl sohbete yazılır.
  function finish(bookId, c, mine, userMsg, errText, data) {
    if (pending[c.id] !== mine) return;
    delete pending[c.id];
    if (errText) {
      userMsg.error = errText;
    } else {
      delete userMsg.error;
      if (data.conversationId) c.conversationId = data.conversationId;
      c.messages.push({
        id: DB.uid(), role: 'assistant', quotes: [], text: data.response,
        model: data.model || userMsg.model, at: Date.now()
      });
    }
    touch(c);
    saveRec(bookId);
    renderStatus();
    if (curBook && curBook.id === bookId) render();
  }

  function stop() {
    var p = curPending();
    if (!p) return;
    p.userAborted = true;
    p.ctrl.abort();
  }

  // Yeni sohbet eskisini silmez: eski sohbet "Sohbetler" listesinde kalır, bekleyen cevabı da oraya yazılır.
  function newChat() {
    if (!curBook || !rec) return;
    listMode = false;
    if (chat && !chat.messages.length) { render(); focusInput(); return; }
    var c = newChatObj();
    rec.chats.push(c);
    rec.activeId = c.id;
    chat = c;
    saveRec(curBook.id);
    render();
    focusInput();
  }

  function openChat(id) {
    if (!rec) return;
    var c = findChat(rec, id);
    if (!c) return;
    // Açık olan boş sohbetten çıkarken onu listeden at
    if (chat && chat !== c && !chat.messages.length && !pending[chat.id]) {
      rec.chats.splice(rec.chats.indexOf(chat), 1);
    }
    rec.activeId = c.id;
    chat = c;
    listMode = false;
    saveRec(curBook.id);
    render();
    focusInput();
  }

  function toggleList() {
    if (!rec) return;
    listMode = !listMode;
    render();
  }

  function focusInput() {
    var i = $('#ai-input');
    if (i && isOpen()) setTimeout(function () { try { i.focus({ preventScroll: true }); } catch (e) {} }, 0);
  }

  /* ---------- Alıntılar ---------- */
  function addQuote(text) {
    text = String(text || '').trim();
    if (!text) return false;
    if (quotes.indexOf(text) < 0) {
      if (quotes.length >= MAX_QUOTES) quotes.shift();
      quotes.push(text);
    }
    hideBubble();
    open();
    renderChips();
    updateSend();
    var inp = $('#ai-input');
    if (inp) setTimeout(function () { try { inp.focus({ preventScroll: true }); } catch (e) {} }, 0);
    return true;
  }

  function addCurrentSelection() {
    var t = window.Reader ? (Reader.getStageSelection() || Reader.getLastSelection()) : '';
    if (!t) { showHint('Önce PDF\'te bir yazı seç.'); return; }
    addQuote(t);
  }

  function showHint(msg) {
    var h = $('#ai-hint');
    if (!h) return;
    h.textContent = msg;
    h.hidden = false;
    clearTimeout(hintTimer);
    hintTimer = setTimeout(function () { h.hidden = true; }, 2600);
  }

  /* ---------- Çizim ---------- */
  function renderStatus() {
    var box = $('#ai-status');
    if (!box) return;
    var t = $('#ai-status-text');
    if (bridge === 'off') {
      t.textContent = '';
      t.appendChild(document.createTextNode('AI köprüsü kapalı. Masa klasöründeki '));
      t.appendChild(el('code', null, 'AI Köprüsü Başlat.bat'));
      t.appendChild(document.createTextNode(' dosyasını çalıştır.'));
      box.hidden = false;
    } else {
      box.hidden = true;
    }
  }

  function renderRef() {
    var r = $('#ai-ref');
    if (!r) return;
    if (!curBook) { r.textContent = ''; r.title = ''; return; }
    var cb = window.Reader && Reader.currentBook ? Reader.currentBook() : null;
    var pg = cb && cb.id === curBook.id ? cb.page : curBook.page;
    var s = (curBook.title || '') + ' · s. ' + (pg || 1);
    if (r.textContent !== s) { r.textContent = s; r.title = s; }
  }

  function fallbackCopy(text) {
    var ta = el('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e) {}
    ta.remove();
  }
  function copyText(text, btn) {
    function done() {
      var old = btn.textContent;
      btn.textContent = 'Kopyalandı';
      setTimeout(function () { btn.textContent = old; }, 1400);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text); done(); });
    } else { fallbackCopy(text); done(); }
  }

  function quoteEl(text) {
    var q = el('blockquote', 'ai-quote');
    q.appendChild(el('div', 'ai-quote-text', '“' + text + '”'));
    var long = text.length > 260 || text.split('\n').length > 6;
    if (long) {
      var tg = el('button', 'ai-quote-more', 'devamı');
      tg.type = 'button';
      tg.addEventListener('click', function () {
        var open = q.classList.toggle('open');
        tg.textContent = open ? 'daha az' : 'devamı';
      });
      q.appendChild(tg);
    }
    return q;
  }

  function renderMessages() {
    var box = $('#ai-msgs');
    if (!box) return;
    box.textContent = '';
    if (!curBook) return;
    if (!chat) { box.appendChild(el('div', 'ai-empty', 'Yükleniyor…')); return; }
    var pend = curPending();
    if (!chat.messages.length) {
      box.appendChild(el('div', 'ai-empty', 'PDF\'te bir yazı seç, “Yapay zekaya sor”a bas ve sorunu yaz.'));
    }
    chat.messages.forEach(function (m) {
      var row = el('div', 'ai-msg ' + (m.role === 'user' ? 'user' : 'bot'));
      if (m.role === 'user') {
        var body = el('div', 'ai-user-body');
        (m.quotes || []).forEach(function (q) { body.appendChild(quoteEl(q)); });
        body.appendChild(el('span', 'ai-user-q', m.text));
        row.appendChild(body);
        if (m.error) {
          var err = el('div', 'ai-err');
          err.appendChild(el('span', null, m.error));
          // Yalnız son mesajda: eski bir mesajı yeniden denemek cevabı sohbetin sonuna, sıra dışı eklerdi.
          if (!pend && m === chat.messages[chat.messages.length - 1]) {
            var rb = el('button', 'ai-link-btn', 'Tekrar dene');
            rb.type = 'button';
            rb.addEventListener('click', function () { send(m.id); });
            err.appendChild(rb);
          }
          row.appendChild(err);
        }
      } else {
        row.appendChild(renderMarkdown(m.text));
        var foot = el('div', 'ai-bot-foot');
        foot.appendChild(el('span', null, modelName(m.model)));
        var cp = el('button', 'ai-link-btn', 'Kopyala');
        cp.type = 'button';
        cp.addEventListener('click', function () { copyText(m.text, cp); });
        foot.appendChild(cp);
        row.appendChild(foot);
      }
      box.appendChild(row);
    });
    if (pend) {
      var pr = el('div', 'ai-pending');
      var dots = el('span', 'ai-dots');
      dots.appendChild(el('i')); dots.appendChild(el('i')); dots.appendChild(el('i'));
      pr.appendChild(dots);
      var lbl = el('span', null, 'düşünüyor… ');
      var sec = el('span');
      sec.id = 'ai-pend-sec';
      sec.textContent = Math.floor((Date.now() - pend.start) / 1000) + ' sn';
      lbl.appendChild(sec);
      pr.appendChild(lbl);
      var st = el('button', 'btn sm', 'Durdur');
      st.type = 'button';
      st.addEventListener('click', stop);
      pr.appendChild(st);
      box.appendChild(pr);
    }
    box.scrollTop = box.scrollHeight;
  }

  function fmtDate(t) {
    try {
      var d = new Date(t), now = new Date();
      var hm = d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
      if (d.toDateString() === now.toDateString()) return 'Bugün ' + hm;
      return d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' }) + ' ' + hm;
    } catch (e) { return ''; }
  }

  function renderList() {
    var box = $('#ai-list');
    if (!box) return;
    box.textContent = '';
    if (!rec) return;
    var list = rec.chats.filter(function (c) { return c.messages.length || c === chat; })
      .slice().sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); });
    var head = el('div', 'ai-list-head', 'Bu PDF\'teki sohbetler (' + list.filter(function (c) { return c.messages.length; }).length + ')');
    box.appendChild(head);
    var nb = el('button', 'ai-list-item ai-list-new', '+ Yeni sohbet başlat');
    nb.type = 'button';
    nb.addEventListener('click', newChat);
    box.appendChild(nb);
    list.forEach(function (c) {
      if (!c.messages.length) return;
      var it = el('button', 'ai-list-item' + (c === chat ? ' on' : ''));
      it.type = 'button';
      it.appendChild(el('span', 'ai-list-title', chatTitle(c)));
      var n = c.messages.filter(function (m) { return m.role === 'user'; }).length;
      var meta = fmtDate(c.updatedAt) + ' · ' + n + ' soru';
      if (pending[c.id]) meta += ' · düşünüyor…';
      else if (c === chat) meta += ' · açık';
      it.appendChild(el('span', 'ai-list-meta', meta));
      it.addEventListener('click', function () { openChat(c.id); });
      box.appendChild(it);
    });
  }

  function renderChips() {
    var box = $('#ai-chips');
    if (!box) return;
    box.textContent = '';
    box.hidden = !quotes.length;
    quotes.forEach(function (q, idx) {
      var chip = el('div', 'ai-chip');
      chip.title = q;
      var flat = q.replace(/\s+/g, ' ');
      chip.appendChild(el('span', null, '“' + (flat.length > 80 ? flat.slice(0, 80) + '…' : flat) + '”'));
      var x = el('button');
      x.type = 'button';
      x.setAttribute('aria-label', 'Alıntıyı kaldır');
      x.appendChild(icon('i-x'));
      x.addEventListener('click', function () {
        quotes.splice(idx, 1);
        renderChips();
        updateSend();
      });
      chip.appendChild(x);
      box.appendChild(chip);
    });
  }

  function updateSend() {
    var b = $('#ai-send');
    if (!b) return;
    var inp = $('#ai-input');
    var can = !!curBook && !!chat && !curPending() && (inp.value.trim() || quotes.length);
    b.disabled = !can;
  }

  function render() {
    renderRef();
    var msgs = $('#ai-msgs'), lst = $('#ai-list'), hb = $('#ai-hist');
    if (lst) lst.hidden = !listMode;
    if (msgs) msgs.hidden = listMode;
    if (hb) {
      hb.setAttribute('aria-pressed', listMode ? 'true' : 'false');
      hb.textContent = listMode ? 'Sohbete dön' : 'Sohbetler';
    }
    if (listMode) renderList();
    renderMessages();
    renderChips();
    updateSend();
  }

  function autosize() {
    var t = $('#ai-input');
    if (!t) return;
    t.style.height = 'auto';
    t.style.height = (t.scrollHeight + 2) + 'px';
  }

  /* ---------- Panel ---------- */
  function isOpen() {
    var a = $('#r-ai');
    return !!a && !a.hidden;
  }
  function open() {
    var a = $('#r-ai');
    if (!a) return;
    if (!curBook && window.Reader && Reader.currentBook) {
      var cb = Reader.currentBook();
      if (cb) onBookChanged(cb);
    }
    if (window.Reader && Reader.closeSidePanel) Reader.closeSidePanel();
    if (window.Notebook && Notebook.isSidePanelOpen && Notebook.isSidePanelOpen()) Notebook.closeSidePanel();
    a.hidden = false;
    var v = $('#view-reader');
    v.classList.add('ai-side-open');
    v.classList.remove('idle');
    $('#r-ai-btn').setAttribute('aria-pressed', 'true');
    renderRef();
    checkBridge();
    var box = $('#ai-msgs');
    if (box) box.scrollTop = box.scrollHeight;
    setTimeout(function () { var i = $('#ai-input'); if (i && isOpen()) { try { i.focus({ preventScroll: true }); } catch (e) {} } }, 0);
  }
  function close() {
    var a = $('#r-ai');
    if (!a || a.hidden) return;
    a.hidden = true;
    $('#view-reader').classList.remove('ai-side-open');
    $('#r-ai-btn').setAttribute('aria-pressed', 'false');
  }
  function toggle() { if (isOpen()) close(); else open(); }

  function onBookChanged(book) {
    hideBubble();
    quotes = [];
    listMode = false;
    var tok = ++loadToken;
    if (!book) { curBook = null; rec = null; chat = null; render(); return; }
    curBook = { id: book.id, title: book.title || '', author: book.author || '', page: book.page || 1 };
    var cached = recs[book.id];
    if (cached) { rec = cached; chat = findChat(rec, rec.activeId); render(); return; }
    rec = null;
    chat = null;
    render();
    DB.getAiChat(book.id).then(function (r) { return r; }, function () { return null; }).then(function (r) {
      if (!recs[book.id]) recs[book.id] = normalizeRec(book.id, r);
      if (tok !== loadToken || !curBook || curBook.id !== book.id) return;
      rec = recs[book.id];
      chat = findChat(rec, rec.activeId);
      render();
    });
  }

  /* ---------- Seçim balonu ---------- */
  function ensureBubble() {
    if (bubbleEl) return bubbleEl;
    var b = el('button', 'ai-bubble');
    b.type = 'button';
    b.hidden = true;
    b.appendChild(icon('i-ai'));
    b.appendChild(el('span', null, 'Yapay zekaya sor'));
    b.addEventListener('mousedown', function (e) { e.preventDefault(); });
    b.addEventListener('pointerdown', function (e) { e.preventDefault(); });
    b.addEventListener('click', function (e) {
      e.preventDefault();
      var t = (window.Reader && Reader.getStageSelection()) || bubbleText;
      try { var s = window.getSelection(); if (s) s.removeAllRanges(); } catch (err) {}
      hideBubble();
      addQuote(t);
    });
    $('#view-reader').appendChild(b);
    bubbleEl = b;
    return b;
  }
  function hideBubble() {
    var was = !!(bubbleEl && !bubbleEl.hidden);
    if (was) bubbleEl.hidden = true;
    bubbleText = '';
    return was;
  }
  function readerActive() {
    return window.App && App.route === 'reader' && window.Reader && Reader.currentBook && !!Reader.currentBook();
  }
  function maybeShowBubble() {
    if (!readerActive()) { hideBubble(); return; }
    var txt = Reader.getStageSelection();
    if (!txt) { hideBubble(); return; }
    var sel = window.getSelection();
    if (!sel || !sel.rangeCount) { hideBubble(); return; }
    var range = sel.getRangeAt(0);
    var rect = null, rects = range.getClientRects();
    for (var i = rects.length - 1; i >= 0; i--) {
      if (rects[i].width > 1 && rects[i].height > 1) { rect = rects[i]; break; }
    }
    if (!rect) {
      var bb = range.getBoundingClientRect();
      if (bb && (bb.width || bb.height)) rect = bb;
    }
    if (!rect) { hideBubble(); return; }
    var b = ensureBubble();
    bubbleText = txt;
    b.hidden = false;
    var w = b.offsetWidth || 150, h = b.offsetHeight || 32;
    var left = clamp(rect.right - w / 2, 8, Math.max(8, window.innerWidth - w - 8));
    var top = rect.bottom + 8;
    if (top + h > window.innerHeight - 8) top = rect.top - h - 8;
    top = clamp(top, 8, Math.max(8, window.innerHeight - h - 8));
    b.style.left = Math.round(left) + 'px';
    b.style.top = Math.round(top) + 'px';
  }

  function initBubble() {
    var stage = $('#r-stage');
    var downInStage = false;
    stage.addEventListener('mousedown', function (e) {
      if (e.button === 0) downInStage = true;
      hideBubble();
    });
    document.addEventListener('mouseup', function () {
      if (!downInStage) return;
      downInStage = false;
      setTimeout(maybeShowBubble, 40);
    });
    stage.addEventListener('keyup', function (e) {
      if (e.shiftKey || ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A'))) setTimeout(maybeShowBubble, 40);
    });
    document.addEventListener('selectionchange', function () {
      if (!bubbleEl || bubbleEl.hidden) return;
      if (!window.Reader || !Reader.getStageSelection()) hideBubble();
    });
    stage.addEventListener('scroll', hideBubble, { passive: true });
    stage.addEventListener('wheel', hideBubble, { passive: true });
    window.addEventListener('resize', hideBubble);
    document.addEventListener('keydown', function (e) {
      if (!bubbleEl || bubbleEl.hidden) return;
      if (e.key === 'Shift' || e.key === 'Control' || e.key === 'Meta' || e.key === 'Alt') return;
      if (e.ctrlKey || e.metaKey) return;
      hideBubble();
    });
  }

  /* ---------- Başlatma ---------- */
  function init() {
    if (inited) return;
    inited = true;
    fillModels();
    DB.getSetting('aiModel', DEFAULT_MODEL).then(function (v) {
      if (typeof v === 'string' && v) { model = v; fillModels(); }
    }, function () {});

    $('#r-ai-btn').addEventListener('click', toggle);
    $('#ai-close').addEventListener('click', close);
    $('#ai-new').addEventListener('click', newChat);
    $('#ai-hist').addEventListener('click', toggleList);
    $('#ai-retry-bridge').addEventListener('click', checkBridge);
    $('#ai-model').addEventListener('change', function () {
      model = this.value;
      DB.setSetting('aiModel', model).catch(function () {});
    });
    $('#ai-send').addEventListener('click', function () { send(); });
    var inp = $('#ai-input');
    inp.addEventListener('input', function () { autosize(); updateSend(); });
    inp.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        send();
      }
    });
    var addSel = $('#ai-add-sel');
    addSel.addEventListener('mousedown', function (e) { e.preventDefault(); });
    addSel.addEventListener('click', addCurrentSelection);

    initBubble();

    // Süre sayacı ve sayfa numarası (panel açıkken)
    setInterval(function () {
      if (!isOpen()) return;
      renderRef();
      var p = curPending(), s = $('#ai-pend-sec');
      if (p && s) s.textContent = Math.floor((Date.now() - p.start) / 1000) + ' sn';
    }, 1000);

    render();
  }

  window.AI = {
    init: init,
    open: open,
    close: close,
    toggle: toggle,
    isOpen: isOpen,
    addQuote: addQuote,
    onBookChanged: onBookChanged,
    dismissBubble: hideBubble
  };
})();
