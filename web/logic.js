/* Lógica sin pantalla: cálculo de ofertas e interpretación del texto de un cartel.
   Se usa en la web y se prueba con Node (module.exports). */
(function (root) {
  'use strict';

  // ---------- Cálculo de una línea (céntimos) ----------
  // item: {cents, qty, kg, promo: null | {type:'nxm',buy,pay} | {type:'second',pct} | {type:'pct',pct}}
  function lineCalc(item) {
    var p = item.cents, q = item.qty, pr = item.promo;
    var gross = Math.round(p * q);
    var net = gross;
    if (pr) {
      if (!item.kg && pr.type === 'nxm' && pr.buy >= 2 && pr.pay >= 1 && pr.pay < pr.buy) {
        var g = Math.floor(q / pr.buy);
        net = Math.round((g * pr.pay + (q - g * pr.buy)) * p);
      } else if (!item.kg && pr.type === 'second' && pr.pct > 0 && pr.pct <= 100) {
        var pairs = Math.floor(q / 2);
        net = Math.round(((q - pairs) + pairs * (1 - pr.pct / 100)) * p);
      } else if (pr.type === 'pct' && pr.pct > 0 && pr.pct <= 100) {
        net = Math.round(gross * (1 - pr.pct / 100));
      }
    }
    return { gross: gross, net: net, save: gross - net };
  }

  // ---------- Expresiones ----------
  var PRICE_RE = /(?<![\d.,])(\d{1,3})\s?[,.]\s?(\d{2})(?!\d)(?!\s?(?:l|kg|g|ml|cl)\b)/gi;
  var REF_TAIL_RE = /\/\s?(?:kg|kilo|l|litro|100\s?g|100\s?ml|ud|unidad)\b|\bpor\s+(?:kg|kilo|litro)\b|(?:€|eur)\s?[\/lI|1]?\s?k[gq9]\b/i;
  var KG_TAIL_RE = /(?:€|eur)\s?[\/lI|1]?\s?k[gq9]\b|\/\s?(?:kg|kilo)\b|\bpor\s+(?:kg|kilo)\b/i;
  var REF_HEAD_RE = /(?:precio|pvp)\s*(?:por\s*)?(?:kg|kilo|litro|l)\b\s*:?\s*$/i;
  var OLD_RE = /\b(?:antes|anterior|habitual)\b/i;

  var NXM_RE = /(?<![\d.,])([2-4])\s?[x×]\s?([1-3])(?![\d.,])(?!\s?(?:g|kg|l|ml|cl|litro)\b)/i;
  var POR_RE = /(?<!\d)([2-4])\s?por\s?([1-3])(?!\d)/i;
  var LLEVA_RE = /lleva[a-záéíóúñ]*\s?([2-4])\D{0,15}?pag[a-záéíóúñ]*\s?([1-3])/i;
  var SECOND_A_RE = /(?:2\s?[ªº°*]|2\.ª|2\s?a\b|segunda)\s?(?:unidad|ud\.?)?\D{0,20}?(\d{1,2})\s?%/i;
  var SECOND_B_RE = /(\d{1,2})\s?%\D{0,15}?(?:2\s?[ªº°*]|segunda)/i;
  var PCT_A_RE = /[-−–]\s?(\d{1,2})\s?%/;
  var PCT_B_RE = /(\d{1,2})\s?%\s?(?:dto|desc)/i;
  var NOISE_RE = /\b(?:oferta|dto|descuento|ahora|antes|pvp|precio|iva|unidad|paga|lleva|cada|ahorra|hasta|stock)\b/i;

  function boxH(b) { return b.bottom - b.top; }

  // lines: [{text, box:{left,top,right,bottom}, elements:[{text, box}]}]
  function parseLabel(lines) {
    var cands = [];
    var i, j;

    lines.forEach(function (line) {
      var text = line.text;
      var lower = text.toLowerCase();
      var oldish = OLD_RE.test(lower);
      PRICE_RE.lastIndex = 0;
      var m;
      while ((m = PRICE_RE.exec(text)) !== null) {
        var value = parseInt(m[1], 10) * 100 + parseInt(m[2], 10);
        if (value <= 0 || value >= 100000) continue;
        var head = text.slice(0, m.index).toLowerCase();
        var tail = text.slice(m.index + m[0].length, m.index + m[0].length + 10).toLowerCase();
        var ref = REF_TAIL_RE.test(tail) || REF_HEAD_RE.test(head);
        var h16 = head.slice(-16);
        var kgRef = ref && (KG_TAIL_RE.test(tail) || tail.indexOf('kg') >= 0 || tail.indexOf('kilo') >= 0 ||
          h16.indexOf('kg') >= 0 || h16.indexOf('kilo') >= 0);
        var key = m[0].replace(/\s/g, '');
        var el = null;
        for (j = 0; j < (line.elements || []).length; j++) {
          if (line.elements[j].text.replace(/\s/g, '').indexOf(key) >= 0) { el = line.elements[j]; break; }
        }
        var h = el ? boxH(el.box) : boxH(line.box);
        var score = h * (ref ? 0.35 : 1) * (oldish ? 0.55 : 1);
        cands.push({ cents: value, score: score, ref: ref, kgRef: kgRef });
      }
      // Precio partido en dos elementos de la misma línea: euros grandes y céntimos pequeños
      var els = line.elements || [];
      if (els.length === 2) {
        var a = els[0], b = els[1];
        var at = a.text.trim(), bt = b.text.trim();
        if (/^\d{1,3}$/.test(at) && /^\d{2}$/.test(bt) && boxH(b.box) < boxH(a.box) * 0.85) {
          var v = parseInt(at, 10) * 100 + parseInt(bt, 10);
          if (v > 0 && v < 100000) cands.push({ cents: v, score: boxH(a.box), ref: false, kgRef: false });
        }
      }
    });

    // Precio partido en dos líneas distintas ("1" grande y "45" pequeño a su derecha)
    for (i = 0; i < lines.length; i++) {
      var A = lines[i];
      var at2 = A.text.trim();
      if (!/^\d{1,3}$/.test(at2)) continue;
      var hA = boxH(A.box), wA = A.box.right - A.box.left;
      for (j = 0; j < lines.length; j++) {
        if (i === j) continue;
        var B = lines[j];
        if (!/^\d{2}$/.test(B.text.trim())) continue;
        var hB = boxH(B.box);
        var okSide = B.box.left >= A.box.right - 0.3 * wA && B.box.left <= A.box.right + 1.5 * hA;
        var okTop = B.box.top >= A.box.top - 0.25 * hA && B.box.top <= A.box.top + 0.8 * hA;
        if (okSide && okTop && hB < hA * 0.85) {
          var v2 = parseInt(at2, 10) * 100 + parseInt(B.text.trim(), 10);
          if (v2 > 0 && v2 < 100000) cands.push({ cents: v2, score: hA, ref: false, kgRef: false });
        }
      }
    }

    var best = {};
    cands.forEach(function (c) {
      if (!best[c.cents] || c.score > best[c.cents].score) best[c.cents] = c;
    });
    var sorted = Object.keys(best).map(function (k) { return best[k]; })
      .sort(function (x, y) { return y.score - x.score; });
    var chosen = sorted[0] || null;

    var notes = [];
    if (chosen) {
      if (chosen.ref && !chosen.kgRef) notes.push('El precio elegido parece ser el de referencia por litro o unidad.');
      if (chosen.kgRef) notes.push('Parece un producto al peso (precio por kilo).');
      if (sorted.length > 1 && sorted[1].score >= chosen.score * 0.75) {
        notes.push('Hay varios precios parecidos: elige el correcto.');
      }
    }

    var all = lines.map(function (l) { return l.text; }).join(' ').toLowerCase();
    return {
      name: extractName(lines),
      priceCents: chosen ? chosen.cents : null,
      kg: !!(chosen && chosen.kgRef),
      promo: detectPromo(all),
      candidates: sorted.slice(0, 5).map(function (c) { return c.cents; }),
      scored: sorted.slice(0, 8),
      barcode: null,
      note: notes.length ? notes.join(' ') : null
    };
  }

  // Une lecturas de la misma foto (imagen normal e invertida): el precio que coincide en varias gana.
  function mergeReadings(list) {
    var rs = list.filter(Boolean);
    if (rs.length === 0) return null;
    if (rs.length === 1) return rs[0];
    var best = {};
    rs.forEach(function (r) {
      var sc = r.scored || [];
      var max = 1;
      sc.forEach(function (c) { if (c.score > max) max = c.score; });
      sc.forEach(function (c) {
        var e = best[c.cents] || (best[c.cents] = { cents: c.cents, sum: 0, votes: 0, kgRef: false, ref: false });
        e.sum += c.score / max; e.votes++; e.kgRef = e.kgRef || c.kgRef; e.ref = e.ref || c.ref;
      });
    });
    var arr = Object.keys(best).map(function (k) { return best[k]; });
    arr.forEach(function (e) { e.total = e.sum * (e.votes > 1 ? 1.6 : 1); });
    arr.sort(function (a, b) { return b.total - a.total; });
    var chosen = arr[0] || null;
    var pick = function (f) { for (var i = 0; i < rs.length; i++) { if (rs[i][f]) return rs[i][f]; } return null; };
    var notes = [];
    if (chosen) {
      if (chosen.ref && !chosen.kgRef) notes.push('El precio elegido parece ser el de referencia por litro o unidad.');
      if (chosen.kgRef) notes.push('Parece un producto al peso (precio por kilo).');
      if (arr.length > 1 && arr[1].total >= chosen.total * 0.75) notes.push('Hay varios precios parecidos: elige el correcto.');
    }
    return {
      name: pick('name'),
      priceCents: chosen ? chosen.cents : null,
      kg: !!(chosen && chosen.kgRef),
      promo: pick('promo'),
      candidates: arr.slice(0, 5).map(function (e) { return e.cents; }),
      scored: [],
      barcode: null,
      note: notes.length ? notes.join(' ') : null
    };
  }

  function detectPromo(lower) {
    var res = [NXM_RE, POR_RE, LLEVA_RE];
    for (var k = 0; k < res.length; k++) {
      var m = res[k].exec(lower);
      if (!m) continue;
      var buy = parseInt(m[1], 10), pay = parseInt(m[2], 10);
      if (buy > pay && pay >= 1) return { type: 'nxm', buy: buy, pay: pay };
    }
    var sa = SECOND_A_RE.exec(lower) || SECOND_B_RE.exec(lower);
    if (sa) {
      var pct = parseFloat(sa[1]);
      if (pct >= 5 && pct <= 90) return { type: 'second', pct: pct };
    }
    var pm = PCT_A_RE.exec(lower) || PCT_B_RE.exec(lower);
    if (pm) {
      var p2 = parseFloat(pm[1]);
      if (p2 >= 5 && p2 <= 90) return { type: 'pct', pct: p2 };
    }
    return null;
  }

  function isNoise(text) {
    var t = text.toLowerCase();
    PRICE_RE.lastIndex = 0;
    if (PRICE_RE.test(t)) return true;
    PRICE_RE.lastIndex = 0;
    if (t.indexOf('€') >= 0 || t.indexOf('%') >= 0) return true;
    if (REF_TAIL_RE.test(t) || NOISE_RE.test(t)) return true;
    if (NXM_RE.test(t) || POR_RE.test(t) || LLEVA_RE.test(t)) return true;
    var letters = (t.match(/[a-záéíóúñü]/g) || []).length;
    if (/^\W*\S?\s?[x×]+\s?\d\W*$/i.test(t.trim())) return true;
    return letters < 3;
  }

  function extractName(lines) {
    var cand = lines.filter(function (l) { return boxH(l.box) > 0 && !isNoise(l.text); });
    if (!cand.length) return null;
    function letters(l) { return Math.min((l.text.match(/[A-Za-zÁÉÍÓÚÑáéíóúñü]/g) || []).length, 18); }
    var best = cand.reduce(function (a, b) { return boxH(b.box) * letters(b) > boxH(a.box) * letters(a) ? b : a; });
    var ordered = cand.slice().sort(function (a, b) { return a.box.top - b.box.top; });
    var idx = ordered.indexOf(best), lo = idx, hi = idx, bh = boxH(best.box);
    while (lo > 0) {
      var a1 = ordered[lo - 1], b1 = ordered[lo];
      if (boxH(a1.box) >= 0.6 * bh && b1.box.top - a1.box.bottom <= 1.5 * bh) lo--; else break;
    }
    while (hi < ordered.length - 1) {
      var a2 = ordered[hi], b2 = ordered[hi + 1];
      if (boxH(b2.box) >= 0.6 * bh && b2.box.top - a2.box.bottom <= 1.5 * bh) hi++; else break;
    }
    var joined = ordered.slice(lo, hi + 1).map(function (l) { return l.text.trim(); }).join(' ');
    var pretty = prettify(joined);
    return pretty ? pretty : null;
  }

  function prettify(s) {
    var t = s.replace(/\s+/g, ' ').trim();
    var letters = t.replace(/[^A-Za-zÁÉÍÓÚÑáéíóúñü]/g, '');
    var upper = letters.replace(/[^A-ZÁÉÍÓÚÑ]/g, '');
    if (letters.length && upper.length >= letters.length * 0.7) {
      t = t.toLowerCase();
      t = t.charAt(0).toUpperCase() + t.slice(1);
    }
    t = t.replace(/([a-záéíóúñü])(\d)/gi, '$1 $2');
    t = t.replace(/(\d)\s?l\b/g, '$1 L');
    return t.slice(0, 80);
  }

  var api = { lineCalc: lineCalc, parseLabel: parseLabel, mergeReadings: mergeReadings, detectPromo: detectPromo };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CC = api;
})(typeof window !== 'undefined' ? window : globalThis);
