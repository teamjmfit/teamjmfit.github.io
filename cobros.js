// TEAM JMFIT · Cobros dentro de la app (migración 044). Sustituye al Excel «Gestión de Cobros»:
// tarifas, ficha de cobro de cada cliente, registro de pagos, vencimientos, estados, resúmenes y avisos.
// Los cálculos replican las fórmulas del Excel. Solo lo ve el entrenador.
(function () {
  const U = () => window.JMUI;
  const METODOS = ['Bizum', 'Efectivo', 'Transferencia', 'Tarjeta'];
  const SERVICIOS = ['Entreno', 'Nutrición', 'Mixto'];
  const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  const MES_C = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

  // ---------- utilidades
  const today = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); };
  const D = s => new Date(s + 'T12:00:00');
  const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
  const days = (a, b) => Math.round((D(a) - D(b)) / 864e5);
  // EDATE del Excel: mismo día n meses después (31 ene + 1 → 28/29 feb)
  function addMonths(s, n) {
    const d = D(s), y = d.getFullYear(), m = d.getMonth() + Number(n || 0), day = d.getDate();
    const last = new Date(y, m + 1, 0).getDate();
    return iso(new Date(y, m, Math.min(day, last), 12));
  }
  const firstOfMonth = (y, m) => iso(new Date(y, m, 1, 12));
  const eur = v => (v === '' || v == null || isNaN(Number(v)) ? '–' : Number(v).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' }));
  const eur0 = v => (v == null || isNaN(Number(v)) ? '–' : Math.round(Number(v)).toLocaleString('es-ES') + ' €');
  const fd = (s, o) => (s ? D(s).toLocaleDateString('es-ES', o || { day: 'numeric', month: 'short', year: '2-digit' }) : '–');
  const dmy = s => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : '');
  const num = v => (v === '' || v == null ? null : (isNaN(Number(String(v).replace(',', '.'))) ? null : Number(String(v).replace(',', '.'))));
  const norm = s => String(s || '').trim().toLowerCase();

  // ---------- datos
  let cache = null;   // { at, T, B, P }
  const drop = () => { cache = null; };
  async function raw(force) {
    if (!force && cache && Date.now() - cache.at < 30000) return cache;
    const DB = window.DB;
    const [T, B, P] = await Promise.all([DB.list('tariffs', { order: ['position', 'asc'] }), DB.list('billing_clients', { order: ['position', 'asc'] }), DB.list('payments', { order: ['paid_on', 'desc'] })]);
    if (DB.mode === 'demo' && !T.length && !B.length) { await seedDemo(); const r = await raw(true); syncAll(); return r; }
    // Avisos de renovación (046): notificación, visto en su app o WhatsApp tuyo. Opcional si la tabla aún no existe.
    const N = await DB.list('pay_notices', { gte: { day: addDays(today(), -60) }, order: ['created_at', 'desc'] }).catch(() => []);
    cache = { at: Date.now(), T, B, P, N };
    return cache;
  }
  // ¿Están los cobros en la app? (tablas creadas y con datos). Si no, la app sigue con el Excel.
  async function available() {
    try { const r = await raw(); return r.T.length > 0 || r.B.length > 0; } catch (e) { return false; }
  }

  // Estado calculado de cada cliente (columnas automáticas de «Base de Clientes»)
  function compute(r) {
    const t0 = today(), now = D(t0), nextM = firstOfMonth(now.getFullYear(), now.getMonth() + 1), cut = addDays(nextM, -6);
    const tar = {}; r.T.forEach(t => { tar[t.plan] = t; });
    const byBc = {}; r.P.forEach(p => { (byBc[p.billing_client_id] = byBc[p.billing_client_id] || []).push(p); });
    Object.values(byBc).forEach(a => a.sort((x, y) => (y.paid_on.localeCompare(x.paid_on)) || String(y.created_at).localeCompare(String(x.created_at))));
    const list = r.B.map((b, i) => {
      const t = tar[b.plan] || null, pays = byBc[b.id] || [], last = pays[0] || null;
      const paused = !!b.paused || !b.plan;
      const cuota = paused ? null : (b.price_custom != null ? Number(b.price_custom) : t ? Number(t.price) : null);
      const vence = last ? last.covers_until : null, dias = !paused && vence ? days(vence, t0) : null;
      const estado = paused ? 'BAJA / PAUSA' : !vence ? 'SIN PAGOS' : dias < 0 ? 'VENCIDO' : dias <= 5 ? 'AVISAR / PRÓXIMO' : 'AL DÍA';
      const pagadoMes = paused ? null : pays.some(p => p.paid_on < nextM && p.covers_until && p.covers_until > cut);
      return Object.assign({}, b, { code: 'CLI-' + String(i + 1).padStart(3, '0'), t, service: t ? t.service : null, months: t ? t.months : null, cuota, paused, pays, last, vence, dias, estado, pagadoMes,
        total: pays.reduce((s, p) => s + Number(p.amount || 0), 0),
        // avisos de este ciclo: los posteriores a su último pago
        notices: (r.N || []).filter(n => n.billing_client_id === b.id && (!last || String(n.created_at) > String(last.created_at))) });
    });
    return { tar, list, byId: Object.fromEntries(list.map(x => [x.id, x])), T: r.T, P: r.P };
  }
  function addDays(s, n) { const d = D(s); d.setDate(d.getDate() + n); return iso(d); }
  async function load(force) { return compute(await raw(force)); }

  // Copia la renovación en la ficha del cliente de la app (para sus avisos de pago)
  async function syncClient(bcId) {
    const c = await load(true), b = c.byId[bcId]; if (!b || !b.client_id) return;
    const want = b.paused ? { pay_due: null, pay_plan: null, pay_amount: null } : { pay_due: b.vence || null, pay_plan: b.plan || null, pay_amount: b.cuota };
    try { await window.DB.update('clients', b.client_id, want); } catch (e) { /* migración 017 sin aplicar */ }
  }
  async function syncAll() { const c = await load(true); for (const b of c.list) if (b.client_id) await syncClient(b.id); }

  // ---------- copia en el Excel (si está conectado): la app manda, el Excel se rellena solo
  async function mirror(extra) {
    const DB = window.DB;
    try {
      const url = await DB.getSetting('sheets_url'); if (!url || DB.mode === 'demo') return;
      const c = await load(true);
      const data = {
        tarifas: c.T.map(t => ({ plan: t.plan, servicio: t.service, precio: Number(t.price), meses: t.months })),
        clientes: c.list.map(b => ({ nombre: b.name, plan: b.paused ? 'Inactivo / Pausa' : b.plan, precio: b.price_custom, metodo: b.method, alta: b.start_date, pendiente: b.split_pending, notas: b.notes, correo: b.email, telefono: b.phone })),
        pagos: c.P.slice().sort((a, b) => a.paid_on.localeCompare(b.paid_on) || String(a.created_at).localeCompare(String(b.created_at)))
          .map(p => ({ fecha: p.paid_on, cliente: (c.byId[p.billing_client_id] || {}).name || '', plan: p.plan, importe: Number(p.amount), metodo: p.method, notas: p.notes }))
      };
      await DB.sheets('volcar', data);
    } catch (e) {
      // script de la hoja sin actualizar: al menos el pago nuevo
      if (extra && extra.pago && /desconocida/i.test(e.message || '')) { try { await DB.sheets('registrarPago', { pago: extra.pago }); } catch (e2) { /* sin copia */ } }
    } finally { try { localStorage.removeItem('jmfit-sheet'); } catch (e) { /* nada */ } }
  }
  const after = (bcId, extra) => { drop(); return syncClient(bcId).then(() => { mirror(extra); }); };

  // ---------- formato «hoja» para las partes de la app que ya leían el Excel (inicio, ficha de cliente…)
  function asSheet(c) {
    return {
      app: true, actualizado: new Date().toISOString(),
      tarifas: c.T.map(t => ({ plan: t.plan, servicio: t.service, precio: Number(t.price), meses: t.months })),
      clientes: c.list.map(b => ({ id: b.code, nombre: b.name, servicio: b.service || '', plan: b.paused ? 'Inactivo / Pausa' : b.plan, cuota: b.cuota, meses: b.months, metodo: b.method || '',
        alta: b.start_date || '', ultimoPago: b.last ? b.last.paid_on : '', vence: b.vence || '', dias: b.dias == null ? '' : b.dias + ' d', estado: b.estado,
        pagadoMes: b.pagadoMes == null ? '' : b.pagadoMes ? '✔ Sí' : '✘ No', pendiente: b.split_pending || '', notas: b.notes || '' })),
      pagos: c.P.map(p => ({ fecha: p.paid_on, cliente: (c.byId[p.billing_client_id] || {}).name || '', servicio: p.service, plan: p.plan, importe: Number(p.amount), metodo: p.method, vence: p.covers_until, notas: p.notes || '' }))
    };
  }

  // ---------- piezas de interfaz
  const pillOf = b => b.paused ? '<span class="pill">En pausa</span>'
    : b.estado === 'SIN PAGOS' ? '<span class="pill amber">Sin pagos</span>'
      : `<span class="pill ${b.dias < 0 ? 'red' : b.dias <= 5 ? 'amber' : 'green'}">${b.dias < 0 ? `Vencido hace ${-b.dias} d` : b.dias === 0 ? 'Vence hoy' : `${b.dias} d`}</span>`;
  const CH = { push: ['🔔', 'Avisado'], app: ['👁', 'Lo vio en la app'], whatsapp: ['💬', 'WhatsApp'] };
  const whenTxt = d => { const n = days(today(), d); return n <= 0 ? 'hoy' : n === 1 ? 'ayer' : `hace ${n} días`; };
  function noticeTxt(b) {
    if (b.paused || !b.notices || !b.notices.length) return '';
    const seen = new Set(), parts = [];
    b.notices.forEach(n => { if (seen.has(n.channel) || !CH[n.channel]) return; seen.add(n.channel); parts.push(`${CH[n.channel][0]} ${CH[n.channel][1]} ${whenTxt(n.day)}`); });
    return parts.join(' · ');
  }
  async function logWa(b) {
    try { await window.DB.upsert('pay_notices', { billing_client_id: b.id, day: today(), channel: 'whatsapp', kind: b.estado === 'VENCIDO' ? 'vencido' : 'recordatorio' }, 'billing_client_id,day,channel'); drop(); } catch (e) { /* tabla aún no creada */ }
  }
  function phoneOf(b, clients) { const cl = b.client_id && (clients || []).find(x => x.id === b.client_id); return String(b.phone || (cl && cl.phone) || '').replace(/\D/g, ''); }
  function waText(b) {
    const first = String(b.name).split(' ')[0];
    const body = b.estado === 'VENCIDO'
      ? `Tu plan ${b.plan} venció el ${dmy(b.vence)}. Cuando puedas, renuévalo para seguir con todo al día.`
      : `Te recuerdo que tu plan ${b.plan} se renueva el ${dmy(b.vence)}.`;
    return `¡Hola ${first}! 👋\n\n${body}\nCuota: ${eur(b.cuota)}${b.method ? ` · ${b.method}` : ''}.\n\nSi ya lo has pagado, ignora este mensaje. ¡Gracias! 💪\nJorge · TEAM JMFIT`;
  }
  const waUrl = (b, clients) => { const ph = phoneOf(b, clients); return ph ? `https://wa.me/${ph}?text=${encodeURIComponent(waText(b))}` : ''; };

  function bars(vals, labels, { h = 170 } = {}) {
    const W = 600, H = h, P = 30, n = vals.length, mx = Math.max(1, ...vals), bw = (W - P * 2) / n;
    return `<svg class="chart cb-bars" viewBox="0 0 ${W} ${H}" role="img" aria-label="Facturación por mes">
      <line class="grid" x1="${P}" x2="${W - P}" y1="${H - 24}" y2="${H - 24}"/>
      ${vals.map((v, i) => { const bh = v ? Math.max(3, (H - 46) * v / mx) : 0, x = P + i * bw + bw * 0.18; return `<rect class="bar" x="${x.toFixed(1)}" y="${(H - 24 - bh).toFixed(1)}" width="${(bw * 0.64).toFixed(1)}" height="${bh.toFixed(1)}" rx="4"><title>${labels[i]}: ${eur(v)}</title></rect>${v ? `<text class="lbl" x="${(x + bw * 0.32).toFixed(1)}" y="${(H - 30 - bh).toFixed(1)}" text-anchor="middle">${Math.round(v)}</text>` : ''}`; }).join('')}
      ${labels.map((l, i) => `<text class="lbl" x="${(P + i * bw + bw / 2).toFixed(1)}" y="${H - 6}" text-anchor="middle">${l}</text>`).join('')}</svg>`;
  }

  // Resumen como el Dashboard del Excel
  function stats(c, year) {
    const t0 = today(), ym = t0.slice(0, 7), y0 = t0.slice(0, 4), act = c.list.filter(b => !b.paused);
    const mes = c.P.filter(p => p.paid_on.slice(0, 7) === ym), ano = c.P.filter(p => p.paid_on.slice(0, 4) === y0);
    const in30 = act.filter(b => b.vence && b.dias != null && b.dias >= 0 && b.dias <= 30);
    const venc = act.filter(b => b.estado === 'VENCIDO' || b.estado === 'AVISAR / PRÓXIMO');
    const frac = c.list.filter(b => Number(b.split_pending) > 0);
    const first = c.P.length ? c.P.reduce((m, p) => (p.paid_on < m ? p.paid_on : m), c.P[0].paid_on) : null;
    const sum = a => a.reduce((s, p) => s + Number(p.amount || 0), 0);
    // por meses del año elegido
    const months = MESES.map((_, m) => {
      const k = `${year}-${String(m + 1).padStart(2, '0')}`, ps = c.P.filter(p => p.paid_on.slice(0, 7) === k);
      const start = `${k}-01`, end = addMonths(start, 1), cut = addDays(end, -6);
      // activos ese mes: con algún pago que cubre el mes; «sin pagar»: activos hoy que ya habían empezado y no tienen ese mes cubierto
      const covered = new Set(c.P.filter(p => p.paid_on < end && p.covers_until && p.covers_until > cut).map(p => p.billing_client_id));
      const pend = start <= t0 ? c.list.filter(b => !b.paused && b.start_date && b.start_date < end && !covered.has(b.id)).length : 0;
      return { m, total: sum(ps), n: ps.length, activos: covered.size, pend };
    });
    const bySvc = {}; c.P.filter(p => p.paid_on.slice(0, 4) === String(year)).forEach(p => { const s = p.service || (c.tar[p.plan] || {}).service || 'Otro'; bySvc[s] = (bySvc[s] || 0) + Number(p.amount || 0); });
    const years = [...new Set(c.P.map(p => p.paid_on.slice(0, 4)).concat([y0]))].sort();
    const byYear = years.map(y => ({ y, total: sum(c.P.filter(p => p.paid_on.slice(0, 4) === y)) }));
    const byPlan = {}; act.forEach(b => { byPlan[b.plan] = (byPlan[b.plan] || 0) + 1; });
    return { mes, ano, in30, venc, frac, first, act, months, bySvc, byYear, byPlan, years, total: sum(c.P), sinPagar: act.filter(b => b.pagadoMes === false) };
  }

  // Matriz mensual: ✔ plan que cubre el mes · ✘ pendiente · — pausa
  function matrix(c, year) {
    const t0 = today();
    return c.list.map(b => ({ b, cells: MESES.map((_, m) => {
      const start = `${year}-${String(m + 1).padStart(2, '0')}-01`, end = addMonths(start, 1), cut = addDays(end, -6);
      const p = b.pays.find(x => x.paid_on < end && x.covers_until && x.covers_until > cut);
      if (p) return { k: 'ok', t: p.plan || '✔' };
      if (start > t0) return { k: '', t: '' };
      if (b.start_date && end <= firstOfMonth(D(b.start_date).getFullYear(), D(b.start_date).getMonth())) return { k: '', t: '' };
      if (!b.start_date && !b.pays.length) return { k: '', t: '' };
      if (b.paused) return { k: 'off', t: 'Pausa' };
      return { k: 'miss', t: 'Pendiente' };
    }) }));
  }
  const shortPlan = s => String(s || '').replace(/Mensual/i, 'Men').replace(/Trimestral/i, 'Tri').replace(/Semestral/i, 'Sem').replace(/Nutrición/i, 'Nut').replace(/Entreno/i, 'Ent').replace(/Mixto/i, 'Mix');

  // ---------- formularios
  function tariffOpts(c, sel, withPause) {
    return (withPause ? `<option value="" ${!sel ? 'selected' : ''}>Inactivo / Pausa</option>` : '') + c.T.map(t => `<option value="${U().esc(t.plan)}" ${t.plan === sel ? 'selected' : ''}>${U().esc(t.plan)} · ${eur(t.price)}</option>`).join('');
  }

  // Registrar (o editar) un pago
  async function payForm({ bcId = null, payment = null, onDone } = {}) {
    const { esc, modal, toast, confirmBox } = U(), DB = window.DB;
    const c = await load(true);
    if (!c.list.length) { toast('Primero crea la ficha de cobro del cliente', 'err'); return; }
    const p0 = payment || {}, b0 = c.byId[payment ? payment.billing_client_id : bcId] || null;
    const opts = c.list.slice().sort((a, b) => (a.paused - b.paused) || a.name.localeCompare(b.name, 'es'));
    const f = modal(payment ? 'Editar pago' : 'Registrar pago', `
      <div class="form-grid">
        <label class="full">Cliente<select name="bc" required>${opts.map(b => `<option value="${b.id}" ${b0 && b.id === b0.id ? 'selected' : ''}>${esc(b.name)}${b.paused ? ' (en pausa)' : ''}</option>`).join('')}</select></label>
        <label>Fecha del pago<input name="paid_on" type="date" required value="${esc(p0.paid_on || today())}"></label>
        <label>Plan<select name="plan" required>${tariffOpts(c, p0.plan || (b0 && b0.plan) || (c.T[0] || {}).plan)}</select></label>
        <label>Importe (€)<input name="amount" type="number" step="0.01" min="0" inputmode="decimal" required value="${p0.amount != null ? esc(p0.amount) : ''}"></label>
        <label>Método<select name="method">${METODOS.map(m => `<option ${(p0.method || (b0 && b0.method) || 'Bizum') === m ? 'selected' : ''}>${m}</option>`).join('')}</select></label>
        <label class="full">Notas<input name="notes" maxlength="500" value="${esc(p0.notes || '')}" placeholder="Ej: pago 1 de 2, cambio de plan…"></label>
        ${payment ? '' : `<label>Queda pendiente (€) <small class="muted">si paga a plazos</small><input name="pending" type="number" step="0.01" min="0" inputmode="decimal" placeholder="0"></label>`}
        <label class="check full" data-chplan hidden><input type="checkbox" name="setplan" checked> <span>Cambiar su plan actual a este</span></label>
      </div>
      <p class="note small" data-cover></p>`, {
      submitLabel: payment ? 'Guardar' : 'Registrar pago',
      danger: payment ? { label: 'Borrar pago', run: async () => { if (!(await confirmBox('Se borrará este pago del registro. Su vencimiento se recalcula con los demás pagos.', 'Borrar'))) return; await U().safe(() => DB.remove('payments', payment.id), 'Pago borrado'); U().closeModal(); await after(payment.billing_client_id); if (onDone) onDone(); } } : null,
      onSubmit: async (form, fd) => {
        const b = c.byId[fd.get('bc')], t = c.tar[fd.get('plan')];
        const amount = num(fd.get('amount')); if (amount == null) { toast('Pon el importe', 'err'); return false; }
        const row = { billing_client_id: b.id, paid_on: fd.get('paid_on'), plan: t.plan, service: t.service, amount, method: fd.get('method'), covers_until: addMonths(fd.get('paid_on'), t.months), notes: String(fd.get('notes') || '').trim() || null };
        if (payment) await U().safe(() => DB.update('payments', payment.id, row), 'Pago guardado');
        else await U().safe(() => DB.insert('payments', row), `Pago registrado · cubre hasta ${fd_(row.covers_until)}`);
        const patch = {};
        if (fd.get('setplan') && !form.querySelector('[data-chplan]').hidden) { patch.plan = t.plan; patch.paused = false; if (b.price_custom != null && Number(b.price_custom) !== amount) patch.price_custom = null; }
        if (!payment && b.paused && !patch.plan) patch.paused = false;
        const pend = num(fd.get('pending')); if (!payment && pend != null) patch.split_pending = pend || null;
        if (Object.keys(patch).length) await DB.update('billing_clients', b.id, patch);
        await after(b.id, payment ? null : { pago: { cliente: b.name, fecha: row.paid_on, plan: row.plan, importe: amount, metodo: row.method, notas: row.notes || '' } });
        if (onDone) onDone();
      }
    });
    const fd_ = s => fd(s, { day: 'numeric', month: 'short', year: 'numeric' });
    let touched = !!payment;
    f.amount.addEventListener('input', () => { touched = true; });
    const upd = () => {
      const b = c.byId[f.bc.value], t = c.tar[f.plan.value];
      if (!touched) f.amount.value = t ? (b && b.plan === t.plan && b.cuota != null ? b.cuota : t.price) : '';
      f.querySelector('[data-chplan]').hidden = !b || !t || (b.plan === t.plan && !b.paused);
      const cover = t && f.paid_on.value ? addMonths(f.paid_on.value, t.months) : null;
      f.querySelector('[data-cover]').innerHTML = cover ? `Cubre hasta el <b>${fd_(cover)}</b> (${t.months} ${t.months === 1 ? 'mes' : 'meses'}). Su próximo vencimiento y el aviso de su app se actualizan solos.` : '';
    };
    f.bc.onchange = () => { const b = c.byId[f.bc.value]; if (b && b.plan && !payment) f.plan.value = b.plan; if (b && b.method && !payment) f.method.value = b.method; touched = !!payment; upd(); };
    f.plan.onchange = () => { if (!payment) touched = false; upd(); }; f.paid_on.oninput = upd;
    upd();
  }

  // Ficha de cobro de un cliente (fila de «Base de Clientes»)
  async function bcForm(bc, { clientId = null, name = '', onDone } = {}) {
    const { esc, modal, toast, confirmBox } = U(), DB = window.DB;
    const c = await load(true), clients = (await DB.list('clients', { order: ['name', 'asc'] })).filter(x => !x.is_template);
    const used = new Set(c.list.filter(b => b.client_id && (!bc || b.id !== bc.id)).map(b => b.client_id));
    const b = bc || { name, client_id: clientId, method: 'Bizum', start_date: today(), plan: (c.T[0] || {}).plan };
    const f = modal(bc ? 'Ficha de cobro' : 'Nuevo cliente en cobros', `
      <div class="form-grid">
        <label class="full">Nombre<input name="name" required maxlength="120" value="${esc(b.name || '')}"></label>
        <label>Plan actual<select name="plan">${tariffOpts(c, bc && b.paused ? '' : b.plan, true)}</select></label>
        <label>Precio pactado (€) <small class="muted">vacío = tarifa</small><input name="price_custom" type="number" step="0.01" min="0" inputmode="decimal" value="${b.price_custom != null ? esc(b.price_custom) : ''}" placeholder="Tarifa oficial"></label>
        <label>Método habitual<select name="method">${METODOS.map(m => `<option ${b.method === m ? 'selected' : ''}>${m}</option>`).join('')}</select></label>
        <label>Fecha de alta<input name="start_date" type="date" value="${esc(b.start_date || '')}"></label>
        <label>Pendiente fraccionado (€)<input name="split_pending" type="number" step="0.01" min="0" inputmode="decimal" value="${b.split_pending != null ? esc(b.split_pending) : ''}" placeholder="0"></label>
        <label>Teléfono (con 34)<input name="phone" inputmode="tel" maxlength="30" value="${esc(b.phone || '')}" placeholder="Si no, el de su ficha"></label>
        <label class="full">Correo<input name="email" type="email" maxlength="160" value="${esc(b.email || '')}"></label>
        <label class="full">Su cuenta en la app<select name="client_id"><option value="">— Sin vincular —</option>${clients.filter(x => !used.has(x.id)).map(x => `<option value="${x.id}" ${x.id === b.client_id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select><small class="muted">Vinculado, le llegan a su app los avisos de renovación.</small></label>
        <label class="full">Notas<textarea name="notes" rows="2" maxlength="1000">${esc(b.notes || '')}</textarea></label>
      </div><p class="note small" data-cuota></p>`, {
      submitLabel: bc ? 'Guardar' : 'Crear',
      danger: bc ? { label: 'Eliminar', run: async () => {
        if (!(await confirmBox(bc.pays.length ? `Se borrarán ${bc.name} y sus ${bc.pays.length} pagos del registro de cobros. Si solo ha dejado de entrenar, mejor ponle «Inactivo / Pausa».` : `Se borrará la ficha de cobro de ${bc.name}.`, 'Eliminar'))) return;
        if (bc.client_id) try { await DB.update('clients', bc.client_id, { pay_due: null, pay_plan: null, pay_amount: null }); } catch (e) { /* nada */ }
        await U().safe(() => DB.remove('billing_clients', bc.id), 'Ficha eliminada'); U().closeModal(); drop(); mirror(); if (onDone) onDone(); } } : null,
      onSubmit: async (form, fd) => {
        const row = { name: String(fd.get('name')).trim(), plan: fd.get('plan') || (bc ? bc.plan : null), paused: !fd.get('plan'), price_custom: num(fd.get('price_custom')), method: fd.get('method'),
          start_date: fd.get('start_date') || null, split_pending: num(fd.get('split_pending')) || null, phone: String(fd.get('phone') || '').trim() || null, email: String(fd.get('email') || '').trim() || null,
          notes: String(fd.get('notes') || '').trim() || null, client_id: fd.get('client_id') || null };
        if (!row.name) { toast('Pon el nombre', 'err'); return false; }
        if (c.list.some(x => norm(x.name) === norm(row.name) && (!bc || x.id !== bc.id))) { toast('Ya hay otra ficha con ese nombre', 'err'); return false; }
        let id = bc && bc.id;
        if (bc) {
          if (bc.client_id && bc.client_id !== row.client_id) try { await DB.update('clients', bc.client_id, { pay_due: null, pay_plan: null, pay_amount: null }); } catch (e) { /* nada */ }
          await U().safe(() => DB.update('billing_clients', bc.id, row), 'Guardado');
        } else { row.position = c.list.length; const r = await U().safe(() => DB.insert('billing_clients', row), 'Cliente añadido a cobros'); id = r[0].id; }
        await after(id); if (onDone) onDone();
      }
    });
    const upd = () => { const t = c.tar[f.plan.value], pc = num(f.price_custom.value);
      f.querySelector('[data-cuota]').textContent = !f.plan.value ? 'En pausa: no cuenta para cobros ni avisos.' : t ? `Cuota que paga: ${eur(pc != null ? pc : t.price)} cada ${t.months === 1 ? 'mes' : t.months + ' meses'}${pc != null && pc !== Number(t.price) ? ` (tarifa ${eur(t.price)})` : ''}.` : ''; };
    f.plan.onchange = upd; f.price_custom.oninput = upd; upd();
  }

  // Tarifas oficiales (hoja «Tarifas Oficiales»)
  async function tariffsForm(onDone) {
    const { esc, modal, toast } = U(), DB = window.DB;
    const c = await load(true);
    const row = t => `<div class="tf-row" data-id="${t.id || ''}"><input data-k="plan" value="${esc(t.plan || '')}" placeholder="Ej: Mensual Entreno" maxlength="80">
      <select data-k="service">${SERVICIOS.map(s => `<option ${t.service === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
      <input data-k="price" type="number" step="0.01" min="0" inputmode="decimal" value="${t.price != null ? esc(t.price) : ''}" placeholder="€">
      <input data-k="months" type="number" min="1" max="36" value="${esc(t.months || 1)}" title="Meses"><small data-pm></small>
      <button type="button" class="icon-btn sm" data-del aria-label="Quitar">${U().ic('trash')}</button></div>`;
    const f = modal('Tarifas oficiales', `<p class="muted small">Plan · servicio · precio · meses que cubre. Cambia un precio y se actualizan las cuotas de quien no tenga precio pactado.</p>
      <div class="tf-head small muted"><span>Plan</span><span>Servicio</span><span>Precio</span><span>Meses</span><span>€/mes · ahorro</span><span></span></div>
      <div data-tf>${c.T.map(row).join('')}</div><button type="button" class="btn small" data-add>${U().ic('plus')} Añadir plan</button>`, {
      submitLabel: 'Guardar tarifas', wide: true,
      onSubmit: async form => {
        const rows = [...form.querySelectorAll('.tf-row')].map((r, i) => ({ id: r.dataset.id || null, plan: r.querySelector('[data-k=plan]').value.trim(), service: r.querySelector('[data-k=service]').value,
          price: num(r.querySelector('[data-k=price]').value), months: parseInt(r.querySelector('[data-k=months]').value, 10) || 1, position: i })).filter(r => r.plan);
        if (rows.some(r => r.price == null)) { toast('Falta el precio de algún plan', 'err'); return false; }
        if (new Set(rows.map(r => norm(r.plan))).size !== rows.length) { toast('Hay dos planes con el mismo nombre', 'err'); return false; }
        const keep = new Set(rows.filter(r => r.id).map(r => r.id));
        for (const t of c.T) if (!keep.has(t.id)) {
          if (c.list.some(b => b.plan === t.plan && !b.paused)) { toast(`«${t.plan}» lo tiene algún cliente: cámbiale el plan antes de quitarlo`, 'err'); return false; }
          await DB.remove('tariffs', t.id);
        }
        for (const r of rows) {
          const old = r.id && c.T.find(t => t.id === r.id), data = { plan: r.plan, service: r.service, price: r.price, months: r.months, position: r.position };
          if (old) { await DB.update('tariffs', r.id, data); if (old.plan !== r.plan) for (const b of c.list.filter(b => b.plan === old.plan)) await DB.update('billing_clients', b.id, { plan: r.plan }); }
          else await DB.insert('tariffs', data);
        }
        toast('Tarifas guardadas', 'ok'); drop(); await syncAll(); mirror(); if (onDone) onDone();
      }
    });
    const box = f.querySelector('[data-tf]');
    const calc = () => { const rs = [...box.querySelectorAll('.tf-row')];
      rs.forEach(r => { const p = num(r.querySelector('[data-k=price]').value), m = parseInt(r.querySelector('[data-k=months]').value, 10) || 1, s = r.querySelector('[data-k=service]').value;
        const base = rs.find(x => x.querySelector('[data-k=service]').value === s && (parseInt(x.querySelector('[data-k=months]').value, 10) || 1) === 1);
        const bp = base ? num(base.querySelector('[data-k=price]').value) : null, pm = p != null ? p / m : null;
        r.querySelector('[data-pm]').textContent = pm != null ? `${eur(pm)}${m > 1 && bp ? ` · −${Math.round((1 - pm / bp) * 100)} %` : ''}` : ''; }); };
    const wire = () => { box.querySelectorAll('[data-del]').forEach(b => b.onclick = () => { b.closest('.tf-row').remove(); calc(); }); box.querySelectorAll('input,select').forEach(x => { x.oninput = calc; x.onchange = calc; }); calc(); };
    f.querySelector('[data-add]').onclick = () => { box.insertAdjacentHTML('beforeend', row({ service: 'Entreno', months: 1 })); wire(); };
    wire();
  }

  // ---------- página Cobros
  const st = { tab: 'clientes', filt: 'activos', year: null, q: '' };
  async function page(box, { clients = [], rerender } = {}) {
    const { esc, ic } = U();
    const c = await load(true), year = st.year || today().slice(0, 4), s = stats(c, year), re = rerender || (() => page(box, { clients }));
    const ym = today().slice(0, 7), mesN = MESES[Number(ym.slice(5)) - 1].toLowerCase();
    const k = (t, v, sub, cls = '') => `<div class="kpi ${cls}"><small>${t}</small><b>${v}</b><span>${sub}</span></div>`;
    const linkOf = b => b.client_id ? `#/cliente/${b.client_id}/cobros` : '';
    const rows = c.list.filter(b => st.filt === 'todos' || (st.filt === 'pausa' ? b.paused : !b.paused))
      .sort((a, b) => (a.paused - b.paused) || ((a.dias == null ? 1e6 : a.dias) - (b.dias == null ? 1e6 : b.dias)) || a.name.localeCompare(b.name, 'es'));
    const pagos = c.P.filter(p => !st.q || norm((c.byId[p.billing_client_id] || {}).name).includes(norm(st.q)));
    const mx = matrix(c, year);
    box.innerHTML = `
      <div class="kpis cb-kpis">
        ${k('Cobrado en ' + mesN, eur0(s.mes.reduce((a, p) => a + Number(p.amount), 0)), `${s.mes.length} pago${s.mes.length === 1 ? '' : 's'}`)}
        ${k('Previsión 30 días', eur0(s.in30.reduce((a, b) => a + (b.cuota || 0), 0)), `${s.in30.length} renovaci${s.in30.length === 1 ? 'ón' : 'ones'}`)}
        ${k('Vencidos / por avisar', s.venc.length, s.venc.length ? `≈ ${eur0(s.venc.reduce((a, b) => a + (b.cuota || 0), 0))} por cobrar` : 'todo al día', s.venc.some(b => b.estado === 'VENCIDO') ? 'warn' : '')}
        ${k('Clientes activos', s.act.length, `${c.list.length - s.act.length} en pausa · ${s.sinPagar.length} sin pagar este mes`)}
        ${k('Año ' + today().slice(0, 4), eur0(s.ano.reduce((a, p) => a + Number(p.amount), 0)), `${s.ano.length} pagos`)}
        ${s.years.length < 2 && s.first && s.first.slice(0, 4) === today().slice(0, 4) ? '' : k('Total acumulado', eur0(s.total), s.first ? `desde ${fd(s.first, { month: 'long', year: 'numeric' })} · ${c.P.length} pagos` : 'sin pagos')}
        ${s.frac.length ? k('Fraccionados pendientes', eur0(s.frac.reduce((a, b) => a + Number(b.split_pending), 0)), `${s.frac.length} cliente${s.frac.length === 1 ? '' : 's'} con 2º pago`, 'warn') : ''}
      </div>
      <div class="row gap wrap cb-acts"><button class="btn primary" data-pay>${ic('plus')} Registrar pago</button><button class="btn" data-newbc>${ic('users')} Nuevo cliente</button><button class="btn ghost" data-tar>${ic('euro')} Tarifas</button></div>
      <div class="np-plans cb-tabs">${[['clientes', 'Clientes'], ['pagos', 'Pagos'], ['resumen', 'Resumen'], ['matriz', 'Mes a mes']].map(([v, l]) => `<button type="button" class="chip ${st.tab === v ? 'on' : ''}" data-ctab="${v}">${l}</button>`).join('')}</div>
      <div data-cpane="clientes" ${st.tab === 'clientes' ? '' : 'hidden'}>
        <div class="np-plans">${[['activos', `Activos ${s.act.length}`], ['pausa', `En pausa ${c.list.length - s.act.length}`], ['todos', 'Todos']].map(([v, l]) => `<button type="button" class="chip sm ${st.filt === v ? 'on' : ''}" data-filt="${v}">${l}</button>`).join('')}</div>
        <section class="card flush"><ul class="cb-list">${rows.map(b => `<li class="${b.paused ? 'off' : ''}">
          <div class="grow cb-main" data-edit="${b.id}" role="button" tabindex="0"><b>${esc(b.name)}</b>${b.client_id ? '' : ' <span class="muted" style="font-size:12.5px">· sin app</span>'}
            <small>${b.paused ? 'Inactivo / Pausa' : `${esc(b.plan)} · ${eur(b.cuota)}${b.price_custom != null && b.t && Number(b.price_custom) !== Number(b.t.price) ? ' <i>pactado</i>' : ''}`}${b.vence && !b.paused ? ` · vence ${fd(b.vence, { day: 'numeric', month: 'short' })}` : ''}</small>
            ${Number(b.split_pending) > 0 ? `<small class="cb-frac">Pendiente fraccionado: ${eur(b.split_pending)}</small>` : ''}${b.pagadoMes === false ? '<small class="cb-frac">✘ Sin pagar este mes</small>' : ''}${noticeTxt(b) ? `<small class="cb-av">${noticeTxt(b)}</small>` : ''}</div>
          ${pillOf(b)}
          <div class="cb-btns">${!b.paused && waUrl(b, clients) ? `<a class="icon-btn" target="_blank" rel="noopener" data-wa="${b.id}" href="${esc(waUrl(b, clients))}" title="Recordatorio por WhatsApp" aria-label="WhatsApp">${ic('wa')}</a>` : ''}
            ${linkOf(b) ? `<a class="icon-btn" href="${linkOf(b)}" title="Su ficha" aria-label="Su ficha">${ic('users')}</a>` : ''}<button class="btn small" data-payfor="${b.id}">Cobrar</button></div></li>`).join('') || '<li class="muted">Nadie en esta lista.</li>'}</ul></section>
      </div>
      <div data-cpane="pagos" ${st.tab === 'pagos' ? '' : 'hidden'}>
        <input class="cb-q" data-q placeholder="Buscar por cliente…" value="${esc(st.q)}">
        <section class="card flush"><ul class="cb-list cb-pays">${pagos.slice(0, 200).map(p => `<li data-pedit="${p.id}" role="button" tabindex="0"><span class="cb-d">${fd(p.paid_on)}</span>
          <span class="grow"><b>${esc((c.byId[p.billing_client_id] || {}).name || '¿?')}</b><small>${esc(p.plan || '')}${p.method ? ' · ' + esc(p.method) : ''} · cubre hasta ${fd(p.covers_until)}${p.notes ? ' · ' + esc(p.notes) : ''}</small></span><b class="cb-amt">${eur(p.amount)}</b></li>`).join('') || '<li class="muted">Sin pagos.</li>'}</ul></section>
        <p class="muted small">Toca un pago para corregirlo o borrarlo.</p>
      </div>
      <div data-cpane="resumen" ${st.tab === 'resumen' ? '' : 'hidden'}>
        <div class="np-plans">${s.years.map(y => `<button type="button" class="chip sm ${y === String(year) ? 'on' : ''}" data-year="${y}">${y}</button>`).join('')}</div>
        <section class="card"><h3>Facturación ${year} <small class="muted">${eur(s.months.reduce((a, m) => a + m.total, 0))}</small></h3>${bars(s.months.map(m => m.total), MES_C)}</section>
        <section class="card flush"><h3 class="pad">Resumen mensual ${year}</h3><div class="tscroll"><table class="cb-t"><thead><tr><th>Mes</th><th class="r">Facturado</th><th class="r">Pagos</th><th class="r">Activos</th><th class="r">Sin pagar</th><th class="r">Ticket medio</th></tr></thead><tbody>
          ${s.months.map(m => `<tr class="${`${year}-${String(m.m + 1).padStart(2, '0')}` === ym ? 'cur' : ''}"><td>${MESES[m.m]}</td><td class="r">${m.total ? eur(m.total) : '–'}</td><td class="r">${m.n || '–'}</td><td class="r">${m.activos || '–'}</td><td class="r">${m.pend || '–'}</td><td class="r">${m.n ? eur(m.total / m.n) : '–'}</td></tr>`).join('')}
          <tr class="tot"><td>Total</td><td class="r">${eur(s.months.reduce((a, m) => a + m.total, 0))}</td><td class="r">${s.months.reduce((a, m) => a + m.n, 0)}</td><td class="r">máx ${Math.max(0, ...s.months.map(m => m.activos))}</td><td></td><td class="r">${(() => { const n = s.months.reduce((a, m) => a + m.n, 0); return n ? eur(s.months.reduce((a, m) => a + m.total, 0) / n) : '–'; })()}</td></tr>
        </tbody></table></div></section>
        <div class="grid2">
          <section class="card"><h3>Por servicio · ${year}</h3>${Object.keys(s.bySvc).length ? `<ul class="cb-split">${Object.entries(s.bySvc).sort((a, b) => b[1] - a[1]).map(([k2, v]) => { const tot = Object.values(s.bySvc).reduce((a, x) => a + x, 0); return `<li><span>${esc(k2)}</span><i style="--w:${Math.round(v / tot * 100)}%"></i><b>${eur0(v)}</b></li>`; }).join('')}</ul>` : '<p class="empty">Sin pagos ese año.</p>'}</section>
          <section class="card"><h3>Clientes por plan (hoy)</h3>${Object.keys(s.byPlan).length ? `<ul class="cb-split">${Object.entries(s.byPlan).sort((a, b) => b[1] - a[1]).map(([k2, v]) => `<li><span>${esc(k2)}</span><i style="--w:${Math.round(v / s.act.length * 100)}%"></i><b>${v}</b></li>`).join('')}</ul>` : '<p class="empty">Sin clientes activos.</p>'}</section>
        </div>
        ${s.byYear.length > 1 ? `<section class="card"><h3>Facturación anual</h3><ul class="cb-split">${s.byYear.map(y => `<li><span>${y.y}</span><i style="--w:${Math.round(y.total / Math.max(1, ...s.byYear.map(x => x.total)) * 100)}%"></i><b>${eur0(y.total)}</b></li>`).join('')}</ul></section>` : ''}
      </div>
      <div data-cpane="matriz" ${st.tab === 'matriz' ? '' : 'hidden'}>
        <div class="np-plans">${s.years.map(y => `<button type="button" class="chip sm ${y === String(year) ? 'on' : ''}" data-year="${y}">${y}</button>`).join('')}</div>
        <section class="card flush"><div class="tscroll"><table class="cb-mx"><thead><tr><th>Cliente</th>${MES_C.map((m, i) => `<th class="${`${year}-${String(i + 1).padStart(2, '0')}` === ym ? 'cur' : ''}">${m}</th>`).join('')}</tr></thead><tbody>
          ${mx.map(r => `<tr><td>${esc(r.b.name)}</td>${r.cells.map((x, i) => `<td class="${x.k} ${`${year}-${String(i + 1).padStart(2, '0')}` === ym ? 'cur' : ''}" title="${esc(x.t)}">${x.k === 'ok' ? '✔<small>' + esc(shortPlan(x.t)) + '</small>' : x.k === 'miss' ? '✘' : x.k === 'off' ? '—' : ''}</td>`).join('')}</tr>`).join('')}
        </tbody></table></div><p class="muted small pad">✔ mes cubierto por un pago (con su plan) · ✘ activo sin pago · — en pausa. El mes actual sale resaltado.</p></section>
      </div>`;
    box.querySelector('[data-pay]').onclick = () => payForm({ onDone: re });
    box.querySelector('[data-newbc]').onclick = () => bcForm(null, { onDone: re });
    box.querySelector('[data-tar]').onclick = () => tariffsForm(re);
    box.querySelectorAll('[data-ctab]').forEach(b => b.onclick = () => { st.tab = b.dataset.ctab; re(); });
    box.querySelectorAll('[data-filt]').forEach(b => b.onclick = () => { st.filt = b.dataset.filt; re(); });
    box.querySelectorAll('[data-year]').forEach(b => b.onclick = () => { st.year = b.dataset.year; re(); });
    box.querySelectorAll('[data-payfor]').forEach(b => b.onclick = () => payForm({ bcId: b.dataset.payfor, onDone: re }));
    box.querySelectorAll('[data-wa]').forEach(a => a.addEventListener('click', () => { logWa(c.byId[a.dataset.wa]).then(() => setTimeout(re, 400)); }));
    box.querySelectorAll('[data-edit]').forEach(el => { const go = () => bcForm(c.byId[el.dataset.edit], { onDone: re }); el.onclick = go; el.onkeydown = e => { if (e.key === 'Enter') go(); }; });
    box.querySelectorAll('[data-pedit]').forEach(el => { const go = () => payForm({ payment: c.P.find(p => p.id === el.dataset.pedit), onDone: re }); el.onclick = go; el.onkeydown = e => { if (e.key === 'Enter') go(); }; });
    { const cur = box.querySelector('.cb-mx th.cur'), sc = cur && cur.closest('.tscroll'); if (sc) sc.scrollLeft = Math.max(0, cur.offsetLeft - 160); }
    const q = box.querySelector('[data-q]'); if (q) q.oninput = () => { st.q = q.value; clearTimeout(q._t); q._t = setTimeout(() => { re().then(() => { const n = box.querySelector('[data-q]'); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } }); }, 250); };
  }

  // ---------- pestaña Cobros de la ficha del cliente
  async function clientTab(cl, box, { rerender } = {}) {
    const { esc, ic } = U();
    const c = await load(true), re = rerender || (() => clientTab(cl, box));
    const b = c.list.find(x => x.client_id === cl.id) || null;
    if (!b) {
      const free = c.list.filter(x => !x.client_id), guess = free.find(x => norm(x.name) === norm(cl.sheet_name || cl.name) || norm(x.email) === norm(cl.email));
      box.innerHTML = `<section class="card"><h3>Sin ficha de cobro</h3><p class="muted small">${esc(cl.name)} todavía no está en Cobros. Créale la ficha (plan, precio y método) o vincúlala a una que ya exista.</p>
        <div class="row gap wrap"><button class="btn primary" data-new>${ic('plus')} Crear ficha de cobro</button>
        ${free.length ? `<select data-link><option value="">Vincular con…</option>${free.map(x => `<option value="${x.id}" ${guess && guess.id === x.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select><button class="btn" data-dolink>Vincular</button>` : ''}</div></section>`;
      box.querySelector('[data-new]').onclick = () => bcForm(null, { clientId: cl.id, name: cl.sheet_name || cl.name, onDone: re });
      const dl = box.querySelector('[data-dolink]'); if (dl) dl.onclick = async () => { const id = box.querySelector('[data-link]').value; if (!id) return; await U().safe(() => window.DB.update('billing_clients', id, { client_id: cl.id }), 'Vinculado'); await after(id); re(); };
      return;
    }
    const wa = waUrl(b, [cl]);
    box.innerHTML = `<div class="kpis small">
        <div class="kpi"><small>Plan actual</small><b class="txt">${esc(b.paused ? 'En pausa' : b.plan)}</b><span>${b.paused ? 'sin cobros ni avisos' : `${eur(b.cuota)}${b.price_custom != null && b.t && Number(b.price_custom) !== Number(b.t.price) ? ` · pactado (tarifa ${eur(b.t.price)})` : ''}`}</span></div>
        <div class="kpi ${b.estado === 'VENCIDO' ? 'warn' : ''}"><small>Próximo vencimiento</small><b class="txt">${b.vence ? fd(b.vence, { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}</b><span>${pillOf(b)}</span></div>
        <div class="kpi"><small>Pagado este mes</small><b class="txt">${b.pagadoMes == null ? '—' : b.pagadoMes ? '✔ Sí' : '✘ No'}</b><span>${b.method ? esc(b.method) : ''}</span></div>
        <div class="kpi"><small>Total pagado</small><b class="txt">${eur(b.total)}</b><span>${b.pays.length} pago${b.pays.length === 1 ? '' : 's'}${b.start_date ? ` · cliente desde ${fd(b.start_date, { month: 'short', year: 'numeric' })}` : ''}</span></div>
        ${Number(b.split_pending) > 0 ? `<div class="kpi warn"><small>Pendiente fraccionado</small><b class="txt">${eur(b.split_pending)}</b><span>por cobrar</span></div>` : ''}
      </div>
      ${b.notes ? `<p class="note small">📝 ${esc(b.notes)}</p>` : ''}
      <div class="row gap wrap"><button class="btn primary" data-pay>${ic('plus')} Registrar pago</button><button class="btn" data-edit>${ic('edit')} Plan y datos</button>
        ${wa && !b.paused ? `<a class="btn ghost" target="_blank" rel="noopener" data-wa="${b.id}" href="${esc(wa)}">${ic('wa')} Recordatorio</a>` : ''}</div>
      ${noticeTxt(b) ? `<p class="note small cb-avp">${noticeTxt(b)}</p>` : ''}
      <section class="card flush"><h3 class="pad">Pagos</h3><ul class="cb-list cb-pays">${b.pays.map(p => `<li data-pedit="${p.id}" role="button" tabindex="0"><span class="cb-d">${fd(p.paid_on)}</span>
        <span class="grow"><b>${esc(p.plan || '')}</b><small>${p.method ? esc(p.method) + ' · ' : ''}cubre hasta ${fd(p.covers_until)}${p.notes ? ' · ' + esc(p.notes) : ''}</small></span><b class="cb-amt">${eur(p.amount)}</b></li>`).join('') || '<li class="muted">Aún sin pagos.</li>'}</ul></section>`;
    box.querySelector('[data-pay]').onclick = () => payForm({ bcId: b.id, onDone: re });
    box.querySelector('[data-edit]').onclick = () => bcForm(b, { onDone: re });
    box.querySelectorAll('[data-wa]').forEach(a => a.addEventListener('click', () => { logWa(b).then(() => setTimeout(re, 400)); }));
    box.querySelectorAll('[data-pedit]').forEach(el => el.onclick = () => payForm({ payment: b.pays.find(p => p.id === el.dataset.pedit), onDone: re }));
  }

  // Al crear o editar un cliente de la app: su ficha de cobro (nueva o vinculada por nombre)
  async function linkClient(cl, { plan, price, method, start } = {}) {
    const c = await load(true), DB = window.DB;
    if (c.list.some(x => x.client_id === cl.id)) return;
    const ex = c.list.find(x => !x.client_id && (norm(x.name) === norm(cl.sheet_name || cl.name) || (cl.email && norm(x.email) === norm(cl.email))));
    if (ex) { await DB.update('billing_clients', ex.id, { client_id: cl.id }); await after(ex.id); return; }
    if (!plan) return;
    const r = await DB.insert('billing_clients', { client_id: cl.id, name: String(cl.sheet_name || cl.name).trim(), plan, price_custom: num(price), method: method || 'Bizum', start_date: start || today(), phone: cl.phone || null, email: cl.email || null, position: c.list.length });
    await after(r[0].id);
  }

  // ---------- modo demo: datos inventados
  async function seedDemo() {
    const DB = window.DB, t0 = today();
    const T = [['Mensual Entreno', 'Entreno', 70, 1], ['Mensual Nutrición', 'Nutrición', 50, 1], ['Mensual Mixto', 'Mixto', 110, 1], ['Trimestral Entreno', 'Entreno', 180, 3], ['Trimestral Mixto', 'Mixto', 291, 3], ['Semestral Mixto', 'Mixto', 510, 6]];
    await DB.insert('tariffs', T.map(([plan, service, price, months], i) => ({ plan, service, price, months, position: i })));
    const cl = (await DB.list('clients')).filter(x => !x.is_template);
    const mk = async (name, plan, months, amount, startAgo, extra = {}) => {
      const client = cl.find(x => x.name === name) || null;
      const r = await DB.insert('billing_clients', Object.assign({ name, plan, method: 'Bizum', start_date: addDays(t0, -startAgo), client_id: client ? client.id : null, position: 0 }, extra));
      const pays = []; for (let d = addDays(t0, -startAgo); d <= t0; d = addMonths(d, months)) pays.push({ billing_client_id: r[0].id, paid_on: d, plan, service: plan.split(' ')[1], amount, method: 'Bizum', covers_until: addMonths(d, months) });
      if (extra.skipLast) pays.pop();
      await DB.insert('payments', pays);
    };
    await mk('Laura Martín', 'Mensual Mixto', 1, 110, 160);
    await mk('Carlos Ruiz', 'Mensual Entreno', 1, 70, 120, { skipLast: true });
    await mk('Ana Pérez', 'Trimestral Mixto', 3, 260, 200, { price_custom: 260, notes: 'Precio pactado por ser la primera clienta' });
  }

  window.JMCobros = { available, load, asSheet, page, clientTab, payForm, bcForm, tariffsForm, linkClient, drop, mirror, addMonths };
})();
