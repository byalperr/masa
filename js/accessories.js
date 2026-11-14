/* accessories.js — Değiştirilebilir, sürüklenebilir, etkileşimli masa aksesuarları. */
(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var CATALOG = [
    {
      id: 'lamp',
      name: 'Masa Lambası',
      defaultOn: true,
      defaultVariant: 'banker',
      defaultX: 1,
      defaultY: 1.2,
      variants: [
        { id: 'banker', label: 'Bankacı (Yeşil)' },
        { id: 'architect', label: 'Mimar Lambası' },
        { id: 'abajur', label: 'Sıcak Abajur' }
      ]
    },
    {
      id: 'clock',
      name: 'Odak Saati',
      defaultOn: true,
      defaultVariant: 'sayac',
      defaultX: 9.5,
      defaultY: 1.2,
      variants: [
        { id: 'saat', label: 'Dijital Saat (Tarih + Saniye)' },
        { id: 'kronometre', label: 'Kronometre (Tur + Salise)' },
        { id: 'sayac', label: 'Zaman Sayacı (Odak / Özel)' }
      ]
    },
    {
      id: 'drink',
      name: 'İçecek Kupası',
      defaultOn: true,
      defaultVariant: 'kahve',
      defaultX: 56,
      defaultY: 12,
      variants: [
        { id: 'kahve', label: 'Filtre Kahve' },
        { id: 'turk', label: 'Türk Kahvesi' },
        { id: 'cay', label: 'İnce Belli Çay' },
        { id: 'matcha', label: 'Matcha' }
      ]
    },
    {
      id: 'sticky',
      name: 'Yapışkan Not',
      defaultOn: true,
      defaultVariant: 'sari',
      defaultX: 54,
      defaultY: 1.2,
      variants: [
        { id: 'sari', label: 'Klasik Sarı' },
        { id: 'ada', label: 'Adaçayı' },
        { id: 'seftali', label: 'Şeftali' },
        { id: 'mavi', label: 'Buz Mavisi' }
      ]
    },
    {
      id: 'plant',
      name: 'Masa Bitkisi',
      defaultOn: true,
      defaultVariant: 'sukulent',
      defaultX: 1,
      defaultY: 11.5,
      variants: [
        { id: 'sukulent', label: 'Sukulent' },
        { id: 'bonsai', label: 'Mini Bonsai' },
        { id: 'monstera', label: 'Deve Tabanı' }
      ]
    },
    {
      id: 'candle',
      name: 'Kokulu Mum',
      defaultOn: false,
      defaultVariant: 'amber',
      defaultX: 2,
      defaultY: 7,
      variants: [
        { id: 'amber', label: 'Kehribar' },
        { id: 'lavanta', label: 'Lavanta' },
        { id: 'sedir', label: 'Sedir' }
      ]
    },
    {
      id: 'calendar',
      name: 'Masa Takvimi',
      defaultOn: false,
      defaultVariant: 'kart',
      defaultX: 2,
      defaultY: 4.5,
      variants: [
        { id: 'kart', label: 'Günlük Kart' },
        { id: 'koyu', label: 'Koyu Kart' }
      ]
    }
  ];

  var TR_MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
  var TR_DAYS = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
  var TIMER_PRESETS = [
    { mins: 5, mode: 'break', label: '5 dk' },
    { mins: 15, mode: 'custom', label: '15 dk' },
    { mins: 25, mode: 'focus', label: '25 dk' },
    { mins: 45, mode: 'focus', label: '45 dk' }
  ];

  function normalizeClockVariant(v) {
    if (v === 'pomodoro' || v === 'sayac') return 'sayac';
    if (v === 'kronometre') return 'kronometre';
    if (v === 'saat') return 'saat';
    return 'sayac';
  }

  // Zaman sayacı (geri sayım / odak) ve kronometre durumu (masalar arası korunur)
  var pomo = {
    mode: 'focus', // 'focus' | 'break' | 'custom'
    duration: 25 * 60,
    remaining: 25 * 60,
    running: false,
    timerId: null
  };
  var stopwatch = {
    elapsedMs: 0,
    startedAt: 0,
    running: false,
    laps: [],
    timerId: null
  };
  var clockTickId = null;

  function defaultList() {
    return CATALOG.map(function (c) {
      return {
        id: c.id,
        on: c.defaultOn,
        variant: c.defaultVariant,
        x: c.defaultX,
        y: c.defaultY,
        state: c.id === 'lamp' ? { lit: true } :
               c.id === 'candle' ? { lit: true } :
               c.id === 'sticky' ? { text: 'Bugünkü hedef:\n- Odaklan\n- Önemli notları deftere yaz' } : {}
      };
    });
  }

  function ensureDeskAccessories(desk) {
    if (!desk.accessories || !Array.isArray(desk.accessories)) {
      desk.accessories = defaultList();
      desk.deskScaleV2 = true;
      return desk.accessories;
    }
    var byId = {};
    desk.accessories.forEach(function (a) {
      if (a.id === 'clock') a.variant = normalizeClockVariant(a.variant);
      byId[a.id] = a;
    });
    CATALOG.forEach(function (c) {
      if (!byId[c.id]) {
        desk.accessories.push({
          id: c.id,
          on: c.defaultOn,
          variant: c.defaultVariant,
          x: c.defaultX,
          y: c.defaultY,
          state: c.id === 'lamp' ? { lit: true } :
                 c.id === 'candle' ? { lit: true } :
                 c.id === 'sticky' ? { text: '' } : {}
        });
      }
    });
    if (!desk.deskScaleV2) {
      desk.accessories.forEach(function (a) {
        if (typeof a.y === 'number') a.y = Math.round((a.y * 620 / 3200) * 100) / 100;
      });
      if (desk.musicBox && typeof desk.musicBox.y === 'number') {
        desk.musicBox.y = Math.round((desk.musicBox.y * 620 / 3200) * 100) / 100;
      }
      desk.deskScaleV2 = true;
      if (window.Desk && Desk.saveCurrentDesk) Desk.saveCurrentDesk();
      if (window.Desk && Desk.applyMusicBoxPos) Desk.applyMusicBoxPos(desk);
    }
    return desk.accessories;
  }

  function playChime() {
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      var ctx = new Ctx();
      [523.25, 659.25, 783.99].forEach(function (freq, i) {
        var osc = ctx.createOscillator();
        var gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.001, ctx.currentTime + i * 0.14);
        gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + i * 0.14 + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.14 + 0.55);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime + i * 0.14);
        osc.stop(ctx.currentTime + i * 0.14 + 0.6);
      });
    } catch (e) {}
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function fmtPomo(sec) {
    sec = Math.max(0, Math.floor(sec));
    var h = Math.floor(sec / 3600);
    var m = Math.floor((sec % 3600) / 60);
    var s = sec % 60;
    return h > 0 ? (h + ':' + pad2(m) + ':' + pad2(s)) : (pad2(m) + ':' + pad2(s));
  }

  function fmtNowDetailed() {
    var d = new Date();
    var h = d.getHours(), m = d.getMinutes(), s = d.getSeconds();
    var tzMin = -d.getTimezoneOffset();
    var tzSign = tzMin >= 0 ? '+' : '-';
    var tzH = Math.floor(Math.abs(tzMin) / 60);
    var dayPct = Math.round(((h * 3600 + m * 60 + s) / 86400) * 100);
    return {
      time: pad2(h) + ':' + pad2(m) + ':' + pad2(s),
      date: d.getDate() + ' ' + TR_MONTHS[d.getMonth()] + ' ' + d.getFullYear() + ' · ' + TR_DAYS[d.getDay()],
      meta: 'YEREL SAAT · GMT' + tzSign + tzH + ' · GÜN %' + dayPct,
      pct: Math.round((s / 59) * 100)
    };
  }

  function getStopwatchMs() {
    return stopwatch.running ? (stopwatch.elapsedMs + (Date.now() - stopwatch.startedAt)) : stopwatch.elapsedMs;
  }

  function fmtStopwatch(ms) {
    ms = Math.max(0, Math.floor(ms));
    var totalSec = Math.floor(ms / 1000);
    var tenth = Math.floor((ms % 1000) / 100);
    var h = Math.floor(totalSec / 3600);
    var m = Math.floor((totalSec % 3600) / 60);
    var s = totalSec % 60;
    var main = h > 0 ? (pad2(h) + ':' + pad2(m) + ':' + pad2(s)) : (pad2(m) + ':' + pad2(s));
    return { main: main, tenth: '.' + tenth };
  }

  function startPomo() {
    if (pomo.running) return;
    if (pomo.remaining <= 0) pomo.remaining = pomo.duration || 25 * 60;
    pomo.running = true;
    pomo.timerId = setInterval(function () {
      if (pomo.remaining > 0) {
        pomo.remaining--;
        updateClockText();
      } else {
        pausePomo();
        playChime();
        if (pomo.mode === 'focus') {
          pomo.mode = 'break';
          pomo.duration = 5 * 60;
          pomo.remaining = 5 * 60;
          App.toast('Odak süresi bitti! 5 dakikalık mola zamanı.');
        } else {
          pomo.mode = 'focus';
          pomo.duration = 25 * 60;
          pomo.remaining = 25 * 60;
          App.toast('Süre doldu! Yeni sayaç oturumu hazır.');
        }
        updateClockText();
      }
    }, 1000);
    updateClockText();
  }

  function pausePomo() {
    pomo.running = false;
    if (pomo.timerId) { clearInterval(pomo.timerId); pomo.timerId = null; }
    updateClockText();
  }

  function resetPomo() {
    pausePomo();
    pomo.duration = pomo.duration || (pomo.mode === 'break' ? 5 * 60 : 25 * 60);
    pomo.remaining = pomo.duration;
    updateClockText();
  }

  function setTimerPreset(mins, mode) {
    pausePomo();
    pomo.mode = mode || (mins <= 10 ? 'break' : 'focus');
    pomo.duration = mins * 60;
    pomo.remaining = pomo.duration;
    updateClockText();
  }

  function adjustTimerMinutes(deltaMins) {
    if (pomo.running) pausePomo();
    var next = Math.max(60, Math.min(180 * 60, (pomo.remaining || 60) + deltaMins * 60));
    pomo.mode = 'custom';
    pomo.duration = next;
    pomo.remaining = next;
    updateClockText();
  }

  function startStopwatch() {
    if (stopwatch.running) return;
    stopwatch.running = true;
    stopwatch.startedAt = Date.now();
    stopwatch.timerId = setInterval(updateClockText, 100);
    updateClockText();
  }

  function pauseStopwatch() {
    if (stopwatch.running) {
      stopwatch.elapsedMs += Date.now() - stopwatch.startedAt;
      stopwatch.running = false;
    }
    if (stopwatch.timerId) { clearInterval(stopwatch.timerId); stopwatch.timerId = null; }
    updateClockText();
  }

  function lapStopwatch() {
    var ms = getStopwatchMs();
    if (ms <= 0) return;
    var f = fmtStopwatch(ms);
    stopwatch.laps.unshift({ num: stopwatch.laps.length + 1, label: f.main + f.tenth });
    if (stopwatch.laps.length > 10) stopwatch.laps.length = 10;
    updateClockText();
  }

  function resetStopwatch() {
    pauseStopwatch();
    stopwatch.elapsedMs = 0;
    stopwatch.laps = [];
    updateClockText();
  }

  function updateClockText() {
    var box = $('.acc-clock-box');
    if (!box) return;
    var el = $('.acc-clock-readout', box);
    if (!el) return;
    var mode = normalizeClockVariant(el.dataset.variant);
    var sub = $('.acc-clock-sub', box);
    var meta = $('.acc-clock-meta', box);
    var fill = $('.acc-clock-bar-fill', box);
    var tg = $('.acc-clock-toggle', box);

    if (mode === 'saat') {
      var nowD = fmtNowDetailed();
      el.textContent = nowD.time;
      if (sub) sub.textContent = nowD.date;
      if (meta) meta.textContent = nowD.meta;
      if (fill) fill.style.width = nowD.pct + '%';
    } else if (mode === 'kronometre') {
      var swMs = getStopwatchMs();
      var swF = fmtStopwatch(swMs);
      el.innerHTML = swF.main + '<span class="acc-clock-ms">' + swF.tenth + '</span>';
      if (sub) {
        sub.textContent = stopwatch.running ? 'KRONOMETRE · ÇALIŞIYOR' : (swMs > 0 ? 'KRONOMETRE · DURAKLATILDI' : 'KRONOMETRE · HAZIR');
      }
      if (meta) {
        if (stopwatch.laps.length) {
          meta.textContent = stopwatch.laps.slice(0, 2).map(function (l) { return 'Tur ' + l.num + ': ' + l.label; }).join(' · ');
        } else {
          meta.textContent = 'Geçen süreyi ölç · Tur alabilirsin';
        }
      }
      if (fill) {
        var secPct = Math.round((((swMs / 1000) % 60) / 60) * 100);
        fill.style.width = secPct + '%';
      }
      if (tg) tg.textContent = stopwatch.running ? 'Duraklat' : (swMs > 0 ? 'Devam Et' : 'Başlat');
      var lapBtn = $('.acc-clock-lap', box);
      if (lapBtn) lapBtn.disabled = swMs <= 0;
    } else {
      el.textContent = fmtPomo(pomo.remaining);
      var durMin = Math.max(1, Math.round((pomo.duration || 1500) / 60));
      var modeTitle = pomo.mode === 'break' ? 'MOLA' : (pomo.mode === 'custom' ? 'ÖZEL SAYAÇ' : 'ODAK');
      if (sub) sub.textContent = modeTitle + ' (' + durMin + ' dk)' + (pomo.running ? ' · ÇALIŞIYOR' : ' · HAZIR');
      if (meta) meta.textContent = 'Kalan: ' + Math.ceil(pomo.remaining / 60) + ' dk · Hedef: ' + durMin + ' dk';
      if (fill) {
        var pct = pomo.duration > 0 ? Math.max(0, Math.min(100, Math.round((pomo.remaining / pomo.duration) * 100))) : 0;
        fill.style.width = pct + '%';
      }
      if (tg) tg.textContent = pomo.running ? 'Duraklat' : 'Başlat';
      $$('.acc-clock-preset', box).forEach(function (b) {
        b.classList.toggle('is-active', parseInt(b.dataset.mins, 10) * 60 === pomo.duration);
      });
    }
  }

  function makeSvg(id, variant, state) {
    if (id === 'lamp') {
      var lit = !state || state.lit !== false;
      if (variant === 'architect') {
        return '<svg class="acc-svg" viewBox="0 0 96 108" aria-hidden="true">' +
          '<path d="M22 98h44" stroke="currentColor" stroke-width="5" stroke-linecap="round"/>' +
          '<path d="M36 98L24 58 52 22" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linejoin="round"/>' +
          '<circle cx="24" cy="58" r="3.5" fill="var(--accent)"/>' +
          '<path d="M46 16l28 12-10 18-24-10z" fill="' + (lit ? '#d8b46a' : '#4a4a4a') + '" stroke="currentColor" stroke-width="2"/>' +
          (lit ? '<ellipse cx="64" cy="48" rx="18" ry="8" fill="rgba(255,220,130,0.45)"/>' : '') +
          '</svg>';
      }
      if (variant === 'abajur') {
        return '<svg class="acc-svg" viewBox="0 0 96 108" aria-hidden="true">' +
          '<ellipse cx="48" cy="96" rx="22" ry="5" fill="#5c432d"/>' +
          '<rect x="44" y="54" width="8" height="42" rx="3" fill="#8b6b45"/>' +
          '<path d="M20 56L30 20h36l10 36z" fill="' + (lit ? '#f3cf8a' : '#6c6257') + '" stroke="#5c432d" stroke-width="2"/>' +
          '</svg>';
      }
      // banker
      return '<svg class="acc-svg" viewBox="0 0 96 108" aria-hidden="true">' +
        '<ellipse cx="48" cy="95" rx="24" ry="6" fill="#9c7a3c"/>' +
        '<path d="M48 92V44c0-10 8-16 14-16" fill="none" stroke="#b9934c" stroke-width="4" stroke-linecap="round"/>' +
        '<path d="M24 44c4-18 44-18 48 0H24z" fill="' + (lit ? '#2d7a4f' : '#1d4630') + '" stroke="#b9934c" stroke-width="2"/>' +
        (lit ? '<ellipse cx="48" cy="46" rx="20" ry="4" fill="#ffe6a3"/>' : '') +
        '</svg>';
    }
    if (id === 'drink') {
      if (variant === 'cay') {
        return '<svg class="acc-svg" viewBox="0 0 76 84" aria-hidden="true">' +
          '<ellipse cx="38" cy="74" rx="26" ry="5" fill="rgba(255,255,255,0.22)" stroke="rgba(255,255,255,0.45)" stroke-width="1.5"/>' +
          '<path d="M25 26c3 12-4 22-2 32 1 8 6 14 15 14s14-6 15-14c2-10-5-20-2-32z" fill="rgba(255,255,255,0.18)" stroke="rgba(255,255,255,0.55)" stroke-width="1.5"/>' +
          '<path d="M26 36c2 9-3 17-1 25 1 6 5 10 13 10s12-4 13-10c2-8-3-16-1-25z" fill="#9a2b17"/>' +
          '</svg>';
      }
      var fillCol = variant === 'matcha' ? '#6d9b4f' : (variant === 'turk' ? '#3d2214' : '#4a2b18');
      var cupCol = variant === 'turk' ? '#d8cab4' : '#ede4d3';
      return '<svg class="acc-svg" viewBox="0 0 84 84" aria-hidden="true">' +
        '<path d="M58 34h8c6 0 9 4 9 10s-3 10-9 10h-8" fill="none" stroke="' + cupCol + '" stroke-width="4.5" stroke-linecap="round"/>' +
        '<path d="M18 26h42l-4 38c-1 7-6 11-17 11s-16-4-17-11z" fill="' + cupCol + '"/>' +
        '<ellipse cx="39" cy="26" rx="21" ry="6" fill="#cfc3ae"/>' +
        '<ellipse cx="39" cy="27" rx="17" ry="4.2" fill="' + fillCol + '"/>' +
        '</svg>';
    }
    if (id === 'plant') {
      if (variant === 'bonsai') {
        return '<svg class="acc-svg" viewBox="0 0 92 96" aria-hidden="true">' +
          '<path d="M22 68h48l-6 18H28z" fill="#6b442a"/>' +
          '<path d="M46 68c-2-14 6-22 2-34-2-7-10-10-12-16" fill="none" stroke="#5a3c24" stroke-width="5" stroke-linecap="round"/>' +
          '<circle cx="34" cy="24" r="14" fill="#3c6e47"/><circle cx="56" cy="30" r="13" fill="#4b8356"/><circle cx="44" cy="18" r="11" fill="#599665"/>' +
          '</svg>';
      }
      if (variant === 'monstera') {
        return '<svg class="acc-svg" viewBox="0 0 92 96" aria-hidden="true">' +
          '<path d="M28 58h36l-4 28H32z" fill="#c97b53"/>' +
          '<path d="M46 58V30M46 58L28 36M46 58L64 38" stroke="#3c6b45" stroke-width="3" stroke-linecap="round"/>' +
          '<ellipse cx="26" cy="30" rx="14" ry="10" transform="rotate(-24 26 30)" fill="#4c8757"/>' +
          '<ellipse cx="64" cy="32" rx="14" ry="10" transform="rotate(24 64 32)" fill="#3f754a"/>' +
          '<ellipse cx="46" cy="22" rx="13" ry="15" fill="#5a9b66"/>' +
          '</svg>';
      }
      return '<svg class="acc-svg" viewBox="0 0 84 88" aria-hidden="true">' +
        '<path d="M22 52h40l-5 28H27z" fill="#b86b49"/>' +
        '<rect x="20" y="48" width="44" height="6" rx="2" fill="#cc7b56"/>' +
        '<ellipse cx="42" cy="38" rx="18" ry="12" fill="#4f8357"/>' +
        '<ellipse cx="32" cy="32" rx="10" ry="13" transform="rotate(-20 32 32)" fill="#639a6c"/>' +
        '<ellipse cx="52" cy="32" rx="10" ry="13" transform="rotate(20 52 32)" fill="#5c9364"/>' +
        '<ellipse cx="42" cy="26" rx="8" ry="12" fill="#75ad7e"/>' +
        '</svg>';
    }
    if (id === 'candle') {
      var clit = !state || state.lit !== false;
      var jar = variant === 'lavanta' ? '#7b638f' : (variant === 'sedir' ? '#586d57' : '#a86b32');
      return '<svg class="acc-svg" viewBox="0 0 64 78" aria-hidden="true">' +
        '<rect x="14" y="32" width="36" height="38" rx="4" fill="' + jar + '" fill-opacity="0.82" stroke="rgba(255,255,255,0.28)" stroke-width="1.5"/>' +
        '<rect x="17" y="42" width="30" height="24" rx="2" fill="#efe3cd" fill-opacity="0.85"/>' +
        '<line x1="32" y1="32" x2="32" y2="26" stroke="#2a2118" stroke-width="2"/>' +
        (clit ? '<path class="candle-flame" d="M32 10c4 6 6 10 0 16-6-6-4-10 0-16z" fill="#ffb84d"/><path class="candle-flame" d="M32 14c2 4 3 6 0 10-3-4-2-6 0-10z" fill="#fff2b2"/>' : '') +
        '</svg>';
    }
    return '';
  }

  function makeDraggable(el, item) {
    if (window.Desk && Desk.makeFreeDraggable) {
      Desk.makeFreeDraggable({
        el: el,
        ignoreSelector: 'textarea, button',
        threshold: 8,
        setPos: function (nx, ny) { item.x = nx; item.y = ny; },
        onDragEnd: function (e, moved) {
          if (moved) Desk.saveCurrentDesk();
        }
      });
    }
  }

  function autoResizeSticky(ta) {
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.max(76, ta.scrollHeight) + 'px';
  }

  function renderOnDesk(desk) {
    var layer = $('#desk-acc-layer');
    var stage = $('#desk-stage');
    if (!layer || !stage || !desk) return;
    layer.textContent = '';

    var list = ensureDeskAccessories(desk);
    var lampLit = false;

    list.forEach(function (item) {
      if (!item.on) return;
      if (item.id === 'lamp' && (!item.state || item.state.lit !== false)) lampLit = true;

      var wrap = document.createElement('div');
      wrap.className = 'acc-item acc-' + item.id + ' var-' + item.variant;
      wrap.style.left = item.x + '%';
      wrap.style.top = item.y + '%';
      wrap.dataset.id = item.id;

      if (item.id === 'lamp') {
        var lit = !item.state || item.state.lit !== false;
        wrap.classList.toggle('is-lit', lit);
        wrap.title = 'Masa Lambası (tıkla: yak/söndür, sürükle: taşı)';
        wrap.innerHTML = makeSvg('lamp', item.variant, item.state);
        wrap.addEventListener('click', function () {
          if (wrap.dataset.justDragged) return;
          item.state = item.state || {};
          item.state.lit = !lit;
          Desk.saveCurrentDesk();
          renderOnDesk(desk);
        });
      } else if (item.id === 'drink') {
        wrap.title = 'Sıcak İçecek (sürükle: taşı)';
        wrap.innerHTML = '<div class="acc-steam"><span></span><span></span><span></span></div>' + makeSvg('drink', item.variant, item.state);
        wrap.addEventListener('click', function () {
          if (wrap.dataset.justDragged) return;
          wrap.classList.add('sip');
          setTimeout(function () { wrap.classList.remove('sip'); }, 450);
        });
      } else if (item.id === 'plant') {
        wrap.title = 'Masa Bitkisi (sürükle: taşı)';
        wrap.innerHTML = makeSvg('plant', item.variant, item.state);
      } else if (item.id === 'candle') {
        var clit = !item.state || item.state.lit !== false;
        wrap.classList.toggle('is-lit', clit);
        wrap.title = 'Kokulu Mum (tıkla: yak/söndür, sürükle: taşı)';
        wrap.innerHTML = makeSvg('candle', item.variant, item.state);
        wrap.addEventListener('click', function () {
          if (wrap.dataset.justDragged) return;
          item.state = item.state || {};
          item.state.lit = !clit;
          Desk.saveCurrentDesk();
          renderOnDesk(desk);
        });
      } else if (item.id === 'clock') {
        wrap.title = 'Odak Saati / Kronometre / Zaman Sayacı (sürükle: taşı)';
        var mode = normalizeClockVariant(item.variant);
        item.variant = mode;
        var box = document.createElement('div');
        box.className = 'acc-clock-box is-mode-' + mode;

        // Mod Seçici Sekmeler (Saat | Kronometre | Sayaç)
        var tabs = document.createElement('div');
        tabs.className = 'acc-clock-tabs';
        [
          { id: 'saat', label: 'Saat' },
          { id: 'kronometre', label: 'Kronometre' },
          { id: 'sayac', label: 'Sayaç' }
        ].forEach(function (m) {
          var tb = document.createElement('button');
          tb.type = 'button';
          tb.className = 'acc-clock-tab' + (mode === m.id ? ' is-active' : '');
          tb.textContent = m.label;
          tb.dataset.mode = m.id;
          tb.addEventListener('click', function (e) {
            e.stopPropagation();
            if (item.variant === m.id) return;
            item.variant = m.id;
            Desk.saveCurrentDesk();
            renderOnDesk(desk);
            if ($('#acc-settings-list')) renderSettingsList(desk);
          });
          tabs.appendChild(tb);
        });
        box.appendChild(tabs);

        var readout = document.createElement('div');
        readout.className = 'acc-clock-readout';
        readout.dataset.variant = mode;
        box.appendChild(readout);

        var sub = document.createElement('div');
        sub.className = 'acc-clock-sub';
        box.appendChild(sub);

        var meta = document.createElement('div');
        meta.className = 'acc-clock-meta';
        box.appendChild(meta);

        var bar = document.createElement('div');
        bar.className = 'acc-clock-bar';
        bar.innerHTML = '<div class="acc-clock-bar-fill"></div>';
        box.appendChild(bar);

        if (mode === 'kronometre') {
          var kBtns = document.createElement('div');
          kBtns.className = 'acc-clock-btns';
          var kTg = document.createElement('button');
          kTg.type = 'button';
          kTg.className = 'acc-clock-toggle is-primary';
          kTg.addEventListener('click', function (e) {
            e.stopPropagation();
            if (stopwatch.running) pauseStopwatch();
            else startStopwatch();
          });
          var kLap = document.createElement('button');
          kLap.type = 'button';
          kLap.className = 'acc-clock-lap';
          kLap.textContent = 'Tur';
          kLap.addEventListener('click', function (e) {
            e.stopPropagation();
            lapStopwatch();
          });
          var kRst = document.createElement('button');
          kRst.type = 'button';
          kRst.textContent = 'Sıfırla';
          kRst.addEventListener('click', function (e) {
            e.stopPropagation();
            resetStopwatch();
          });
          kBtns.appendChild(kTg);
          kBtns.appendChild(kLap);
          kBtns.appendChild(kRst);
          box.appendChild(kBtns);
        } else if (mode === 'sayac') {
          var presets = document.createElement('div');
          presets.className = 'acc-clock-presets';
          TIMER_PRESETS.forEach(function (pr) {
            var pb = document.createElement('button');
            pb.type = 'button';
            pb.className = 'acc-clock-preset';
            pb.dataset.mins = String(pr.mins);
            pb.textContent = pr.label;
            pb.addEventListener('click', function (e) {
              e.stopPropagation();
              setTimerPreset(pr.mins, pr.mode);
            });
            presets.appendChild(pb);
          });
          box.appendChild(presets);

          var btns = document.createElement('div');
          btns.className = 'acc-clock-btns';
          var minusBtn = document.createElement('button');
          minusBtn.type = 'button';
          minusBtn.textContent = '−1 dk';
          minusBtn.title = '1 dakika azalt';
          minusBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            adjustTimerMinutes(-1);
          });
          var tg = document.createElement('button');
          tg.type = 'button';
          tg.className = 'acc-clock-toggle is-primary';
          tg.addEventListener('click', function (e) {
            e.stopPropagation();
            if (pomo.running) pausePomo();
            else startPomo();
          });
          var plusBtn = document.createElement('button');
          plusBtn.type = 'button';
          plusBtn.textContent = '+1 dk';
          plusBtn.title = '1 dakika ekle';
          plusBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            adjustTimerMinutes(1);
          });
          var rst = document.createElement('button');
          rst.type = 'button';
          rst.textContent = 'Sıfırla';
          rst.addEventListener('click', function (e) {
            e.stopPropagation();
            resetPomo();
          });
          btns.appendChild(minusBtn);
          btns.appendChild(tg);
          btns.appendChild(plusBtn);
          btns.appendChild(rst);
          box.appendChild(btns);
        }
        wrap.appendChild(box);
        requestAnimationFrame(updateClockText);
      } else if (item.id === 'sticky') {
        wrap.title = 'Yapışkan Not (yaz, veya kenarından sürükle)';
        var head = document.createElement('div');
        head.className = 'acc-sticky-head';
        head.textContent = 'Not';
        var ta = document.createElement('textarea');
        ta.className = 'acc-sticky-text';
        ta.placeholder = 'Hızlı hatırlatma yaz…';
        ta.rows = 3;
        ta.value = (item.state && item.state.text) || '';
        var saveDeb = null;
        ta.addEventListener('input', function () {
          autoResizeSticky(ta);
          item.state = item.state || {};
          item.state.text = ta.value;
          clearTimeout(saveDeb);
          saveDeb = setTimeout(function () { Desk.saveCurrentDesk(); }, 350);
        });
        wrap.appendChild(head);
        wrap.appendChild(ta);
        requestAnimationFrame(function () { autoResizeSticky(ta); });
      } else if (item.id === 'calendar') {
        wrap.title = 'Masa Takvimi (sürükle: taşı)';
        var now = new Date();
        var card = document.createElement('div');
        card.className = 'acc-cal-card';
        card.innerHTML =
          '<div class="acc-cal-top">' + TR_MONTHS[now.getMonth()].toUpperCase() + '</div>' +
          '<div class="acc-cal-day">' + now.getDate() + '</div>' +
          '<div class="acc-cal-week">' + TR_DAYS[now.getDay()] + '</div>';
        wrap.appendChild(card);
      }

      makeDraggable(wrap, item);
      layer.appendChild(wrap);
    });

    stage.classList.toggle('lamp-lit', lampLit);
  }

  function renderSettingsList(desk) {
    var host = $('#acc-settings-list');
    if (!host || !desk) return;
    host.textContent = '';
    var list = ensureDeskAccessories(desk);
    var byId = {};
    list.forEach(function (a) { byId[a.id] = a; });

    CATALOG.forEach(function (cat) {
      var item = byId[cat.id];
      var row = document.createElement('div');
      row.className = 'acc-cfg-row';

      var top = document.createElement('div');
      top.className = 'acc-cfg-top';

      var lbl = document.createElement('label');
      lbl.className = 'acc-cfg-check';
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = !!item.on;
      cb.addEventListener('change', function () {
        item.on = cb.checked;
        Desk.saveCurrentDesk();
        renderOnDesk(desk);
      });
      var nm = document.createElement('span');
      nm.textContent = cat.name;
      lbl.appendChild(cb);
      lbl.appendChild(nm);

      var sel = document.createElement('select');
      sel.className = 'acc-cfg-var';
      sel.setAttribute('aria-label', cat.name + ' çeşidi');
      cat.variants.forEach(function (v) {
        var opt = document.createElement('option');
        opt.value = v.id;
        opt.textContent = v.label;
        if (item.variant === v.id) opt.selected = true;
        sel.appendChild(opt);
      });
      sel.addEventListener('change', function () {
        item.variant = sel.value;
        Desk.saveCurrentDesk();
        renderOnDesk(desk);
      });

      top.appendChild(lbl);
      top.appendChild(sel);
      row.appendChild(top);
      host.appendChild(row);
    });
  }

  function resetPositions(desk) {
    if (!desk) return;
    var defs = {};
    CATALOG.forEach(function (c) { defs[c.id] = c; });
    ensureDeskAccessories(desk).forEach(function (a) {
      if (defs[a.id]) {
        a.x = defs[a.id].defaultX;
        a.y = defs[a.id].defaultY;
      }
    });
    desk.musicBox = { x: 72, y: 1.2 };
    desk.deskScaleV2 = true;
    Desk.saveCurrentDesk();
    renderOnDesk(desk);
    if (Desk.applyMusicBoxPos) Desk.applyMusicBoxPos(desk);
    if (window.Notebook && Notebook.resetDeskPositions) Notebook.resetDeskPositions();
  }

  function init() {
    if (!clockTickId) {
      clockTickId = setInterval(function () {
        var el = $('.acc-clock-readout');
        if (el && normalizeClockVariant(el.dataset.variant) === 'saat') updateClockText();
      }, 1000);
    }
    var rst = $('#acc-reset-pos');
    if (rst) {
      rst.addEventListener('click', function () {
        var d = Desk.getActive();
        if (d) resetPositions(d);
      });
    }
  }

  window.Accessories = {
    init: init,
    defaultList: defaultList,
    renderOnDesk: renderOnDesk,
    renderSettingsList: renderSettingsList
  };
})();
