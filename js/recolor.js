/* recolor.js — render edilmiş sayfa canvas'ını piksel düzeyinde yeniden renklendirir.
 * CSS invert filtresi KULLANILMAZ.
 *  - Düşük doygunluklu pikseller (metin, zemin, gri tonlar):
 *      çıktı = karıştır(yazıRengi, zeminRengi, L)   L = parlaklık 0..1
 *      (L=0 siyah -> yazı rengi, L=1 beyaz -> zemin rengi)
 *  - Belirgin renkli pikseller (fotoğraf, renkli çizim) büyük ölçüde korunur;
 *    koyu temalarda hafifçe kısılır, çok koyu olanlar okunur kalsın diye biraz açılır.
 */
(function () {
  'use strict';

  function hexToRgb(h) {
    h = String(h || '').replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    if (isNaN(n) || h.length !== 6) return [0, 0, 0];
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgbToHex(c) {
    return '#' + c.map(function (v) {
      v = Math.max(0, Math.min(255, Math.round(v)));
      return (v < 16 ? '0' : '') + v.toString(16);
    }).join('');
  }
  function lum(c) { return (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255; }
  // a ile b'yi t oranında karıştır (t=0 -> a, t=1 -> b)
  function mixHex(a, b, t) {
    var x = hexToRgb(a), y = hexToRgb(b);
    return rgbToHex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]);
  }

  /**
   * canvas'ı yerinde dönüştürür.
   * opts: { bg:'#rrggbb', fg:'#rrggbb' }
   * Kâğıt gibi "doğal" temalarda (bg beyaza, fg siyaha yakın) işlem atlanabilir: identity=true.
   */
  function apply(canvas, opts) {
    var bg = hexToRgb(opts.bg), fg = hexToRgb(opts.fg);
    var dark = lum(bg) < 0.45;
    var ctx = canvas.getContext('2d', { willReadFrequently: false });
    var img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    var d = img.data, n = d.length;

    // L (0..255) için hazır tablo: karışım rengi
    var lutR = new Uint8ClampedArray(256), lutG = new Uint8ClampedArray(256), lutB = new Uint8ClampedArray(256);
    for (var i = 0; i < 256; i++) {
      var t = i / 255;
      lutR[i] = fg[0] + (bg[0] - fg[0]) * t;
      lutG[i] = fg[1] + (bg[1] - fg[1]) * t;
      lutB[i] = fg[2] + (bg[2] - fg[2]) * t;
    }
    var dim = dark ? 0.86 : 1;

    for (var p = 0; p < n; p += 4) {
      var r = d[p], g = d[p + 1], b = d[p + 2];
      var mx = r > g ? (r > b ? r : b) : (g > b ? g : b);
      var mn = r < g ? (r < b ? r : b) : (g < b ? g : b);
      var chroma = mx - mn;                       // 0..255
      var L = (r * 77 + g * 151 + b * 28) >> 8;   // 0..255 (≈ Rec.601)
      var mr = lutR[L], mg = lutG[L], mb = lutB[L];

      if (chroma > 28) {
        // renklilik ağırlığı: 28..90 arası yumuşak geçiş
        var w = (chroma - 28) / 62; if (w > 1) w = 1;
        w = w * w * (3 - 2 * w);
        var cr = r * dim, cg = g * dim, cb = b * dim;
        if (dark && L < 110) {
          // koyu renkli ayrıntı koyu zeminde kaybolmasın
          var lift = (110 - L) / 110 * 0.55;
          cr += (255 - cr) * lift; cg += (255 - cg) * lift; cb += (255 - cb) * lift;
        }
        mr += (cr - mr) * w; mg += (cg - mg) * w; mb += (cb - mb) * w;
      }
      d[p] = mr; d[p + 1] = mg; d[p + 2] = mb;
    }
    ctx.putImageData(img, 0, 0);
  }

  window.Recolor = { apply: apply, hexToRgb: hexToRgb, rgbToHex: rgbToHex, lum: lum, mixHex: mixHex };
})();
