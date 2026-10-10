/* Cuenta Carro (web instalable). Todo ocurre en el móvil: no se envía ninguna foto a ningún servidor. */
(function () {
  'use strict';

  var CC = window.CC;
  var $ = function (id) { return document.getElementById(id); };
  var FMT = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' });
  var QFMT = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 3 });
  var money = function (c) { return FMT.format(c / 100); };
  var limitText = function (c) { return c % 100 === 0 ? (c / 100) + ' €' : money(c); };
  var centsText = function (c) { return (Math.floor(c / 100)) + ',' + ('0' + (c % 100)).slice(-2); };
  function num(s) {
    var n = parseFloat(String(s == null ? '' : s).replace(/\s/g, '').replace(',', '.'));
    return isFinite(n) ? n : NaN;
  }
  function numStr(n) { return String(n).replace('.', ','); }
  function h(tag, props) {
    var e = document.createElement(tag);
    var p = props || {};
    Object.keys(p).forEach(function (k) {
      var v = p[k];
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k.indexOf('on') === 0) e.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v);
    });
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      if (c == null || c === false) continue;
      e.append(c.nodeType ? c : document.createTextNode(c));
    }
    return e;
  }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  // ---------- Estado y almacenamiento ----------
  var KEY = 'cuentacarro.v2';
  var KNOWN_KEY = 'cuentacarro.known.v1';

  function demoItems() {
    return [
      { id: uid(), name: 'Leche entera 1 L', cents: 89, qty: 6, kg: false, promo: null, prev: 85 },
      { id: uid(), name: 'Yogur natural, pack de 4', cents: 145, qty: 3, kg: false, promo: { type: 'nxm', buy: 3, pay: 2 }, prev: null },
      { id: uid(), name: 'Aceite de oliva virgen extra 1 L', cents: 895, qty: 1, kg: false, promo: null, prev: 949 },
      { id: uid(), name: 'Tomate frito 400 g', cents: 110, qty: 2, kg: false, promo: { type: 'second', pct: 50 }, prev: null },
      { id: uid(), name: 'Tomate de ensalada', cents: 249, qty: 0.8, kg: true, promo: null, prev: null }
    ];
  }
  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) {
        var s = JSON.parse(raw);
        if (s && Array.isArray(s.items)) {
          return {
            limit: (typeof s.limit === 'number' && s.limit > 0) ? s.limit : null,
            items: s.items.filter(function (it) { return it && typeof it.name === 'string' && isFinite(it.cents) && isFinite(it.qty) && it.qty > 0; }),
            ticket: typeof s.ticket === 'string' ? s.ticket : '',
            demo: !!s.demo
          };
        }
      }
    } catch (e) { /* sin almacenamiento: la lista vive mientras la página esté abierta */ }
    return { limit: 7000, items: demoItems(), ticket: '', demo: true };
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* nada */ } }
  function recall(code) {
    try { var all = JSON.parse(localStorage.getItem(KNOWN_KEY) || '{}'); return all[code] || null; } catch (e) { return null; }
  }
  function remember(code, name, cents, kg) {
    try {
      var all = JSON.parse(localStorage.getItem(KNOWN_KEY) || '{}');
      all[code] = { n: name, c: cents, k: !!kg };
      localStorage.setItem(KNOWN_KEY, JSON.stringify(all));
    } catch (e) { /* nada */ }
  }

  var state = load();
  var prevOver = false;

  function totals() {
    var gross = 0, net = 0, units = 0;
    state.items.forEach(function (it) {
      var c = CC.lineCalc(it);
      gross += c.gross; net += c.net;
      units += it.kg ? 1 : it.qty;
    });
    return { gross: gross, net: net, save: gross - net, units: units, lines: state.items.length };
  }

  // ---------- Pantalla principal ----------
  function promoLabel(pr) {
    if (!pr) return '';
    if (pr.type === 'nxm') return pr.buy + 'x' + pr.pay;
    if (pr.type === 'second') return '2ª al ' + QFMT.format(pr.pct) + '%';
    return '−' + QFMT.format(pr.pct) + '%';
  }
  function changeQty(id, dir) {
    var idx = state.items.findIndex(function (x) { return x.id === id; });
    if (idx < 0) return;
    var it = state.items[idx];
    var st = it.kg ? 0.1 : 1;
    var q = Math.round((it.qty + dir * st) * 1000) / 1000;
    if (q < st - 1e-9) { removeItem(id); return; }
    it.qty = q;
    commit(true);
  }
  function removeItem(id) {
    var idx = state.items.findIndex(function (x) { return x.id === id; });
    if (idx < 0) return;
    var removed = state.items.splice(idx, 1)[0];
    commit(true);
    toast('Producto eliminado', 'Deshacer', function () {
      state.items.splice(Math.min(idx, state.items.length), 0, removed);
      commit(true);
    });
  }
  function renderList() {
    var ul = $('list');
    ul.textContent = '';
    state.items.forEach(function (it) {
      var c = CC.lineCalc(it);
      var meta = it.kg
        ? QFMT.format(it.qty) + ' kg × ' + money(it.cents) + '/kg'
        : QFMT.format(it.qty) + ' × ' + money(it.cents);
      var prevLine = null;
      if (it.prev != null && it.prev !== it.cents) {
        var diff = it.cents - it.prev;
        prevLine = h('span', {
          class: 'ln-prev ' + (diff > 0 ? 'up' : 'down'),
          text: (diff > 0 ? '▲ +' : '▼ −') + money(Math.abs(diff)) + ' (antes ' + money(it.prev) + ')'
        });
      }
      ul.append(h('li', { class: 'line' },
        h('button', { class: 'line-main', type: 'button', 'aria-label': 'Editar ' + it.name, onclick: function () { openItem(it.id); } },
          h('span', { class: 'ln-name', text: it.name }),
          h('span', { class: 'ln-meta' }, meta, it.promo ? h('span', { class: 'tag', text: promoLabel(it.promo) }) : null),
          prevLine),
        h('div', { class: 'ln-amt' },
          h('span', { class: 'ln-total', text: money(c.net) }),
          c.save > 0 ? h('span', { class: 'ln-save', text: '−' + money(c.save) }) : null),
        h('div', { class: 'ln-step' },
          h('button', { type: 'button', 'aria-label': 'Quitar una de ' + it.name, text: '−', onclick: function () { changeQty(it.id, -1); } }),
          h('span', { class: 'q', text: QFMT.format(it.qty) + (it.kg ? ' kg' : '') }),
          h('button', { type: 'button', 'aria-label': 'Añadir una de ' + it.name, text: '+', onclick: function () { changeQty(it.id, 1); } }))
      ));
    });
    ul.hidden = state.items.length === 0;
    $('empty').hidden = state.items.length !== 0;
    $('demoNote').hidden = !state.demo;
  }
  function renderBar() {
    var t = totals();
    $('barTotal').textContent = money(t.net);
    var bar = $('bar');
    if (state.limit == null) {
      bar.dataset.state = 'none';
      $('barLimit').textContent = 'Sin tope';
      $('barRemain').textContent = '';
      $('limitChip').textContent = 'Sin tope';
      $('limitChip').dataset.over = 'false';
      $('barFill').style.width = '0%';
      return;
    }
    var ratio = t.net / state.limit;
    var over = t.net > state.limit;
    bar.dataset.state = over ? 'over' : (ratio >= 0.9 ? 'warn' : 'ok');
    $('barLimit').textContent = 'Tope ' + limitText(state.limit);
    $('barRemain').textContent = over ? 'Te pasas ' + money(t.net - state.limit) : 'Te quedan ' + money(state.limit - t.net);
    $('barFill').style.width = Math.min(100, Math.max(0, ratio * 100)) + '%';
    $('limitChip').textContent = 'Tope ' + limitText(state.limit);
    $('limitChip').dataset.over = String(over);
  }
  function renderSummary() {
    var t = totals();
    $('sTotal').textContent = money(t.net);
    $('sGross').textContent = money(t.gross);
    $('sSave').textContent = t.save > 0 ? '−' + money(t.save) : money(0);
    $('sCount').textContent = t.lines + (t.lines === 1 ? ' producto' : ' productos') + ' · ' + QFMT.format(Math.round(t.units * 10) / 10) + ' uds';
    var res = $('ticketResult');
    var tk = num($('fTicket').value);
    if (isFinite(tk) && tk >= 0 && $('fTicket').value.trim() !== '') {
      var diff = Math.round(tk * 100) - t.net;
      res.hidden = false;
      if (diff === 0) { res.className = 'result ok'; res.textContent = 'El ticket coincide con tu total.'; }
      else {
        res.className = 'result diff';
        res.textContent = 'El ticket es ' + money(Math.abs(diff)) + (diff > 0 ? ' más alto' : ' más bajo') + ' que tu total. Revisa las ofertas y las cantidades.';
      }
    } else { res.hidden = true; }
  }
  function render() { renderList(); renderBar(); if (openSheetEl === $('sumSheet')) renderSummary(); }

  function checkOver(user) {
    var over = state.limit != null && totals().net > state.limit;
    if (over && !prevOver && user) {
      $('overText').textContent = 'Has superado tu tope de ' + limitText(state.limit) + '. Llevas ' + money(totals().net) + '.';
      $('overBanner').hidden = false;
      try { if (navigator.vibrate) navigator.vibrate([180, 90, 180]); } catch (e) { /* sin vibración */ }
    }
    if (!over) $('overBanner').hidden = true;
    prevOver = over;
  }
  function commit(user) { save(); render(); checkOver(!!user); }

  // ---------- Aviso con deshacer ----------
  var toastTimer = null;
  function toast(msg, label, fn) {
    $('toastMsg').textContent = msg;
    var b = $('toastAct');
    b.textContent = label || '';
    b.hidden = !label;
    b.onclick = function () { hideToast(); if (fn) fn(); };
    $('toast').hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, 6000);
  }
  function hideToast() { $('toast').hidden = true; clearTimeout(toastTimer); }

  // ---------- Hojas ----------
  var openSheetEl = null, lastFocus = null;
  function openSheet(el) {
    lastFocus = document.activeElement;
    if (openSheetEl) openSheetEl.hidden = true;
    $('scrim').hidden = false;
    el.hidden = false;
    document.documentElement.classList.add('lock');
    openSheetEl = el;
  }
  function closeSheet() {
    if (!openSheetEl) return;
    if (openSheetEl === $('itemSheet')) cancelReading();
    openSheetEl.hidden = true;
    $('scrim').hidden = true;
    document.documentElement.classList.remove('lock');
    openSheetEl = null;
    if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch (e) { /* nada */ } }
  }
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeSheet(); });
  $('scrim').addEventListener('click', closeSheet);
  $('itemClose').addEventListener('click', closeSheet);
  $('sumClose').addEventListener('click', closeSheet);

  // ---------- Formulario de producto ----------
  var PROMOS = [
    { k: 'none', t: 'Sin oferta' },
    { k: '2x1', t: '2x1', ud: true },
    { k: '3x2', t: '3x2', ud: true },
    { k: 'second', t: '2ª unidad', ud: true },
    { k: 'pct', t: '% dto.' },
    { k: 'nxm', t: 'Otra NxM', ud: true }
  ];
  var F = blankForm();
  function blankForm() {
    return { id: null, kg: false, promoKey: 'none', prev: null, prevKg: false, barcode: null, candidates: [], touched: {} };
  }

  function buildChips() {
    var box = $('promoChips');
    box.textContent = '';
    PROMOS.forEach(function (p) {
      box.append(h('button', {
        type: 'button', class: 'pchip', 'data-k': p.k, 'aria-pressed': 'false', text: p.t,
        onclick: function () { setPromoKey(p.k, true); }
      }));
    });
  }
  function setPromoKey(k, byUser) {
    F.promoKey = k;
    if (byUser) F.touched.promo = true;
    if (byUser && k === 'second' && !F.touched.pct) $('fPct').value = '50';
    if (byUser && k === 'pct' && !F.touched.pct) $('fPct').value = '10';
    syncForm();
  }
  function setUnit(kg, byUser) {
    F.kg = kg;
    if (byUser) F.touched.unit = true;
    var q = num($('fQty').value);
    if (kg) {
      if (F.promoKey !== 'none' && F.promoKey !== 'pct') F.promoKey = 'none';
      if (byUser && (!isFinite(q) || q >= 1) && !F.touched.qty) $('fQty').value = '0,5';
    } else if (isFinite(q) && q > 0 && q !== Math.floor(q)) {
      $('fQty').value = String(Math.max(1, Math.round(q)));
    }
    syncForm();
  }
  function promoFromForm() {
    var k = F.promoKey;
    if (k === '3x2') return { type: 'nxm', buy: 3, pay: 2 };
    if (k === '2x1') return { type: 'nxm', buy: 2, pay: 1 };
    if (k === 'nxm') {
      var b = Math.round(num($('fBuy').value)), p = Math.round(num($('fPay').value));
      return (b >= 2 && p >= 1 && p < b) ? { type: 'nxm', buy: b, pay: p } : null;
    }
    if (k === 'second' || k === 'pct') {
      var v = num($('fPct').value);
      return (v > 0 && v <= 100) ? { type: k, pct: v } : null;
    }
    return null;
  }
  function keyFromPromo(pr) {
    if (!pr) return 'none';
    if (pr.type === 'nxm') return (pr.buy === 3 && pr.pay === 2) ? '3x2' : (pr.buy === 2 && pr.pay === 1) ? '2x1' : 'nxm';
    return pr.type;
  }
  function draft() {
    var price = num($('fPrice').value);
    var qty = num($('fQty').value);
    if (!F.kg && isFinite(qty)) qty = Math.max(1, Math.round(qty));
    var name = $('fName').value.trim();
    var valid = name.length > 0 && price > 0 && price < 10000 && qty > 0 && qty < 1000;
    var pr = promoFromForm();
    if (F.kg && pr && pr.type !== 'pct') pr = null;
    return {
      valid: valid, name: name,
      cents: isFinite(price) ? Math.round(price * 100) : 0,
      qty: isFinite(qty) ? qty : 0,
      kg: F.kg, promo: pr
    };
  }
  function hintFor(d) {
    var pr = d.promo;
    if (!pr) return d.kg ? 'Precio por kilo: indica los kilos que vas a llevar.' : '';
    if (pr.type === 'nxm' && !d.kg) {
      if (d.qty < pr.buy) return 'Con ' + pr.buy + ' unidades pagas ' + pr.pay + '.';
      var g = Math.floor(d.qty / pr.buy);
      return 'Pagas ' + (g * pr.pay + (d.qty - g * pr.buy)) + ' de ' + d.qty + ' unidades.';
    }
    if (pr.type === 'second' && !d.kg) {
      if (d.qty < 2) return 'Con 2 unidades, la segunda lleva un ' + QFMT.format(pr.pct) + '% de descuento.';
      var pairs = Math.floor(d.qty / 2);
      return pairs + (pairs === 1 ? ' segunda unidad' : ' segundas unidades') + ' con ' + QFMT.format(pr.pct) + '% de descuento.';
    }
    if (pr.type === 'pct') return 'Descuento del ' + QFMT.format(pr.pct) + '% sobre el importe.';
    return '';
  }
  function syncForm() {
    $('unitSeg').querySelectorAll('button').forEach(function (b) { b.setAttribute('aria-pressed', String((b.dataset.unit === 'kg') === F.kg)); });
    $('priceLabel').textContent = F.kg ? 'Precio por kilo' : 'Precio';
    $('promoChips').querySelectorAll('.pchip').forEach(function (b) {
      var def = PROMOS.find(function (p) { return p.k === b.dataset.k; });
      b.hidden = F.kg && def.ud;
      b.setAttribute('aria-pressed', String(b.dataset.k === F.promoKey));
    });
    var showPct = F.promoKey === 'pct' || F.promoKey === 'second';
    $('extraPct').hidden = !showPct;
    $('pctLabel').textContent = F.promoKey === 'second' ? 'Descuento en la 2ª unidad (%)' : 'Descuento (%)';
    $('extraNxm').hidden = F.promoKey !== 'nxm';
    var d = draft();
    var c = d.valid ? CC.lineCalc(d) : { net: 0, save: 0 };
    $('pvTotal').textContent = money(c.net);
    var sv = $('pvSave');
    sv.hidden = !(c.save > 0);
    sv.textContent = c.save > 0 ? 'Ahorras ' + money(c.save) + ' con la oferta' : '';
    $('pvHint').textContent = d.valid || d.qty > 0 ? hintFor(d) : '';
    $('fSave').disabled = !d.valid;

    // Cambio de precio respecto a la última vez
    var pv = $('pvPrev');
    if (F.prev != null && F.prevKg === F.kg && d.cents > 0 && d.cents !== F.prev) {
      var diff = d.cents - F.prev;
      pv.hidden = false;
      pv.className = 'pv-prev ' + (diff > 0 ? 'up' : 'down');
      pv.textContent = (diff > 0 ? '▲ Sube ' : '▼ Baja ') + money(Math.abs(diff)) + ' respecto a la última vez (' + money(F.prev) + ')';
    } else { pv.hidden = true; }

    // Precios encontrados en el cartel
    var box = $('candsBox');
    if (F.candidates.length > 1) {
      box.hidden = false;
      var cont = $('cands');
      cont.textContent = '';
      F.candidates.forEach(function (c2) {
        cont.append(h('button', {
          type: 'button', 'aria-pressed': String(d.cents === c2), text: money(c2),
          onclick: function () { $('fPrice').value = centsText(c2); F.touched.price = true; syncForm(); }
        }));
      });
    } else { box.hidden = true; }
  }

  function openItem(id, opts) {
    opts = opts || {};
    var it = id ? state.items.find(function (x) { return x.id === id; }) : null;
    F = blankForm();
    if (it) {
      F.id = it.id; F.kg = it.kg; F.promoKey = keyFromPromo(it.promo);
      F.prev = it.prev == null ? null : it.prev; F.prevKg = it.kg;
    }
    $('itemTitle').textContent = it ? 'Editar producto' : 'Nuevo producto';
    $('fName').value = it ? it.name : '';
    $('fPrice').value = it ? centsText(it.cents) : '';
    $('fQty').value = it ? numStr(it.qty) : '1';
    $('fPct').value = it && it.promo && it.promo.pct ? numStr(it.promo.pct) : '';
    $('fBuy').value = it && it.promo && it.promo.type === 'nxm' ? String(it.promo.buy) : '4';
    $('fPay').value = it && it.promo && it.promo.type === 'nxm' ? String(it.promo.pay) : '3';
    $('fSave').textContent = it ? 'Guardar cambios' : 'Añadir a la lista';
    $('fDelete').hidden = !it;
    $('readRow').hidden = !opts.photo;
    $('readProgress').hidden = true;
    openSheet($('itemSheet'));
    syncForm();
    if (!opts.photo && !it) setTimeout(function () { $('fName').focus(); }, 60);
    else $('itemSheet').focus();
  }
  ['fName', 'fPrice', 'fQty', 'fPct', 'fBuy', 'fPay'].forEach(function (id) {
    $(id).addEventListener('input', function () {
      if (id === 'fName') F.touched.name = true;
      if (id === 'fPrice') F.touched.price = true;
      if (id === 'fQty') F.touched.qty = true;
      if (id === 'fPct') F.touched.pct = true;
      syncForm();
    });
  });
  $('fName').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); $('fPrice').focus(); } });
  $('fQty').addEventListener('blur', function () {
    var q = num($('fQty').value);
    if (isFinite(q) && q > 0) {
      if (!F.kg) q = Math.max(1, Math.round(q));
      $('fQty').value = numStr(Math.round(q * 1000) / 1000);
    }
    syncForm();
  });
  $('unitSeg').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-unit]');
    if (b) setUnit(b.dataset.unit === 'kg', true);
  });
  function bumpQty(dir) {
    var step = F.kg ? 0.1 : 1;
    var q = num($('fQty').value);
    if (!isFinite(q)) q = 0;
    q = Math.round((q + dir * step) * 1000) / 1000;
    if (q < step) q = step;
    $('fQty').value = numStr(q);
    F.touched.qty = true;
    syncForm();
  }
  $('qMinus').addEventListener('click', function () { bumpQty(-1); });
  $('qPlus').addEventListener('click', function () { bumpQty(1); });

  $('fSave').addEventListener('click', function () {
    var d = draft();
    if (!d.valid) return;
    var prev = (F.prev != null && F.prevKg === d.kg && F.prev !== d.cents) ? F.prev : null;
    var item = { id: F.id || uid(), name: d.name, cents: d.cents, qty: d.qty, kg: d.kg, promo: d.promo, prev: prev };
    if (F.id) {
      var i = state.items.findIndex(function (x) { return x.id === F.id; });
      if (i >= 0) state.items[i] = item;
    } else {
      if (state.demo) { state.items = []; state.demo = false; }
      state.items.unshift(item);
    }
    if (F.barcode) remember(F.barcode, item.name, item.cents, item.kg);
    closeSheet();
    commit(true);
  });
  $('fDelete').addEventListener('click', function () {
    var id = F.id;
    closeSheet();
    if (id) removeItem(id);
  });

  // ---------- Lectura del cartel (en el móvil) ----------
  var engine = { state: 'idle', worker: null, promise: null };

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = function () { reject(new Error('No se pudo cargar ' + src)); };
      document.head.append(s);
    });
  }
  function abs(path) { return new URL(path, location.href).href; }

  var progressCb = null;
  function getWorker() {
    if (engine.promise) return engine.promise;
    engine.state = 'loading';
    showEngineNote();
    engine.promise = (async function () {
      if (!window.Tesseract) await loadScript('vendor/tesseract.min.js');
      var w = await window.Tesseract.createWorker('spa', 1, {
        workerPath: abs('vendor/worker.min.js'),
        corePath: abs('vendor/core'),
        langPath: abs('vendor/lang'),
        gzip: true,
        cacheMethod: 'none',
        logger: function (m) { if (progressCb && m && m.status === 'recognizing text') progressCb(m.progress || 0); }
      });
      await w.setParameters({ tessedit_pageseg_mode: '11', preserve_interword_spaces: '1' });
      engine.worker = w;
      engine.state = 'ready';
      showEngineNote();
      return w;
    })().catch(function (e) {
      engine.state = 'failed';
      engine.promise = null;
      showEngineNote();
      throw e;
    });
    return engine.promise;
  }
  function showEngineNote() {
    var n = $('engineNote');
    if (engine.state === 'loading') {
      n.hidden = false;
      n.textContent = 'Preparando el lector de carteles. Solo tarda la primera vez.';
    } else if (engine.state === 'failed') {
      n.hidden = false;
      n.textContent = 'El lector de carteles no está disponible ahora. Añade los productos a mano o prueba con conexión.';
    } else {
      n.hidden = true;
    }
  }

  function prepCanvases(bitmap) {
    var maxSide = 1800;
    var s = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    var w = Math.max(1, Math.round(bitmap.width * s)), hh = Math.max(1, Math.round(bitmap.height * s));
    var c = document.createElement('canvas');
    c.width = w; c.height = hh;
    var ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0, w, hh);
    var img = ctx.getImageData(0, 0, w, hh);
    var d = img.data, n = w * hh, hist = new Uint32Array(256), i;
    for (i = 0; i < n; i++) {
      var g = (d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114) | 0;
      d[i * 4] = g; hist[g]++;
    }
    var lo = 0, hi = 255, acc = 0;
    for (i = 0; i < 256; i++) { acc += hist[i]; if (acc >= n * 0.02) { lo = i; break; } }
    acc = 0;
    for (i = 255; i >= 0; i--) { acc += hist[i]; if (acc >= n * 0.02) { hi = i; break; } }
    if (hi - lo < 40) { lo = Math.max(0, lo - 20); hi = Math.min(255, hi + 20); }
    var scale = 255 / Math.max(1, hi - lo);
    var normal = document.createElement('canvas'), inverted = document.createElement('canvas');
    normal.width = inverted.width = w; normal.height = inverted.height = hh;
    var nctx = normal.getContext('2d'), ictx = inverted.getContext('2d');
    var nimg = nctx.createImageData(w, hh), iimg = ictx.createImageData(w, hh);
    for (i = 0; i < n; i++) {
      var v = Math.max(0, Math.min(255, ((d[i * 4] - lo) * scale) | 0));
      nimg.data[i * 4] = nimg.data[i * 4 + 1] = nimg.data[i * 4 + 2] = v; nimg.data[i * 4 + 3] = 255;
      iimg.data[i * 4] = iimg.data[i * 4 + 1] = iimg.data[i * 4 + 2] = 255 - v; iimg.data[i * 4 + 3] = 255;
    }
    nctx.putImageData(nimg, 0, 0);
    ictx.putImageData(iimg, 0, 0);
    return { color: c, normal: normal, inverted: inverted };
  }

  function flatten(data) {
    var raw = data.lines;
    if (!raw && data.blocks) {
      raw = [];
      data.blocks.forEach(function (b) {
        (b.paragraphs || []).forEach(function (p) { (p.lines || []).forEach(function (l) { raw.push(l); }); });
      });
    }
    return (raw || []).filter(function (l) { return l.text && l.text.trim() && l.bbox; }).map(function (l) {
      return {
        text: l.text.replace(/\s+/g, ' ').trim(),
        box: { left: l.bbox.x0, top: l.bbox.y0, right: l.bbox.x1, bottom: l.bbox.y1 },
        elements: (l.words || []).filter(function (w) { return w.bbox; }).map(function (w) {
          return { text: w.text, box: { left: w.bbox.x0, top: w.bbox.y0, right: w.bbox.x1, bottom: w.bbox.y1 } };
        })
      };
    });
  }

  async function detectBarcode(source) {
    try {
      if (!('BarcodeDetector' in window)) return null;
      var det = new window.BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] });
      var res = await det.detect(source);
      return res && res[0] && res[0].rawValue ? res[0].rawValue : null;
    } catch (e) { return null; }
  }

  var photoToken = 0, thumbUrl = null;
  function cancelReading() {
    photoToken++;
    progressCb = null;
    if (thumbUrl) { URL.revokeObjectURL(thumbUrl); thumbUrl = null; }
  }
  function setStatus(msg, kind) {
    var p = $('readStatus');
    p.textContent = msg;
    p.className = kind ? 'st-' + kind : '';
  }
  function setProgress(p) {
    var box = $('readProgress');
    if (p == null) { box.hidden = true; return; }
    box.hidden = false;
    box.firstElementChild.style.width = Math.round(Math.max(0, Math.min(1, p)) * 100) + '%';
  }

  // Lee la foto y devuelve {reading, barcode}. Los tests pueden sustituir el lector.
  async function readFile(file, token) {
    if (typeof window.CC_TEST_READER === 'function') {
      var t = await window.CC_TEST_READER(file);
      return { reading: CC.parseLabel(t.lines), barcode: t.barcode || null };
    }
    var bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    var cv = prepCanvases(bitmap);
    var barcode = await detectBarcode(cv.color);
    if (token !== photoToken) return null;
    setStatus('Leyendo el cartel…', '');
    var worker = await getWorker();
    if (token !== photoToken) return null;
    progressCb = function (p) { if (token === photoToken) setProgress(p); };
    setProgress(0);
    var res = await worker.recognize(cv.normal);
    if (token !== photoToken) return null;
    var reading = CC.parseLabel(flatten(res.data));
    if (reading.priceCents == null) {
      // Cartel con letras claras sobre fondo oscuro: segunda pasada con la imagen invertida
      setStatus('Probando con la imagen invertida…', '');
      var res2 = await worker.recognize(cv.inverted);
      if (token !== photoToken) return null;
      var r2 = CC.parseLabel(flatten(res2.data));
      if (r2.priceCents != null) reading = r2;
      else if (!reading.name && r2.name) reading.name = r2.name;
      if (!reading.promo && r2.promo) reading.promo = r2.promo;
    }
    return { reading: reading, barcode: barcode };
  }

  function applyReading(r, barcode) {
    var rem = barcode ? recall(barcode) : null;
    F.barcode = barcode;
    F.candidates = r.candidates || [];
    var usedMemory = r.priceCents == null && rem != null;
    var name = r.name || (rem ? rem.n : null);
    var cents = r.priceCents != null ? r.priceCents : (rem ? rem.c : null);
    var toKg = r.kg || (r.priceCents == null && rem && rem.k);
    if (name && !F.touched.name) $('fName').value = name;
    if (cents != null && !F.touched.price) $('fPrice').value = centsText(cents);
    if (toKg && !F.touched.unit) {
      F.kg = true;
      if (!F.touched.qty) $('fQty').value = '0,5';
    }
    var pr = r.promo;
    if (pr && !F.touched.promo) {
      if (pr.type === 'nxm' && !F.kg) {
        F.promoKey = (pr.buy === 3 && pr.pay === 2) ? '3x2' : (pr.buy === 2 && pr.pay === 1) ? '2x1' : 'nxm';
        $('fBuy').value = String(pr.buy); $('fPay').value = String(pr.pay);
      } else if (pr.type === 'second' && !F.kg) {
        F.promoKey = 'second'; $('fPct').value = numStr(pr.pct);
      } else if (pr.type === 'pct') {
        F.promoKey = 'pct'; $('fPct').value = numStr(pr.pct);
      }
    }
    F.prev = rem ? rem.c : null;
    F.prevKg = rem ? !!rem.k : false;
    var note = r.note ? ' ' + r.note : '';
    if (name && cents != null) {
      setStatus((usedMemory ? 'Precio recordado de una compra anterior. Compruébalo.' : 'Leído del cartel. Comprueba el precio antes de añadir.') + note, 'ok');
    } else {
      setStatus('No he podido leer todo el cartel. Completa lo que falta.' + note, 'warn');
    }
    syncForm();
  }

  async function handlePhoto(file) {
    openItem(null, { photo: true });
    if (thumbUrl) URL.revokeObjectURL(thumbUrl);
    thumbUrl = URL.createObjectURL(file);
    $('thumb').src = thumbUrl;
    setStatus(engine.state === 'ready' ? 'Leyendo el cartel…' : 'Preparando el lector de carteles…', '');
    setProgress(null);
    var token = ++photoToken;
    try {
      var out = await readFile(file, token);
      if (!out || token !== photoToken) return;
      setProgress(null);
      applyReading(out.reading, out.barcode);
    } catch (e) {
      if (token !== photoToken) return;
      setProgress(null);
      setStatus('No se pudo leer el cartel. Escribe los datos a mano.', 'warn');
    }
  }

  $('btnPhoto').addEventListener('click', function () { $('camera').click(); });
  $('camera').addEventListener('change', function () {
    var f = $('camera').files && $('camera').files[0];
    $('camera').value = '';
    if (f) handlePhoto(f);
  });
  $('btnManual').addEventListener('click', function () { openItem(null); });

  // ---------- Resumen, tope y ticket ----------
  function openSummary() {
    $('fLimit').value = state.limit != null ? numStr(state.limit / 100) : '';
    $('fTicket').value = state.ticket || '';
    $('btnReset').textContent = 'Vaciar lista';
    $('btnReset').dataset.armed = 'false';
    openSheet($('sumSheet'));
    renderSummary();
    $('sumSheet').focus();
  }
  $('barBtn').addEventListener('click', openSummary);
  $('limitChip').addEventListener('click', openSummary);
  $('fLimit').addEventListener('input', function () {
    var v = num($('fLimit').value);
    state.limit = v > 0 && v < 100000 ? Math.round(v * 100) : null;
    commit(true);
  });
  $('limitOff').addEventListener('click', function () {
    state.limit = null;
    $('fLimit').value = '';
    commit(true);
  });
  $('fTicket').addEventListener('input', function () {
    state.ticket = $('fTicket').value;
    save();
    renderSummary();
  });
  var resetTimer = null;
  $('btnReset').addEventListener('click', function () {
    var b = $('btnReset');
    if (b.dataset.armed !== 'true') {
      b.dataset.armed = 'true';
      b.textContent = 'Pulsa otra vez para vaciar';
      clearTimeout(resetTimer);
      resetTimer = setTimeout(function () { b.dataset.armed = 'false'; b.textContent = 'Vaciar lista'; }, 4000);
      return;
    }
    clearTimeout(resetTimer);
    state.items = []; state.demo = false; state.ticket = '';
    closeSheet();
    commit(true);
  });
  $('demoClear').addEventListener('click', function () {
    state.items = []; state.demo = false;
    commit(true);
  });
  $('overOk').addEventListener('click', function () { $('overBanner').hidden = true; });

  // ---------- Instalación y funcionamiento sin conexión ----------
  var installEvent = null;
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    installEvent = e;
    $('btnInstall').hidden = false;
  });
  $('btnInstall').addEventListener('click', async function () {
    if (!installEvent) return;
    installEvent.prompt();
    try { await installEvent.userChoice; } catch (e) { /* nada */ }
    installEvent = null;
    $('btnInstall').hidden = true;
  });
  window.addEventListener('appinstalled', function () { $('btnInstall').hidden = true; });

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () { /* sin modo sin conexión */ });
    });
  }

  // Calienta el lector con la página ya cargada, para que la primera foto no espere
  function warmUp() { if (typeof window.CC_TEST_READER !== 'function') getWorker().catch(function () { /* se avisa en pantalla */ }); }
  window.addEventListener('load', function () { setTimeout(warmUp, 1200); });

  buildChips();
  render();
  prevOver = state.limit != null && totals().net > state.limit;
})();
