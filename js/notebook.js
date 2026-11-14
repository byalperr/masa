/* notebook.js — Defter bölümü: masaya özel defterler, not editörü, Markdown önizleme ve okuyucu canlı yan paneli. */
(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var TOPIC_COLORS = ['#c9954a', '#5f9e73', '#5c85b8', '#b55d5d', '#8e6bb8', '#4b9ea1'];

  var topics = [];
  var notes = [];
  var activeTopicId = null;
  var activeNoteId = null;
  var sideNoteId = null;
  var searchQuery = '';
  var viewMode = 'split'; // 'edit' | 'split' | 'preview'
  var saveTimer = null;
  var sideSaveTimer = null;
  var editingTopicId = null;
  var inited = false;
  var dataLoaded = false;
  var lastCaptured = { text: '', ts: 0 };

  function fmtDate(ts) {
    if (!ts) return '';
    try {
      return new Date(ts).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    } catch (e) {
      return '';
    }
  }

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // Güvenli, hafif Markdown -> HTML dönüştürücü (etkileşimli görev kutucuklu)
  function renderMarkdown(src) {
    var lines = String(src || '').replace(/\r\n/g, '\n').split('\n');
    var out = [];
    var inCode = false;
    var listTag = null;
    var checkIndex = 0;

    function closeList() {
      if (listTag) { out.push('</' + listTag + '>'); listTag = null; }
    }

    function inlineFmt(str) {
      var esc = escapeHtml(str);
      esc = esc.replace(/`([^`]+)`/g, '<code>$1</code>');
      esc = esc.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
      esc = esc.replace(/\*([^*]+)\*/g, '<em>$1</em>');
      esc = esc.replace(/~~([^~]+)~~/g, '<del>$1</del>');
      return esc;
    }

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (/^```/.test(line.trim())) {
        closeList();
        if (!inCode) {
          inCode = true;
          out.push('<pre><code>');
        } else {
          inCode = false;
          out.push('</code></pre>');
        }
        continue;
      }
      if (inCode) {
        out.push(escapeHtml(line) + '\n');
        continue;
      }

      var m;
      if (/^---+$/.test(line.trim())) {
        closeList();
        out.push('<hr>');
      } else if ((m = line.match(/^(#{1,3})\s+(.*)$/))) {
        closeList();
        var lvl = m[1].length;
        out.push('<h' + lvl + '>' + inlineFmt(m[2]) + '</h' + lvl + '>');
      } else if ((m = line.match(/^>\s?(.*)$/))) {
        closeList();
        out.push('<blockquote>' + inlineFmt(m[1]) + '</blockquote>');
      } else if ((m = line.match(/^\s*[-*]\s+\[( |x|X)\]\s+(.*)$/))) {
        if (listTag !== 'ul') { closeList(); listTag = 'ul'; out.push('<ul class="md-checklist">'); }
        var checked = m[1].toLowerCase() === 'x';
        out.push('<li><label><input type="checkbox" data-check-idx="' + (checkIndex++) + '"' + (checked ? ' checked' : '') + '><span>' + inlineFmt(m[2]) + '</span></label></li>');
      } else if ((m = line.match(/^\s*[-*]\s+(.*)$/))) {
        if (listTag !== 'ul') { closeList(); listTag = 'ul'; out.push('<ul>'); }
        out.push('<li>' + inlineFmt(m[1]) + '</li>');
      } else if ((m = line.match(/^\s*\d+\.\s+(.*)$/))) {
        if (listTag !== 'ol') { closeList(); listTag = 'ol'; out.push('<ol>'); }
        out.push('<li>' + inlineFmt(m[1]) + '</li>');
      } else if (!line.trim()) {
        closeList();
      } else {
        closeList();
        out.push('<p>' + inlineFmt(line) + '</p>');
      }
    }
    closeList();
    if (inCode) out.push('</code></pre>');
    return out.join('\n') || '<p class="nb-empty-pv">Önizleme için yazmaya başla…</p>';
  }

  function activeDeskId() {
    return (window.Desk && Desk.getActiveId && Desk.getActiveId()) || null;
  }

  function activeDeskName() {
    var d = window.Desk && Desk.getActive && Desk.getActive();
    return (d && d.name) || 'Masa';
  }

  // Eski sürümlerden kalan deskId === 'global' defterlerini ilk geçerli masaya bağla, masanın en az 1 defteri olsun
  function ensureDeskHasTopic(dId) {
    if (!dataLoaded || !dId) return false;
    var changed = false;

    topics.forEach(function (t) {
      if (!t.deskId || t.deskId === 'global') {
        t.deskId = dId;
        DB.putTopic(t).catch(function () {});
        changed = true;
      }
    });
    notes.forEach(function (n) {
      if (!n.deskId || n.deskId === 'global') {
        var parentTopic = getTopic(n.topicId);
        n.deskId = (parentTopic && parentTopic.deskId) || dId;
        DB.putNote(n).catch(function () {});
      }
    });

    var hasTopicForDesk = topics.some(function (t) { return t.deskId === dId; });
    if (!hasTopicForDesk) {
      var isVeryFirst = topics.length === 0;
      var starter = {
        id: DB.uid(),
        deskId: dId,
        title: isVeryFirst ? 'Genel Çalışma Notları' : 'Çalışma Defteri',
        color: TOPIC_COLORS[topics.length % TOPIC_COLORS.length],
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      topics.push(starter);
      DB.putTopic(starter).catch(function () {});

      if (isVeryFirst) {
        var welcomeNote = {
          id: DB.uid(),
          topicId: starter.id,
          deskId: dId,
          title: 'Defterine Hoş Geldin',
          content: '# Defter Kullanımı\n\nSol taraftan yeni **defter başlıkları** açabilir, her defterin altına istediğin kadar not sayfası ekleyebilirsin.\n\n- [ ] İlk çalışma notunu ekle\n- [ ] Kitap okurken sağdan **Defter** panelini aç ve metin seç — seçtiğin yazı anlık defterine gelsin\n\n> Notların tarayıcıda güvenle saklanır ve `.md` olarak indirilebilir.',
          pinned: true,
          bookId: '',
          bookTitle: '',
          bookPage: 0,
          createdAt: Date.now(),
          updatedAt: Date.now()
        };
        notes.push(welcomeNote);
        DB.putNote(welcomeNote).catch(function () {});
      }
      changed = true;
    }
    return changed;
  }

  function visibleTopics() {
    var dId = activeDeskId();
    if (!dId) return [];
    return topics.filter(function (t) {
      return t.deskId === dId;
    }).sort(function (a, b) {
      return (a.createdAt || 0) - (b.createdAt || 0);
    });
  }

  function topicNotes(topicId) {
    return notes.filter(function (n) {
      return n.topicId === topicId;
    }).sort(function (a, b) {
      if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
      return (b.updatedAt || 0) - (a.updatedAt || 0);
    });
  }

  function notesInTopic(topicId) {
    var q = searchQuery.trim().toLocaleLowerCase('tr');
    if (!q) return topicNotes(topicId);

    var deskTopicIds = {};
    visibleTopics().forEach(function (t) { deskTopicIds[t.id] = true; });
    var list = notes.filter(function (n) {
      if (!deskTopicIds[n.topicId]) return false;
      return (n.title || '').toLocaleLowerCase('tr').indexOf(q) >= 0 ||
             (n.content || '').toLocaleLowerCase('tr').indexOf(q) >= 0;
    });
    list.sort(function (a, b) {
      if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
      return (b.updatedAt || 0) - (a.updatedAt || 0);
    });
    return list;
  }

  function getNote(id) {
    for (var i = 0; i < notes.length; i++) {
      if (notes[i].id === id) return notes[i];
    }
    return null;
  }

  function getTopic(id) {
    for (var i = 0; i < topics.length; i++) {
      if (topics[i].id === id) return topics[i];
    }
    return null;
  }

  function renderTopics() {
    var badge = $('#nb-desk-badge');
    if (badge) badge.textContent = activeDeskName();

    var host = $('#nb-topics-list');
    if (!host) return;
    host.textContent = '';

    var list = visibleTopics();
    if (!list.some(function (t) { return t.id === activeTopicId; })) {
      activeTopicId = list.length ? list[0].id : null;
    }

    list.forEach(function (t) {
      var count = notes.filter(function (n) { return n.topicId === t.id; }).length;
      var row = document.createElement('div');
      row.className = 'nb-topic-row' + (t.id === activeTopicId && !searchQuery.trim() ? ' is-active' : '');

      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'nb-topic-btn';
      btn.addEventListener('click', function () {
        searchQuery = '';
        var sInp = $('#nb-search');
        if (sInp) sInp.value = '';
        activeTopicId = t.id;
        var tNotes = notesInTopic(t.id);
        activeNoteId = tNotes.length ? tNotes[0].id : null;
        renderAll();
      });

      var dot = document.createElement('span');
      dot.className = 'nb-topic-dot';
      dot.style.background = t.color || TOPIC_COLORS[0];

      var nm = document.createElement('span');
      nm.className = 'nb-topic-name';
      nm.textContent = t.title;

      var cnt = document.createElement('span');
      cnt.className = 'nb-topic-cnt';
      cnt.textContent = count;

      btn.appendChild(dot);
      btn.appendChild(nm);
      btn.appendChild(cnt);

      var editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'btn icon small nb-topic-edit';
      editBtn.title = 'Defteri düzenle';
      editBtn.innerHTML = '<svg class="ico" aria-hidden="true"><use href="#i-edit"/></svg>';
      editBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        openTopicDialog(t);
      });

      row.appendChild(btn);
      row.appendChild(editBtn);
      host.appendChild(row);
    });
  }

  function renderNotesList() {
    var host = $('#nb-notes-list');
    var head = $('#nb-notes-topic-title');
    if (!host) return;
    host.textContent = '';

    var curTopic = getTopic(activeTopicId);
    if (head) {
      head.textContent = searchQuery.trim()
        ? 'Arama: "' + searchQuery.trim() + '"'
        : (curTopic ? curTopic.title : 'Defter seç');
    }

    var list = notesInTopic(activeTopicId);
    if (!list.some(function (n) { return n.id === activeNoteId; })) {
      activeNoteId = list.length ? list[0].id : null;
    }

    var empty = $('#nb-notes-empty');
    if (empty) empty.hidden = list.length > 0;

    list.forEach(function (n) {
      var card = document.createElement('button');
      card.type = 'button';
      card.className = 'nb-note-card' + (n.id === activeNoteId ? ' is-active' : '');
      card.addEventListener('click', function () {
        activeNoteId = n.id;
        renderNotesList();
        renderEditor();
      });

      var top = document.createElement('div');
      top.className = 'nb-note-top';
      var title = document.createElement('span');
      title.className = 'nb-note-title';
      title.textContent = n.title || 'Başlıksız Not';
      top.appendChild(title);
      if (n.pinned) {
        var pin = document.createElement('span');
        pin.className = 'nb-note-pin';
        pin.textContent = '★';
        top.appendChild(pin);
      }

      var snip = document.createElement('div');
      snip.className = 'nb-note-snip';
      snip.textContent = (n.content || '').replace(/[#>*_`\[\]]/g, '').trim().slice(0, 76) || 'Boş not…';

      var meta = document.createElement('div');
      meta.className = 'nb-note-meta';
      meta.textContent = (n.bookTitle ? n.bookTitle + (n.bookPage ? ' s.' + n.bookPage : '') + ' · ' : '') + fmtDate(n.updatedAt);

      card.appendChild(top);
      card.appendChild(snip);
      card.appendChild(meta);
      host.appendChild(card);
    });
  }

  function renderEditor() {
    var empty = $('#nb-editor-empty');
    var wrap = $('#nb-editor-wrap');
    var n = getNote(activeNoteId);
    if (!n) {
      if (empty) empty.hidden = false;
      if (wrap) wrap.hidden = true;
      return;
    }
    if (empty) empty.hidden = true;
    if (wrap) wrap.hidden = false;

    var titleInp = $('#nb-note-title');
    var bodyInp = $('#nb-note-body');
    var pv = $('#nb-note-preview');
    var pinBtn = $('#nb-note-pin');
    var metaEl = $('#nb-note-meta');

    if (titleInp && document.activeElement !== titleInp) titleInp.value = n.title || '';
    if (bodyInp && document.activeElement !== bodyInp) bodyInp.value = n.content || '';
    if (pv) pv.innerHTML = renderMarkdown(n.content || '');
    if (pinBtn) pinBtn.classList.toggle('on', !!n.pinned);

    if (metaEl) {
      var topic = getTopic(n.topicId);
      var parts = [];
      if (topic) parts.push(topic.title);
      if (n.bookTitle) parts.push(n.bookTitle + (n.bookPage ? ' (s. ' + n.bookPage + ')' : ''));
      if (n.updatedAt) parts.push('Son kayıt: ' + fmtDate(n.updatedAt));
      metaEl.textContent = parts.join(' · ');
    }

    wrap.dataset.mode = viewMode;
    $$('[data-nb-mode]').forEach(function (b) {
      b.classList.toggle('on', b.dataset.nbMode === viewMode);
    });
  }

  function pickFreeNotebookSlot(dId) {
    var existing = topics.filter(function (t) { return t.deskId === dId && t.deskX != null && t.deskY != null; });
    var cols = [72, 54, 36, 18];
    var rows = [11.2, 15.2, 19.2, 23.2, 27.5, 32, 36.5, 41, 46, 51, 56, 61];
    for (var pass = 0; pass < 3; pass++) {
      for (var r = 0; r < rows.length; r++) {
        for (var c = 0; c < cols.length; c++) {
          var sx = cols[c] + pass * 2;
          var sy = rows[r] + pass * 1;
          var clash = existing.some(function (t) {
            return Math.abs(t.deskX - sx) < 14 && Math.abs(t.deskY - sy) < 3.4;
          });
          if (!clash) return { x: Math.min(82, sx), y: Math.min(92, sy) };
        }
      }
    }
    var n = existing.length;
    return {
      x: Math.round((72 - ((n % 4) * 18)) * 10) / 10,
      y: Math.round((11.2 + Math.floor(n / 4) * 4) * 10) / 10
    };
  }

  function resetDeskPositions() {
    var dId = activeDeskId();
    if (!dId) return;
    var list = visibleTopics();
    list.forEach(function (t) {
      t.deskX = null;
      t.deskY = null;
    });
    list.forEach(function (t) {
      var slot = pickFreeNotebookSlot(dId);
      t.deskX = slot.x;
      t.deskY = slot.y;
      DB.putTopic(t).catch(function () {});
    });
    renderDeskWidget();
  }

  function renderDeskWidget() {
    var listEl = $('#desk-notebooks-list');
    if (!listEl) return;
    listEl.textContent = '';

    var deskTopics = visibleTopics();
    if (!deskTopics.length) {
      var msg = document.createElement('div');
      msg.className = 'dnb-empty-msg';
      msg.textContent = 'Bu masada henüz defter yok.';
      listEl.appendChild(msg);
      return;
    }

    deskTopics.forEach(function (t) {
      if (t.deskX == null || t.deskY == null) {
        var slot = pickFreeNotebookSlot(t.deskId);
        t.deskX = slot.x;
        t.deskY = slot.y;
        DB.putTopic(t).catch(function () {});
      }

      var tNotes = topicNotes(t.id);
      var recent = tNotes[0] || null;
      var color = t.color || TOPIC_COLORS[0];

      var card = document.createElement('div');
      card.className = 'desk-notebook desk-notebook-float';
      card.dataset.id = t.id;
      card.setAttribute('role', 'button');
      card.tabIndex = 0;
      card.style.left = t.deskX + '%';
      card.style.top = t.deskY + '%';
      card.style.setProperty('--nb-color', color);
      card.title = t.title + ' defterini aç (sürükle: taşı)';

      var spine = document.createElement('div');
      spine.className = 'dnb-spine';
      spine.setAttribute('aria-hidden', 'true');

      var cover = document.createElement('div');
      cover.className = 'dnb-cover';

      var topRow = document.createElement('div');
      topRow.className = 'dnb-top-row';

      var lbl = document.createElement('span');
      lbl.className = 'dnb-label';
      lbl.textContent = 'DEFTER';

      var editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'dnb-edit-btn';
      editBtn.title = 'Defteri düzenle';
      editBtn.innerHTML = '<svg class="ico ico-sm" aria-hidden="true"><use href="#i-edit"/></svg>';
      editBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        openTopicDialog(t);
      });

      topRow.appendChild(lbl);
      topRow.appendChild(editBtn);

      var title = document.createElement('div');
      title.className = 'dnb-title serif';
      title.textContent = t.title;

      var cnt = document.createElement('div');
      cnt.className = 'dnb-count';
      cnt.textContent = tNotes.length + ' not';

      var preview = document.createElement('div');
      preview.className = 'dnb-preview';
      preview.textContent = recent
        ? (recent.title || (recent.content || '').replace(/[#>*_`\[\]]/g, '').trim().slice(0, 48) || 'Not…')
        : 'Not almak için aç';

      cover.appendChild(topRow);
      cover.appendChild(title);
      cover.appendChild(cnt);
      cover.appendChild(preview);

      card.appendChild(spine);
      card.appendChild(cover);

      function openThisNotebook() {
        activeTopicId = t.id;
        activeNoteId = recent ? recent.id : null;
        location.hash = '#/defter';
      }

      if (window.Desk && Desk.makeFreeDraggable) {
        Desk.makeFreeDraggable({
          el: card,
          ignoreSelector: 'button',
          threshold: 10,
          setPos: function (nx, ny) {
            t.deskX = nx;
            t.deskY = ny;
          },
          onDragEnd: function (e, moved) {
            if (moved) DB.putTopic(t).catch(function () {});
          }
        });
      }

      card.addEventListener('click', function () {
        if (card.dataset.justDragged) return;
        openThisNotebook();
      });
      card.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openThisNotebook();
        }
      });

      listEl.appendChild(card);
    });
  }

  function renderAll() {
    renderTopics();
    renderNotesList();
    renderEditor();
    renderDeskWidget();
    if (window.AI && AI.syncScope) AI.syncScope();
  }

  // Masa hafızası: yalnız kullanıcı düzenlediyse (queue* çağrıldıysa) not özeti köprüye bildirilir
  var hafDirty = {};
  function hafizaNote(n) {
    if (!n || !hafDirty[n.id]) return;
    delete hafDirty[n.id];
    if (!window.Hafiza) return;
    var t = getTopic(n.topicId);
    Hafiza.noteSaved(n.topicId, t ? t.title : '', n.id, n.title || '', n.content || '', t ? t.deskId : n.deskId);
  }

  function saveActiveNoteNow() {
    clearTimeout(saveTimer);
    var n = getNote(activeNoteId);
    if (!n) return;
    n.updatedAt = Date.now();
    hafizaNote(n);
    var status = $('#nb-save-status');
    if (status) status.textContent = 'Kaydedildi';
    DB.putNote(n).catch(function () {});
  }

  function queueSaveNote() {
    if (activeNoteId) hafDirty[activeNoteId] = true;
    var status = $('#nb-save-status');
    if (status) status.textContent = 'Kaydediliyor…';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      saveActiveNoteNow();
      renderNotesList();
      renderDeskWidget();
    }, 320);
  }

  function createNote(opts) {
    opts = opts || {};
    var deskTopics = visibleTopics();
    var tid = opts.topicId || activeTopicId || (deskTopics[0] && deskTopics[0].id);
    if (!tid) {
      openTopicDialog(null);
      return null;
    }
    var n = {
      id: DB.uid(),
      topicId: tid,
      deskId: activeDeskId() || 'global',
      title: opts.title || '',
      content: opts.content || '',
      pinned: false,
      bookId: opts.bookId || '',
      bookTitle: opts.bookTitle || '',
      bookPage: opts.bookPage || 0,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    notes.unshift(n);
    activeTopicId = tid;
    activeNoteId = n.id;
    DB.putNote(n).catch(function () {});
    renderAll();
    if (!opts.silent && $('#nb-note-title')) {
      $('#nb-note-title').focus();
    }
    return n;
  }

  function openTopicDialog(topic) {
    var dlg = $('#dlg-topic');
    if (!dlg) return;
    editingTopicId = topic ? topic.id : null;
    $('#topic-dlg-title').textContent = topic ? 'Defteri düzenle' : 'Yeni defter oluştur';
    $('#topic-name').value = topic ? topic.title : '';
    var chosen = (topic && topic.color) || TOPIC_COLORS[visibleTopics().length % TOPIC_COLORS.length];
    var colorsHost = $('#topic-colors');
    if (colorsHost) {
      colorsHost.textContent = '';
      TOPIC_COLORS.forEach(function (c) {
        var sw = document.createElement('button');
        sw.type = 'button';
        sw.className = 'color-swatch' + (c === chosen ? ' is-selected' : '');
        sw.style.background = c;
        sw.dataset.color = c;
        sw.addEventListener('click', function () {
          $$('.color-swatch', colorsHost).forEach(function (x) { x.classList.remove('is-selected'); });
          sw.classList.add('is-selected');
        });
        colorsHost.appendChild(sw);
      });
    }
    var delBtn = $('#topic-delete-btn');
    if (delBtn) delBtn.hidden = !topic || visibleTopics().length <= 1;
    dlg.showModal();
    setTimeout(function () { $('#topic-name').focus(); }, 30);
  }

  function insertFormatting(kind) {
    var ta = $('#nb-note-body');
    var n = getNote(activeNoteId);
    if (!ta || !n) return;
    var s = ta.selectionStart, e = ta.selectionEnd;
    var val = ta.value;
    var sel = val.slice(s, e);
    var rep = sel;
    if (kind === 'h2') rep = '## ' + (sel || 'Alt Başlık');
    else if (kind === 'bold') rep = '**' + (sel || 'kalın') + '**';
    else if (kind === 'italic') rep = '*' + (sel || 'italik') + '*';
    else if (kind === 'quote') rep = '> ' + (sel || 'Alıntı');
    else if (kind === 'ul') rep = '- ' + (sel || 'Madde');
    else if (kind === 'check') rep = '- [ ] ' + (sel || 'Yapılacak');
    else if (kind === 'code') rep = sel.indexOf('\n') >= 0 ? '```\n' + sel + '\n```' : '`' + (sel || 'kod') + '`';
    else if (kind === 'date') rep = new Date().toLocaleString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });

    ta.value = val.slice(0, s) + rep + val.slice(e);
    n.content = ta.value;
    ta.focus();
    ta.setSelectionRange(s + rep.length, s + rep.length);
    var pv = $('#nb-note-preview');
    if (pv) pv.innerHTML = renderMarkdown(n.content);
    queueSaveNote();
  }

  // ---------- Okuyucu içinde Yan Defter Paneli (Canlı Alıntı Yakalama) ----------
  function isSidePanelOpen() {
    var drawer = $('#r-quick-note');
    return !!(drawer && !drawer.hidden);
  }

  function setSideStatus(text, flash) {
    var el = $('#rqn-status');
    if (!el) return;
    el.textContent = text;
    el.classList.toggle('flash', !!flash);
  }

  function populateSideSelectors() {
    var topicSel = $('#rqn-topic');
    var noteSel = $('#rqn-note');
    var list = visibleTopics();

    if (topicSel) {
      topicSel.textContent = '';
      list.forEach(function (t) {
        var opt = document.createElement('option');
        opt.value = t.id;
        opt.textContent = t.title;
        if (t.id === activeTopicId) opt.selected = true;
        topicSel.appendChild(opt);
      });
      if (list.length && !list.some(function (t) { return t.id === activeTopicId; })) {
        activeTopicId = list[0].id;
        topicSel.value = activeTopicId;
      }
    }

    var tNotes = activeTopicId ? topicNotes(activeTopicId) : [];
    if (!tNotes.some(function (n) { return n.id === sideNoteId; })) {
      sideNoteId = tNotes.some(function (n) { return n.id === activeNoteId; })
        ? activeNoteId
        : (tNotes[0] ? tNotes[0].id : null);
    }

    if (noteSel) {
      noteSel.textContent = '';
      if (!tNotes.length) {
        var emptyOpt = document.createElement('option');
        emptyOpt.value = '';
        emptyOpt.textContent = '(Yeni not — yaz veya PDF\'ten metin seç)';
        noteSel.appendChild(emptyOpt);
      } else {
        tNotes.forEach(function (n) {
          var opt = document.createElement('option');
          opt.value = n.id;
          opt.textContent = n.title || 'Başlıksız Not';
          if (n.id === sideNoteId) opt.selected = true;
          noteSel.appendChild(opt);
        });
      }
    }
  }

  function renderSideEditorFields() {
    var n = getNote(sideNoteId);
    var titleInp = $('#rqn-title');
    var bodyInp = $('#rqn-body');
    if (titleInp && document.activeElement !== titleInp) {
      titleInp.value = n ? (n.title || '') : '';
    }
    if (bodyInp && document.activeElement !== bodyInp) {
      bodyInp.value = n ? (n.content || '') : '';
    }
  }

  function renderSidePanel(book, pageNum) {
    ensureDeskHasTopic(activeDeskId());
    populateSideSelectors();
    updateSidePanelContext(book, pageNum);
    renderSideEditorFields();
    setSideStatus('Hazır', false);
  }

  function updateSidePanelContext(book, pageNum) {
    var refEl = $('#rqn-ref');
    if (refEl) {
      refEl.textContent = (book ? book.title : 'PDF') + ' · Sayfa ' + (pageNum || 1);
    }
  }

  function ensureSideNote(book, pageNum) {
    var existing = getNote(sideNoteId);
    if (existing) return existing;
    var titleFallback = (book && book.title ? book.title : 'Okuma Notu') + ' — s. ' + (pageNum || 1);
    var created = createNote({
      topicId: activeTopicId,
      title: ($('#rqn-title') && $('#rqn-title').value.trim()) || titleFallback,
      content: ($('#rqn-body') && $('#rqn-body').value) || '',
      bookId: book ? book.id : '',
      bookTitle: book ? book.title : '',
      bookPage: pageNum || 0,
      silent: true
    });
    if (created) {
      sideNoteId = created.id;
      populateSideSelectors();
    }
    return created;
  }

  function saveSideNoteNow() {
    clearTimeout(sideSaveTimer);
    var n = getNote(sideNoteId);
    if (!n) return;
    n.updatedAt = Date.now();
    hafizaNote(n);
    DB.putNote(n).catch(function () {});
    setSideStatus('Kaydedildi', false);
    renderNotesList();
    renderDeskWidget();
  }

  function queueSideSave() {
    if (sideNoteId) hafDirty[sideNoteId] = true;
    setSideStatus('Kaydediliyor…', false);
    clearTimeout(sideSaveTimer);
    sideSaveTimer = setTimeout(saveSideNoteNow, 300);
  }

  function setReaderSideState(open) {
    var drawer = $('#r-quick-note');
    var viewer = $('#view-reader');
    var btn = $('#r-quick-note-btn');
    if (drawer) drawer.hidden = !open;
    if (viewer) viewer.classList.toggle('note-side-open', open);
    if (btn) btn.setAttribute('aria-pressed', open ? 'true' : 'false');
  }

  function openSidePanel(book, pageNum) {
    if (window.AI && AI.isOpen()) AI.close();
    setReaderSideState(true);
    renderSidePanel(book, pageNum);
  }

  function closeSidePanel() {
    saveSideNoteNow();
    setReaderSideState(false);
  }

  function toggleSidePanel(book, pageNum) {
    if (isSidePanelOpen()) closeSidePanel();
    else openSidePanel(book, pageNum);
  }

  function appendSelectionToSidePanel(rawText, book, pageNum, force) {
    if (!isSidePanelOpen()) return false;
    var liveCb = $('#rqn-live');
    if (!force && liveCb && !liveCb.checked) return false;

    var cleaned = String(rawText || '').replace(/\r\n?/g, '\n')
      .split('\n')
      .map(function (ln) { return ln.replace(/[ \t]+/g, ' ').trim(); })
      .filter(Boolean)
      .join('\n');
    if (!cleaned) return false;

    var now = Date.now();
    if (!force && lastCaptured.text === cleaned && now - lastCaptured.ts < 850) return false;
    lastCaptured = { text: cleaned, ts: now };

    var n = ensureSideNote(book, pageNum);
    if (!n) return false;

    var bodyInp = $('#rqn-body');
    var titleInp = $('#rqn-title');
    if (bodyInp && typeof bodyInp.value === 'string' && n.content !== bodyInp.value) {
      n.content = bodyInp.value;
    }

    var quote = '> ' + cleaned.replace(/\n+/g, '\n> ') + (pageNum ? ' *(s. ' + pageNum + ')*' : '');
    var cur = (n.content || '').replace(/\s+$/, '');
    n.content = (cur ? cur + '\n\n' : '') + quote + '\n\n';
    n.updatedAt = now;
    if (!n.bookId && book) {
      n.bookId = book.id;
      n.bookTitle = book.title;
      n.bookPage = pageNum || 0;
    }

    updateSidePanelContext(book, pageNum);
    if (titleInp && titleInp.value !== (n.title || '')) titleInp.value = n.title || '';
    if (bodyInp) {
      bodyInp.value = n.content;
      bodyInp.scrollTop = bodyInp.scrollHeight;
    }

    clearTimeout(sideSaveTimer);
    DB.putNote(n).catch(function () {});
    populateSideSelectors();
    renderNotesList();
    renderDeskWidget();
    setSideStatus('Anlık aktarıldı · s. ' + (pageNum || 1), true);
    if (window.Hafiza) {
      var qt = getTopic(n.topicId);
      Hafiza.quote(book ? book.id : (n.bookId || null), n.topicId || null, cleaned, pageNum || null, (book && book.deskId) || (qt && qt.deskId) || '');
    }
    return true;
  }

  function onDeskChange(deskId) {
    if (!dataLoaded || !deskId) return;
    ensureDeskHasTopic(deskId);
    var deskTopics = visibleTopics();
    activeTopicId = deskTopics.length ? deskTopics[0].id : null;
    var tNotes = activeTopicId ? notesInTopic(activeTopicId) : [];
    activeNoteId = tNotes.length ? tNotes[0].id : null;
    sideNoteId = activeNoteId;
    renderAll();
    if (isSidePanelOpen()) {
      var book = window.Reader && Reader.currentBook ? Reader.currentBook() : null;
      renderSidePanel(book, book ? book.page : 1);
    }
  }

  function deleteDeskData(deskId) {
    var victimTopics = topics.filter(function (t) { return t.deskId === deskId; });
    victimTopics.forEach(function (t) {
      DB.deleteTopic(t.id).catch(function () {});
      if (window.AI && AI.forget) AI.forget('topic:' + t.id);
    });
    var victimIds = {};
    victimTopics.forEach(function (t) { victimIds[t.id] = true; });
    var victimNotes = notes.filter(function (n) { return n.deskId === deskId || victimIds[n.topicId]; });
    victimNotes.forEach(function (n) { DB.deleteNote(n.id).catch(function () {}); });

    topics = topics.filter(function (t) { return t.deskId !== deskId; });
    notes = notes.filter(function (n) { return n.deskId !== deskId && !victimIds[n.topicId]; });
    renderAll();
  }

  function init() {
    if (inited) return Promise.resolve();
    inited = true;

    $('#nb-back').addEventListener('click', function () {
      saveActiveNoteNow();
      location.hash = '#/masa/' + encodeURIComponent(activeDeskId() || '');
    });

    $('#nb-new-topic').addEventListener('click', function () { openTopicDialog(null); });
    $('#nb-new-note').addEventListener('click', function () { createNote(); });

    var deskNewBtn = $('#btn-desk-new-notebook');
    if (deskNewBtn) {
      deskNewBtn.addEventListener('click', function () { openTopicDialog(null); });
    }

    var searchInp = $('#nb-search');
    if (searchInp) {
      searchInp.addEventListener('input', function () {
        searchQuery = this.value;
        renderTopics();
        renderNotesList();
        renderEditor();
      });
    }

    $$('[data-nb-mode]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        viewMode = btn.dataset.nbMode;
        renderEditor();
      });
    });

    $$('[data-nb-fmt]').forEach(function (btn) {
      btn.addEventListener('click', function () { insertFormatting(btn.dataset.nbFmt); });
    });

    $('#nb-note-title').addEventListener('input', function () {
      var n = getNote(activeNoteId);
      if (!n) return;
      n.title = this.value;
      queueSaveNote();
    });

    $('#nb-note-body').addEventListener('input', function () {
      var n = getNote(activeNoteId);
      if (!n) return;
      n.content = this.value;
      var pv = $('#nb-note-preview');
      if (pv) pv.innerHTML = renderMarkdown(n.content);
      queueSaveNote();
    });

    // Önizlemede görev kutucuğunu tıklama
    $('#nb-note-preview').addEventListener('change', function (e) {
      if (e.target.type !== 'checkbox' || e.target.dataset.checkIdx == null) return;
      var n = getNote(activeNoteId);
      if (!n) return;
      var targetIdx = parseInt(e.target.dataset.checkIdx, 10);
      var count = 0;
      var lines = (n.content || '').split('\n').map(function (ln) {
        var m = ln.match(/^(\s*[-*]\s+\[)( |x|X)(\]\s+.*)$/);
        if (m) {
          if (count === targetIdx) {
            ln = m[1] + (e.target.checked ? 'x' : ' ') + m[3];
          }
          count++;
        }
        return ln;
      });
      n.content = lines.join('\n');
      $('#nb-note-body').value = n.content;
      queueSaveNote();
    });

    $('#nb-note-pin').addEventListener('click', function () {
      var n = getNote(activeNoteId);
      if (!n) return;
      n.pinned = !n.pinned;
      DB.putNote(n).catch(function () {});
      renderNotesList();
      renderEditor();
    });

    $('#nb-note-export').addEventListener('click', function () {
      var n = getNote(activeNoteId);
      if (!n) return;
      var fname = (n.title || 'not').replace(/[\\/:*?"<>|]+/g, '_') + '.md';
      var blob = new Blob(['# ' + (n.title || 'Not') + '\n\n' + (n.content || '')], { type: 'text/markdown;charset=utf-8' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = fname;
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 500);
    });

    $('#nb-note-del').addEventListener('click', function () {
      var n = getNote(activeNoteId);
      if (!n) return;
      notes = notes.filter(function (x) { return x.id !== n.id; });
      DB.deleteNote(n.id).catch(function () {});
      var rem = notesInTopic(activeTopicId);
      activeNoteId = rem.length ? rem[0].id : null;
      if (sideNoteId === n.id) sideNoteId = activeNoteId;
      renderAll();
      App.toast('Not silindi.');
    });

    // Defter dialogu (her zaman aktif masaya ait)
    $('#form-topic').addEventListener('submit', function (e) {
      e.preventDefault();
      var name = $('#topic-name').value.trim();
      if (!name) return;
      var selSw = $('#topic-colors .color-swatch.is-selected');
      var color = selSw ? selSw.dataset.color : TOPIC_COLORS[0];
      var dId = activeDeskId() || 'global';

      if (editingTopicId) {
        var t = getTopic(editingTopicId);
        if (t) {
          t.title = name;
          t.color = color;
          t.updatedAt = Date.now();
          DB.putTopic(t).catch(function () {});
        }
      } else {
        var slot = pickFreeNotebookSlot(dId);
        var nt = {
          id: DB.uid(),
          deskId: dId,
          deskX: slot.x,
          deskY: slot.y,
          title: name,
          color: color,
          createdAt: Date.now(),
          updatedAt: Date.now()
        };
        topics.push(nt);
        activeTopicId = nt.id;
        activeNoteId = null;
        sideNoteId = null;
        DB.putTopic(nt).catch(function () {});
      }
      $('#dlg-topic').close();
      renderAll();
      if (isSidePanelOpen()) {
        var book = window.Reader && Reader.currentBook ? Reader.currentBook() : null;
        renderSidePanel(book, book ? book.page : 1);
      }
    });

    $('#topic-delete-btn').addEventListener('click', function () {
      if (!editingTopicId || visibleTopics().length <= 1) return;
      topics = topics.filter(function (t) { return t.id !== editingTopicId; });
      notes = notes.filter(function (n) { return n.topicId !== editingTopicId; });
      DB.deleteTopic(editingTopicId).catch(function () {});
      if (window.AI && AI.forget) AI.forget('topic:' + editingTopicId);
      if (activeTopicId === editingTopicId) {
        var rem = visibleTopics();
        activeTopicId = rem[0] ? rem[0].id : null;
        activeNoteId = null;
        sideNoteId = null;
      }
      $('#dlg-topic').close();
      renderAll();
      App.toast('Defter silindi.');
    });

    // Okuyucu Yan Defter Paneli olayları
    $('#rqn-close').addEventListener('click', closeSidePanel);

    $('#rqn-open-full').addEventListener('click', function () {
      saveSideNoteNow();
      var chosenTopic = $('#rqn-topic') ? $('#rqn-topic').value : activeTopicId;
      if (chosenTopic) activeTopicId = chosenTopic;
      if (sideNoteId) activeNoteId = sideNoteId;
      closeSidePanel();
      location.hash = '#/defter';
    });

    $('#rqn-topic').addEventListener('change', function () {
      saveSideNoteNow();
      activeTopicId = this.value;
      var tNotes = topicNotes(activeTopicId);
      sideNoteId = tNotes[0] ? tNotes[0].id : null;
      activeNoteId = sideNoteId;
      populateSideSelectors();
      renderSideEditorFields();
      setSideStatus('Hazır', false);
    });

    $('#rqn-note').addEventListener('change', function () {
      saveSideNoteNow();
      sideNoteId = this.value || null;
      activeNoteId = sideNoteId;
      renderSideEditorFields();
      setSideStatus('Hazır', false);
    });

    $('#rqn-new-topic').addEventListener('click', function () {
      openTopicDialog(null);
    });

    $('#rqn-new-note').addEventListener('click', function () {
      saveSideNoteNow();
      var book = window.Reader && Reader.currentBook ? Reader.currentBook() : null;
      var n = createNote({
        topicId: $('#rqn-topic').value || activeTopicId,
        title: (book ? book.title + ' — s. ' + (book.page || 1) : 'Yeni Okuma Notu'),
        content: '',
        bookId: book ? book.id : '',
        bookTitle: book ? book.title : '',
        bookPage: book ? book.page : 0,
        silent: true
      });
      if (n) {
        sideNoteId = n.id;
        populateSideSelectors();
        renderSideEditorFields();
        setSideStatus('Yeni not açıldı', false);
        $('#rqn-body').focus();
      }
    });

    $('#rqn-title').addEventListener('input', function () {
      var book = window.Reader && Reader.currentBook ? Reader.currentBook() : null;
      var n = ensureSideNote(book, book ? book.page : 1);
      if (!n) return;
      n.title = this.value;
      var opt = $('#rqn-note option[value="' + n.id + '"]');
      if (opt) opt.textContent = n.title || 'Başlıksız Not';
      queueSideSave();
    });

    $('#rqn-body').addEventListener('input', function () {
      var book = window.Reader && Reader.currentBook ? Reader.currentBook() : null;
      var n = ensureSideNote(book, book ? book.page : 1);
      if (!n) return;
      n.content = this.value;
      queueSideSave();
    });

    return Promise.all([DB.listTopics(), DB.listNotes()]).then(function (res) {
      topics = res[0] || [];
      notes = res[1] || [];
      dataLoaded = true;
      var dId = activeDeskId();
      if (dId) onDeskChange(dId);
      else renderAll();
    });
  }

  window.Notebook = {
    init: init,
    render: renderAll,
    renderDeskWidget: renderDeskWidget,
    resetDeskPositions: resetDeskPositions,
    onDeskChange: onDeskChange,
    deleteDeskData: deleteDeskData,
    openSidePanel: openSidePanel,
    closeSidePanel: closeSidePanel,
    toggleSidePanel: toggleSidePanel,
    isSidePanelOpen: isSidePanelOpen,
    getActiveTopic: function () {
      var t = getTopic(activeTopicId);
      return t ? { id: t.id, title: t.title || '', deskId: t.deskId } : null;
    },
    getActiveNote: function () {
      var n = getNote(activeNoteId);
      return n ? { id: n.id, title: n.title || '', topicId: n.topicId } : null;
    },
    updateSidePanelContext: updateSidePanelContext,
    appendSelectionToSidePanel: appendSelectionToSidePanel,
    openQuickDrawer: openSidePanel,
    closeQuickDrawer: closeSidePanel,
    flush: function () {
      saveActiveNoteNow();
      saveSideNoteNow();
    }
  };
})();
