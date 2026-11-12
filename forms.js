// TEAM JMFIT · respuestas de los formularios de Google (Plan 1:1 y Datos Base y Salud).
// Las envía el script de Google de la copia (al rellenarse un formulario y cada noche). Solo las ve el entrenador.
(function () {
  const FORMS = { plan: 'Plan 1:1', salud: 'Datos Base y Salud' };
  const U = () => window.JMUI;
  const skip = /^(marca temporal|¿has leido la descripción\?)$/i;

  const answersHtml = r => {
    const { esc, nl2br } = U();
    return `<dl class="fr-ans">${(r.answers || []).filter(([q, a]) => !skip.test(String(q).trim()) && String(a ?? '').trim() !== '')
      .map(([q, a]) => `<dt>${esc(q)}</dt><dd>${nl2br(String(a))}</dd>`).join('')}</dl>`;
  };

  async function homeCard(host) {
    if (!host) return;
    try {
      const rows = await DB.list('form_responses', { eq: { seen: false } });
      if (!rows.length) return;
      const { esc } = U();
      const el = document.createElement('section'); el.className = 'card fr-home';
      el.innerHTML = `<div class="row gap"><b class="grow">📝 ${rows.length} formulario${rows.length > 1 ? 's' : ''} nuevo${rows.length > 1 ? 's' : ''}</b><a class="btn small primary" href="#/formularios">Ver</a></div>
        <p class="small muted">${rows.slice(0, 3).map(r => `${esc(r.name || 'Sin nombre')} · ${FORMS[r.form] || r.form}`).join('<br>')}</p>`;
      host.prepend(el);
    } catch (e) { /* la tabla aún no existe o sin conexión */ }
  }

  async function page(box) {
    const { esc, toast, safe, ago } = U();
    let rows, clients;
    try { [rows, clients] = await Promise.all([DB.list('form_responses', { order: ['submitted_at', 'desc'] }), DB.list('clients', { order: ['name', 'asc'] }).then(cs => cs.filter(c => !c.is_template))]); }
    catch (e) { box.innerHTML = '<p class="empty">Aún no está activado. Falta ejecutar la migración 009 y actualizar el script de Google.</p>'; return; }
    let tab = 'all';
    const name = id => (clients.find(c => c.id === id) || {}).name;
    const draw = () => {
      const list = rows.filter(r => tab === 'all' || r.form === tab);
      box.innerHTML = `<p class="muted small">Llegan solas cuando alguien rellena uno de tus formularios de Google. Las nuevas salen marcadas; asígnalas a su cliente para verlas en su Ficha.</p>
        <div class="np-plans">${[['all', 'Todos'], ['plan', FORMS.plan], ['salud', FORMS.salud]].map(([k, l]) => `<button type="button" class="chip ${tab === k ? 'on' : ''}" data-tab="${k}">${l} <small>${k === 'all' ? rows.length : rows.filter(r => r.form === k).length}</small></button>`).join('')}</div>
        ${list.length ? list.map(r => `<details class="card fr-item ${r.seen ? '' : 'unseen'}" data-id="${r.id}">
          <summary><span class="grow"><b>${esc(r.name || 'Sin nombre')}</b><small class="muted"> · ${FORMS[r.form] || r.form} · ${ago(r.submitted_at)}</small></span>
            ${r.client_id ? `<span class="pill green">${esc(name(r.client_id) || 'Cliente')}</span>` : '<span class="pill amber">Sin cliente</span>'}${r.seen ? '' : '<i class="dot"></i>'}</summary>
          ${answersHtml(r)}
          <div class="row gap wrap"><label class="grow">Cliente<select data-cl><option value="">— Sin asignar (posible cliente nuevo) —</option>${clients.map(c => `<option value="${c.id}" ${c.id === r.client_id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label></div>
        </details>`).join('') : '<p class="empty">Todavía no ha llegado ninguna respuesta.</p>'}`;
      box.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { tab = b.dataset.tab; draw(); });
      box.querySelectorAll('.fr-item').forEach(d => {
        const r = rows.find(x => x.id === d.dataset.id);
        d.addEventListener('toggle', () => { if (d.open && !r.seen) { r.seen = true; d.classList.remove('unseen'); const dot = d.querySelector('.dot'); if (dot) dot.remove(); DB.update('form_responses', r.id, { seen: true }).catch(() => {}); } });
        d.querySelector('[data-cl]').onchange = async e => {
          const v = e.target.value || null;
          try { await safe(() => DB.update('form_responses', r.id, { client_id: v }), v ? 'Asignado a ' + name(v) : 'Sin asignar'); r.client_id = v; draw(); } catch (err) { /* avisado */ }
        };
      });
    };
    draw();
  }

  async function clientBlock(c, box) {
    try {
      const rows = await DB.list('form_responses', { eq: { client_id: c.id }, order: ['submitted_at', 'desc'] });
      if (!rows.length) return;
      const { ago } = U();
      const el = document.createElement('section'); el.className = 'card';
      el.innerHTML = `<h3>Formularios que rellenó</h3>${rows.map(r => `<details class="fr-item"><summary><b>${FORMS[r.form] || r.form}</b> <small class="muted">· ${ago(r.submitted_at)}</small></summary>${answersHtml(r)}</details>`).join('')}`;
      box.appendChild(el);
    } catch (e) { /* opcional */ }
  }

  window.JMForms = { homeCard, page, clientBlock };
})();
