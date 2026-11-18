// Genera las historias (1080×1920) en ./salida a partir de historias.html. Uso: node render.js [carpeta]
const { chromium } = require('playwright'); const path = require('path'); const fs = require('fs');
(async () => {
  const dir = path.resolve(process.argv[2] || __dirname), out = path.join(dir, 'salida'); fs.mkdirSync(out, { recursive: true });
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  await p.goto('file://' + path.join(dir, 'historias.html')); await p.waitForTimeout(400);
  const n = await p.evaluate(() => window.N);
  for (let i = 0; i < n; i++) {
    await p.goto('file://' + path.join(dir, 'historias.html') + '?n=' + i + '&sticker=0'); await p.waitForTimeout(500);
    await p.locator('.st').screenshot({ path: path.join(out, `historia-${String(i + 1).padStart(2, '0')}.png`) });
  }
  await b.close(); console.log('ok', n);
})();
