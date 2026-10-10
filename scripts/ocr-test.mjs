// Prueba el lector de carteles real (Tesseract) con carteles de ejemplo generados aquí.
// Se ejecuta en GitHub después de montar dist/. Los carteles son sintéticos: sirven para
// detectar roturas y dar una idea del acierto, no sustituyen a probar con carteles reales.
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('dist');
const OUT = path.resolve('scripts/out');
fs.mkdirSync(path.join(OUT, 'labels'), { recursive: true });
fs.mkdirSync(path.join(OUT, 'shots'), { recursive: true });

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.png': 'image/png',
  '.webmanifest': 'application/manifest+json', '.gz': 'application/octet-stream', '.wasm': 'application/wasm'
};
const server = http.createServer((req, res) => {
  let p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (p.endsWith(path.sep)) p += 'index.html';
  fs.readFile(p, (err, buf) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream' });
    res.end(buf);
  });
});
await new Promise((r) => server.listen(4180, r));
const BASE = 'http://localhost:4180/';

// ---------- Carteles de ejemplo ----------
const page0 = (inner, bg, fg) => `<!doctype html><meta charset="utf-8"><body style="margin:0;width:1000px;height:700px;position:relative;overflow:hidden;background:${bg};color:${fg};font-family:Arial,Helvetica,'Liberation Sans',sans-serif">${inner}</body>`;
const abs = (l, t, size, text, extra = '') => `<div style="position:absolute;left:${l}px;top:${t}px;font-size:${size}px;font-weight:700;white-space:nowrap;line-height:1.05;${extra}">${text}</div>`;

const CASES = [
  {
    id: 'A-simple', title: 'Cartel claro con precio grande y precio por litro',
    html: page0(abs(40, 30, 54, 'LECHE ENTERA') + abs(40, 100, 34, 'BRIK 1 L', 'font-weight:400') +
      abs(80, 230, 230, '1,45<span style="font-size:90px"> €</span>') + abs(80, 580, 30, '1,45 €/l', 'font-weight:400'), '#ffffff', '#111'),
    expect: { price: 145, promo: 'Sin oferta', kg: false, name: /leche/i }
  },
  {
    id: 'B-3x2', title: 'Oferta 3x2 con precio anterior tachado',
    html: page0(abs(40, 30, 54, 'YOGUR NATURAL') + abs(40, 100, 34, 'PACK 4 UNIDADES', 'font-weight:400') +
      abs(640, 40, 120, '3x2', 'color:#c0262d') + abs(80, 250, 220, '0,89<span style="font-size:90px"> €</span>') +
      abs(80, 560, 34, 'antes 1,19 €', 'font-weight:400;text-decoration:line-through'), '#ffe45c', '#111'),
    expect: { price: 89, promo: '3x2', kg: false, name: /yogur/i }
  },
  {
    id: 'C-peso', title: 'Producto al peso (precio por kilo)',
    html: page0(abs(40, 30, 54, 'JAMÓN COCIDO EXTRA') + abs(80, 250, 200, '5,99<span style="font-size:80px"> €/kg</span>'), '#ffffff', '#111'),
    expect: { price: 599, promo: 'Sin oferta', kg: true, name: /jam/i }
  },
  {
    id: 'D-inverso', title: 'Letras blancas sobre fondo rojo',
    html: page0(abs(40, 30, 54, 'CAFÉ MOLIDO 250 G') + abs(80, 250, 230, '2,35<span style="font-size:90px"> €</span>'), '#b3122a', '#ffffff'),
    expect: { price: 235, promo: 'Sin oferta', kg: false, name: /caf/i }
  },
  {
    id: 'F-segunda', title: '2ª unidad al 50%',
    html: page0(abs(40, 30, 54, 'GALLETAS MARÍA') + abs(40, 110, 60, '2ª unidad al 50%', 'color:#c0262d') +
      abs(80, 250, 220, '1,10<span style="font-size:90px"> €</span>'), '#ffffff', '#111'),
    expect: { price: 110, promo: '2ª unidad', kg: false, name: /gallet/i }
  },
  {
    id: 'E-partido', title: 'Precio partido: euros grandes y céntimos pequeños (informativo)', info: true,
    html: page0(abs(40, 30, 54, 'ACEITE DE OLIVA VIRGEN EXTRA 1 L') + abs(120, 200, 330, '1') + abs(330, 220, 130, '45', 'top:225px') +
      abs(500, 330, 70, '€'), '#ffffff', '#111'),
    expect: { price: 145, promo: 'Sin oferta', kg: false, name: /aceite/i }
  },
  {
    id: 'G-descuento', title: 'Descuento -20% con precio anterior y precio ahora (informativo)', info: true,
    html: page0(abs(40, 30, 54, 'DETERGENTE LÍQUIDO') + abs(640, 40, 110, '-20%', 'color:#c0262d') +
      abs(80, 200, 54, 'antes 2,50 €', 'font-weight:400;text-decoration:line-through') + abs(80, 300, 230, '2,00<span style="font-size:90px"> €</span>'), '#ffffff', '#111'),
    expect: { price: 200, promo: '% dto.', kg: false, name: /deterg/i }
  }
];

const browser = await chromium.launch();

// Generar los carteles como imágenes
const rctx = await browser.newContext({ viewport: { width: 1000, height: 700 } });
const rpage = await rctx.newPage();
for (const c of CASES) {
  await rpage.setContent(c.html);
  c.png = await rpage.screenshot({ type: 'png' });
  fs.writeFileSync(path.join(OUT, 'labels', c.id + '.png'), c.png);
}
await rctx.close();

// ---------- Prueba en la app ----------
const ctx = await browser.newContext({ viewport: { width: 400, height: 820 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(BASE);
await page.click('#demoClear');

async function readCase(c, tag) {
  const t0 = Date.now();
  await page.setInputFiles('#camera', { name: c.id + '.png', mimeType: 'image/png', buffer: c.png });
  await page.waitForFunction(
    () => /Leído del cartel|Precio recordado|No he podido leer|No se pudo leer/.test(document.getElementById('readStatus').textContent),
    null, { timeout: 240000 }
  );
  const got = {
    name: await page.inputValue('#fName'),
    price: await page.inputValue('#fPrice'),
    promo: (await page.locator('#promoChips .pchip[aria-pressed="true"]').first().textContent()).trim(),
    kg: (await page.locator('#unitSeg button[aria-pressed="true"]').getAttribute('data-unit')) === 'kg',
    status: (await page.textContent('#readStatus')).trim(),
    candidates: await page.locator('#cands button').allTextContents(),
    raw: await page.evaluate(() => window.__ccLast || null),
    secs: Math.round((Date.now() - t0) / 100) / 10
  };
  await page.screenshot({ path: path.join(OUT, 'shots', `${tag}-${c.id}.png`) });
  await page.click('#itemClose');
  return got;
}
function judge(c, got) {
  const priceCents = Math.round(parseFloat(got.price.replace(',', '.')) * 100);
  const problems = [];
  if (priceCents !== c.expect.price) problems.push(`precio ${got.price || '(vacío)'} en vez de ${(c.expect.price / 100).toFixed(2).replace('.', ',')}`);
  if (got.promo !== c.expect.promo) problems.push(`oferta "${got.promo}" en vez de "${c.expect.promo}"`);
  if (got.kg !== c.expect.kg) problems.push(`al peso ${got.kg} en vez de ${c.expect.kg}`);
  if (!c.expect.name.test(got.name)) problems.push(`nombre "${got.name}"`);
  return problems;
}

const rows = [];
let hardFails = 0;
for (const c of CASES) {
  let got, problems;
  try { got = await readCase(c, 'online'); problems = judge(c, got); }
  catch (e) { got = { name: '', price: '', promo: '', kg: false, status: 'ERROR: ' + String(e).slice(0, 120), candidates: [], secs: 0 }; problems = ['no terminó la lectura']; }
  const ok = problems.length === 0;
  if (!ok && !c.info) hardFails++;
  rows.push({ id: c.id, title: c.title, info: !!c.info, ok, got, problems });
  console.log(`${ok ? 'OK  ' : c.info ? 'info' : 'FAIL'} ${c.id}  nombre="${got.name}" precio=${got.price} oferta=${got.promo} kg=${got.kg} (${got.secs}s)${ok ? '' : '  -> ' + problems.join('; ')}`);
}

// ---------- Instalable y sin conexión ----------
const checks = [];
const check = (name, ok, extra = '') => { checks.push({ name, ok, extra }); console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${extra ? '  ' + extra : ''}`); if (!ok) hardFails++; };

const manifest = await (await fetch(BASE + 'manifest.webmanifest')).json();
check('manifest con nombre, inicio y modo app', !!manifest.name && manifest.start_url === './' && manifest.display === 'standalone');
for (const icon of manifest.icons) {
  const r = await fetch(BASE + icon.src);
  check('icono ' + icon.src, r.ok && /png/.test(r.headers.get('content-type') || ''));
}
await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 30000 }).catch(() => {});
check('service worker activo y controlando la página', await page.evaluate(() => !!navigator.serviceWorker.controller));

// El motor ya se ha usado: sus archivos deben estar en la copia guardada
const cached = await page.evaluate(async () => {
  const names = await caches.keys();
  const out = [];
  for (const n of names) { const c = await caches.open(n); for (const k of await c.keys()) out.push(new URL(k.url).pathname); }
  return out;
});
check('lector y datos de español guardados para usar sin conexión',
  cached.some((u) => u.includes('/vendor/lang/spa.traineddata')) && cached.some((u) => u.includes('/vendor/core/')) && cached.some((u) => u.includes('worker.min.js')),
  `${cached.length} archivos guardados`);

// Apagar el servidor de verdad: lo que cargue a partir de aquí sale de la copia guardada
server.closeAllConnections();
await new Promise((r) => server.close(r));
await page.reload();
check('la app abre sin conexión', await page.isVisible('#btnPhoto'));
let offline = null;
try { offline = await readCase(CASES[0], 'offline'); } catch (e) { offline = { price: '', name: '', status: String(e).slice(0, 100) }; }
const offOk = offline && Math.round(parseFloat((offline.price || '0').replace(',', '.')) * 100) === 145;
check('lee un cartel sin conexión', offOk, `precio=${offline.price} nombre="${offline.name}"`);
check('sin errores de página', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();

// ---------- Informe ----------
const pass = rows.filter((r) => r.ok && !r.info).length, total = rows.filter((r) => !r.info).length;
let md = `## Prueba del lector de carteles\n\n**${pass} de ${total} carteles de ejemplo bien leídos** (los marcados como informativos no cuentan).\n\n`;
md += '| Cartel | Resultado | Leído (nombre / precio / oferta) | Segundos |\n|---|---|---|---|\n';
for (const r of rows) md += `| ${r.id}${r.info ? ' (info)' : ''} | ${r.ok ? 'correcto' : 'fallo: ' + r.problems.join('; ')} | ${r.got.name || '-'} / ${r.got.price || '-'} / ${r.got.promo || '-'} | ${r.got.secs} |\n`;
md += '\n### Texto leído por pasada\n\n';
for (const r of rows) for (const ps of (r.got.raw || [])) md += `- ${r.id} (${ps.label}): ${ps.text.replace(/\|/g, '/')}  [precio ${ps.price}, oferta ${ps.promo ? JSON.stringify(ps.promo) : '-'}]\n`;
md += '\n### Instalación y modo sin conexión\n\n';
for (const c of checks) md += `- ${c.ok ? 'correcto' : 'FALLO'}: ${c.name}${c.extra ? ' (' + c.extra + ')' : ''}\n`;
fs.writeFileSync(path.join(OUT, 'report.md'), md);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
console.log('\n' + md);
process.exit(hardFails ? 1 : 0);
