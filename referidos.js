// TEAM JMFIT · referidos (migración 027): «Invita a un amigo» del cliente y embudo del entrenador.
(function () {
  const U = () => window.JMUI;
  const BASE = location.origin + location.pathname.replace(/[^/]*$/, '') + 'unete.html?ref=';
  const STATES = [['nuevo', 'Nuevo'], ['contactado', 'Contactado'], ['prueba', 'Prueba / llamada'], ['cliente', 'Cliente'], ['perdido', 'Perdido']];
  const LBL = Object.fromEntries(STATES);
  const demoCode = c => (String(c.name || 'AMIGO').split(' ')[0].normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'AMIGO') + '-' + String(c.id || '').replace(/[^A-Z0-9]/gi, '').slice(0, 3).toUpperCase();
  async function texts() {
    const rows = await DB.list('public_texts').catch(() => []);
    const g = k => (rows.find(r => r.key === k) || {}).value || '';
    return { me: g('referral_reward_referrer'), friend: g('referral_reward_friend') };
  }

  // ---------- Cliente
  function card(c) {
    const { ic } = U();
    return `<section class="card ref-card"><div class="row gap"><span class="ref-gift">🎁</span><div class="grow"><b>Invita a un amigo</b><small class="muted">Compártele tu enlace y entrenad juntos en TEAM JMFIT.</small></div>
      <button type="button" class="btn small" data-refopen>${ic('send')} Invitar</button></div></section>`;
  }
  async function open(c) {
    const { esc, ic, toast, modal } = U();
    let code = null, list = [];
    if (DB.mode === 'demo') { code = demoCode(c); list = []; }
    else {
      const r = await DB.get('referral_codes', c.id, 'client_id').catch(() => null); code = r && r.code;
      list = await DB.rpc('my_referrals').catch(() => []) || [];
    }
    if (!code) return toast('Tu código aún no está listo; prueba en unos minutos', 'err');
    const t = await texts(), link = BASE + encodeURIComponent(code);
    const msg = `¡Hola! Estoy entrenando con Jorge en TEAM JMFIT y me está yendo genial 💪 Si te animas, apúntate desde aquí y dile que vienes de mi parte: ${link}`;
    modal('Invita a un amigo', `<div class="ref">
      <p class="ref-code"><small>Tu código</small><b>${esc(code)}</b></p>
      <div class="ref-link"><input readonly value="${esc(link)}" aria-label="Tu enlace"><button type="button" class="btn small" data-copy>${ic('copy')} Copiar</button></div>
      <a class="btn primary block" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(msg)}">${ic('wa')} Compartir por WhatsApp</a>
      ${navigator.share ? `<button type="button" class="btn block" data-share>${ic('send')} Compartir…</button>` : ''}
      ${t.me || t.friend ? `<div class="ref-rw">${t.me ? `<p>🏆 <b>Tú:</b> ${esc(t.me)}</p>` : ''}${t.friend ? `<p>🎉 <b>Tu amigo:</b> ${esc(t.friend)}</p>` : ''}</div>` : ''}
      <h4>Tus invitados</h4>
      ${list.length ? `<ul class="list">${list.map(r => `<li><span class="grow">${esc(r.first_name)}<small>${esc(LBL[r.status] || r.status)}</small></span>${r.status === 'cliente' ? `<span class="pill ${r.reward_status === 'aplicado' ? 'green' : 'amber'}">${r.reward_status === 'aplicado' ? 'premio aplicado' : 'premio pendiente'}</span>` : ''}</li>`).join('')}</ul>` : '<p class="muted small">Todavía nadie se ha apuntado con tu enlace.</p>'}
    </div>`, { submitLabel: 'Cerrar', onSubmit: () => {} });
    const box = document.querySelector('.ref');
    box.querySelector('[data-copy]').onclick = () => { navigator.clipboard && navigator.clipboard.writeText(link).then(() => toast('Enlace copiado', 'ok')).catch(() => {}); };
    const sh = box.querySelector('[data-share]'); if (sh) sh.onclick = () => navigator.share({ text: msg }).catch(() => {});
  }

  // ---------- Entrenador
  async function page(box, clients) {
    const { esc, ic, toast, safe, ago, loading } = U();
    box.innerHTML = loading();
    const [refs, codes, t] = await Promise.all([DB.list('referrals', { order: ['created_at', 'desc'], limit: 500 }).catch(e => { throw e; }), DB.list('referral_codes').catch(() => []), texts()]);
    const name = id => ((clients || []).find(c => c.id === id) || {}).name || '—';
    const cnt = k => refs.filter(r => r.status === k).length, total = refs.length;
    const conv = total ? Math.round(cnt('cliente') / total * 100) : 0;
    const pend = refs.filter(r => r.reward_status === 'pendiente');
    const rank = Object.entries(refs.reduce((a, r) => { if (r.referrer_client_id) { a[r.referrer_client_id] = a[r.referrer_client_id] || { n: 0, ok: 0 }; a[r.referrer_client_id].n++; if (r.status === 'cliente') a[r.referrer_client_id].ok++; } return a; }, {}))
      .sort((a, b) => b[1].ok - a[1].ok || b[1].n - a[1].n).slice(0, 5);
    box.innerHTML = `<div class="stack">
      <section class="card"><h3>Embudo</h3><div class="ref-funnel">${STATES.map(([k, l]) => `<div class="rf rf-${k}"><b>${cnt(k)}</b><small>${l}</small></div>`).join('')}</div>
        <p class="muted small">${total} contacto${total === 1 ? '' : 's'} · conversión ${conv} %. Los que no acaban en cliente se borran solos a los 6 meses.</p></section>
      ${pend.length ? `<section class="card"><h3>🏆 Premios pendientes</h3><ul class="list">${pend.map(r => `<li><span class="grow">${esc(name(r.referrer_client_id))}<small>por traer a ${esc(r.name)}</small></span><button class="btn small" data-rwok="${r.id}">Marcar aplicado</button></li>`).join('')}</ul></section>` : ''}
      <section class="card"><h3>Contactos</h3>${refs.length ? `<ul class="list ref-leads">${refs.map(r => `<li data-r="${r.id}"><span class="grow"><b>${esc(r.name)}</b>${r.goal ? ` · <small>${esc(r.goal)}</small>` : ''}<small>${r.referrer_client_id ? 'De ' + esc(name(r.referrer_client_id)) : 'Sin código'} · ${ago(r.created_at)} · ${esc(r.contact)}</small>${r.notes ? `<small class="ref-note">📝 ${esc(r.notes)}</small>` : ''}</span>
          <select data-st aria-label="Estado">${STATES.map(([k, l]) => `<option value="${k}" ${r.status === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
          ${/^\+?[\d\s]{9,}$/.test(r.contact) ? `<a class="icon-btn sm" target="_blank" rel="noopener" href="https://wa.me/${esc((r.contact.replace(/\D/g, '').length === 9 ? '34' : '') + r.contact.replace(/\D/g, ''))}" title="WhatsApp">${ic('wa')}</a>` : ''}
          <button class="icon-btn sm" data-note title="Nota">${ic('edit')}</button></li>`).join('')}</ul>` : '<p class="empty">Aún no ha llegado nadie por un enlace de referido.</p>'}</section>
      ${rank.length ? `<section class="card"><h3>Quién más recomienda</h3><ol class="ref-rank">${rank.map(([id, o]) => `<li>${esc(name(id))} <small>${o.n} invitado${o.n === 1 ? '' : 's'} · ${o.ok} cliente${o.ok === 1 ? '' : 's'}</small></li>`).join('')}</ol></section>` : ''}
      <section class="card"><h3>Premios</h3><form class="stack" data-rw>
        <label>Qué gana quien recomienda<input name="me" maxlength="160" value="${esc(t.me)}"></label>
        <label>Qué gana el amigo<input name="friend" maxlength="160" value="${esc(t.friend)}"></label>
        <button class="btn small">Guardar premios</button><small class="muted">Lo ven tus clientes en «Invita a un amigo» y el amigo en la página de alta.</small></form>
        <p class="muted small">Códigos creados: ${codes.length}. Cada cliente nuevo recibe el suyo automáticamente.</p></section>
    </div>`;
    const reload = () => page(box, clients);
    box.querySelectorAll('[data-r]').forEach(li => {
      const id = li.dataset.r, r = refs.find(x => x.id === id);
      li.querySelector('[data-st]').onchange = async e => { await safe(() => DB.update('referrals', id, { status: e.target.value }), 'Estado guardado'); reload(); };
      li.querySelector('[data-note]').onclick = () => U().modal('Nota', `<label>Nota sobre ${esc(r.name)}<textarea name="n" rows="3">${esc(r.notes || '')}</textarea></label>`, { onSubmit: async (f, fd) => { await safe(() => DB.update('referrals', id, { notes: String(fd.get('n') || '').trim() || null }), 'Nota guardada'); reload(); } });
    });
    box.querySelectorAll('[data-rwok]').forEach(b => b.onclick = async () => { await safe(() => DB.update('referrals', b.dataset.rwok, { reward_status: 'aplicado' }), 'Premio marcado como aplicado'); reload(); });
    box.querySelector('[data-rw]').onsubmit = async e => {
      e.preventDefault(); const f = e.target;
      await safe(async () => { await DB.upsert('public_texts', { key: 'referral_reward_referrer', value: f.me.value.trim() }, 'key'); await DB.upsert('public_texts', { key: 'referral_reward_friend', value: f.friend.value.trim() }, 'key'); }, 'Premios guardados');
    };
  }
  window.JMRefer = { card, open, page };
})();
