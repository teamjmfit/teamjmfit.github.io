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

  // Datos de un posible cliente nuevo sacados de sus respuestas (todas las suyas: Plan 1:1 y Salud)
  function prefill(r, rows) {
    const mine = rows.filter(x => !x.client_id && ((r.email && x.email && x.email.toLowerCase() === r.email.toLowerCase()) || (r.name && x.name && x.name.trim().toLowerCase() === r.name.trim().toLowerCase())));
    const ans = mine.concat(mine.includes(r) ? [] : [r]).flatMap(x => x.answers || []);
    const find = re => { const a = ans.find(([q, v]) => re.test(String(q)) && String(v ?? '').trim()); return a ? String(a[1]).trim() : ''; };
    let phone = find(/tel[eé]fono|whats ?app|m[oó]vil|celular/i).replace(/\D/g, '');
    if (phone.length === 9) phone = '34' + phone;
    const sv = (find(/servicio|modalidad|qu[eé] (te )?interesa|tipo de (plan|asesor)/i) || '').toLowerCase();
    const service = /mixt|ambos|completo|entren\w* y nutri|nutri\w* y entren/.test(sv) ? 'Mixto' : /nutri|dieta|alimenta/.test(sv) ? 'Nutrición' : /entren|rutina/.test(sv) ? 'Entreno' : '';
    const health = ans.filter(([q, v]) => /lesi|patolog|enfermedad|medicaci|alerg|intoler|operaci|cirug|dolor|limitaci/i.test(String(q)) && String(v ?? '').trim() && !/^(no|ninguna?o?|nada|-)\.?$/i.test(String(v).trim()))
      .map(([q, v]) => `${String(q).trim().replace(/[:¿?]+/g, '')}: ${String(v).trim()}`);
    return { name: (r.name || find(/^nombre|nombre (y|completo)/i) || '').trim(), email: (r.email || find(/correo|e-?mail/i) || '').trim().toLowerCase(), phone, service,
      goal: find(/objetivo|meta|qu[eé] (quieres|buscas) conseguir/i).slice(0, 200), notes: health.join('\n').slice(0, 1500), ids: mine.map(x => x.id).concat(mine.includes(r) ? [] : [r.id]) };
  }

  // Datos básicos sacados de las respuestas (Datos Base y Salud: fecha de nacimiento, peso, altura; Plan 1:1: sexo)
  function basicsFrom(rows) {
    const ans = rows.slice().sort((a, b) => String(b.submitted_at).localeCompare(String(a.submitted_at))).flatMap(x => x.answers || []);
    const find = re => { const a = ans.find(([q, v]) => re.test(String(q)) && String(v ?? '').trim()); return a ? String(a[1]).trim() : ''; };
    const out = {};
    const fb = find(/fecha de nacimiento|nacimiento/i);
    if (fb) {
      let m = fb.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/), d = null;
      if (m) d = [m[1], m[2], m[3]];
      else if ((m = fb.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/))) d = [m[3].length === 2 ? (Number(m[3]) > 30 ? '19' : '20') + m[3] : m[3], m[2], m[1]];
      else { const x = new Date(fb.replace(/\s*\(.*\)\s*$/, '')); if (!isNaN(x)) d = [x.getFullYear(), x.getMonth() + 1, x.getDate()]; }
      if (d) { const iso = `${d[0]}-${String(d[1]).padStart(2, '0')}-${String(d[2]).padStart(2, '0')}`; if (/^(19[2-9]\d|20[0-2]\d)-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(iso)) out.birth_date = iso; }
    }
    const nums = t => { const m = String(t).replace(',', '.').match(/\d+(\.\d+)?/); return m ? Number(m[0]) : null; };
    const h = nums(find(/^altura|estatura|cu[aá]nto mides/i));
    if (h != null) { const cm = h < 3 ? h * 100 : h; if (cm >= 100 && cm <= 250) out.height_cm = Math.round(cm * 2) / 2; }
    const w = nums(find(/peso( actual)?$|^peso/i));
    if (w != null && w >= 25 && w <= 350) out.weight = w;
    const sx = find(/^sexo|g[eé]nero/i).toLowerCase();
    if (sx) out.sex = /^(h|m(asc|ale)|var[oó]n|chico|hombre)/.test(sx) && !/^muj/.test(sx) ? 'male' : /^(muj|fem|chica|f)/.test(sx) ? 'female' : 'other';
    const sub = rows.map(x => String(x.submitted_at || '').slice(0, 10)).filter(Boolean).sort().pop();
    out.day = sub || null;
    return out;
  }
  // Al aceptar o asignar un formulario: se rellenan solos los datos que falten en su ficha (no pisa lo que ya tenga)
  async function applyBasics(clientId, rows) {
    const DB = window.DB;
    try {
      const c = await DB.get('clients', clientId); if (!c) return;
      const b = basicsFrom(rows), patch = {};
      ['birth_date', 'sex', 'height_cm'].forEach(k => { if (b[k] != null && (c[k] == null || c[k] === '')) patch[k] = b[k]; });
      if (Object.keys(patch).length) await DB.update('clients', clientId, patch);
      if (b.weight != null) {
        const dm = await DB.list('daily_metrics', { eq: { client_id: clientId }, limit: 1 }).catch(() => []);
        const ck = await DB.list('checkins', { eq: { client_id: clientId }, limit: 1 }).catch(() => []);
        if (!dm.length && !ck.length) await DB.upsert('daily_metrics', { client_id: clientId, date: b.day || new Date().toISOString().slice(0, 10), weight: b.weight }, 'client_id,date');
      }
      const n = Object.keys(patch).length + (b.weight != null ? 1 : 0);
      if (n) U().toast('Datos del formulario pasados a su ficha ✓', 'ok');
    } catch (e) { console.warn('datos del formulario', e); }
  }

  async function homeCard(host) {
    if (!host) return;
    try {
      const rows = await DB.list('form_responses', { eq: { seen: false } });
      if (!rows.length) return;
      const { esc } = U();
      const el = document.createElement('section'); el.className = 'card fr-home';
      el.innerHTML = `<div class="row gap"><b class="grow">📝 ${rows.length} formulario${rows.length > 1 ? 's' : ''} nuevo${rows.length > 1 ? 's' : ''}</b><a class="btn small primary" href="#/revisiones/formularios">Ver</a></div>
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
          ${r.client_id ? '' : '<div class="row gap wrap fr-accept"><button type="button" class="btn small primary" data-accept>✓ Aceptar como cliente nuevo</button><small class="muted">Se abre la ficha de alta con sus datos (nombre, correo, teléfono, objetivo y salud en notas privadas). Revísalos y guarda.</small></div>'}
          <div class="row gap wrap"><label class="grow">Cliente<select data-cl><option value="">— Sin asignar (posible cliente nuevo) —</option>${clients.map(c => `<option value="${c.id}" ${c.id === r.client_id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label></div>
        </details>`).join('') : '<p class="empty">Todavía no ha llegado ninguna respuesta.</p>'}`;
      box.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { tab = b.dataset.tab; draw(); });
      box.querySelectorAll('.fr-item').forEach(d => {
        const r = rows.find(x => x.id === d.dataset.id);
        d.addEventListener('toggle', () => { if (d.open && !r.seen) { r.seen = true; d.classList.remove('unseen'); const dot = d.querySelector('.dot'); if (dot) dot.remove(); DB.update('form_responses', r.id, { seen: true }).catch(() => {}); } });
        const acc = d.querySelector('[data-accept]');
        if (acc) acc.onclick = () => {
          if (!window.JMClientForm) return;
          const pf = prefill(r, rows), ids = pf.ids; delete pf.ids;
          window.JMClientForm(null, { data: pf, onCreated: async c => {
            for (const id of ids) await DB.update('form_responses', id, { client_id: c.id, seen: true }).catch(() => {});
            await applyBasics(c.id, rows.filter(x => ids.includes(x.id)));
            rows.forEach(x => { if (ids.includes(x.id)) { x.client_id = c.id; x.seen = true; } }); clients.push(c); draw();
          } });
        };
        d.querySelector('[data-cl]').onchange = async e => {
          const v = e.target.value || null;
          try { await safe(() => DB.update('form_responses', r.id, { client_id: v }), v ? 'Asignado a ' + name(v) : 'Sin asignar'); r.client_id = v; if (v) await applyBasics(v, rows.filter(x => x.client_id === v)); draw(); } catch (err) { /* avisado */ }
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

  window.JMForms = { homeCard, page, clientBlock, basicsFrom, applyBasics };
})();
