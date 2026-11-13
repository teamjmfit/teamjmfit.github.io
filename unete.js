// TEAM JMFIT · página pública de referidos (unete.html?ref=CODIGO). Solo llama a dos funciones públicas y limitadas.
(function () {
  const C = window.JMFIT_CONFIG || {}, url = (C.SUPABASE_URL || '').replace(/\/+$/, ''), key = C.SUPABASE_ANON_KEY;
  const code = (new URLSearchParams(location.search).get('ref') || '').trim().toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 20);
  const rpc = (fn, body) => fetch(`${url}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { apikey: key, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    .then(async r => { const t = await r.text(); const j = t ? JSON.parse(t) : null; if (!r.ok) throw new Error((j && (j.message || j.hint)) || 'Error ' + r.status); return j; });
  const $ = id => document.getElementById(id);
  if (code && url && key) rpc('referral_public', { p_code: code }).then(d => {
    if (!d || !d.name) return;
    const el = $('from'); el.hidden = false;
    el.textContent = ''; el.append('Vienes de parte de ');
    const b = document.createElement('b'); b.textContent = d.name; el.append(b);
    if (d.reward) el.append(' · ' + d.reward);
  }).catch(() => {});
  const f = $('f');
  f.addEventListener('submit', async e => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(f)), err = $('err'); err.textContent = '';
    if (!String(d.name || '').trim() || String(d.contact || '').trim().length < 5) { err.textContent = 'Pon tu nombre y un WhatsApp o correo.'; return; }
    if (!f.consent.checked) { err.textContent = 'Necesito que aceptes la privacidad para poder contactarte.'; return; }
    if (!url || !key) { err.textContent = 'La página no está configurada todavía.'; return; }
    const btn = f.querySelector('button'); btn.disabled = true;
    try {
      await rpc('submit_referral', { p_code: code || null, p_name: d.name, p_contact: d.contact, p_goal: d.goal || null, p_consent: true, p_hp: d.web || null });
      f.hidden = true; $('ok').hidden = false; window.scrollTo(0, 0);
    } catch (x) { err.textContent = x.message || 'No se pudo enviar. Inténtalo de nuevo.'; btn.disabled = false; }
  });
})();
