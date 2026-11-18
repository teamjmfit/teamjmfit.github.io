const { chromium, devices } = require('playwright');
(async () => { const b = await chromium.launch(); const errs = []; try {
  const ctx = await b.newContext({ ...devices['iPhone 13'] });
  await ctx.addInitScript(() => { try { sessionStorage.setItem('jmfit-web-ok', '1'); localStorage.setItem('jmfit-theme', 'dark'); localStorage.setItem('jmfit-install-off', '1'); localStorage.setItem('jmfit-push-off', '1'); } catch (e) {} });
  await ctx.route(/jsdelivr|gstatic|docs\.google/, r => r.abort());
  const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8765/'); await p.waitForTimeout(3000); await p.getByText(/Reiniciar datos/).click(); await p.waitForTimeout(300);
  await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('jmfit-demo-v1')); s.who = 'client'; s.tables.clients.forEach(c => { c.consent_version = '2026-11-v1'; c.onboarded_at = '2026-11-01'; }); localStorage.setItem('jmfit-demo-v1', JSON.stringify(s)); });
  const go = async (hash) => { await p.goto('http://localhost:8765/' + hash); await p.reload(); await p.waitForTimeout(3500); };
  const openAndShot = async (re, name) => {
    await go('#/progreso');
    const ok = await p.evaluate(re => { const h = [...document.querySelectorAll('.content h3')].find(x => new RegExp(re).test(x.textContent)); if (!h) return false; const sec = h.closest('section'); if (sec.classList.contains('folded') || h.getAttribute('aria-expanded') === 'false') h.click(); return true; }, re);
    await p.waitForTimeout(600);
    await p.evaluate(re => { const h = [...document.querySelectorAll('.content h3')].find(x => new RegExp(re).test(x.textContent)); if (h) { h.closest('section').scrollIntoView(); scrollBy(0, -80); } }, re);
    await p.waitForTimeout(500); await p.screenshot({ path: require('path').join(__dirname, name + '.png') }); console.log(name, ok);
  };
  await openAndShot('Rendimiento por ejercicio', 'rendimiento');
  await openAndShot('Mejores marcas', 'marcas');
  await openAndShot('Peso', 'peso');
} catch (e) { console.log('FAIL', e.message.slice(0, 300)); } console.log('errs', errs); await b.close(); })();
