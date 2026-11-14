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
  // Kapsam (scope): { key, kind: 'book'|'topic'|'desk', refId, title, author, page }
  //   book  -> key = bookId           topic -> key = 'topic:' + topicId      desk -> key = 'desk:' + deskId
  var home = null;                 // geçerli görünümün (PDF okuyucu / defter / masa) kendi kapsamı
  var cur = null;                  // panelde gösterilen kapsam (masa merkezinde başka kapsama inilmişse home'dan farklı)
  var drilled = false;             // masa merkezinden başka kapsamdaki bir sohbete inildi mi
  var readerBook = null;           // okuyucuda açık kitap { id, title, author, page }
  var rec = null;                  // cur kapsamının kaydı: { bookId(=key), activeId, chats: [...] }
  var chat = null;                 // cur kapsamında açık olan sohbet
  var recs = {};                   // key -> kayıt (önbellek; bekleyen istekler için de gerekli)
  var pending = {};                // chatId -> { ctrl, start, msgId, userAborted }
  var listMode = false;            // panelde "Sohbetler" listesi (masada: merkez) mi gösteriliyor
  var quotes = [];                 // gönderilmemiş alıntılar (geçerli kapsam)
  var loadToken = 0;
  var hubTok = 0;
  var hubData = null;              // { deskId, books, topics, dbmap }
  var hubOpen = {};                // merkezde açık grup anahtarları
  var hubShowEmpty = false;        // sohbeti olmayan PDF/defterler gösterilsin mi
  var hintTimer = null;
  var bubbleEl = null;
  var bubbleText = '';
  var bubbleSrc = '';              // 'reader' | 'ta' | 'preview'
  var lastPtr = { x: 0, y: 0 };    // not editöründeki son fare bırakma konumu
  var PANEL_MIN = 320;
  var RESEARCH_TIMEOUT_MS = 5 * 60 * 1000;
  var CURATE_TIMEOUT_MS = 3.5 * 60 * 1000;
  var SESSION_CHARS_MAX = 12000;   // oturum sonu küratör için toplam sohbet metni üst sınırı

  // Masa hafızası durumu
  var memCache = {};               // deskId -> { memory, path, chars } (köprüden gelen son hafıza)
  var lastState = {};              // deskId -> köprüye en son gönderilen masa durumu (JSON)
  var researching = {};            // bookId -> AbortController (devam eden araştırma)
  var researchTried = {};          // bookId -> true (bu oturumda otomatik araştırma denendi)
  var researchState = {};          // bookId -> { st: 'done'|'error', msg }
  var curating = {};               // deskId -> true ("Şimdi güncelle" sürüyor)
  var goalDismissed = {};          // deskId -> true (hedef kartı bu oturumda kapatıldı)
  var goalFetching = {};
  var goalCardEl = null;           // yazılmakta olan hedef kartı (yeniden çizimlerde korunur)
  var memPoll = null;
  var memSec = { goal: true, sessions: true, questions: true, sources: true };   // açık bölümler
  var qClosedOpen = false;
  var goalEdit = '';               // Hedef bölümünde düzenlenen masa
  var memMode = false;             // panelde "Hafıza" sekmesi mi gösteriliyor
  var memPrevList = false;
  var memOpen = {};                // açık kitap profili öğeleri
  var memView = null;              // { deskId, books, topics } son çizilen Hafıza görünümü
  var memTok = 0;
  var memMsgText = '';

  function route() { return window.App && App.route; }

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
    if (opts.keepalive) init.keepalive = true;
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
        onScopeShown();
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
    return { id: DB.uid(), conversationId: null, messages: [], createdAt: now, updatedAt: now, summarizedUpTo: 0 };
  }
  /* ---------- Kapsamlar ---------- */
  function bookScope(b) {
    return { key: b.id, kind: 'book', refId: b.id, deskId: b.deskId || '', title: b.title || '', author: b.author || '', page: b.page || 1 };
  }
  function topicScope(t) {
    return { key: 'topic:' + t.id, kind: 'topic', refId: t.id, deskId: t.deskId || '', title: t.title || 'Adsız defter', author: '', page: null };
  }
  function deskScope(d) {
    return { key: 'desk:' + d.id, kind: 'desk', refId: d.id, deskId: d.id, title: d.name || 'Masa', author: '', page: null };
  }
  // Kapsamın ait olduğu masa (kitap/defter kaydında yoksa etkin masaya düşer)
  function scopeDeskId(s) {
    if (!s) return '';
    if (s.deskId) return s.deskId;
    if (s.kind === 'desk') return s.refId;
    return window.Desk && Desk.getActiveId ? (Desk.getActiveId() || '') : '';
  }
  function deskNameOf(id) {
    return window.Desk && Desk.getDeskName ? (Desk.getDeskName(id) || '') : '';
  }
  function scopeLabel(s) {
    if (!s) return '';
    if (s.kind === 'topic') return 'Defter: ' + s.title;
    if (s.kind === 'desk') return 'Masa: ' + s.title;
    return s.title;
  }
  function computeHome() {
    var r = route();
    if (r === 'reader') return readerBook ? bookScope(readerBook) : null;
    if (r === 'notebook') {
      var t = window.Notebook && Notebook.getActiveTopic ? Notebook.getActiveTopic() : null;
      return t ? topicScope(t) : null;
    }
    if (r === 'desk') {
      var d = window.Desk && Desk.getActive ? Desk.getActive() : null;
      return d ? deskScope(d) : null;
    }
    return null;
  }
  // Köprüye gidecek book + context (masa için PDF listesi veritabanından okunur)
  function buildPayloadScope(s) {
    var book = { title: scopeLabel(s), author: s.author || '', page: null };
    if (s.kind === 'book') {
      var cb = window.Reader && Reader.currentBook ? Reader.currentBook() : null;
      book.page = (cb && cb.id === s.refId ? cb.page : s.page) || 1;
      return Promise.resolve({ book: book, context: '' });
    }
    if (s.kind === 'topic') {
      var ctx = '';
      var nt = window.Notebook && Notebook.getActiveTopic ? Notebook.getActiveTopic() : null;
      var nn = window.Notebook && Notebook.getActiveNote ? Notebook.getActiveNote() : null;
      if (route() === 'notebook' && nt && nt.id === s.refId && nn && nn.title) ctx = 'Açık not: ' + nn.title;
      return Promise.resolve({ book: book, context: ctx });
    }
    return DB.listBooks(s.refId).then(function (list) {
      var titles = (list || []).map(function (b) { return b.title || ''; }).filter(Boolean);
      var ctx = titles.length ? trunc('Bu masadaki PDF\'ler: ' + titles.join('; '), 3000) : '';
      return { book: book, context: ctx };
    }, function () { return { book: book, context: '' }; });
  }

  function normalizeRec(bookId, r, s) {
    if (r && Array.isArray(r.chats)) {
      r.chats = r.chats.filter(function (c) { return c && c.id; });
      r.chats.forEach(function (c) {
        if (!Array.isArray(c.messages)) c.messages = [];
        if (typeof c.summarizedUpTo !== 'number') c.summarizedUpTo = 0;
      });
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
    if (s) stampRec(r, s);
    return r;
  }
  // Kaydın hangi masaya / kapsama ait olduğunu bellekte tut (oturum sonu sohbet derlemesi için)
  function stampRec(r, s) {
    if (!r || !s) return;
    r.kind = s.kind;
    r.refId = s.refId;
    r.deskId = scopeDeskId(s);
    r.scopeTitle = scopeLabel(s);
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
      kind: r.kind || 'book',
      refId: r.refId || bookId,
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

  // Koprüye giden mesaj bicimi (alintilar soru metninin önüne eklenir)
  function histMsg(x) {
    var t = x.text;
    if (x.role === 'user' && x.quotes && x.quotes.length) {
      t = x.quotes.map(function (q) { return '“' + q + '”'; }).join('\n') + '\n' + t;
    }
    return { role: x.role, text: trunc(t, 1500) };
  }

  function send(retryId) {
    var sc = cur;
    if (!sc || !chat || pending[chat.id]) return;
    listMode = false;
    memMode = false;
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
    var history = c.messages.slice(0, idx).filter(function (x) { return !x.error; }).slice(-10).map(histMsg);
    var ctrl = new AbortController();
    var mine = { ctrl: ctrl, start: Date.now(), msgId: m.id, userAborted: false };
    pending[c.id] = mine;
    touch(c);
    var key = sc.key;
    saveRec(key);
    render();

    // Kapsam bağlamı (not başlığı / masadaki PDF'ler) gönderme anında kurulur; önce masa durumu köprüye iletilir
    var deskId = scopeDeskId(sc);
    buildPayloadScope(sc).then(function (ps) {
      return syncDeskState(deskId).catch(function () {}).then(function () { return ps; });
    }).then(function (ps) {
      var payload = {
        model: model,
        conversationId: c.conversationId || null,
        book: ps.book,
        quotes: m.quotes || [],
        question: m.text,
        history: history
      };
      if (ps.context) payload.context = ps.context;
      if (deskId) { payload.deskId = deskId; payload.deskName = deskNameOf(deskId); }
      return request('/ask', { method: 'POST', body: payload, ctrl: ctrl }, ASK_TIMEOUT_MS);
    }).then(function (r) {
      var d = r.data;
      if (d && d.ok && typeof d.response === 'string') {
        finish(key, c, mine, m, null, d, sc);
      } else {
        finish(key, c, mine, m, (d && d.error) || ('Köprüden beklenmeyen yanıt geldi (' + r.status + ').'), null, sc);
      }
    }, function (err) {
      var msg;
      if (err && err.name === 'AbortError') {
        msg = mine.userAborted ? 'İstek durduruldu.' : 'İstek zaman aşımına uğradı.';
      } else {
        bridge = 'off';
        msg = 'AI köprüsüne ulaşılamadı. Köprünün açık olduğundan emin ol.';
      }
      finish(key, c, mine, m, msg, null, sc);
    });
  }

  // bookId ve sohbet send anında yakalanır: yanıt, kullanıcı başka PDF'e ya da sohbete geçse bile
  // asıl sohbete yazılır.
  function finish(bookId, c, mine, userMsg, errText, data, sc) {
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
    if (isOpen() && ((cur && cur.key === bookId) || isHub())) render();
  }

  function stop() {
    var p = curPending();
    if (!p) return;
    p.userAborted = true;
    p.ctrl.abort();
  }

  // Yeni sohbet eskisini silmez: eski sohbet "Sohbetler" listesinde kalır, bekleyen cevabı da oraya yazılır.
  // Kayıtta boş aktif sohbet varsa onu kullanır, yoksa yenisini açar
  function startNew(r) {
    var act = findChat(r, r.activeId);
    if (act && !act.messages.length) return act;
    var c = newChatObj();
    r.chats.push(c);
    r.activeId = c.id;
    return c;
  }

  function newChat() {
    if (!cur || !rec) return;
    listMode = false;
    memMode = false;
    chat = startNew(rec);
    saveRec(cur.key);
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
    memMode = false;
    saveRec(cur.key);
    render();
    focusInput();
  }

  function toggleList() {
    if (!cur) return;
    listMode = memMode ? true : !listMode;
    memMode = false;
    render();
  }

  // Masa merkezinden başka kapsamdaki (PDF / defter) bir sohbete in
  function drillIn(s, chatId, fresh) {
    drilled = true;
    listMode = false;
    memMode = false;
    setScope(s, function (r) {
      if (fresh) {
        startNew(r);
      } else if (findChat(r, chatId)) {
        var old = findChat(r, r.activeId);
        if (old && old.id !== chatId && !old.messages.length && !pending[old.id]) r.chats.splice(r.chats.indexOf(old), 1);
        r.activeId = chatId;
      }
      saveRec(s.key);
    });
    focusInput();
  }

  // Masa merkezine dön
  function goHub() {
    if (!home) return;
    drilled = false;
    listMode = true;
    memMode = false;
    setScope(home);
  }

  function focusInput() {
    var i = $('#ai-input');
    if (i && isOpen()) setTimeout(function () { try { i.focus({ preventScroll: true }); } catch (e) {} }, 0);
  }

  /* ---------- Alıntılar ---------- */
  function addQuote(text) {
    text = String(text || '').trim();
    if (!text) return false;
    hideBubble();
    open();
    if (!cur) { showHint(route() === 'notebook' ? 'Bir defter seç.' : 'Panel hazır değil.'); return false; }
    if (quotes.indexOf(text) < 0) {
      if (quotes.length >= MAX_QUOTES) quotes.shift();
      quotes.push(text);
    }
    if (window.Hafiza && route() === 'reader') {
      var qb = window.Reader && Reader.currentBook ? Reader.currentBook() : null;
      if (qb) Hafiza.quote(qb.id, null, text, qb.page || null, qb.deskId || '');
    }
    renderChips();
    updateSend();
    var inp = $('#ai-input');
    if (inp) setTimeout(function () { try { inp.focus({ preventScroll: true }); } catch (e) {} }, 0);
    return true;
  }

  function nbSelectionText() {
    var ta = $('#nb-note-body');
    if (ta && ta.selectionEnd > ta.selectionStart && ta.offsetParent !== null) {
      var t = ta.value.slice(ta.selectionStart, ta.selectionEnd).trim();
      if (t) return t;
    }
    return previewSelection();
  }
  function previewSelection() {
    var pv = $('#nb-note-preview');
    var sel = window.getSelection ? window.getSelection() : null;
    if (!pv || !sel || sel.isCollapsed || !sel.rangeCount) return '';
    var a = sel.anchorNode, f = sel.focusNode;
    if (!a || !f || !pv.contains(a) || !pv.contains(f)) return '';
    return String(sel).trim();
  }

  function addCurrentSelection() {
    var r = route(), t = '';
    if (r === 'reader') {
      t = window.Reader ? (Reader.getStageSelection() || Reader.getLastSelection()) : '';
      if (!t) { showHint('Önce PDF\'te bir yazı seç.'); return; }
    } else if (r === 'notebook') {
      t = nbSelectionText();
      if (!t) { showHint('Önce notta bir yazı seç.'); return; }
    } else {
      showHint('Alıntı eklemek için PDF\'i ya da defteri aç.');
      return;
    }
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
      t.appendChild(document.createTextNode(' dosyasını çalıştır. İlk kez kullanıyorsan önce '));
      t.appendChild(el('code', null, 'Kurulum.bat'));
      t.appendChild(document.createTextNode(' ile gerekenleri kur.'));
      box.hidden = false;
    } else {
      box.hidden = true;
    }
  }

  function renderRef() {
    var r = $('#ai-ref');
    if (!r) return;
    var s = '';
    if (!cur) {
      s = route() === 'notebook' ? 'Defter seçilmedi' : '';
    } else if (cur.kind === 'book') {
      var cb = window.Reader && Reader.currentBook ? Reader.currentBook() : null;
      var pg = cb && cb.id === cur.refId ? cb.page : cur.page;
      s = cur.title + (route() === 'reader' ? ' · s. ' + (pg || 1) : '');
    } else {
      s = scopeLabel(cur);
    }
    if (r.textContent !== s) { r.textContent = s; r.title = s; }
  }

  // Geri okunu, "Sohbetler" düğmesini ve ek düğmeleri duruma göre ayarlar
  function renderChrome() {
    var back = $('#ai-back');
    var inChat = route() === 'desk' && !isHub();
    if (back) {
      back.hidden = !inChat;
      back.textContent = '← Masa';
    }
    var ref = $('#ai-ref');
    if (ref && route() === 'desk' && isHub() && home) { ref.textContent = scopeLabel(home); ref.title = ref.textContent; }
    var add = $('#ai-add-sel');
    if (add) add.hidden = route() === 'desk';
    var hb = $('#ai-hist');
    if (hb) {
      hb.title = !cur ? 'Sohbetler'
        : isHub() || (cur.kind === 'desk' && !drilled) ? 'Bu masadaki tüm sohbetler (PDF\'ler ve defterler dahil)'
        : cur.kind === 'book' ? 'Bu PDF\'teki tüm sohbetler'
        : cur.kind === 'topic' ? 'Bu defterdeki tüm sohbetler' : 'Bu masadaki sohbetler';
    }
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
    if (!cur) {
      var r0 = route();
      box.appendChild(el('div', 'ai-empty', r0 === 'notebook' ? 'Bir defter seç.' : r0 === 'reader' ? 'Yükleniyor…' : ''));
      return;
    }
    updateCard();
    if (!chat) { box.appendChild(el('div', 'ai-empty', 'Yükleniyor…')); return; }
    var pend = curPending();
    if (!chat.messages.length) {
      var emptyMsg = cur.kind === 'book' ? 'PDF\'te bir yazı seç, “Yapay zekaya sor”a bas ve sorunu yaz.'
        : cur.kind === 'topic' ? 'Notunda bir yazı seç, “Yapay zekaya sor”a bas ya da doğrudan sorunu yaz. Sohbet bu defterde saklanır.'
        : 'Bu masayla ilgili bir soru sor. Masadaki PDF\'lerin adlarını biliyorum.';
      box.appendChild(el('div', 'ai-empty', emptyMsg));
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

  function chatItem(c, on, onClick) {
    var it = el('button', 'ai-list-item' + (on ? ' on' : ''));
    it.type = 'button';
    it.appendChild(el('span', 'ai-list-title', chatTitle(c)));
    var n = c.messages.filter(function (m) { return m.role === 'user'; }).length;
    var meta = fmtDate(c.updatedAt) + ' · ' + n + ' soru';
    if (pending[c.id]) meta += ' · düşünüyor…';
    else if (on) meta += ' · açık';
    it.appendChild(el('span', 'ai-list-meta', meta));
    it.addEventListener('click', onClick);
    return it;
  }
  function sortedChats(r) {
    return ((r && r.chats) || []).filter(function (c) { return c.messages && c.messages.length; })
      .slice().sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); });
  }

  // Masada panel, masadaki her sohbetin merkezidir (masa + PDF'ler + defterler)
  function isHub() {
    return !!cur && !drilled && cur.kind === 'desk' && listMode && route() === 'desk';
  }

  function renderList() {
    if (isHub()) { renderHub(); return; }
    var box = $('#ai-list');
    if (!box) return;
    box.textContent = '';
    if (!rec) return;
    var list = sortedChats(rec);
    var noun = cur.kind === 'book' ? 'Bu PDF\'teki' : cur.kind === 'topic' ? 'Bu defterdeki' : 'Bu masadaki';
    box.appendChild(el('div', 'ai-list-head', noun + ' sohbetler (' + list.length + ')'));
    var nb = el('button', 'ai-list-item ai-list-new', '+ Yeni sohbet başlat');
    nb.type = 'button';
    nb.addEventListener('click', newChat);
    box.appendChild(nb);
    list.forEach(function (c) {
      box.appendChild(chatItem(c, c === chat, function () { openChat(c.id); }));
    });
  }

  function loadHub() {
    if (!home || home.kind !== 'desk') return;
    var tok = ++hubTok;
    var deskId = home.refId;
    Promise.all([
      DB.listBooks(deskId).catch(function () { return []; }),
      DB.listTopics().catch(function () { return []; }),
      DB.listAiChats().catch(function () { return []; })
    ]).then(function (res) {
      if (tok !== hubTok || !home || home.refId !== deskId) return;
      var dbmap = {};
      (res[2] || []).forEach(function (r) { if (r && r.bookId) dbmap[r.bookId] = r; });
      hubData = {
        deskId: deskId,
        books: (res[0] || []).slice(),
        topics: (res[1] || []).filter(function (t) { return t.deskId === deskId; }),
        dbmap: dbmap
      };
      if (isHub() && isOpen()) drawHub();
    });
  }

  function renderHub() {
    var box = $('#ai-list');
    if (box && (!hubData || !home || hubData.deskId !== home.refId)) {
      box.textContent = '';
      box.appendChild(el('div', 'ai-list-note', 'Yükleniyor…'));
    }
    loadHub();
    if (hubData && home && hubData.deskId === home.refId) drawHub();
  }

  function hubChats(key) {
    var r = recs[key] || (hubData && hubData.dbmap[key]);
    return sortedChats(r);
  }

  function hubGroup(s, onOpenChat, onNew) {
    var chats = hubChats(s.key);
    var g = el('div', 'ai-grp');
    var open = !!hubOpen[s.key];
    var h = el('button', 'ai-grp-head' + (chats.length ? '' : ' dim'));
    h.type = 'button';
    h.setAttribute('aria-expanded', open ? 'true' : 'false');
    h.appendChild(el('span', 'ai-grp-chev', '›'));
    h.appendChild(el('span', 'ai-grp-title', s.title || 'Adsız'));
    h.appendChild(el('span', 'ai-grp-n', chats.length ? chats.length + ' sohbet' : 'sohbet yok'));
    h.addEventListener('click', function () { hubOpen[s.key] = !hubOpen[s.key]; drawHub(); });
    g.appendChild(h);
    if (open) {
      var body = el('div', 'ai-grp-body');
      var nb = el('button', 'ai-list-item ai-list-new', '+ Yeni sohbet');
      nb.type = 'button';
      nb.addEventListener('click', onNew);
      body.appendChild(nb);
      chats.forEach(function (c) { body.appendChild(chatItem(c, false, function () { onOpenChat(c); })); });
      g.appendChild(body);
    }
    return g;
  }

  function drawHub() {
    var box = $('#ai-list');
    if (!box || !hubData || !home) return;
    var st = box.scrollTop;
    box.textContent = '';

    // 1) Masa sohbetleri
    var deskChats = sortedChats(recs[home.key] || hubData.dbmap[home.key]);
    box.appendChild(el('div', 'ai-sec', 'Masa sohbetleri (' + deskChats.length + ')'));
    var nb = el('button', 'ai-list-item ai-list-new', '+ Yeni masa sohbeti');
    nb.type = 'button';
    nb.addEventListener('click', function () { drilled = false; listMode = false; newChat(); });
    box.appendChild(nb);
    deskChats.forEach(function (c) {
      box.appendChild(chatItem(c, false, function () { drilled = false; openChat(c.id); }));
    });

    // 2) PDF'ler, 3) Defterler
    function section(title, items, mkScope, noneText) {
      var withChats = items.filter(function (it) { return hubChats(mkScope(it).key).length; });
      var without = items.filter(function (it) { return !hubChats(mkScope(it).key).length; });
      withChats.sort(function (a, b) {
        var la = hubChats(mkScope(a).key)[0], lb = hubChats(mkScope(b).key)[0];
        return (lb.updatedAt || 0) - (la.updatedAt || 0);
      });
      without.sort(function (a, b) { return String(a.title || '').localeCompare(String(b.title || ''), 'tr'); });
      box.appendChild(el('div', 'ai-sec', title + ' (' + items.length + ')'));
      if (!items.length) { box.appendChild(el('div', 'ai-list-note', noneText)); return; }
      var shown = withChats.concat(hubShowEmpty ? without : []);
      shown.forEach(function (it) {
        var s = mkScope(it);
        box.appendChild(hubGroup(s,
          function (c) { drillIn(s, c.id, false); },
          function () { drillIn(s, null, true); }));
      });
      if (!withChats.length && !hubShowEmpty) box.appendChild(el('div', 'ai-list-note', 'Henüz sohbet yok.'));
    }
    section('PDF\'ler', hubData.books, bookScope, 'Bu masada PDF yok.');
    section('Defterler', hubData.topics, topicScope, 'Bu masada defter yok.');

    var nEmpty = 0;
    hubData.books.forEach(function (b) { if (!hubChats(b.id).length) nEmpty++; });
    hubData.topics.forEach(function (t) { if (!hubChats('topic:' + t.id).length) nEmpty++; });
    if (nEmpty) {
      var tg = el('button', 'ai-toggle-empty', hubShowEmpty ? 'sohbeti olmayanları gizle' : 'sohbeti olmayanları göster (' + nEmpty + ')');
      tg.type = 'button';
      tg.addEventListener('click', function () { hubShowEmpty = !hubShowEmpty; drawHub(); });
      box.appendChild(tg);
    }
    box.scrollTop = st;
    updateGoalCard();
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
    var can = !!cur && !!chat && !curPending() && (inp.value.trim() || quotes.length);
    b.disabled = !can;
  }

  function render() {
    renderRef();
    var msgs = $('#ai-msgs'), lst = $('#ai-list'), hb = $('#ai-hist'), mem = $('#ai-mem'), mb = $('#ai-mem-btn');
    var hub = isHub();
    if (lst) lst.hidden = !listMode || memMode;
    if (msgs) msgs.hidden = listMode || memMode;
    if (mem) mem.hidden = !memMode;
    if (mb) mb.setAttribute('aria-pressed', memMode ? 'true' : 'false');
    var comp = $('.ai-composer');
    if (comp) comp.hidden = hub || memMode;
    if (hb) {
      hb.setAttribute('aria-pressed', listMode && !memMode ? 'true' : 'false');
      hb.textContent = listMode && !memMode ? 'Sohbete dön' : 'Sohbetler';
    }
    if (listMode && !memMode) renderList();
    if (memMode) renderMem(true);
    renderMessages();
    renderChips();
    updateSend();
    renderChrome();
    updateGoalCard();
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
    if (window.Reader && Reader.closeSidePanel) Reader.closeSidePanel();
    if (window.Notebook && Notebook.isSidePanelOpen && Notebook.isSidePanelOpen()) Notebook.closeSidePanel();
    a.hidden = false;
    syncHome();
    syncLayout();
    if (route() === 'reader') $('#view-reader').classList.remove('idle');
    render();
    checkBridge();
    onScopeShown();
    var box = $('#ai-msgs');
    if (box) box.scrollTop = box.scrollHeight;
    setTimeout(function () { var i = $('#ai-input'); if (i && isOpen() && !i.closest('[hidden]') && !$('.ai-composer').hidden) { try { i.focus({ preventScroll: true }); } catch (e) {} } }, 0);
  }
  function close() {
    var a = $('#r-ai');
    if (!a || a.hidden) return;
    a.hidden = true;
    setFull(false);
    hideBubble();
    syncLayout();
  }
  function toggle() { if (isOpen()) close(); else open(); }

  // Görünüm sınıfları: okuyucu kaydırması yalnız okuyucu görünürken, defter daralması yalnız defterde
  function syncLayout() {
    var a = $('#r-ai');
    var o = !!a && !a.hidden;
    var full = !!a && a.classList.contains('ai-full');
    var r = route();
    var vr = $('#view-reader'), vn = $('#view-notebook');
    if (vr) vr.classList.toggle('ai-side-open', o && !full && r === 'reader');
    if (vn) vn.classList.toggle('ai-nb-open', o && !full && r === 'notebook');
    ['#r-ai-btn', '#nb-ai-btn', '#d-ai-btn'].forEach(function (id) {
      var b = $(id);
      if (b) b.setAttribute('aria-pressed', o ? 'true' : 'false');
    });
  }

  /* ---------- Tam ekran ve genişlik ---------- */
  function isFull() { var a = $('#r-ai'); return !!a && a.classList.contains('ai-full'); }
  function setFull(on) {
    var a = $('#r-ai');
    if (!a) return;
    a.classList.toggle('ai-full', !!on);
    var u = $('#ai-full-use'), b = $('#ai-full');
    if (u) u.setAttribute('href', on ? '#i-shrink' : '#i-expand');
    if (b) {
      b.title = on ? 'Küçült' : 'Tam ekran';
      b.setAttribute('aria-label', on ? 'Küçült' : 'Tam ekran');
    }
    syncLayout();
  }
  function maxPanelW() { return Math.max(PANEL_MIN, Math.min(900, Math.round(window.innerWidth * 0.8))); }
  function setPanelW(px, persist) {
    var w = clamp(Math.round(px), PANEL_MIN, maxPanelW());
    document.documentElement.style.setProperty('--ai-side-w', w + 'px');
    if (persist) DB.setSetting('aiPanelW', w).catch(function () {});
    return w;
  }
  function currentPanelW() {
    var a = $('#r-ai');
    return a ? a.getBoundingClientRect().width : 400;
  }
  function initResize() {
    var h = $('#ai-resize'), a = $('#r-ai');
    if (!h || !a) return;
    var dragging = false;
    h.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      dragging = true;
      try { h.setPointerCapture(e.pointerId); } catch (err) {}
      h.classList.add('dragging');
      document.body.classList.add('ai-resizing');
      e.preventDefault();
    });
    h.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      setPanelW(window.innerWidth - e.clientX, false);
    });
    function end(e) {
      if (!dragging) return;
      dragging = false;
      try { h.releasePointerCapture(e.pointerId); } catch (err) {}
      h.classList.remove('dragging');
      document.body.classList.remove('ai-resizing');
      setPanelW(currentPanelW(), true);
    }
    h.addEventListener('pointerup', end);
    h.addEventListener('pointercancel', end);
    h.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      var d = (e.key === 'ArrowLeft' ? 1 : -1) * (e.shiftKey ? 80 : 24);
      setPanelW(currentPanelW() + d, true);
    });
    window.addEventListener('resize', function () {
      var st = document.documentElement.style.getPropertyValue('--ai-side-w');
      if (st && /px$/.test(st)) setPanelW(parseFloat(st), false);
    });
  }

  /* ---------- Kapsam yönetimi ---------- */
  function loadRec(s) {
    return DB.getAiChat(s.key).then(function (r) { return r; }, function () { return null; }).then(function (r) {
      if (!recs[s.key]) recs[s.key] = normalizeRec(s.key, r, s);
      return recs[s.key];
    });
  }

  // Panelde gösterilen kapsamı değiştirir; kaydı yükler. after(rec) kayıt hazır olunca, çizimden önce çalışır.
  function setScope(s, after) {
    hideBubble();
    var tok = ++loadToken;
    if (!s) { cur = null; rec = null; chat = null; quotes = []; memMode = false; render(); return; }
    var changed = !cur || cur.key !== s.key;
    cur = s;
    if (changed) { quotes = []; memMode = false; }
    function apply(r) {
      rec = r;
      stampRec(r, s);
      if (after) after(r);
      chat = findChat(rec, rec.activeId);
      render();
      onScopeShown();
    }
    if (recs[s.key]) { apply(recs[s.key]); return; }
    rec = null;
    chat = null;
    render();
    loadRec(s).then(function (r) {
      if (tok !== loadToken || !cur || cur.key !== s.key) return;
      apply(r);
    });
  }

  // Geçerli görünümün (okuyucu/defter/masa) kapsamını yeniden hesaplar
  function syncHome() {
    if (!isOpen()) { home = null; return; }
    var s = computeHome();
    var prev = home;
    home = s;
    if (prev && s && prev.key === s.key) {
      if (!drilled) { cur = s; renderRef(); }
      syncLayout();
      return;
    }
    drilled = false;
    listMode = !!(s && s.kind === 'desk');
    setScope(s);
    syncLayout();
  }

  function syncScope() {
    syncHome();
  }

  function onBookChanged(book) {
    readerBook = book ? { id: book.id, deskId: book.deskId || '', title: book.title || '', author: book.author || '', page: book.page || 1 } : null;
    syncHome();
  }

  // Silinen PDF / defter / masanın kaydını bellekten at (veritabanı satırını DB silme işlevleri siler)
  function forget(key) {
    var r = recs[key];
    if (r) {
      r.chats.forEach(function (c) {
        var p = pending[c.id];
        if (p) { p.userAborted = true; try { p.ctrl.abort(); } catch (e) {} }
      });
      delete recs[key];
    }
    if (hubData) delete hubData.dbmap[key];
    if (cur && cur.key === key) { home = null; cur = null; rec = null; chat = null; drilled = false; syncHome(); }
    else if (isOpen() && isHub()) { renderHub(); }
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
      var t = bubbleText;
      if (bubbleSrc === 'reader') t = (window.Reader && Reader.getStageSelection()) || bubbleText;
      if (bubbleSrc !== 'ta') { try { var s = window.getSelection(); if (s) s.removeAllRanges(); } catch (err) {} }
      hideBubble();
      addQuote(t);
    });
    document.body.appendChild(b);
    bubbleEl = b;
    return b;
  }
  function hideBubble() {
    var was = !!(bubbleEl && !bubbleEl.hidden);
    if (was) bubbleEl.hidden = true;
    bubbleText = '';
    bubbleSrc = '';
    return was;
  }
  function readerActive() {
    return window.App && App.route === 'reader' && window.Reader && Reader.currentBook && !!Reader.currentBook();
  }
  // Balonu bir dikdörtgenin altına (sığmazsa üstüne) yerleştirir; rect yoksa verilen noktaya
  function placeBubble(txt, src, rect, pt) {
    var b = ensureBubble();
    bubbleText = txt;
    bubbleSrc = src;
    b.hidden = false;
    var w = b.offsetWidth || 150, h = b.offsetHeight || 32;
    var left, top;
    if (rect) {
      left = rect.right - w / 2;
      top = rect.bottom + 8;
      if (top + h > window.innerHeight - 8) top = rect.top - h - 8;
    } else {
      left = pt.x - w / 2;
      top = pt.y;
    }
    left = clamp(left, 8, Math.max(8, window.innerWidth - w - 8));
    top = clamp(top, 8, Math.max(8, window.innerHeight - h - 8));
    b.style.left = Math.round(left) + 'px';
    b.style.top = Math.round(top) + 'px';
  }
  function selectionRect() {
    var sel = window.getSelection();
    if (!sel || !sel.rangeCount) return null;
    var range = sel.getRangeAt(0);
    var rect = null, rects = range.getClientRects();
    for (var i = rects.length - 1; i >= 0; i--) {
      if (rects[i].width > 1 && rects[i].height > 1) { rect = rects[i]; break; }
    }
    if (!rect) {
      var bb = range.getBoundingClientRect();
      if (bb && (bb.width || bb.height)) rect = bb;
    }
    return rect;
  }
  function maybeShowBubble() {
    if (!readerActive()) { hideBubble(); return; }
    var txt = Reader.getStageSelection();
    if (!txt) { hideBubble(); return; }
    var rect = selectionRect();
    if (!rect) { hideBubble(); return; }
    placeBubble(txt, 'reader', rect, null);
  }

  // Defter: not editörü (textarea) ve önizleme seçimi
  function maybeShowNbBubble(fromPointer) {
    if (route() !== 'notebook' || !cur || cur.kind !== 'topic') { hideBubble(); return; }
    var ta = $('#nb-note-body');
    if (ta && ta.offsetParent !== null && ta.selectionEnd > ta.selectionStart) {
      var t = ta.value.slice(ta.selectionStart, ta.selectionEnd).trim();
      if (t) {
        if (fromPointer) {
          placeBubble(t, 'ta', null, { x: lastPtr.x, y: lastPtr.y + 16 });
        } else {
          var r = ta.getBoundingClientRect();
          placeBubble(t, 'ta', null, { x: r.right - 90, y: r.top + 8 });
        }
        return;
      }
    }
    var pt = previewSelection();
    if (pt) {
      var rect = selectionRect();
      if (rect) { placeBubble(pt, 'preview', rect, null); return; }
    }
    hideBubble();
  }
  function initNbBubble() {
    var ta = $('#nb-note-body'), pv = $('#nb-note-preview');
    if (!ta || !pv) return;
    var downInTa = false;
    ta.addEventListener('mousedown', function (e) { if (e.button === 0) downInTa = true; hideBubble(); });
    document.addEventListener('mouseup', function (e) {
      if (!downInTa) return;
      downInTa = false;
      lastPtr = { x: e.clientX, y: e.clientY };
      setTimeout(function () { maybeShowNbBubble(true); }, 30);
    });
    ta.addEventListener('keyup', function (e) {
      if (e.shiftKey || ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A'))) setTimeout(function () { maybeShowNbBubble(false); }, 30);
    });
    ta.addEventListener('input', hideBubble);
    ta.addEventListener('scroll', hideBubble, { passive: true });
    pv.addEventListener('mousedown', hideBubble);
    pv.addEventListener('mouseup', function () { setTimeout(function () { maybeShowNbBubble(false); }, 30); });
    pv.addEventListener('scroll', hideBubble, { passive: true });
    document.addEventListener('selectionchange', function () {
      if (bubbleSrc === 'preview' && bubbleEl && !bubbleEl.hidden && !previewSelection()) hideBubble();
    });
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
      if (!bubbleEl || bubbleEl.hidden || bubbleSrc !== 'reader') return;
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

  /* ---------- Masa hafızası ---------- */
  // Köprüye JSON çağrısı: { ok: true, ... } döner, aksi halde hata fırlatır
  function api(path, body, timeoutMs, ctrl) {
    var opts = body === undefined ? {} : { method: 'POST', body: body };
    if (ctrl) opts.ctrl = ctrl;
    return request(path, opts, timeoutMs || 15000).then(function (r) {
      var d = r.data;
      if (d && d.ok) return d;
      throw new Error((d && d.error) || ('Köprüden beklenmeyen yanıt geldi (' + r.status + ').'));
    });
  }
  function errMsg(e) {
    if (e && e.name === 'AbortError') return 'İstek zaman aşımına uğradı.';
    if (e && e.name === 'TypeError') return 'AI köprüsüne ulaşılamadı.';
    return (e && e.message) || 'Bir hata oluştu.';
  }

  // GET /memory — masa başına önbellekli
  function fetchMemory(deskId, force) {
    if (!deskId) return Promise.resolve(null);
    if (!force && memCache[deskId]) return Promise.resolve(memCache[deskId]);
    return api('/memory?deskId=' + encodeURIComponent(deskId), undefined, 8000).then(function (d) {
      var mem = d.memory;
      if (!mem) return null;
      if (!mem.sources || typeof mem.sources !== 'object') mem.sources = {};
      ['sessions', 'questions', 'concepts', 'notes'].forEach(function (k) { if (!Array.isArray(mem[k])) mem[k] = []; });
      if (!mem.state || typeof mem.state !== 'object') mem.state = {};
      if (!Array.isArray(mem.state.books)) mem.state.books = [];
      if (!mem.settings || typeof mem.settings !== 'object') mem.settings = {};
      if (!mem.goal || typeof mem.goal !== 'object') mem.goal = null;
      var m = { memory: mem, path: d.path || '', dir: d.dir || '', chars: d.chars || 0 };
      memCache[deskId] = m;
      return m;
    }).catch(function () { return null; });
  }

  // POST /memory/state — masadaki PDF'ler ve defterler; aynıysa gönderilmez
  function syncDeskState(deskId) {
    if (!deskId) return Promise.resolve();
    return Promise.all([
      DB.listBooks(deskId).catch(function () { return []; }),
      DB.listTopics().catch(function () { return []; })
    ]).then(function (res) {
      var cb = window.Reader && Reader.currentBook ? Reader.currentBook() : null;
      var books = (res[0] || []).map(function (b) {
        var pg = cb && cb.id === b.id ? cb.page : b.page;
        return { id: b.id, title: b.title || '', author: b.author || '', page: pg || 1, pages: b.pages || 0 };
      });
      var topics = (res[1] || []).filter(function (t) { return t.deskId === deskId; }).map(function (t) {
        return { id: t.id, title: t.title || 'Adsız defter' };
      });
      var body = { deskId: deskId, deskName: deskNameOf(deskId), books: books, topics: topics };
      var key = JSON.stringify(body);
      if (lastState[deskId] === key) return;
      lastState[deskId] = key;
      return api('/memory/state', body, 6000).catch(function () {
        if (lastState[deskId] === key) delete lastState[deskId];
      });
    }).catch(function () {});
  }

  function deleteDeskMemory(deskId) {
    delete memCache[deskId];
    delete lastState[deskId];
    delete goalDismissed[deskId];
    if (window.Hafiza && Hafiza.forgetDesk) Hafiza.forgetDesk(deskId);
    api('/memory/delete-desk', { deskId: deskId }, 8000).catch(function () {});
  }

  // Masa oturumu başlayınca: küratör arka planda hafızayı değiştirmiş olabilir, önbelleği at
  function dropMemCache(deskId) {
    delete memCache[deskId];
    delete goalFetching[deskId];
    if (isOpen() && cur && scopeDeskId(cur) === deskId) {
      if (memMode) renderMem(true);
      else updateGoalCard();
    }
  }

  // Panel gösterilen kapsama geçince: masa durumunu eşitle, kitap profilini kontrol et
  function onScopeShown() {
    if (!cur || !isOpen()) return;
    var d = scopeDeskId(cur);
    if (d && bridge !== 'off') syncDeskState(d);
    checkBookProfile(cur);
    updateGoalCard();
  }

  /* --- Oturum sonu: küratöre gidecek sohbetler --- */
  // Bu masaya ait, henüz küratöre verilmemiş mesajları toplar ve işaretler (summarizedUpTo).
  // Dönen rollback() işaretleri geri alır (gönderim başarısız olursa). force=false iken masanın
  // "küratör" ayarı kapalıysa hiçbir şey gönderilmez ve işaretlenmez.
  function sessionChats(deskId, force) {
    var out = { chats: [], rollback: function () {} };
    if (!deskId) return out;
    try {
      if (!force) {
        var cm = memCache[deskId];
        if (cm && cm.memory.settings && cm.memory.settings.autoSummary === false) return out;
      }
      var marks = [], items = [];
      Object.keys(recs).forEach(function (key) {
        var r = recs[key];
        if (!r || r.deskId !== deskId || !r.chats) return;
        r.chats.forEach(function (c) {
          var from = c.summarizedUpTo || 0;
          var n = c.messages.length;
          var p = pending[c.id];
          if (p) {
            for (var i = 0; i < c.messages.length; i++) if (c.messages[i].id === p.msgId) { n = i; break; }
          }
          if (n <= from) return;
          marks.push({ key: key, c: c, from: from, n: n });
          var msgs = c.messages.slice(from, n).filter(function (x) { return !x.error; }).map(histMsg);
          if (msgs.length) items.push({ r: r, c: c, msgs: msgs });
        });
      });
      // En yeni mesajlar öncelikli: toplam üst sınıra göre eskileri at
      items.sort(function (a, b) { return (b.c.updatedAt || 0) - (a.c.updatedAt || 0); });
      var left = SESSION_CHARS_MAX;
      var kept = [];
      items.forEach(function (it) {
        var take = [];
        for (var i = it.msgs.length - 1; i >= 0; i--) {
          var len = it.msgs[i].text.length;
          if (len > left) break;
          left -= len;
          take.unshift(it.msgs[i]);
        }
        if (take.length) {
          kept.push({
            at: it.c.updatedAt || 0,
            chat: { scopeTitle: it.r.scopeTitle || '', bookId: it.r.kind === 'book' ? (it.r.refId || null) : null, messages: take }
          });
        }
      });
      kept.sort(function (a, b) { return a.at - b.at; });
      out.chats = kept.map(function (k) { return k.chat; });
      var saved = {};
      marks.forEach(function (mk) { mk.c.summarizedUpTo = mk.n; saved[mk.key] = true; });
      Object.keys(saved).forEach(function (k) { saveRec(k); });
      out.rollback = function () {
        var again = {};
        marks.forEach(function (mk) {
          if (mk.c.summarizedUpTo === mk.n) { mk.c.summarizedUpTo = mk.from; again[mk.key] = true; }
        });
        Object.keys(again).forEach(function (k) { saveRec(k); });
      };
    } catch (e) { out.chats = []; }
    return out;
  }

  /* --- Kitap profili (internet araştırması) --- */
  function profileOf(deskId, bookId) {
    var m = memCache[deskId];
    var s = m && m.memory.sources[bookId];
    return (s && s.profile) || null;
  }
  function autoResearchOn(deskId) {
    var m = memCache[deskId];
    return !(m && m.memory.settings && m.memory.settings.autoResearch === false);
  }

  function checkBookProfile(s) {
    if (!s || s.kind !== 'book' || !isOpen() || bridge === 'off') return;
    var deskId = scopeDeskId(s), id = s.refId;
    if (!deskId) return;
    fetchMemory(deskId).then(function (m) {
      updateCard();
      if (!m || !autoResearchOn(deskId) || researchTried[id] || researching[id]) return;
      if (profileOf(deskId, id)) return; // hazır, atlandı, araştırılıyor ya da hatalı: otomatik başlatma
      if (!cur || cur.key !== s.key || !isOpen()) return;
      startResearch({ id: id, title: s.title, author: s.author }, deskId);
    });
  }

  var MEM_EDITING = '#ai-mem textarea, #ai-mem input[type="text"], #ai-mem input[type="date"]';
  function memEditing() { return !!document.querySelector(MEM_EDITING); }

  function refreshResearchUi() {
    updateCard();
    if (memMode && !memEditing()) renderMem(false);
  }

  function startResearch(b, deskId) {
    var id = b && b.id;
    if (!id || !deskId || researching[id]) return;
    var ctrl = new AbortController();
    researching[id] = ctrl;
    researchTried[id] = true;
    delete researchState[id];
    refreshResearchUi();
    var openInReader = readerBook && readerBook.id === id && route() === 'reader' && window.Reader && Reader.getIdentityClues;
    var cluesP = openInReader ? Reader.getIdentityClues().catch(function () { return {}; }) : Promise.resolve({});
    Promise.all([cluesP, DB.getBook(id).catch(function () { return null; }), syncDeskState(deskId)]).then(function (res) {
      var clues = res[0] || {}, rb = res[1] || {};
      var book = {
        id: id,
        title: b.title || rb.title || '',
        author: b.author || rb.author || '',
        fileName: rb.fileName || '',
        pages: rb.pages || 0,
        metaTitle: clues.metaTitle || '',
        metaAuthor: clues.metaAuthor || '',
        outline: clues.outline || [],
        firstPagesText: clues.firstPagesText || ''
      };
      return api('/memory/profile', { deskId: deskId, deskName: deskNameOf(deskId), model: model, book: book }, RESEARCH_TIMEOUT_MS, ctrl);
    }).then(function (d) {
      var cancelled = researching[id] !== ctrl;
      if (!cancelled) delete researching[id];
      var p = d.profile;
      if (!cancelled) {
        researchState[id] = p && p.status === 'error' ? { st: 'error', msg: p.error || '' } : { st: 'done' };
        if (p && p.status === 'skip') delete researchState[id];
      }
      return fetchMemory(deskId, true);
    }, function (err) {
      if (researching[id] === ctrl) {
        delete researching[id];
        researchState[id] = { st: 'error', msg: errMsg(err) };
      }
      return null;
    }).then(refreshResearchUi);
  }

  // "Bu PDF için yapma": sürmekte olan araştırmayı bırak, köprüye "atla" yaz
  function skipResearch(b, deskId) {
    var c = researching[b.id];
    delete researching[b.id];
    delete researchState[b.id];
    researchTried[b.id] = true;
    if (c) { try { c.abort(); } catch (e) {} }
    updateCard();
    return api('/memory/profile/skip', { deskId: deskId, bookId: b.id, title: b.title || '' }, 8000).then(function () {
      return fetchMemory(deskId, true);
    }, function (e) { setMemMsg(errMsg(e)); }).then(refreshResearchUi);
  }

  function openMemoryAt(bookId) {
    if (!cur) return;
    if (bookId) memOpen[bookId] = true;
    if (!memMode) { memPrevList = listMode; listMode = false; memMode = true; }
    render();
  }

  function buildCard() {
    if (!cur || cur.kind !== 'book') return null;
    var id = cur.refId, deskId = scopeDeskId(cur);
    var st = researchState[id], p = profileOf(deskId, id);
    var mode = researching[id] ? 'run' : st && st.st === 'done' ? 'done' : st && st.st === 'error' ? 'err' : p && p.status === 'error' ? 'err' : '';
    if (!mode) return null;
    var b = { id: id, title: cur.title, author: cur.author };
    var card = el('div', 'ai-rcard ' + mode);
    card.id = 'ai-rcard';
    card.setAttribute('role', 'status');
    var row = el('div', 'ai-rcard-row');
    if (mode === 'run') {
      row.appendChild(el('span', 'ai-spin'));
      row.appendChild(el('span', null, 'Kitabı tanıyorum… internette araştırılıyor (≈1 dk)'));
    } else if (mode === 'done') {
      row.appendChild(el('span', null, 'Kitap profili hazır'));
    } else {
      var why = (st && st.msg) || (p && p.error) || '';
      row.appendChild(el('span', null, 'Kitap tanınamadı' + (why ? ' (' + trunc(why, 120) + ')' : '')));
    }
    card.appendChild(row);
    var acts = el('div', 'ai-rcard-acts');
    function lb(label, fn) {
      var x = el('button', 'ai-link-btn', label);
      x.type = 'button';
      x.addEventListener('click', fn);
      acts.appendChild(x);
    }
    if (mode === 'done') {
      lb('Gör', function () { openMemoryAt(id); });
      lb('Kapat', function () { delete researchState[id]; updateCard(); });
    } else {
      if (mode === 'err') lb('Tekrar dene', function () { startResearch(b, deskId); });
      lb('Bu PDF için yapma', function () { skipResearch(b, deskId); });
    }
    card.appendChild(acts);
    return card;
  }

  function updateCard() {
    var box = $('#ai-msgs');
    if (!box) return;
    var old = $('#ai-rcard');
    if (old) old.remove();
    var c = buildCard();
    if (c) box.insertBefore(c, box.firstChild);
  }

  /* --- Hedef kartı ("Bu masada neyi başarmak istiyorsun?") --- */
  var SEVIYELER = ['Başlangıç', 'Orta', 'İleri'];

  // Hedef formu: kart ve Hafıza sekmesindeki "Hedef" bölümü ortak kullanır.
  // cancelLabel boşsa vazgeç düğmesi gösterilmez.
  function goalForm(deskId, goal, onDone, onCancel, cancelLabel) {
    goal = goal || {};
    var f = el('div', 'ai-goal-form');
    function field(label, ctl) {
      var w = el('label', 'ai-goal-f');
      w.appendChild(el('span', 'ai-goal-l', label));
      w.appendChild(ctl);
      return w;
    }
    var amac = el('textarea');
    amac.rows = 2;
    amac.value = goal.amac || '';
    amac.placeholder = 'ör. Vizeye kadar bu kitabın ilk beş bölümünü bitirmek';
    var tarih = el('input');
    tarih.type = 'text';
    tarih.value = goal.sonTarih || '';
    tarih.placeholder = 'ör. 15 Aralık ya da vizeden önce';
    var sev = el('select');
    var opts = [['', 'Seçme (boş)']].concat(SEVIYELER.map(function (x) { return [x, x]; }));
    if (goal.seviye && SEVIYELER.indexOf(goal.seviye) < 0) opts.push([goal.seviye, goal.seviye]);
    opts.forEach(function (o) {
      var op = el('option', null, o[1]);
      op.value = o[0];
      sev.appendChild(op);
    });
    sev.value = goal.seviye || '';
    var notlar = el('textarea');
    notlar.rows = 2;
    notlar.value = goal.notlar || '';
    notlar.placeholder = 'Yapay zekanın bilmesi gereken başka bir şey';
    f.appendChild(field('Amaç (zorunlu)', amac));
    f.appendChild(field('Son tarih (isteğe bağlı)', tarih));
    f.appendChild(field('Seviye (isteğe bağlı)', sev));
    f.appendChild(field('Notlar (isteğe bağlı)', notlar));
    var err = el('div', 'ai-mem-msg');
    err.hidden = true;
    f.appendChild(err);
    var row = el('div', 'ai-mem-actions');
    var ok = el('button', 'btn sm', 'Kaydet');
    ok.type = 'button';
    ok.addEventListener('click', function () {
      var a = amac.value.trim();
      if (!a) { err.textContent = 'Amaç boş olamaz.'; err.hidden = false; amac.focus(); return; }
      err.hidden = true;
      ok.disabled = true;
      var body = { deskId: deskId, amac: a, sonTarih: tarih.value.trim(), seviye: sev.value, notlar: notlar.value.trim() };
      api('/memory/goal', body, 10000).then(function (d) {
        var cm = memCache[deskId];
        if (cm) cm.memory.goal = d.goal || { amac: body.amac, sonTarih: body.sonTarih, seviye: body.seviye, notlar: body.notlar, updatedAt: Date.now() };
        onDone();
      }, function (e) {
        ok.disabled = false;
        err.textContent = errMsg(e);
        err.hidden = false;
      });
    });
    row.appendChild(ok);
    if (cancelLabel) {
      var no = el('button', 'btn sm', cancelLabel);
      no.type = 'button';
      no.addEventListener('click', onCancel);
      row.appendChild(no);
    }
    f.appendChild(row);
    return f;
  }

  function goalHost() {
    if (memMode) return null;
    var lst = $('#ai-list'), msgs = $('#ai-msgs');
    if (lst && !lst.hidden) return lst;
    if (msgs && !msgs.hidden) return msgs;
    return null;
  }

  // Masanın hedefi yoksa panelin üstünde kompakt bir kart gösterir (bu oturumda "Şimdi değil" ile kapatılabilir)
  function updateGoalCard() {
    var host = goalHost();
    var deskId = cur && isOpen() ? scopeDeskId(cur) : '';
    var show = false;
    if (host && deskId && bridge !== 'off' && !goalDismissed[deskId]) {
      var cm = memCache[deskId];
      if (!cm) {
        var last = goalFetching[deskId] || 0;
        if (Date.now() - last > 15000) {
          goalFetching[deskId] = Date.now();
          fetchMemory(deskId).then(function (m) { if (m) updateGoalCard(); });
        }
      } else {
        show = !cm.memory.goal;
      }
    }
    if (!show) {
      if (goalCardEl) {
        if (goalCardEl.parentNode) goalCardEl.parentNode.removeChild(goalCardEl);
        goalCardEl = null;
      }
      return;
    }
    if (!goalCardEl || goalCardEl.getAttribute('data-desk') !== deskId) {
      if (goalCardEl && goalCardEl.parentNode) goalCardEl.parentNode.removeChild(goalCardEl);
      goalCardEl = buildGoalCard(deskId);
    }
    if (host.firstChild !== goalCardEl) host.insertBefore(goalCardEl, host.firstChild);
  }

  function buildGoalCard(deskId) {
    var c = el('div', 'ai-goal');
    c.id = 'ai-goal';
    c.setAttribute('data-desk', deskId);
    c.appendChild(el('div', 'ai-goal-h', 'Bu masada neyi başarmak istiyorsun?'));
    c.appendChild(el('div', 'ai-goal-sub', 'Hedefini bilirsem sana ona göre yardım ederim. Sonra Hafıza sekmesinden değiştirebilirsin.'));
    // Önce kartı DOM'dan kaldır, sonra referansı sil: tersi olursa updateGoalCard kaldıracak kartı göremez
    // ve kart ekranda asılı kalırdı.
    c.appendChild(goalForm(deskId, null, function () {
      removeGoalCard();
      updateGoalCard();
    }, function () {
      goalDismissed[deskId] = true;
      removeGoalCard();
      updateGoalCard();
    }, 'Şimdi değil'));
    return c;
  }

  function removeGoalCard() {
    if (goalCardEl && goalCardEl.parentNode) goalCardEl.parentNode.removeChild(goalCardEl);
    goalCardEl = null;
    var stray = $('#ai-goal');            // önceki sürümden kalmış olabilecek kart
    if (stray && stray.parentNode) stray.parentNode.removeChild(stray);
  }

  /* --- "Hafıza" sekmesi --- */
  function toggleMem() {
    if (!cur) return;
    if (memMode) { memMode = false; listMode = memPrevList; }
    else { memPrevList = listMode; listMode = false; memMode = true; }
    render();
  }

  function setMemMsg(t) {
    memMsgText = t || '';
    var m = $('#ai-mem-msg');
    if (m) { m.textContent = memMsgText; m.hidden = !memMsgText; }
  }

  function mkBtn(label, fn, cls) {
    var b = el('button', cls || 'ai-link-btn', label);
    b.type = 'button';
    b.addEventListener('click', fn);
    return b;
  }
  // İlk tık "Emin misin?" der, 3 sn içinde ikinci tık işlemi yapar (confirm() kullanılmaz)
  function armBtn(label, fn) {
    var timer = null;
    var b = el('button', 'ai-link-btn', label);
    b.type = 'button';
    b.addEventListener('click', function () {
      if (timer) { clearTimeout(timer); timer = null; fn(); return; }
      b.textContent = 'Emin misin?';
      b.classList.add('warn');
      timer = setTimeout(function () { timer = null; b.textContent = label; b.classList.remove('warn'); }, 3000);
    });
    return b;
  }
  function mkEditor(initial, onSave, onCancel, rows, okLabel, placeholder) {
    var w = el('div', 'ai-mem-edit');
    var ta = el('textarea');
    ta.value = initial || '';
    ta.rows = rows || 6;
    if (placeholder) ta.placeholder = placeholder;
    ta.setAttribute('aria-label', 'Metni düzenle');
    var row = el('div', 'ai-mem-actions');
    var ok = el('button', 'btn sm', okLabel || 'Kaydet');
    ok.type = 'button';
    ok.addEventListener('click', function () {
      ok.disabled = true;
      onSave(ta.value.trim(), function () { ok.disabled = false; });
    });
    var no = el('button', 'btn sm', 'Vazgeç');
    no.type = 'button';
    no.addEventListener('click', onCancel);
    row.appendChild(ok);
    row.appendChild(no);
    w.appendChild(ta);
    w.appendChild(row);
    setTimeout(function () { try { ta.focus(); } catch (e) {} }, 0);
    return w;
  }
  function badge(text, kind) { return el('span', 'ai-badge ' + kind, text); }

  function reloadMem(deskId) {
    return fetchMemory(deskId, true).then(function () { redrawMem(); updateCard(); updateGoalCard(); });
  }

  // refetch=true: köprüden yeniden oku; false: önbellekten çiz
  function renderMem(refetch) {
    var box = $('#ai-mem');
    if (!box) return;
    if (!cur) { box.textContent = ''; box.appendChild(el('div', 'ai-list-note', 'Önce bir kapsam seç.')); return; }
    var deskId = scopeDeskId(cur);
    if (memView && memView.deskId === deskId && memEditing()) return; // yazılmakta olan metni bozma
    var tok = ++memTok;
    if (!box.firstChild) box.appendChild(el('div', 'ai-list-note', 'Yükleniyor…'));
    Promise.all([
      fetchMemory(deskId, !!refetch || !memCache[deskId]),
      DB.listBooks(deskId).catch(function () { return []; }),
      DB.listTopics().catch(function () { return []; })
    ]).then(function (res) {
      if (tok !== memTok || !memMode) return;
      if (memEditing() && memView && memView.deskId === deskId) return;
      var m = res[0];
      var order = {};
      ((m && m.memory.state.books) || []).forEach(function (b, i) { order[b.id] = i; });
      var books = (res[1] || []).slice().sort(function (a, b) {
        var oa = order[a.id] != null ? order[a.id] : 1e6, ob = order[b.id] != null ? order[b.id] : 1e6;
        if (oa !== ob) return oa - ob;
        return String(a.title || '').localeCompare(String(b.title || ''), 'tr');
      });
      var topics = (res[2] || []).filter(function (t) { return t.deskId === deskId; });
      memView = { deskId: deskId, books: books, topics: topics };
      drawMem(m);
    });
  }
  function redrawMem() {
    if (!memMode || !memView || !cur || scopeDeskId(cur) !== memView.deskId) return;
    drawMem(memCache[memView.deskId] || null);
  }
  // Açık bir düzenleme varken bölüm aç/kapa ya da yeniden çizim yapma (yazılan metin kaybolmasın)
  function redrawFromClick() {
    if (memEditing()) { setMemMsg('Önce açık düzenlemeyi kaydet ya da vazgeç.'); return; }
    setMemMsg('');
    redrawMem();
  }

  function fmtMin(n) { n = Math.round(Number(n) || 0); return n + ' dk'; }

  function memSection(key, title, count, fill, headExtra) {
    var wrap = el('div', 'ai-msec');
    var open = !!memSec[key];
    var h = el('button', 'ai-msec-head');
    h.type = 'button';
    h.setAttribute('aria-expanded', open ? 'true' : 'false');
    h.appendChild(el('span', 'ai-grp-chev', '›'));
    h.appendChild(el('span', 'ai-msec-title', title));
    if (count != null && count !== '') h.appendChild(el('span', 'ai-grp-n', String(count)));
    h.addEventListener('click', function () { memSec[key] = !memSec[key]; redrawFromClick(); });
    wrap.appendChild(h);
    if (open) {
      var body = el('div', 'ai-msec-body');
      if (headExtra) body.appendChild(headExtra);
      fill(body);
      wrap.appendChild(body);
    }
    return wrap;
  }

  function memPost(path, deskId, body, ms) {
    body.deskId = deskId;
    return api(path, body, ms || 10000).then(function () { return reloadMem(deskId); }, function (e) {
      setMemMsg(errMsg(e));
      throw e;
    });
  }

  function drawMem(m) {
    var box = $('#ai-mem');
    if (!box || !memView) return;
    var deskId = memView.deskId;
    var st = box.scrollTop;
    clearTimeout(memPoll);
    box.textContent = '';
    if (!m) {
      box.appendChild(el('div', 'ai-list-note', 'Köprü kapalı: masa hafızası şu an okunamıyor. Köprüyü açıp tekrar dene.'));
      box.appendChild(mkBtn('Tekrar dene', function () { renderMem(true); }, 'btn sm ai-mem-retry'));
      return;
    }
    var mem = m.memory;
    var msg = el('div', 'ai-mem-msg');
    msg.id = 'ai-mem-msg';
    msg.hidden = !memMsgText;
    msg.textContent = memMsgText;
    box.appendChild(msg);
    box.appendChild(el('div', 'ai-mem-desk', 'Masa: ' + (deskNameOf(deskId) || mem.deskName || 'Masa')));

    // 1) Hedef
    box.appendChild(memSection('goal', 'Hedef', mem.goal ? '' : 'yok', function (body) { drawGoalSec(body, deskId, mem); }));
    // 2) Oturumlar
    box.appendChild(memSection('sessions', 'Oturumlar', mem.sessions.length, function (body) { drawSessions(body, deskId, mem); }));
    // 3) Açık sorular
    var nOpen = mem.questions.filter(function (q) { return q.status !== 'closed'; }).length;
    box.appendChild(memSection('questions', 'Açık sorular', nOpen, function (body) { drawQuestions(body, deskId, mem); }));
    // 4) Kaynaklar
    box.appendChild(memSection('sources', 'Kaynaklar', memView.books.length, function (body) { drawSources(body, deskId, m); }));
    // 5) Kavramlar
    box.appendChild(memSection('concepts', 'Kavramlar', mem.concepts.length, function (body) { drawConcepts(body, deskId, mem); }));
    // 6) Genel notlar
    box.appendChild(memSection('notes', 'Genel notlar', mem.notes.length, function (body) { drawNotes(body, deskId, mem); }));
    // 7) Ayarlar
    box.appendChild(memSection('settings', 'Ayarlar', '', function (body) { drawSettings(body, deskId, mem); }));

    // Alt bilgi
    box.appendChild(el('div', 'ai-mem-foot', 'Hafıza klasörü: ' + (m.dir || '—') + ' · GEMINI.md ' + (m.chars || 0) +
      ' karakter. Yapay zeka her soruda GEMINI.md\'yi okur, ayrıntı gerekince klasördeki dosyaları açar.'));
    box.scrollTop = st;

    // Küratör çalışırken durumu kendiliğinden yenile
    var busy = mem.sessions.some(function (s) { return s.status === 'curating'; });
    if (busy) {
      memPoll = setTimeout(function pollMem() {
        if (!memMode || !cur || scopeDeskId(cur) !== deskId) return;
        if (memEditing()) { memPoll = setTimeout(pollMem, 6000); return; }
        renderMem(true);
      }, 6000);
    }
  }

  function kv(parent, label, text) {
    if (!text) return;
    var r = el('div', 'ai-kv');
    r.appendChild(el('span', 'ai-kv-k', label));
    r.appendChild(el('span', 'ai-kv-v', text));
    parent.appendChild(r);
  }

  function drawGoalSec(body, deskId, mem) {
    var g = mem.goal;
    if (!g || goalEdit === deskId) {
      if (!g) body.appendChild(el('div', 'ai-list-note', 'Bu masa için henüz bir hedef yazılmadı.'));
      body.appendChild(goalForm(deskId, g, function () {
        goalEdit = '';
        reloadMem(deskId);
      }, function () {
        goalEdit = '';
        // redrawFromClick değil: kapatılan formun kendisi "açık düzenleme" sayılıp yeniden çizimi engellerdi
        setMemMsg('');
        redrawMem();
      }, g ? 'Vazgeç' : ''));
      return;
    }
    kv(body, 'Amaç', g.amac);
    kv(body, 'Son tarih', g.sonTarih);
    kv(body, 'Seviye', g.seviye);
    kv(body, 'Notlar', g.notlar);
    if (g.updatedAt) body.appendChild(el('div', 'ai-list-meta', 'Güncellendi: ' + fmtDate(g.updatedAt)));
    var acts = el('div', 'ai-mem-actions');
    acts.appendChild(mkBtn('Düzenle', function () { goalEdit = deskId; redrawFromClick(); }));
    body.appendChild(acts);
  }

  var SESSION_BADGE = {
    open: ['sürüyor', 'run'], curating: ['güncelleniyor', 'run'], done: ['tamam', 'ok'],
    skipped: ['atlandı', 'skip'], error: ['hata', 'err']
  };

  function drawSessions(body, deskId, mem) {
    var acts = el('div', 'ai-mem-actions');
    var busy = !!curating[deskId] || mem.sessions.some(function (s) { return s.status === 'curating'; });
    var nb = mkBtn(busy ? 'Güncelleniyor…' : 'Şimdi güncelle', function () { curateNow(deskId); }, 'btn sm');
    nb.disabled = busy;
    nb.title = 'Bu oturumdaki sohbetleri ve olayları yapay zekaya özetlettirip hafızaya yazar';
    if (busy) nb.insertBefore(el('span', 'ai-spin'), nb.firstChild);
    acts.appendChild(nb);
    body.appendChild(acts);
    if (!mem.sessions.length) { body.appendChild(el('div', 'ai-list-note', 'Henüz oturum yok. Masadan çıkınca oturum kartı yazılır.')); return; }
    mem.sessions.slice(0, 8).forEach(function (s) {
      var it = el('div', 'ai-mem-note');
      var head = el('div', 'ai-mem-note-h');
      var bd = SESSION_BADGE[s.status] || [s.status || '—', 'none'];
      head.appendChild(badge(bd[0], bd[1]));
      var meta = (s.start ? fmtDate(s.start) : '') + (s.minutes != null ? ' · ' + fmtMin(s.minutes) : '');
      head.appendChild(el('span', 'ai-list-meta', meta));
      it.appendChild(head);
      if (s.title) it.appendChild(el('div', 'ai-sess-title', s.title));
      if (s.summary) it.appendChild(renderMarkdown(s.summary));
      if (s.next) {
        var nx = el('div', 'ai-sess-next');
        nx.appendChild(el('strong', null, 'Sonraki adım: '));
        nx.appendChild(document.createTextNode(s.next));
        it.appendChild(nx);
      }
      var st = s.stats || {};
      var pgs = 0;
      if (st.pages && typeof st.pages === 'object') Object.keys(st.pages).forEach(function (k) { pgs += Number(st.pages[k]) || 0; });
      var parts = [];
      if (pgs) parts.push(pgs + ' sayfa');
      if (st.quotes) parts.push(st.quotes + ' alıntı');
      if (st.chats) parts.push(st.chats + ' sohbet');
      if (st.notes) parts.push(st.notes + ' not');
      if (parts.length) it.appendChild(el('div', 'ai-list-meta', parts.join(' · ')));
      body.appendChild(it);
    });
  }

  // "Şimdi güncelle": açık oturum için küratörü hemen çalıştırır (en çok ≈3 dk sürer)
  function curateNow(deskId) {
    if (curating[deskId]) return;
    curating[deskId] = true;
    setMemMsg('');
    redrawMem();
    var waits = window.Hafiza && Hafiza.flush ? Hafiza.flush() : [];
    var sc = sessionChats(deskId, true);
    Promise.all(waits).catch(function () {}).then(function () {
      return api('/memory/curate', { deskId: deskId, deskName: deskNameOf(deskId), chats: sc.chats }, CURATE_TIMEOUT_MS);
    }).then(function () {}, function (e) {
      sc.rollback();
      setMemMsg(errMsg(e));
    }).then(function () {
      delete curating[deskId];
      return fetchMemory(deskId, true);
    }).then(function () {
      if (memEditing()) return;
      redrawMem();
      updateGoalCard();
    });
  }

  function drawQuestions(body, deskId, mem) {
    var openQ = mem.questions.filter(function (q) { return q.status !== 'closed'; });
    var closedQ = mem.questions.filter(function (q) { return q.status === 'closed'; });
    if (!openQ.length) body.appendChild(el('div', 'ai-list-note', 'Açık soru yok. Yapay zeka oturum sonunda ya da sen ekleyebilirsin.'));
    openQ.forEach(function (q) { body.appendChild(questionItem(deskId, q, false)); });
    var addWrap = el('div', 'ai-mem-add');
    function showAdd() {
      addWrap.textContent = '';
      addWrap.appendChild(mkEditor('', function (text, done) {
        if (!text) { done(); return; }
        memPost('/memory/questions', deskId, { op: 'add', text: text }).then(null, done);
      }, hideAdd, 3, 'Ekle', 'Aklında kalan soru'));
    }
    function hideAdd() { addWrap.textContent = ''; addWrap.appendChild(mkBtn('+ Soru ekle', showAdd, 'ai-list-item ai-list-new')); }
    hideAdd();
    body.appendChild(addWrap);
    if (closedQ.length) {
      var tg = el('button', 'ai-toggle-empty', (qClosedOpen ? 'Kapananları gizle' : 'Kapananlar (' + closedQ.length + ')'));
      tg.type = 'button';
      tg.addEventListener('click', function () { qClosedOpen = !qClosedOpen; redrawFromClick(); });
      body.appendChild(tg);
      if (qClosedOpen) closedQ.forEach(function (q) { body.appendChild(questionItem(deskId, q, true)); });
    }
  }

  function questionItem(deskId, q, closed) {
    var it = el('div', 'ai-mem-note' + (closed ? ' dim' : ''));
    var txt = el('div', 'ai-mem-note-t', q.text || '');
    it.appendChild(txt);
    if (closed && q.answer) it.appendChild(el('div', 'ai-q-ans', 'Cevap: ' + q.answer));
    if (closed && q.closedAt) it.appendChild(el('div', 'ai-list-meta', 'Kapandı: ' + fmtDate(q.closedAt)));
    else if (q.at) it.appendChild(el('div', 'ai-list-meta', fmtDate(q.at)));
    var acts = el('div', 'ai-mem-actions');
    function swap(ed) {
      txt.hidden = true;
      acts.hidden = true;
      it.insertBefore(ed, acts);
    }
    function unswap(ed) { ed.remove(); txt.hidden = false; acts.hidden = false; }
    if (closed) {
      acts.appendChild(mkBtn('Yeniden aç', function () { memPost('/memory/questions', deskId, { op: 'reopen', id: q.id }).then(null, function () {}); }));
    } else {
      acts.appendChild(mkBtn('Kapat', function () {
        var ed = mkEditor('', function (text, done) {
          memPost('/memory/questions', deskId, { op: 'close', id: q.id, answer: text }).then(null, done);
        }, function () { unswap(ed); }, 3, 'Kapat', 'Cevap (isteğe bağlı)');
        swap(ed);
      }));
      acts.appendChild(mkBtn('Düzenle', function () {
        var ed = mkEditor(q.text || '', function (text, done) {
          if (!text) { done(); setMemMsg('Soru boş olamaz; silmek için Sil\'i kullan.'); return; }
          memPost('/memory/questions', deskId, { op: 'update', id: q.id, text: text }).then(null, done);
        }, function () { unswap(ed); }, 3);
        swap(ed);
      }));
    }
    acts.appendChild(armBtn('Sil', function () { memPost('/memory/questions', deskId, { op: 'delete', id: q.id }).then(null, function () {}); }));
    it.appendChild(acts);
    return it;
  }

  function drawSources(body, deskId, m) {
    if (!memView.books.length) body.appendChild(el('div', 'ai-list-note', 'Bu masada PDF yok.'));
    memView.books.forEach(function (b) { body.appendChild(memBookItem(deskId, b, m)); });
    if (memView.topics.length) {
      body.appendChild(el('div', 'ai-list-head', 'Defterler'));
      memView.topics.forEach(function (t) { body.appendChild(el('div', 'ai-mem-line', 'Defter: ' + (t.title || 'Adsız defter'))); });
    }
  }

  function drawConcepts(body, deskId, mem) {
    if (!mem.concepts.length) { body.appendChild(el('div', 'ai-list-note', 'Henüz kavram notu yok. Oturum sonunda yapay zeka yazar.')); return; }
    var titles = {};
    mem.concepts.forEach(function (c) { titles[c.slug] = c.title || c.slug; });
    mem.concepts.forEach(function (c) {
      var it = el('div', 'ai-mem-note');
      it.appendChild(el('div', 'ai-sess-title', c.title || c.slug));
      var view = el('div', 'ai-mem-view');
      view.appendChild(renderMarkdown(c.text || ''));
      it.appendChild(view);
      if (c.books && c.books.length) it.appendChild(el('div', 'ai-list-meta', 'Kitaplar: ' + c.books.join(', ')));
      if (c.related && c.related.length) {
        it.appendChild(el('div', 'ai-list-meta', 'İlişkili: ' + c.related.map(function (s) { return titles[s] || s; }).join(', ')));
      }
      if (c.updatedAt) it.appendChild(el('div', 'ai-list-meta', 'Güncellendi: ' + fmtDate(c.updatedAt)));
      var acts = el('div', 'ai-mem-actions');
      acts.appendChild(mkBtn('Düzenle', function () {
        view.hidden = true;
        acts.hidden = true;
        var ed = mkEditor(c.text || '', function (text, done) {
          if (!text) { done(); setMemMsg('Kavram metni boş olamaz; silmek için Sil\'i kullan.'); return; }
          memPost('/memory/concepts', deskId, { op: 'update', slug: c.slug, title: c.title || '', text: text }).then(null, done);
        }, function () { ed.remove(); view.hidden = false; acts.hidden = false; }, 8);
        it.insertBefore(ed, acts);
      }));
      acts.appendChild(armBtn('Sil', function () { memPost('/memory/concepts', deskId, { op: 'delete', slug: c.slug }).then(null, function () {}); }));
      it.appendChild(acts);
      body.appendChild(it);
    });
  }

  function drawNotes(body, deskId, mem) {
    var notes = mem.notes.slice().sort(function (a, b) { return (b.at || 0) - (a.at || 0); });
    if (!notes.length) body.appendChild(el('div', 'ai-list-note', 'Henüz not yok. Sohbetlerde ya da elle eklediğin genel bilgiler burada durur.'));
    notes.forEach(function (n) { body.appendChild(memNoteItem(deskId, n)); });
    var addWrap = el('div', 'ai-mem-add');
    function showAdd() {
      addWrap.textContent = '';
      addWrap.appendChild(mkEditor('', function (text, done) {
        if (!text) { done(); return; }
        memPost('/memory/notes', deskId, { op: 'add', text: text }).then(null, done);
      }, hideAdd, 4));
    }
    function hideAdd() { addWrap.textContent = ''; addWrap.appendChild(mkBtn('+ Not ekle', showAdd, 'ai-list-item ai-list-new')); }
    hideAdd();
    body.appendChild(addWrap);
  }

  function drawSettings(body, deskId, mem) {
    function toggleRow(label, checked, onChange) {
      var lab = el('label', 'ai-mem-toggle');
      var cbx = el('input');
      cbx.type = 'checkbox';
      cbx.checked = !!checked;
      cbx.addEventListener('change', function () { onChange(cbx.checked, cbx); });
      lab.appendChild(cbx);
      lab.appendChild(el('span', null, label));
      return lab;
    }
    function setting(key, cbx, v) {
      var b = { deskId: deskId };
      b[key] = v;
      api('/memory/settings', b, 8000).then(function () {
        mem.settings[key] = v;
      }, function (e) { cbx.checked = !v; setMemMsg(errMsg(e)); });
    }
    body.appendChild(toggleRow('Masadan çıkınca hafızayı güncelle (küratör)', mem.settings.autoSummary !== false, function (v, cbx) { setting('autoSummary', cbx, v); }));
    body.appendChild(el('div', 'ai-list-meta ai-set-note', 'Açıkken masadan çıkınca, o oturumdaki sohbet mesajların (alıntılar dahil) ve olay özetin yapay zeka modeline bir kez gönderilir.'));
    body.appendChild(toggleRow('Yeni kitapları otomatik araştır', mem.settings.autoResearch !== false, function (v, cbx) { setting('autoResearch', cbx, v); }));
  }

  function memBookItem(deskId, b, m) {
    var src = m.memory.sources[b.id] || {};
    var p = src.profile || null;
    var running = !!researching[b.id] || !!(p && p.status === 'running');
    var bd = running ? ['araştırılıyor', 'run'] : !p ? ['yok', 'none']
      : p.status === 'ok' ? ['hazır', 'ok'] : p.status === 'error' ? ['tanınamadı', 'err'] : p.status === 'skip' ? ['atlandı', 'skip'] : ['yok', 'none'];
    var open = !!memOpen[b.id];
    var cb = window.Reader && Reader.currentBook ? Reader.currentBook() : null;
    var pr = src.progress || {};
    var pg = cb && cb.id === b.id ? cb.page : (pr.page || b.page);
    var pgs = pr.pages || b.pages || 0;
    var g = el('div', 'ai-grp');
    var h = el('button', 'ai-grp-head');
    h.type = 'button';
    h.setAttribute('aria-expanded', open ? 'true' : 'false');
    h.appendChild(el('span', 'ai-grp-chev', '›'));
    h.appendChild(el('span', 'ai-grp-title', b.title || src.title || 'Adsız PDF'));
    h.appendChild(el('span', 'ai-grp-n', 's. ' + (pg || 1) + (pgs ? '/' + pgs : '')));
    h.appendChild(badge(bd[0], bd[1]));
    h.addEventListener('click', function () { memOpen[b.id] = !memOpen[b.id]; redrawFromClick(); });
    g.appendChild(h);
    if (!open) return g;

    var body = el('div', 'ai-grp-body');
    var view = el('div', 'ai-mem-view');
    if (p && p.text) view.appendChild(renderMarkdown(p.text));
    else if (p && p.status === 'error') view.appendChild(el('div', 'ai-list-note', 'Tanınamadı' + (p.error ? ': ' + p.error : '') + '.'));
    else if (p && p.status === 'skip') view.appendChild(el('div', 'ai-list-note', 'Bu PDF için araştırma yapılmıyor.'));
    else if (running) view.appendChild(el('div', 'ai-list-note', 'İnternette araştırılıyor…'));
    else view.appendChild(el('div', 'ai-list-note', 'Henüz profil yok.'));
    if (p && p.sources && p.sources.length) {
      var su = el('div', 'ai-mem-src');
      su.appendChild(el('div', 'ai-mem-src-h', 'Kaynaklar'));
      p.sources.forEach(function (u) { su.appendChild(el('div', 'ai-mem-src-u', String(u))); });
      view.appendChild(su);
    }
    if (p && p.updatedAt) view.appendChild(el('div', 'ai-list-meta', 'Güncellendi: ' + fmtDate(p.updatedAt)));
    body.appendChild(view);

    var acts = el('div', 'ai-mem-actions');
    var canRe = !running;
    var re = mkBtn('Yeniden araştır', function () { startResearch({ id: b.id, title: b.title, author: b.author }, deskId); }, 'ai-link-btn');
    if (!canRe) re.disabled = true;
    re.title = readerBook && readerBook.id === b.id && route() === 'reader'
      ? 'PDF\'in başlıkları ve ilk sayfaları da ipucu olarak gönderilir'
      : 'Yalnız ad, yazar ve dosya adıyla araştırılır (PDF okuyucuda açıksan daha iyi sonuç verir)';
    acts.appendChild(re);
    acts.appendChild(mkBtn('Düzenle', function () {
      view.hidden = true;
      acts.hidden = true;
      var ed = mkEditor(p && p.text ? p.text : '', function (text, done) {
        if (!text) { done(); setMemMsg('Profil metni boş olamaz.'); return; }
        api('/memory/profile/set', { deskId: deskId, bookId: b.id, title: b.title || '', text: text }, 10000).then(function () {
          delete researchState[b.id];
          return reloadMem(deskId);
        }, function (e) { done(); setMemMsg(errMsg(e)); });
      }, function () { ed.remove(); view.hidden = false; acts.hidden = false; }, 8);
      body.insertBefore(ed, acts);
    }));
    if (!p || p.status !== 'skip') acts.appendChild(mkBtn('Araştırma yapma', function () { skipResearch({ id: b.id, title: b.title }, deskId); }));
    if (p) acts.appendChild(armBtn('Sil', function () {
      api('/memory/profile/delete', { deskId: deskId, bookId: b.id }, 8000).then(function () {
        delete researchState[b.id];
        researchTried[b.id] = true; // silinen profil bu oturumda otomatik yeniden araştırılmasın
        return reloadMem(deskId);
      }, function (e) { setMemMsg(errMsg(e)); });
    }));
    body.appendChild(acts);

    // Alıntılar (en yeni üstte)
    var qs = (src.quotes || []).slice().sort(function (a, c) { return (c.at || 0) - (a.at || 0); });
    body.appendChild(el('div', 'ai-list-head', 'Alıntıların (' + qs.length + ')'));
    if (!qs.length) body.appendChild(el('div', 'ai-list-note', 'Bu kitaptan henüz alıntı yakalanmadı.'));
    var showAll = !!memOpen['q:' + b.id];
    (showAll ? qs : qs.slice(0, 6)).forEach(function (q) {
      var qe = el('div', 'ai-mem-note');
      var t = String(q.text || '');
      qe.appendChild(el('div', 'ai-mem-note-t', '“' + (t.length > 400 ? t.slice(0, 400) + '…' : t) + '”'));
      var qa = el('div', 'ai-mem-actions');
      qa.appendChild(el('span', 'ai-list-meta', (q.page ? 's. ' + q.page + ' · ' : '') + (q.at ? fmtDate(q.at) : '')));
      qa.appendChild(armBtn('Sil', function () {
        api('/memory/quotes', { deskId: deskId, op: 'delete', bookId: b.id, id: q.id }, 8000).then(function () {
          return reloadMem(deskId);
        }, function (e) { setMemMsg(errMsg(e)); });
      }));
      qe.appendChild(qa);
      body.appendChild(qe);
    });
    if (qs.length > 6) {
      var more = el('button', 'ai-toggle-empty', showAll ? 'daha az göster' : 'tümünü göster (' + qs.length + ')');
      more.type = 'button';
      more.addEventListener('click', function () { memOpen['q:' + b.id] = !showAll; redrawFromClick(); });
      body.appendChild(more);
    }
    g.appendChild(body);
    return g;
  }

  function memNoteItem(deskId, n) {
    var it = el('div', 'ai-mem-note');
    var head = el('div', 'ai-mem-note-h');
    head.appendChild(badge(n.source === 'user' ? 'Sen' : 'AI', n.source === 'user' ? 'user' : 'ai'));
    head.appendChild(el('span', 'ai-list-meta', n.at ? fmtDate(n.at) : ''));
    it.appendChild(head);
    var txt = el('div', 'ai-mem-note-t', n.text || '');
    it.appendChild(txt);
    var acts = el('div', 'ai-mem-actions');
    acts.appendChild(mkBtn('Düzenle', function () {
      txt.hidden = true;
      acts.hidden = true;
      var ed = mkEditor(n.text || '', function (text, done) {
        if (!text) { done(); setMemMsg('Not boş olamaz; silmek için Sil\'i kullan.'); return; }
        api('/memory/notes', { deskId: deskId, op: 'update', id: n.id, text: text }, 10000).then(function () { return reloadMem(deskId); }, function (e) { done(); setMemMsg(errMsg(e)); });
      }, function () { ed.remove(); txt.hidden = false; acts.hidden = false; }, 4);
      it.insertBefore(ed, acts);
    }));
    acts.appendChild(armBtn('Sil', function () {
      api('/memory/notes', { deskId: deskId, op: 'delete', id: n.id }, 10000).then(function () { return reloadMem(deskId); }, function (e) { setMemMsg(errMsg(e)); });
    }));
    it.appendChild(acts);
    return it;
  }

  /* ---------- Başlatma ---------- */
  function init() {
    if (inited) return;
    inited = true;
    fillModels();
    DB.getSetting('aiModel', DEFAULT_MODEL).then(function (v) {
      if (typeof v === 'string' && v) { model = v; fillModels(); }
    }, function () {});

    ['#r-ai-btn', '#nb-ai-btn', '#d-ai-btn'].forEach(function (id) {
      var b = $(id);
      if (b) b.addEventListener('click', toggle);
    });
    $('#ai-close').addEventListener('click', close);
    $('#ai-full').addEventListener('click', function () { setFull(!isFull()); });
    $('#ai-back').addEventListener('click', goHub);
    // Esc: tam ekranda önce tam ekrandan çıkar; okuyucu dışındaki görünümlerde panel içinden Esc paneli kapatır
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape' || !isOpen()) return;
      if (document.querySelector('dialog[open]')) return;
      if (isFull()) { e.preventDefault(); e.stopPropagation(); setFull(false); return; }
      var t = e.target;
      if (route() !== 'reader' && t && t.closest && t.closest('#r-ai')) {
        e.preventDefault(); e.stopPropagation(); close();
      }
    }, true);
    DB.getSetting('aiPanelW', 0).then(function (v) {
      if (typeof v === 'number' && v > 0) setPanelW(v, false);
    }, function () {});
    initResize();
    $('#ai-new').addEventListener('click', newChat);
    $('#ai-hist').addEventListener('click', toggleList);
    $('#ai-mem-btn').addEventListener('click', toggleMem);
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
    initNbBubble();

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
    syncScope: syncScope,
    forget: forget,
    deleteDeskMemory: deleteDeskMemory,
    sessionChats: sessionChats,
    dropMemCache: dropMemCache,
    dismissBubble: hideBubble
  };
})();
