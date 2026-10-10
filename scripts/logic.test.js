const { lineCalc, parseLabel, detectPromo } = require('../web/logic.js');
let fails = 0;
const eq = (name, got, exp) => {
  const ok = JSON.stringify(got) === JSON.stringify(exp);
  if (!ok) fails++;
  console.log((ok ? 'OK   ' : 'FAIL ') + name + (ok ? '' : '  obtenido=' + JSON.stringify(got) + ' esperado=' + JSON.stringify(exp)));
};

// ---- Ofertas ----
const net = (it) => lineCalc(it).net;
eq('sin oferta 6x0,89', net({ cents: 89, qty: 6, kg: false, promo: null }), 534);
eq('3x2 con 3', net({ cents: 145, qty: 3, kg: false, promo: { type: 'nxm', buy: 3, pay: 2 } }), 290);
eq('3x2 con 2 (no aplica)', net({ cents: 145, qty: 2, kg: false, promo: { type: 'nxm', buy: 3, pay: 2 } }), 290);
eq('3x2 con 7', net({ cents: 100, qty: 7, kg: false, promo: { type: 'nxm', buy: 3, pay: 2 } }), 500);
eq('2x1 con 5', net({ cents: 100, qty: 5, kg: false, promo: { type: 'nxm', buy: 2, pay: 1 } }), 300);
eq('2a al 50% con 2', net({ cents: 110, qty: 2, kg: false, promo: { type: 'second', pct: 50 } }), 165);
eq('2a al 70% con 3', net({ cents: 100, qty: 3, kg: false, promo: { type: 'second', pct: 70 } }), 230);
eq('20% dto x2', net({ cents: 500, qty: 2, kg: false, promo: { type: 'pct', pct: 20 } }), 800);
eq('al peso 0,8 kg a 2,49', net({ cents: 249, qty: 0.8, kg: true, promo: null }), 199);
eq('al peso ignora 3x2', net({ cents: 249, qty: 3, kg: true, promo: { type: 'nxm', buy: 3, pay: 2 } }), 747);
eq('al peso con 10%', net({ cents: 1000, qty: 1, kg: true, promo: { type: 'pct', pct: 10 } }), 900);

// ---- Ofertas en texto ----
eq('3x2', detectPromo('oferta 3x2 en lácteos'), { type: 'nxm', buy: 3, pay: 2 });
eq('3X2 mayúscula', detectPromo('3x2'.toUpperCase().toLowerCase()), { type: 'nxm', buy: 3, pay: 2 });
eq('2x1', detectPromo('2x1'), { type: 'nxm', buy: 2, pay: 1 });
eq('lleva 3 paga 2', detectPromo('lleva 3 y paga 2'), { type: 'nxm', buy: 3, pay: 2 });
eq('2ª unidad al 50%', detectPromo('2ª unidad al 50%'), { type: 'second', pct: 50 });
eq('2a unidad 70%', detectPromo('2a unidad 70%'), { type: 'second', pct: 70 });
eq('-20%', detectPromo('ahora -20% dto'), { type: 'pct', pct: 20 });
eq('gramos no son oferta', detectPromo('pack 4x125 g'), null);
eq('sin oferta', detectPromo('leche entera 1 l'), null);

// ---- Carteles ----
const L = (text, left, top, right, bottom, els) => ({
  text, box: { left, top, right, bottom },
  elements: els || text.split(' ').map((t) => ({ text: t, box: { left, top, right, bottom } }))
});

let r = parseLabel([
  L('LECHE ENTERA', 40, 30, 400, 80), L('BRIK 1 L', 40, 85, 250, 130),
  L('1,45 €', 80, 300, 520, 480), L('1,45 €/l', 80, 520, 300, 560)
]);
eq('cartel simple: precio', r.priceCents, 145);
eq('cartel simple: nombre', r.name, 'Leche entera brik 1 L');
eq('cartel simple: sin oferta', r.promo, null);

r = parseLabel([
  L('YOGUR NATURAL PACK 4', 40, 30, 600, 80), L('OFERTA 3x2', 40, 110, 360, 170),
  L('0,89 €', 80, 300, 520, 480), L('antes 1,19 €', 80, 500, 300, 540), L('0,89 €/ud', 80, 560, 260, 590)
]);
eq('3x2: precio', r.priceCents, 89);
eq('3x2: oferta', r.promo, { type: 'nxm', buy: 3, pay: 2 });

r = parseLabel([
  L('JAMÓN COCIDO', 40, 30, 420, 80),
  L('5,99 €/kg', 80, 300, 520, 400), L('0,60 €', 80, 450, 200, 480)
]);
eq('al peso: precio', r.priceCents, 599);
eq('al peso: kg', r.kg, true);

r = parseLabel([
  L('ACEITE DE OLIVA VIRGEN EXTRA', 40, 30, 700, 80),
  L('1', 80, 300, 200, 480), L('45', 210, 300, 290, 380)
]);
eq('precio partido en dos líneas', r.priceCents, 145);

r = parseLabel([
  L('PAN DE MOLDE', 40, 30, 400, 80),
  { text: '2 15', box: { left: 80, top: 300, right: 400, bottom: 480 }, elements: [
    { text: '2', box: { left: 80, top: 300, right: 250, bottom: 480 } },
    { text: '15', box: { left: 260, top: 300, right: 400, bottom: 380 } }] }
]);
eq('precio partido en una línea (2 elementos)', r.priceCents, 215);

r = parseLabel([L('Sin nada útil', 10, 10, 100, 30)]);
eq('sin precio', r.priceCents, null);

// ---- Errores típicos del OCR ----
r = parseLabel([L('JAMÓN COCIDO EXTRA', 40, 30, 400, 80), L('5,99 €lkg', 80, 300, 520, 400)]);
eq('OCR: €lkg es al peso', r.kg, true);
eq('OCR: €lkg precio', r.priceCents, 599);
eq('OCR: 2* unidad al 50%', detectPromo('2* unidad al 50%'), { type: 'second', pct: 50 });
r = parseLabel([L('YOGUR NATURAL', 40, 30, 400, 80), L('I Xx2', 40, 110, 200, 170), L('0,89:', 80, 300, 520, 480)]);
eq('línea corta con dígitos no es nombre', r.name, 'Yogur natural');
r = parseLabel([L('LECHE ENTERA', 40, 30, 400, 80), L('BRIK1L', 40, 85, 250, 130), L('1,45:', 80, 300, 520, 480)]);
eq('letras pegadas a números', r.name, 'Leche entera brik 1 L');

// ---- Unir lecturas ----
const { mergeReadings } = require('../web/logic.js');
const mk = (scored, name, promo) => ({ name, priceCents: scored[0] ? scored[0].cents : null, kg: false, promo: promo || null, candidates: scored.map(c => c.cents), scored, barcode: null, note: null });
let m = mergeReadings([
  mk([{ cents: 239, score: 100, ref: false, kgRef: false }], 'Café', null),
  mk([{ cents: 235, score: 90, ref: false, kgRef: false }, { cents: 239, score: 85, ref: false, kgRef: false }], 'Café', null)
]);
eq('unir: gana el precio que coincide en varias pasadas', m.priceCents, 239);
m = mergeReadings([mk([], null, null), mk([{ cents: 89, score: 50, ref: false, kgRef: false }], 'Yogur', { type: 'nxm', buy: 3, pay: 2 })]);
eq('unir: toma la oferta de la pasada que la vio', m.promo, { type: 'nxm', buy: 3, pay: 2 });
eq('unir: toma el precio de la pasada que lo vio', m.priceCents, 89);

console.log(fails ? `\n${fails} fallos` : '\nTodo correcto');
process.exit(fails ? 1 : 0);
