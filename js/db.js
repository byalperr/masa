/* db.js — Masa IndexedDB deposu.
 * Depolar:
 *   desks       : çalışma masaları (tema, yüzey, arka plan, aksesuar yerleşimi)
 *   books       : PDF üst verisi + kapak küçük resmi (Blob) + deskId
 *   files       : PDF Blob'ları (bookId ile)
 *   bookmarks   : okuyucu yer imleri (bookId indeksli)
 *   tracks      : müzik parçaları (audioBlob + coverBlob)
 *   topics      : defter konu başlıkları
 *   notes       : konu başlıkları altındaki notlar
 *   backgrounds : kullanıcının yüklediği özel arka plan fotoğrafları
 *   aichats     : PDF başına Yapay Zekaya Sor sohbeti (bookId anahtarlı)
 *   settings    : genel uygulama ayarları
 */
(function () {
  'use strict';
  var DB_NAME = 'masa_db';
  var DB_VER = 2;
  var dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains('desks')) {
          db.createObjectStore('desks', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('books')) {
          var bs = db.createObjectStore('books', { keyPath: 'id' });
          bs.createIndex('deskId', 'deskId', { unique: false });
        }
        if (!db.objectStoreNames.contains('files')) {
          db.createObjectStore('files');
        }
        if (!db.objectStoreNames.contains('bookmarks')) {
          var bm = db.createObjectStore('bookmarks', { keyPath: 'id' });
          bm.createIndex('bookId', 'bookId', { unique: false });
        }
        if (!db.objectStoreNames.contains('tracks')) {
          var ts = db.createObjectStore('tracks', { keyPath: 'id' });
          ts.createIndex('addedAt', 'addedAt', { unique: false });
        }
        if (!db.objectStoreNames.contains('topics')) {
          var tp = db.createObjectStore('topics', { keyPath: 'id' });
          tp.createIndex('deskId', 'deskId', { unique: false });
        }
        if (!db.objectStoreNames.contains('notes')) {
          var ns = db.createObjectStore('notes', { keyPath: 'id' });
          ns.createIndex('topicId', 'topicId', { unique: false });
        }
        if (!db.objectStoreNames.contains('backgrounds')) {
          db.createObjectStore('backgrounds', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings');
        }
        if (!db.objectStoreNames.contains('aichats')) {
          db.createObjectStore('aichats', { keyPath: 'bookId' });
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
    return dbPromise;
  }

  function tx(names, mode, fn) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction(names, mode);
        var stores = {};
        [].concat(names).forEach(function (n) { stores[n] = t.objectStore(n); });
        var result;
        try { result = fn(stores); } catch (e) { reject(e); return; }
        t.oncomplete = function () {
          resolve(result && 'result' in result ? result.result : result);
        };
        t.onerror = function () { reject(t.error); };
        t.onabort = function () { reject(t.error || new Error('İşlem iptal edildi')); };
      });
    });
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  window.DB = {
    uid: uid,

    // --- masalar ---
    listDesks: function () {
      return tx('desks', 'readonly', function (s) { return s.desks.getAll(); });
    },
    getDesk: function (id) {
      return tx('desks', 'readonly', function (s) { return s.desks.get(id); });
    },
    putDesk: function (desk) {
      return tx('desks', 'readwrite', function (s) { s.desks.put(desk); });
    },
    deleteDesk: function (id) {
      return tx('desks', 'readwrite', function (s) { s.desks.delete(id); });
    },

    // --- kitaplar / çalışma PDF'leri ---
    listBooks: function (deskId) {
      if (deskId) {
        return tx('books', 'readonly', function (s) {
          return s.books.index('deskId').getAll(IDBKeyRange.only(deskId));
        });
      }
      return tx('books', 'readonly', function (s) { return s.books.getAll(); });
    },
    getBook: function (id) {
      return tx('books', 'readonly', function (s) { return s.books.get(id); });
    },
    addBook: function (book, blob) {
      return tx(['books', 'files'], 'readwrite', function (s) {
        s.books.put(book);
        s.files.put(blob, book.id);
      });
    },
    updateBook: function (id, patch) {
      return tx('books', 'readwrite', function (s) {
        var g = s.books.get(id);
        g.onsuccess = function () {
          if (g.result) s.books.put(Object.assign(g.result, patch));
        };
      });
    },
    getFile: function (id) {
      return tx('files', 'readonly', function (s) { return s.files.get(id); });
    },
    deleteBook: function (id) {
      return tx(['books', 'files', 'bookmarks', 'aichats'], 'readwrite', function (s) {
        s.books.delete(id);
        s.files.delete(id);
        s.aichats.delete(id);
        var cur = s.bookmarks.index('bookId').openKeyCursor(IDBKeyRange.only(id));
        cur.onsuccess = function () {
          var c = cur.result;
          if (c) { s.bookmarks.delete(c.primaryKey); c.continue(); }
        };
      });
    },

    // --- yer imleri ---
    listBookmarks: function (bookId) {
      return tx('bookmarks', 'readonly', function (s) {
        return s.bookmarks.index('bookId').getAll(IDBKeyRange.only(bookId));
      });
    },
    putBookmark: function (bm) {
      return tx('bookmarks', 'readwrite', function (s) { s.bookmarks.put(bm); });
    },
    deleteBookmark: function (id) {
      return tx('bookmarks', 'readwrite', function (s) { s.bookmarks.delete(id); });
    },

    // --- yapay zeka sohbetleri (PDF başına) ---
    getAiChat: function (bookId) {
      return tx('aichats', 'readonly', function (s) { return s.aichats.get(bookId); });
    },
    putAiChat: function (chat) {
      return tx('aichats', 'readwrite', function (s) { s.aichats.put(chat); });
    },
    deleteAiChat: function (bookId) {
      return tx('aichats', 'readwrite', function (s) { s.aichats.delete(bookId); });
    },

    // --- müzik parçaları ---
    listTracks: function () {
      return tx('tracks', 'readonly', function (s) { return s.tracks.getAll(); });
    },
    putTrack: function (track) {
      return tx('tracks', 'readwrite', function (s) { s.tracks.put(track); });
    },
    updateTrack: function (id, patch) {
      return tx('tracks', 'readwrite', function (s) {
        var g = s.tracks.get(id);
        g.onsuccess = function () {
          if (g.result) s.tracks.put(Object.assign(g.result, patch));
        };
      });
    },
    deleteTrack: function (id) {
      return tx('tracks', 'readwrite', function (s) { s.tracks.delete(id); });
    },

    // --- defter konu başlıkları & notlar ---
    listTopics: function () {
      return tx('topics', 'readonly', function (s) { return s.topics.getAll(); });
    },
    putTopic: function (topic) {
      return tx('topics', 'readwrite', function (s) { s.topics.put(topic); });
    },
    deleteTopic: function (id) {
      return tx(['topics', 'notes'], 'readwrite', function (s) {
        s.topics.delete(id);
        var cur = s.notes.index('topicId').openKeyCursor(IDBKeyRange.only(id));
        cur.onsuccess = function () {
          var c = cur.result;
          if (c) { s.notes.delete(c.primaryKey); c.continue(); }
        };
      });
    },
    listNotes: function (topicId) {
      if (topicId) {
        return tx('notes', 'readonly', function (s) {
          return s.notes.index('topicId').getAll(IDBKeyRange.only(topicId));
        });
      }
      return tx('notes', 'readonly', function (s) { return s.notes.getAll(); });
    },
    putNote: function (note) {
      return tx('notes', 'readwrite', function (s) { s.notes.put(note); });
    },
    deleteNote: function (id) {
      return tx('notes', 'readwrite', function (s) { s.notes.delete(id); });
    },

    // --- özel arka planlar ---
    listBackgrounds: function () {
      return tx('backgrounds', 'readonly', function (s) { return s.backgrounds.getAll(); });
    },
    getBackground: function (id) {
      return tx('backgrounds', 'readonly', function (s) { return s.backgrounds.get(id); });
    },
    putBackground: function (bg) {
      return tx('backgrounds', 'readwrite', function (s) { s.backgrounds.put(bg); });
    },
    deleteBackground: function (id) {
      return tx('backgrounds', 'readwrite', function (s) { s.backgrounds.delete(id); });
    },

    // --- ayarlar ---
    getSetting: function (key, def) {
      return tx('settings', 'readonly', function (s) { return s.settings.get(key); })
        .then(function (v) { return v === undefined ? def : v; });
    },
    setSetting: function (key, value) {
      return tx('settings', 'readwrite', function (s) { s.settings.put(value, key); });
    }
  };
})();
