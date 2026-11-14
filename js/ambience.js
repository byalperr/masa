/* ambience.js — Arka plan ambiyans ses mikseri (deniz, yağmur, şömine, kafe, fırtına, succession). */
(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };

  var TRACKS = [
    { id: 'dalga', name: 'Deniz dalgaları', file: 'dalga.ogg', defaultVol: 60 },
    { id: 'kafe', name: 'Kafe uğultusu', file: 'kafe.ogg', defaultVol: 50 },
    { id: 'yagmur', name: 'Yağmur', file: 'yagmur.ogg', defaultVol: 70 },
    { id: 'somine', name: 'Şömine ateşi', file: 'somine.ogg', defaultVol: 60 },
    { id: 'karanlik', name: 'Karanlık ambiyans', file: 'karanlik.ogg', defaultVol: 40 },
    { id: 'firtina', name: 'Orman fırtınası', file: 'firtina.ogg', defaultVol: 60 },
    { id: 'succession', name: 'Succession müziği', file: 'succession.mp3', defaultVol: 50 }
  ];

  var audios = {};
  var audioErrors = {};
  var audioLoading = {};
  var activeBtn = null;
  var inited = false;

  function getState() {
    var s = (window.App && App.settings && App.settings.ambience) || {};
    var out = { master: typeof s.master === 'number' ? s.master : 80 };
    TRACKS.forEach(function (t) {
      var cur = s[t.id] || {};
      out[t.id] = {
        on: !!cur.on,
        vol: typeof cur.vol === 'number' ? cur.vol : t.defaultVol
      };
    });
    return out;
  }

  function saveState(state) {
    if (window.App && App.set) App.set('ambience', state);
  }

  function effectiveVol(trackVol, masterVol) {
    return Math.max(0, Math.min(1, (masterVol / 100) * (trackVol / 100)));
  }

  function isMediaError(a) {
    if (!a || !a.error) return true;
    var c = a.error.code;
    return c === 2 || c === 3 || c === 4;
  }

  function handlePlayError(trackId, err) {
    audioLoading[trackId] = false;
    if (err && (err.name === 'NotAllowedError' || err.name === 'AbortError')) {
      // Kullanıcı etkileşimi bekleniyor veya pause() iptal etti — dosya hatası değil
    } else {
      var a = audios[trackId];
      if (a && isMediaError(a)) audioErrors[trackId] = true;
    }
    updateUI();
  }

  function initAudioElements() {
    TRACKS.forEach(function (t) {
      var a = document.createElement('audio');
      a.preload = 'none';
      a.loop = true;
      a.src = new URL('audio/' + t.file, document.baseURI).href;

      a.addEventListener('waiting', function () {
        var s = getState();
        if (s[t.id] && s[t.id].on) { audioLoading[t.id] = true; updateUI(); }
      });
      a.addEventListener('canplay', function () {
        if (audioLoading[t.id]) { audioLoading[t.id] = false; updateUI(); }
      });
      a.addEventListener('playing', function () {
        audioLoading[t.id] = false; updateUI();
      });
      a.addEventListener('error', function () {
        audioLoading[t.id] = false;
        if (isMediaError(a)) audioErrors[t.id] = true;
        updateUI();
      });

      document.body.appendChild(a);
      audios[t.id] = a;
    });
  }

  function applyAudio() {
    var s = getState();
    var anyActive = false;
    TRACKS.forEach(function (t) {
      var a = audios[t.id];
      if (!a) return;
      var cfg = s[t.id];
      a.volume = effectiveVol(cfg.vol, s.master);
      if (cfg.on && !audioErrors[t.id]) {
        anyActive = true;
        if (a.paused) {
          audioLoading[t.id] = true;
          updateUI();
          a.play().then(function () {
            audioLoading[t.id] = false;
            updateUI();
          }).catch(function (err) {
            handlePlayError(t.id, err);
          });
        }
      } else {
        audioLoading[t.id] = false;
        if (!a.paused) a.pause();
      }
    });

    [$('#btn-ambience'), $('#r-ambience'), $('#nb-ambience')].forEach(function (btn) {
      if (!btn) return;
      btn.classList.toggle('on', anyActive);
      btn.setAttribute('aria-pressed', anyActive ? 'true' : 'false');
    });
  }

  function unlockAutoplay() {
    window.removeEventListener('pointerdown', unlockAutoplay, true);
    window.removeEventListener('keydown', unlockAutoplay, true);
    applyAudio();
  }

  function getStatusLabel(t, cfg) {
    if (audioErrors[t.id]) return ' (yüklenemedi)';
    if (audioLoading[t.id] && cfg.on) return ' (yükleniyor…)';
    return '';
  }

  function buildUI() {
    var list = $('#amb-list');
    if (!list) return;
    list.textContent = '';
    var s = getState();

    $('#amb-master-vol').value = s.master;
    $('#amb-master-val').textContent = s.master + '%';

    TRACKS.forEach(function (t) {
      var cfg = s[t.id];
      var isErr = !!audioErrors[t.id];
      var isLoad = !!audioLoading[t.id] && cfg.on;
      var row = document.createElement('div');
      row.className = 'amb-row' + (cfg.on && !isErr ? ' is-active' : '') + (isErr ? ' is-disabled' : '') + (isLoad ? ' is-loading' : '');
      row.dataset.id = t.id;

      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'amb-toggle';
      btn.setAttribute('aria-pressed', cfg.on ? 'true' : 'false');
      btn.setAttribute('aria-label', t.name + (cfg.on ? ' (Açık)' : ' (Kapalı)'));
      btn.title = cfg.on ? 'Kapat' : 'Aç';

      var ico = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      ico.setAttribute('class', 'ico');
      ico.setAttribute('aria-hidden', 'true');
      var use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
      use.setAttribute('href', cfg.on ? '#i-volume' : '#i-volume-x');
      ico.appendChild(use);
      btn.appendChild(ico);

      var title = document.createElement('span');
      title.className = 'amb-title';
      title.textContent = t.name + getStatusLabel(t, cfg);

      var range = document.createElement('input');
      range.type = 'range';
      range.className = 'amb-vol';
      range.min = '0';
      range.max = '100';
      range.value = cfg.vol;
      range.setAttribute('aria-label', t.name + ' ses düzeyi');
      if (isErr) range.disabled = true;

      var val = document.createElement('span');
      val.className = 'amb-val';
      val.textContent = cfg.vol + '%';

      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var cur = getState();
        cur[t.id].on = !cur[t.id].on;
        saveState(cur);
        updateUI();
        applyAudio();
      });

      range.addEventListener('input', function (e) {
        e.stopPropagation();
        var cur = getState();
        cur[t.id].vol = parseInt(range.value, 10);
        val.textContent = cur[t.id].vol + '%';
        saveState(cur);
        applyAudio();
      });

      row.appendChild(btn);
      row.appendChild(title);
      row.appendChild(range);
      row.appendChild(val);
      list.appendChild(row);
    });
  }

  function updateUI() {
    var s = getState();
    var masterInput = $('#amb-master-vol');
    var masterVal = $('#amb-master-val');
    if (masterInput) masterInput.value = s.master;
    if (masterVal) masterVal.textContent = s.master + '%';

    TRACKS.forEach(function (t) {
      var row = $('.amb-row[data-id="' + t.id + '"]');
      if (!row) return;
      var cfg = s[t.id];
      var isErr = !!audioErrors[t.id];
      var isLoad = !!audioLoading[t.id] && cfg.on;
      row.classList.toggle('is-active', cfg.on && !isErr);
      row.classList.toggle('is-disabled', isErr);
      row.classList.toggle('is-loading', isLoad);
      var btn = row.querySelector('.amb-toggle');
      if (btn) {
        btn.setAttribute('aria-pressed', cfg.on ? 'true' : 'false');
        btn.setAttribute('aria-label', t.name + (cfg.on ? ' (Açık)' : ' (Kapalı)'));
        btn.title = cfg.on ? 'Kapat' : 'Aç';
        var use = btn.querySelector('use');
        if (use) use.setAttribute('href', cfg.on ? '#i-volume' : '#i-volume-x');
      }
      var title = row.querySelector('.amb-title');
      if (title) title.textContent = t.name + getStatusLabel(t, cfg);
      var range = row.querySelector('.amb-vol');
      if (range) { range.value = cfg.vol; range.disabled = isErr; }
      var val = row.querySelector('.amb-val');
      if (val) val.textContent = cfg.vol + '%';
    });
  }

  function openPop(btn) {
    var pop = $('#pop-ambience');
    if (!pop || !btn) return;
    if (activeBtn && activeBtn !== btn) activeBtn.setAttribute('aria-expanded', 'false');
    activeBtn = btn;
    btn.setAttribute('aria-expanded', 'true');
    var wrap = btn.closest('.pop-wrap') || btn.parentElement;
    if (pop.parentElement !== wrap) wrap.appendChild(pop);
    pop.classList.add('right');
    updateUI();
    pop.hidden = false;
  }

  function closePop() {
    var pop = $('#pop-ambience');
    if (pop) pop.hidden = true;
    if (activeBtn) {
      activeBtn.setAttribute('aria-expanded', 'false');
      activeBtn = null;
    }
  }

  function togglePop(btn) {
    var pop = $('#pop-ambience');
    if (!pop) return;
    if (!pop.hidden && activeBtn === btn) closePop();
    else openPop(btn);
  }

  function init() {
    if (inited) return;
    inited = true;
    initAudioElements();

    window.addEventListener('pointerdown', unlockAutoplay, true);
    window.addEventListener('keydown', unlockAutoplay, true);

    buildUI();
    applyAudio();

    ['#btn-ambience', '#r-ambience', '#nb-ambience'].forEach(function (sel) {
      var b = $(sel);
      if (b) b.addEventListener('click', function (e) { e.stopPropagation(); togglePop(b); });
    });

    var masterInput = $('#amb-master-vol');
    if (masterInput) {
      masterInput.addEventListener('input', function (e) {
        e.stopPropagation();
        var cur = getState();
        cur.master = parseInt(masterInput.value, 10);
        $('#amb-master-val').textContent = cur.master + '%';
        saveState(cur);
        applyAudio();
      });
    }

    var stopAll = $('#amb-stop-all');
    if (stopAll) {
      stopAll.addEventListener('click', function (e) {
        e.stopPropagation();
        var cur = getState();
        TRACKS.forEach(function (t) { cur[t.id].on = false; });
        saveState(cur);
        updateUI();
        applyAudio();
      });
    }

    document.addEventListener('click', function (e) {
      var pop = $('#pop-ambience');
      if (!pop || pop.hidden) return;
      if (!pop.contains(e.target) && (!activeBtn || !activeBtn.contains(e.target))) {
        closePop();
      }
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        var pop = $('#pop-ambience');
        if (pop && !pop.hidden) {
          e.stopPropagation();
          var prevBtn = activeBtn;
          closePop();
          if (prevBtn) prevBtn.focus();
        }
      }
    });
  }

  window.Ambience = {
    init: init,
    isOpen: function () { var p = $('#pop-ambience'); return !!(p && !p.hidden); },
    close: closePop,
    apply: applyAudio
  };
})();
