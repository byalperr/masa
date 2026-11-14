/* music.js — Masa Müzik Kutusu & Yerel Müzik Kütüphanesi (IndexedDB + ID3v2 temel etiket/kapak okuma). */
(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var tracks = [];
  var activeId = null;
  var isPlaying = false;
  var isShuffle = false;
  var isRepeat = false;
  var filterMode = 'all'; // 'all' | 'fav'
  var searchQuery = '';
  var audioEl = null;
  var volume = 0.75;
  var inited = false;

  function fmtTime(sec) {
    if (!isFinite(sec) || sec <= 0) return '0:00';
    var h = Math.floor(sec / 3600);
    var m = Math.floor((sec % 3600) / 60);
    var s = Math.floor(sec % 60);
    if (h > 0) return h + ':' + (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  function parseFileName(name) {
    var base = String(name || 'Bilinmeyen Parça').replace(/\.[^.]+$/, '').replace(/_/g, ' ').trim();
    var parts = base.split(/\s+[-–—]\s+/);
    if (parts.length >= 2) {
      return { artist: parts[0].trim(), title: parts.slice(1).join(' - ').trim() };
    }
    return { artist: '', title: base };
  }

  // Hafif ID3v2 etiket + gömülü kapak (APIC) okuyucu
  function readSynchsafe(view, off) {
    return ((view.getUint8(off) & 0x7f) << 21) |
           ((view.getUint8(off + 1) & 0x7f) << 14) |
           ((view.getUint8(off + 2) & 0x7f) << 7) |
           (view.getUint8(off + 3) & 0x7f);
  }

  function decodeTextFrame(bytes) {
    if (!bytes || !bytes.length) return '';
    var enc = bytes[0];
    var data = bytes.subarray(1);
    try {
      if (enc === 1 || enc === 2) {
        return new TextDecoder(enc === 2 ? 'utf-16be' : 'utf-16le').decode(data).replace(/\0/g, '').trim();
      }
      if (enc === 3) return new TextDecoder('utf-8').decode(data).replace(/\0/g, '').trim();
      return new TextDecoder('iso-8859-1').decode(data).replace(/\0/g, '').trim();
    } catch (e) {
      return '';
    }
  }

  function parseAPIC(bytes) {
    if (!bytes || bytes.length < 4) return null;
    var enc = bytes[0];
    var i = 1;
    var mimeEnd = i;
    while (mimeEnd < bytes.length && bytes[mimeEnd] !== 0) mimeEnd++;
    var mime = new TextDecoder('ascii').decode(bytes.subarray(i, mimeEnd)) || 'image/jpeg';
    i = mimeEnd + 2; // skip null + pictureType
    if (enc === 1 || enc === 2) {
      while (i + 1 < bytes.length && !(bytes[i] === 0 && bytes[i + 1] === 0)) i += 2;
      i += 2;
    } else {
      while (i < bytes.length && bytes[i] !== 0) i++;
      i += 1;
    }
    if (i >= bytes.length) return null;
    return new Blob([bytes.subarray(i)], { type: mime.indexOf('image/') === 0 ? mime : 'image/jpeg' });
  }

  function parseID3(file) {
    return file.slice(0, 524288).arrayBuffer().then(function (buf) {
      var out = { title: '', artist: '', album: '', coverBlob: null };
      if (buf.byteLength < 10) return out;
      var view = new DataView(buf);
      if (view.getUint8(0) !== 0x49 || view.getUint8(1) !== 0x44 || view.getUint8(2) !== 0x33) return out;
      var ver = view.getUint8(3);
      if (ver < 3 || ver > 4) return out;
      var tagSize = readSynchsafe(view, 6);
      var limit = Math.min(buf.byteLength, 10 + tagSize);
      var off = 10;
      if (view.getUint8(5) & 0x40) {
        if (off + 4 <= limit) off += (ver === 4 ? readSynchsafe(view, off) : view.getUint32(off) + 4);
      }
      var bytes = new Uint8Array(buf);
      while (off + 10 <= limit) {
        var fid = String.fromCharCode(bytes[off], bytes[off + 1], bytes[off + 2], bytes[off + 3]);
        if (!/^[A-Z0-9]{4}$/.test(fid)) break;
        var fsize = ver === 4 ? readSynchsafe(view, off + 4) : view.getUint32(off + 4);
        off += 10;
        if (fsize <= 0 || off + fsize > limit) break;
        var payload = bytes.subarray(off, off + fsize);
        if (fid === 'TIT2') out.title = decodeTextFrame(payload) || out.title;
        else if (fid === 'TPE1') out.artist = decodeTextFrame(payload) || out.artist;
        else if (fid === 'TALB') out.album = decodeTextFrame(payload) || out.album;
        else if (fid === 'APIC' && !out.coverBlob) out.coverBlob = parseAPIC(payload);
        off += fsize;
      }
      return out;
    }).catch(function () { return { title: '', artist: '', album: '', coverBlob: null }; });
  }

  function probeDuration(blob) {
    return new Promise(function (resolve) {
      var url = URL.createObjectURL(blob);
      var a = document.createElement('audio');
      a.preload = 'metadata';
      var done = function (d) {
        URL.revokeObjectURL(url);
        resolve(isFinite(d) && d > 0 ? d : 0);
      };
      a.onloadedmetadata = function () { done(a.duration); };
      a.onerror = function () { done(0); };
      a.src = url;
    });
  }

  function isAudioFile(f) {
    if (!f) return false;
    if (f.type && f.type.indexOf('audio/') === 0) return true;
    return /\.(mp3|ogg|wav|flac|m4a|aac|opus|webm)$/i.test(f.name || '');
  }

  function hydrateTrack(rec) {
    return {
      id: rec.id,
      title: rec.title || 'İsimsiz Parça',
      artist: rec.artist || '',
      album: rec.album || '',
      duration: rec.duration || 0,
      isFav: !!rec.isFav,
      addedAt: rec.addedAt || 0,
      size: rec.size || (rec.audioBlob ? rec.audioBlob.size : 0),
      fileName: rec.fileName || '',
      audioBlob: rec.audioBlob,
      coverBlob: rec.coverBlob || null,
      audioUrl: rec.audioBlob ? URL.createObjectURL(rec.audioBlob) : null,
      coverUrl: rec.coverBlob ? URL.createObjectURL(rec.coverBlob) : null
    };
  }

  function addFiles(fileList) {
    var files = Array.prototype.slice.call(fileList || []).filter(isAudioFile);
    if (!files.length) {
      App.toast('Desteklenen ses dosyası bulunamadı (.mp3, .ogg, .wav, .flac, .m4a).', 'error');
      return Promise.resolve();
    }
    var pt = App.progressToast('Müzikler ekleniyor…');
    var added = 0, dup = 0;
    var chain = Promise.resolve();

    files.forEach(function (file, idx) {
      chain = chain.then(function () {
        if (tracks.some(function (t) { return t.fileName === file.name && t.size === file.size; })) {
          dup++;
          return;
        }
        pt.update('Müzik ekleniyor (' + (idx + 1) + '/' + files.length + '): ' + file.name);
        return Promise.all([parseID3(file), probeDuration(file)]).then(function (res) {
          var meta = res[0];
          var dur = res[1];
          var parsed = parseFileName(file.name);
          var rec = {
            id: DB.uid(),
            title: meta.title || parsed.title || file.name,
            artist: meta.artist || parsed.artist || '',
            album: meta.album || '',
            duration: dur,
            isFav: false,
            addedAt: Date.now() + idx,
            size: file.size,
            fileName: file.name,
            audioBlob: file,
            coverBlob: meta.coverBlob || null
          };
          return DB.putTrack(rec).then(function () {
            var item = hydrateTrack(rec);
            tracks.unshift(item);
            added++;
            if (!activeId) selectTrack(item.id, false);
          });
        });
      });
    });

    return chain.then(function () {
      pt.close();
      var msg = [];
      if (added) msg.push(added + ' parça müzik kutusuna eklendi');
      if (dup) msg.push(dup + ' parça zaten var');
      App.toast(msg.join(' · ') || 'Yeni parça eklenmedi');
      renderLibrary();
      renderDeckWidget();
    });
  }

  function currentTrack() {
    for (var i = 0; i < tracks.length; i++) {
      if (tracks[i].id === activeId) return tracks[i];
    }
    return null;
  }

  function selectTrack(id, autoplay) {
    var t = null;
    for (var i = 0; i < tracks.length; i++) {
      if (tracks[i].id === id) { t = tracks[i]; break; }
    }
    if (!t || !t.audioUrl) return;
    var changed = activeId !== t.id;
    activeId = t.id;
    App.set('activeTrackId', t.id);

    if (changed || audioEl.src !== t.audioUrl) {
      audioEl.src = t.audioUrl;
      audioEl.currentTime = 0;
    }
    renderDeckWidget();
    renderMiniPlayers();
    renderLibrary();

    if (autoplay) {
      play();
    }
  }

  function play() {
    if (!tracks.length) {
      openLibrary();
      return;
    }
    if (!currentTrack()) {
      selectTrack(tracks[0].id, true);
      return;
    }
    if (!audioEl.src && currentTrack().audioUrl) {
      audioEl.src = currentTrack().audioUrl;
    }
    audioEl.volume = volume;
    var p = audioEl.play();
    if (p && p.then) {
      p.then(function () {
        isPlaying = true;
        renderDeckWidget();
        renderMiniPlayers();
        renderLibrary();
      }).catch(function (err) {
        if (err && (err.name === 'NotAllowedError' || err.name === 'AbortError')) {
          isPlaying = false;
        } else {
          isPlaying = false;
          App.toast('Parça çalınamadı.', 'error');
        }
        renderDeckWidget();
        renderMiniPlayers();
      });
    }
  }

  function pause() {
    audioEl.pause();
    isPlaying = false;
    renderDeckWidget();
    renderMiniPlayers();
    renderLibrary();
  }

  function togglePlay() {
    if (isPlaying && !audioEl.paused) pause();
    else play();
  }

  function nextTrack(fromEnded) {
    if (!tracks.length) return;
    if (fromEnded && isRepeat) {
      audioEl.currentTime = 0;
      play();
      return;
    }
    if (isShuffle && tracks.length > 1) {
      var cand = tracks[Math.floor(Math.random() * tracks.length)];
      while (cand.id === activeId && tracks.length > 1) {
        cand = tracks[Math.floor(Math.random() * tracks.length)];
      }
      selectTrack(cand.id, isPlaying || fromEnded);
      return;
    }
    var idx = tracks.findIndex(function (t) { return t.id === activeId; });
    var nextIdx = (idx + 1) % tracks.length;
    selectTrack(tracks[nextIdx].id, isPlaying || fromEnded);
  }

  function prevTrack() {
    if (!tracks.length) return;
    if (audioEl.currentTime > 3) {
      audioEl.currentTime = 0;
      return;
    }
    var idx = tracks.findIndex(function (t) { return t.id === activeId; });
    var prevIdx = (idx - 1 + tracks.length) % tracks.length;
    selectTrack(tracks[prevIdx].id, isPlaying);
  }

  function toggleFav(id) {
    var t = tracks.find(function (x) { return x.id === id; });
    if (!t) return;
    t.isFav = !t.isFav;
    DB.updateTrack(id, { isFav: t.isFav }).catch(function () {});
    renderLibrary();
    renderDeckWidget();
  }

  function removeTrack(id) {
    var idx = tracks.findIndex(function (x) { return x.id === id; });
    if (idx < 0) return;
    var removed = tracks[idx];
    tracks.splice(idx, 1);
    if (removed.audioUrl) URL.revokeObjectURL(removed.audioUrl);
    if (removed.coverUrl) URL.revokeObjectURL(removed.coverUrl);
    DB.deleteTrack(id).catch(function () {});
    if (activeId === id) {
      pause();
      audioEl.removeAttribute('src');
      activeId = null;
      if (tracks.length) selectTrack(tracks[Math.min(idx, tracks.length - 1)].id, false);
    }
    renderLibrary();
    renderDeckWidget();
    renderMiniPlayers();
  }

  function setVolume(v) {
    volume = Math.max(0, Math.min(1, v));
    audioEl.volume = volume;
    App.set('musicVol', Math.round(volume * 100));
    $$('.mbox-vol').forEach(function (el) { el.value = Math.round(volume * 100); });
  }

  function updateProgressUI() {
    var cur = audioEl ? audioEl.currentTime : 0;
    var dur = audioEl && isFinite(audioEl.duration) ? audioEl.duration : (currentTrack() ? currentTrack().duration : 0);
    var pct = dur > 0 ? Math.min(100, Math.max(0, (cur / dur) * 100)) : 0;
    var fill = $('#mbox-prog-fill');
    if (fill) fill.style.width = pct + '%';
    var tCur = $('#mbox-time-cur');
    var tDur = $('#mbox-time-dur');
    if (tCur) tCur.textContent = fmtTime(cur);
    if (tDur) tDur.textContent = fmtTime(dur);
  }

  function renderDeckWidget() {
    var box = $('#desk-music-box');
    if (!box) return;
    var t = currentTrack();
    box.classList.toggle('is-playing', isPlaying);
    box.classList.toggle('has-track', !!t);

    var titleEl = $('#mbox-title');
    var artistEl = $('#mbox-artist');
    var artEl = $('#mbox-art');
    var countEl = $('#mbox-count');

    if (t) {
      titleEl.textContent = t.title;
      artistEl.textContent = t.artist || 'Yerel Müzik';
      if (t.coverUrl) {
        artEl.style.backgroundImage = "url('" + t.coverUrl + "')";
        artEl.classList.add('has-cover');
      } else {
        artEl.style.backgroundImage = '';
        artEl.classList.remove('has-cover');
      }
    } else {
      titleEl.textContent = 'Müzik Kutusu Boş';
      artistEl.textContent = 'Şarkı seç veya ekle';
      artEl.style.backgroundImage = '';
      artEl.classList.remove('has-cover');
    }

    if (countEl) {
      countEl.textContent = tracks.length ? tracks.length + ' parça' : 'Müzik ekle';
    }

    var playUse = $('#mbox-play use');
    if (playUse) playUse.setAttribute('href', isPlaying ? '#i-pause' : '#i-play');
    var shuf = $('#mbox-shuffle');
    if (shuf) shuf.classList.toggle('on', isShuffle);
    var rep = $('#mbox-repeat');
    if (rep) rep.classList.toggle('on', isRepeat);
    updateProgressUI();
  }

  function renderMiniPlayers() {
    var t = currentTrack();
    $$('.mini-music').forEach(function (wrap) {
      var lbl = wrap.querySelector('.mini-track');
      var btn = wrap.querySelector('.mini-play use');
      wrap.classList.toggle('is-playing', isPlaying);
      if (lbl) lbl.textContent = t ? t.title : 'Müzik Yok';
      if (btn) btn.setAttribute('href', isPlaying ? '#i-pause' : '#i-play');
    });
  }

  function filteredTracks() {
    var q = searchQuery.toLocaleLowerCase('tr');
    return tracks.filter(function (t) {
      if (filterMode === 'fav' && !t.isFav) return false;
      if (!q) return true;
      return t.title.toLocaleLowerCase('tr').indexOf(q) >= 0 ||
             t.artist.toLocaleLowerCase('tr').indexOf(q) >= 0;
    });
  }

  function renderLibrary() {
    var list = $('#music-list');
    if (!list) return;
    list.textContent = '';

    var favCount = tracks.filter(function (t) { return t.isFav; }).length;
    var tabAll = $('#music-tab-all');
    var tabFav = $('#music-tab-fav');
    if (tabAll) {
      tabAll.textContent = 'Tümü (' + tracks.length + ')';
      tabAll.classList.toggle('on', filterMode === 'all');
    }
    if (tabFav) {
      tabFav.textContent = 'Favoriler (' + favCount + ')';
      tabFav.classList.toggle('on', filterMode === 'fav');
    }

    var items = filteredTracks();
    var empty = $('#music-empty');
    if (empty) empty.hidden = items.length > 0;

    items.forEach(function (t) {
      var row = document.createElement('div');
      row.className = 'm-row' + (t.id === activeId ? ' is-active' : '') + (t.id === activeId && isPlaying ? ' is-playing' : '');

      var playBtn = document.createElement('button');
      playBtn.type = 'button';
      playBtn.className = 'm-row-main';
      playBtn.addEventListener('click', function () {
        if (t.id === activeId) togglePlay();
        else selectTrack(t.id, true);
      });

      var art = document.createElement('span');
      art.className = 'm-art';
      if (t.coverUrl) {
        art.style.backgroundImage = "url('" + t.coverUrl + "')";
      } else {
        art.textContent = (t.title || 'M').slice(0, 2).toUpperCase();
      }

      var meta = document.createElement('span');
      meta.className = 'm-meta';
      var tt = document.createElement('span');
      tt.className = 'm-title';
      tt.textContent = t.title;
      var sub = document.createElement('span');
      sub.className = 'm-sub';
      sub.textContent = (t.artist || 'Yerel Dosya') + (t.duration ? ' · ' + fmtTime(t.duration) : '');
      meta.appendChild(tt);
      meta.appendChild(sub);

      playBtn.appendChild(art);
      playBtn.appendChild(meta);

      var favBtn = document.createElement('button');
      favBtn.type = 'button';
      favBtn.className = 'btn icon small m-fav' + (t.isFav ? ' on' : '');
      favBtn.title = t.isFav ? 'Favorilerden çıkar' : 'Favorilere ekle';
      favBtn.innerHTML = '<svg class="ico" aria-hidden="true"><use href="#i-star"/></svg>';
      favBtn.addEventListener('click', function (e) { e.stopPropagation(); toggleFav(t.id); });

      var delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'btn icon small m-del';
      delBtn.title = 'Kütüphaneden kaldır';
      delBtn.innerHTML = '<svg class="ico" aria-hidden="true"><use href="#i-trash"/></svg>';
      delBtn.addEventListener('click', function (e) { e.stopPropagation(); removeTrack(t.id); });

      row.appendChild(playBtn);
      row.appendChild(favBtn);
      row.appendChild(delBtn);
      list.appendChild(row);
    });
  }

  function openLibrary() {
    var dlg = $('#dlg-music');
    if (!dlg) return;
    renderLibrary();
    if (!dlg.open) dlg.showModal();
  }

  function init() {
    if (inited) return;
    inited = true;

    audioEl = $('#music-audio');
    volume = (typeof App.settings.musicVol === 'number' ? App.settings.musicVol : 75) / 100;
    isRepeat = !!App.settings.musicRepeat;
    isShuffle = !!App.settings.musicShuffle;
    audioEl.volume = volume;

    $$('.mbox-vol').forEach(function (el) {
      el.value = Math.round(volume * 100);
      el.addEventListener('input', function () { setVolume(+this.value / 100); });
    });

    audioEl.addEventListener('timeupdate', updateProgressUI);
    audioEl.addEventListener('loadedmetadata', function () {
      var t = currentTrack();
      if (t && !t.duration && isFinite(audioEl.duration)) {
        t.duration = audioEl.duration;
        DB.updateTrack(t.id, { duration: t.duration }).catch(function () {});
      }
      updateProgressUI();
    });
    audioEl.addEventListener('ended', function () { nextTrack(true); });
    audioEl.addEventListener('play', function () {
      isPlaying = true; renderDeckWidget(); renderMiniPlayers(); renderLibrary();
    });
    audioEl.addEventListener('pause', function () {
      isPlaying = false; renderDeckWidget(); renderMiniPlayers(); renderLibrary();
    });

    // Masa üstündeki Müzik Kutusu kontrolleri
    var bPlay = $('#mbox-play');
    var bPrev = $('#mbox-prev');
    var bNext = $('#mbox-next');
    var bShuf = $('#mbox-shuffle');
    var bRep = $('#mbox-repeat');
    var bOpen = $('#mbox-open-lib');
    var prog = $('#mbox-prog');

    if (bPlay) bPlay.addEventListener('click', function (e) { e.stopPropagation(); togglePlay(); });
    if (bPrev) bPrev.addEventListener('click', function (e) { e.stopPropagation(); prevTrack(); });
    if (bNext) bNext.addEventListener('click', function (e) { e.stopPropagation(); nextTrack(false); });
    if (bShuf) bShuf.addEventListener('click', function (e) {
      e.stopPropagation();
      isShuffle = !isShuffle;
      App.set('musicShuffle', isShuffle);
      renderDeckWidget();
    });
    if (bRep) bRep.addEventListener('click', function (e) {
      e.stopPropagation();
      isRepeat = !isRepeat;
      App.set('musicRepeat', isRepeat);
      renderDeckWidget();
    });
    if (bOpen) bOpen.addEventListener('click', function (e) { e.stopPropagation(); openLibrary(); });
    if (prog) {
      prog.addEventListener('click', function (e) {
        e.stopPropagation();
        if (!audioEl.duration) return;
        var rect = prog.getBoundingClientRect();
        var ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        audioEl.currentTime = ratio * audioEl.duration;
        updateProgressUI();
      });
    }

    // Mini oynatıcılar (Okuyucu ve Defter üst barı)
    $$('.mini-play').forEach(function (btn) { btn.addEventListener('click', togglePlay); });
    $$('.mini-next').forEach(function (btn) { btn.addEventListener('click', function () { nextTrack(false); }); });
    $$('.mini-open').forEach(function (btn) { btn.addEventListener('click', openLibrary); });

    // Müzik kütüphanesi dialog kontrolleri
    var addFileBtn = $('#music-add-files');
    var addDirBtn = $('#music-add-dir');
    var fileInp = $('#music-file-input');
    var dirInp = $('#music-dir-input');
    if (addFileBtn && fileInp) addFileBtn.addEventListener('click', function () { fileInp.click(); });
    if (addDirBtn && dirInp) addDirBtn.addEventListener('click', function () { dirInp.click(); });
    if (fileInp) fileInp.addEventListener('change', function () { if (this.files.length) addFiles(this.files); this.value = ''; });
    if (dirInp) dirInp.addEventListener('change', function () { if (this.files.length) addFiles(this.files); this.value = ''; });

    var tabAll = $('#music-tab-all');
    var tabFav = $('#music-tab-fav');
    var searchInp = $('#music-search');
    if (tabAll) tabAll.addEventListener('click', function () { filterMode = 'all'; renderLibrary(); });
    if (tabFav) tabFav.addEventListener('click', function () { filterMode = 'fav'; renderLibrary(); });
    if (searchInp) searchInp.addEventListener('input', function () { searchQuery = this.value; renderLibrary(); });

    return DB.listTracks().then(function (list) {
      list.sort(function (a, b) { return (b.addedAt || 0) - (a.addedAt || 0); });
      tracks = list.map(hydrateTrack);
      var lastId = App.settings.activeTrackId;
      if (lastId && tracks.some(function (t) { return t.id === lastId; })) {
        selectTrack(lastId, false);
      } else if (tracks.length) {
        selectTrack(tracks[0].id, false);
      } else {
        renderDeckWidget();
        renderMiniPlayers();
      }
    });
  }

  window.Music = {
    init: init,
    addFiles: addFiles,
    isAudioFile: isAudioFile,
    openLibrary: openLibrary,
    togglePlay: togglePlay,
    nextTrack: function () { nextTrack(false); },
    prevTrack: prevTrack,
    getStateSummary: function () {
      var t = currentTrack();
      return { count: tracks.length, playing: isPlaying, current: t };
    }
  };
})();
